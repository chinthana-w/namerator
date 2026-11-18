#!/usr/bin/env python3
"""Local web server and multilingual word-data adapters for Namerator."""

import argparse
import json
import re
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


LANGUAGES = {
    "ar": "Arabic",
    "bn": "Bengali",
    "cs": "Czech",
    "da": "Danish",
    "de": "German",
    "el": "Greek",
    "en": "English",
    "es": "Spanish",
    "fa": "Persian",
    "fi": "Finnish",
    "fr": "French",
    "he": "Hebrew",
    "hi": "Hindi",
    "hu": "Hungarian",
    "id": "Indonesian",
    "it": "Italian",
    "ja": "Japanese",
    "ko": "Korean",
    "la": "Latin",
    "nl": "Dutch",
    "no": "Norwegian",
    "pl": "Polish",
    "pt": "Portuguese",
    "ro": "Romanian",
    "ru": "Russian",
    "sv": "Swedish",
    "th": "Thai",
    "tr": "Turkish",
    "uk": "Ukrainian",
    "vi": "Vietnamese",
    "zh": "Chinese",
}
WIKTIONARY_API = "https://en.wiktionary.org/w/api.php"
CONCEPTNET_API = "https://api.conceptnet.io"
USER_AGENT = "Namerator/1.0 (self-hosted word explorer)"
HTTP_TIMEOUT = 8
MAX_BODY_SIZE = 64 * 1024
_cache = {}
_cache_lock = threading.Lock()


class ProviderError(Exception):
    def __init__(self, provider, message):
        super().__init__(message)
        self.provider = provider


def _request_json(url, provider):
    request = Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(request, timeout=HTTP_TIMEOUT) as response:
            data = response.read(2_000_000)
    except HTTPError as error:
        raise ProviderError(provider, "upstream returned HTTP {}".format(error.code))
    except (URLError, TimeoutError, OSError) as error:
        raise ProviderError(provider, "could not reach provider: {}".format(error))
    try:
        return json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ProviderError(provider, "provider returned invalid JSON")


def _cached_json(url, provider, ttl=900):
    now = time.time()
    with _cache_lock:
        cached = _cache.get(url)
        if cached and cached[0] > now:
            return cached[1]
    result = _request_json(url, provider)
    with _cache_lock:
        _cache[url] = (now + ttl, result)
    return result


def _wiki_content(title):
    query = urlencode({
        "action": "query",
        "prop": "revisions",
        "rvprop": "content",
        "rvslots": "main",
        "format": "json",
        "formatversion": "2",
        "titles": title,
    })
    data = _cached_json("{}?{}".format(WIKTIONARY_API, query), "Wiktionary")
    pages = data.get("query", {}).get("pages", [])
    if not pages or pages[0].get("missing") is not None:
        return None
    revision = (pages[0].get("revisions") or [{}])[0]
    slots = revision.get("slots", {})
    main = slots.get("main", {})
    content = main.get("content", main.get("*"))
    if not isinstance(content, str):
        raise ProviderError("Wiktionary", "provider response did not contain page text")
    return content


def _page_sections(wikitext):
    headings = []
    for index, line in enumerate(wikitext.splitlines()):
        match = re.match(r"^(={2,6})\s*(.*?)\s*\1\s*$", line)
        if match:
            headings.append((index, len(match.group(1)), match.group(2).strip()))

    sections = []
    lines = wikitext.splitlines()
    for item_index, (line_index, level, title) in enumerate(headings):
        end = len(lines)
        for next_index, next_level, _ in headings[item_index + 1:]:
            if next_level <= level:
                end = next_index
                break
        sections.append({
            "level": level,
            "title": title,
            "text": "\n".join(lines[line_index + 1:end]),
        })
    return sections


def _language_section(wikitext, language):
    language_name = LANGUAGES.get(language)
    if not language_name:
        return []
    sections = _page_sections(wikitext)
    for index, section in enumerate(sections):
        if section["level"] != 2 or section["title"].lower() != language_name.lower():
            continue
        found = [section]
        for child in sections[index + 1:]:
            if child["level"] <= 2:
                break
            found.append(child)
        return found
    return []


def _direct_section_text(wikitext, title):
    lines = wikitext.splitlines()
    heading_index = None
    heading_level = None
    for index, line in enumerate(lines):
        match = re.match(r"^(={2,6})\s*(.*?)\s*\1\s*$", line)
        if match and match.group(2).strip() == title:
            heading_index = index
            heading_level = len(match.group(1))
            break
    if heading_index is None:
        return ""
    end = len(lines)
    for index in range(heading_index + 1, len(lines)):
        match = re.match(r"^(={2,6})\s*(.*?)\s*\1\s*$", lines[index])
        if match and len(match.group(1)) <= heading_level:
            end = index
            break
        if match and len(match.group(1)) > heading_level:
            end = index
            break
    return "\n".join(lines[heading_index + 1:end])


def _section_text(sections, names):
    normalized_names = {name.lower() for name in names}
    return [
        section["text"]
        for section in sections
        if section["level"] > 2 and section["title"].lower() in normalized_names
    ]


def _clean_wikitext(text):
    text = re.sub(r"<!--.*?-->", " ", text, flags=re.DOTALL)

    def replace_template(match):
        fields = match.group(1).split("|")
        name = fields[0].strip().lower()
        if name in {"bor", "inh", "der", "cog", "calque", "compound", "affix", "l", "m", "mention", "link", "term", "gloss"}:
            values = [value for value in fields[1:] if value and "=" not in value]
            return values[-1].strip() if values else " "
        return " "

    text = re.sub(r"\{\{([^{}]*)\}\}", replace_template, text)
    text = re.sub(r"\[\[([^]|]+)\|([^]]+)\]\]", r"\2", text)
    text = re.sub(r"\[\[([^]]+)\]\]", r"\1", text)
    text = re.sub(r"\[https?://\S+\s+([^]]+)\]", r"\1", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"'{2,5}", "", text)
    text = re.sub(r"^\s*#+\s*", "", text, flags=re.MULTILINE)
    return re.sub(r"\s+", " ", text).strip()


def _template_terms(text, template_names):
    names = "|".join(re.escape(name) for name in template_names)
    pattern = re.compile(r"\{\{(?:" + names + r")\|([^|{}]+)\|([^|{}]+)", re.IGNORECASE)
    return [
        (match.group(1).strip().lower(), match.group(2).strip())
        for match in pattern.finditer(text)
    ]


def _wiki_links(text):
    ignored_prefixes = ("category:", "file:", "image:", "w:", "wikipedia:", "commons:")
    found = []
    for match in re.finditer(r"\[\[([^]|#]+)(?:#[^]|]*)?(?:\|([^]]+))?\]\]", text):
        target = match.group(1).strip()
        label = (match.group(2) or target).strip()
        if not target.lower().startswith(ignored_prefixes) and target:
            found.append(label)
    return found


def _extract_terms(text, language=None):
    terms = []
    for code, word in _template_terms(text, ("l", "m", "link", "mention")):
        if language is None or code == language:
            terms.append((code, word))
    for word in _wiki_links(text):
        terms.append((language, word))
    return terms


def _parse_entry(wikitext, language):
    sections = _language_section(wikitext, language)
    if not sections:
        return None

    definitions = []
    for section in sections:
        if section["level"] <= 2 or section["title"].lower() not in {
            "noun", "verb", "adjective", "adverb", "proper noun", "interjection",
            "pronoun", "preposition", "conjunction", "participle", "numeral",
            "article", "determiner", "particle",
        }:
            continue
        for line in section["text"].splitlines():
            if re.match(r"^#(?![:*])", line):
                definition = _clean_wikitext(line)
                if definition:
                    definitions.append(definition)
                    break
        if definitions:
            break

    etymology = ""
    for section in sections:
        if section["level"] > 2 and section["title"].lower().startswith("etymology"):
            cleaned = _clean_wikitext(_direct_section_text(wikitext, section["title"]))
            if cleaned:
                sentence_end = cleaned.find(". ", 0, 280)
                if sentence_end >= 40:
                    cleaned = cleaned[:sentence_end + 1]
                elif len(cleaned) > 280:
                    cleaned = cleaned[:277] + "..."
                etymology = cleaned
                break
    synonyms = []
    for text in _section_text(sections, ("Synonyms", "Near-synonyms", "Related terms")):
        synonyms.extend(_extract_terms(text, language))

    translations = []
    for text in _section_text(sections, ("Translations",)):
        translations.extend(_template_terms(
            text, ("t", "t+", "t-", "tt", "t-check", "t-simple", "t-needed")
        ))

    pronunciations = []
    rhymes = []
    for section in sections:
        if section["title"].lower() != "pronunciation":
            continue
        for match in re.finditer(r"\{\{IPA\|([^|{}]+)((?:\|[^|{}]+)*)", section["text"]):
            fields = [value.strip() for value in match.group(2).split("|") if value.strip()]
            if match.group(1).strip().lower() == language:
                pronunciations.extend(
                    value for value in fields
                    if value not in ("~", "*") and not value.startswith(("q=", "a=", "ref="))
                )
        for match in re.finditer(r"\{\{rhymes\|([^|{}]+)((?:\|[^|{}]+)*)", section["text"]):
            fields = [value.strip() for value in match.group(2).split("|") if value.strip()]
            if match.group(1).strip().lower() == language:
                rhymes.extend(value for value in fields if "=" not in value)

    return {
        "language": language,
        "definition": definitions[0] if definitions else "",
        "etymology": etymology,
        "pronunciation": list(dict.fromkeys(pronunciations)),
        "rhymes": list(dict.fromkeys(rhymes)),
        "synonyms": list(dict.fromkeys(synonyms)),
        "translations": list(dict.fromkeys(translations)),
    }


def _parse_rhyme_page(wikitext, language):
    sections = _page_sections(wikitext)
    rhyme_sections = [
        section["text"] for section in sections
        if section["title"].lower() == "rhymes"
    ]
    results = []
    for text in rhyme_sections:
        results.extend(_extract_terms(text, language))
    return list(dict.fromkeys(results))


def _conceptnet_related(word, language):
    path = "/related/c/{}/{}".format(language, quote(word.strip().replace(" ", "_"), safe=""))
    query = urlencode({"limit": 100})
    data = _cached_json("{}{}?{}".format(CONCEPTNET_API, path, query), "ConceptNet")
    results = []
    for item in data.get("related", []):
        label = item.get("label")
        identifier = item.get("@id", "")
        parts = identifier.strip("/").split("/")
        code = parts[1] if len(parts) > 1 and parts[0] == "c" else language
        if isinstance(label, str) and label.strip() and code:
            try:
                weight = float(item.get("weight", 0) or 0)
            except (TypeError, ValueError):
                weight = 0.0
            results.append((code, label.strip(), weight))
    return results


def _validate_word(item):
    if not isinstance(item, dict):
        raise ValueError("Each word must include a word and language code.")
    word = item.get("word")
    language = item.get("language")
    if not isinstance(word, str) or not word.strip() or len(word.strip()) > 100:
        raise ValueError("Words must contain between 1 and 100 characters.")
    if not isinstance(language, str) or language not in LANGUAGES:
        raise ValueError("Use a supported two-letter language code.")
    return {"word": word.strip(), "language": language}


def _normalized(word):
    return re.sub(r"\s+", " ", word.strip().casefold())


def _source_details(providers, language, word):
    source_info = {
        "ConceptNet": (
            "https://conceptnet.io/c/{}/{}".format(
                language, quote(word.strip().replace(" ", "_"), safe="")
            ),
            "See linked source license",
        ),
        "Wiktionary": (
            "https://en.wiktionary.org/wiki/{}".format(
                quote(word.strip().replace(" ", "_"), safe="")
            ),
            "CC BY-SA 4.0 / GFDL",
        ),
    }
    return [
        {"name": provider, "url": source_info[provider][0], "license": source_info[provider][1]}
        for provider in sorted(providers)
        if provider in source_info
    ]


def _collect_candidates(words, mode, preferred, avoided, excluded):
    per_seed = []
    warnings = []
    for seed in words:
        found = {}

        def add(language, word, score, relation, provider):
            if not isinstance(language, str) or not isinstance(word, str):
                return
            word = word.strip()
            if (
                not word or not word[0].isalpha() or language not in LANGUAGES or
                _normalized(word) in excluded
            ):
                return
            if _normalized(word) == _normalized(seed["word"]):
                return
            key = (language, _normalized(word))
            entry = found.setdefault(key, {
                "word": word,
                "language": language,
                "score": 0.0,
                "relations": set(),
                "providers": set(),
            })
            entry["score"] += score
            entry["relations"].add(relation)
            entry["providers"].add(provider)

        if mode in ("meaning", "both"):
            try:
                for language, word, score in _conceptnet_related(seed["word"], seed["language"]):
                    add(language, word, score, "Related meaning", "ConceptNet")
            except ProviderError as error:
                warnings.append({"provider": error.provider, "message": str(error)})

        wiki_page = None
        entry = None
        try:
            wiki_page = _wiki_content(seed["word"])
            if wiki_page:
                entry = _parse_entry(wiki_page, seed["language"])
        except ProviderError as error:
            warnings.append({"provider": error.provider, "message": str(error)})

        if entry and mode in ("meaning", "both"):
            for language, word in entry["synonyms"]:
                add(language, word, 1.0, "Similar meaning", "Wiktionary")
            for language, word in entry["translations"]:
                add(language, word, 0.7, "Translation", "Wiktionary")

        if entry and mode in ("sound", "both"):
            sound_origins = [(seed["language"], seed["word"], entry)]
            translation_options = entry["translations"]
            if preferred:
                translation_options = sorted(
                    translation_options,
                    key=lambda item: (item[0] not in preferred, item[0]),
                )
            seen_origins = {(seed["language"], _normalized(seed["word"]))}
            for language, word in translation_options:
                if language in avoided or language not in LANGUAGES:
                    continue
                origin_key = (language, _normalized(word))
                if origin_key in seen_origins:
                    continue
                seen_origins.add(origin_key)
                try:
                    translated_page = _wiki_content(word)
                    translated_entry = _parse_entry(translated_page, language) if translated_page else None
                except ProviderError as error:
                    warnings.append({"provider": error.provider, "message": str(error)})
                    continue
                if translated_entry:
                    sound_origins.append((language, word, translated_entry))
                if len(sound_origins) >= 5:
                    break

            for language, origin_word, sound_entry in sound_origins:
                for rhyme in sound_entry["rhymes"][:3]:
                    rhyme_title = "Rhymes:{}/{}".format(LANGUAGES[language], rhyme)
                    try:
                        rhyme_page = _wiki_content(rhyme_title)
                    except ProviderError as error:
                        warnings.append({"provider": error.provider, "message": str(error)})
                        continue
                    if not rhyme_page:
                        continue
                    for candidate_language, candidate_word in _parse_rhyme_page(rhyme_page, language):
                        add(candidate_language, candidate_word, 0.8, "Sounds like", "Wiktionary")

        per_seed.append(found)

    if not per_seed:
        return [], warnings

    required = len(per_seed)
    keys = set(per_seed[0])
    for seed_results in per_seed[1:]:
        keys.intersection_update(seed_results)

    excluded_languages = set(avoided)
    preferred_languages = set(preferred)
    results = []
    for key in keys:
        if key[0] in excluded_languages:
            continue
        entries = [seed_results[key] for seed_results in per_seed]
        result = {
            "word": entries[0]["word"],
            "language": key[0],
            "score": sum(entry["score"] for entry in entries) / required,
            "relations": sorted(set().union(*(entry["relations"] for entry in entries))),
            "providers": sorted(set().union(*(entry["providers"] for entry in entries))),
        }
        result["sources"] = _source_details(
            result["providers"], result["language"], result["word"]
        )
        results.append(result)

    results.sort(key=lambda item: (
        item["language"] not in preferred_languages,
        -item["score"],
        item["word"].casefold(),
    ))
    return results, warnings


def _describe(word):
    page = _wiki_content(word["word"])
    if not page:
        return None
    entry = _parse_entry(page, word["language"])
    if not entry:
        return None
    return {
        "word": word["word"],
        "language": word["language"],
        "languageName": LANGUAGES[word["language"]],
        "definition": entry["definition"],
        "etymology": entry["etymology"],
        "pronunciation": entry["pronunciation"],
        "source": "Wiktionary",
        "sourceUrl": "https://en.wiktionary.org/wiki/{}".format(quote(word["word"].replace(" ", "_"), safe="")),
        "license": "CC BY-SA 4.0 / GFDL",
        "sources": _source_details(["Wiktionary"], word["language"], word["word"]),
    }


class NameratorHandler(SimpleHTTPRequestHandler):
    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/health":
            return self._send_json(200, {"ok": True})
        return super().do_GET()

    def do_POST(self):
        if self.path not in ("/api/explore", "/api/describe"):
            return self._send_json(404, {"error": "API route not found."})
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self._send_json(400, {"error": "Invalid request length."})
        if content_length <= 0 or content_length > MAX_BODY_SIZE:
            return self._send_json(413, {"error": "Request body must be between 1 byte and 64 KB."})
        try:
            body = json.loads(self.rfile.read(content_length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return self._send_json(400, {"error": "Request body must be valid JSON."})
        if not isinstance(body, dict):
            return self._send_json(400, {"error": "Request body must be a JSON object."})

        try:
            if self.path == "/api/describe":
                word = _validate_word(body)
                description = _describe(word)
                if not description:
                    return self._send_json(404, {"error": "No Wiktionary entry was found for this word and language."})
                return self._send_json(200, description)

            words = body.get("words")
            if not isinstance(words, list) or not 1 <= len(words) <= 5:
                raise ValueError("Explore requires between 1 and 5 source words.")
            words = [_validate_word(word) for word in words]
            count = body.get("count", 5)
            if not isinstance(count, int) or isinstance(count, bool) or not 1 <= count <= 12:
                raise ValueError("The result count must be between 1 and 12.")
            mode = body.get("mode", "both")
            if mode not in ("meaning", "sound", "both"):
                raise ValueError("Mode must be meaning, sound, or both.")
            preferred = body.get("preferredLanguages", [])
            avoided = body.get("avoidedLanguages", [])
            if not isinstance(preferred, list) or not isinstance(avoided, list):
                raise ValueError("Language preferences must be lists of language codes.")
            if any(
                not isinstance(code, str) or code not in LANGUAGES
                for code in preferred + avoided
            ):
                raise ValueError("Language preferences must use supported language codes.")
            exclude = body.get("exclude", [])
            if not isinstance(exclude, list) or any(not isinstance(item, str) for item in exclude):
                raise ValueError("Excluded words must be a list of strings.")
            results, warnings = _collect_candidates(
                words, mode, preferred, avoided, {_normalized(word) for word in exclude}
            )
            if warnings and not results and all(
                warning["provider"] == "ConceptNet" for warning in warnings
            ):
                warnings.append({
                    "provider": "Wiktionary",
                    "message": "No matching Wiktionary synonyms, translations, or rhymes were found.",
                })
            return self._send_json(200, {"results": results[:count], "warnings": warnings})
        except ValueError as error:
            return self._send_json(400, {"error": str(error)})
        except ProviderError as error:
            return self._send_json(502, {
                "error": "A word-data provider failed.",
                "provider": error.provider,
                "message": str(error),
            })


def main():
    parser = argparse.ArgumentParser(description="Run the Namerator word explorer.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4173)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), NameratorHandler)
    print("Namerator running at http://{}:{}".format(args.host, args.port))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Namerator.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
