import unittest
from unittest.mock import patch

import server


class WiktionaryParsingTests(unittest.TestCase):
    def test_extracts_meaning_roots_and_language_specific_relations(self):
        page = """==English==
===Etymology===
From {{bor|en|la|amor}}.
====Noun====
This nested section is not etymology.
===Noun===
# {{lb|en|uncountable}} Strong affection.
====Synonyms====
* {{l|en|adoration}}
====Pronunciation====
* {{IPA|en|/ˈlʌv/}}
* {{rhymes|en|ʌv}}
===Translations===
* French: {{t|fr|amour}}
==French==
===Noun===
# French definition.
"""
        entry = server._parse_entry(page, "en")

        self.assertEqual(entry["definition"], "Strong affection.")
        self.assertIn("amor", entry["etymology"])
        self.assertNotIn("nested section", entry["etymology"])
        self.assertEqual(entry["pronunciation"], ["/ˈlʌv/"])
        self.assertEqual(entry["rhymes"], ["ʌv"])
        self.assertIn(("en", "adoration"), entry["synonyms"])
        self.assertIn(("fr", "amour"), entry["translations"])

    def test_rhyme_page_extracts_words_for_the_requested_language(self):
        page = """==Rhymes==
* {{l|en|bat}}
* {{l|en|cat}}
* {{l|fr|chat}}
"""
        self.assertEqual(
            server._parse_rhyme_page(page, "en"),
            [("en", "bat"), ("en", "cat")],
        )


class CandidateRankingTests(unittest.TestCase):
    @patch.object(server, "_conceptnet_related")
    @patch.object(server, "_wiki_content")
    def test_exploration_excludes_removed_words_and_avoided_languages(self, wiki_content, conceptnet):
        wiki_content.return_value = """==English==
===Noun===
# a test word
====Synonyms====
* {{l|en|glad}}
* {{l|fr|heureux}}
"""
        conceptnet.side_effect = lambda word, language: [
            ("en", "joyful", 2.0),
            ("fr", "content", 1.0),
            ("en", ".gov", 1.0),
        ]
        results, warnings = server._collect_candidates(
            [{"word": "happy", "language": "en"}],
            "meaning",
            ["fr"],
            ["de", "fr"],
            {"joyful"},
        )

        self.assertEqual(warnings, [])
        self.assertEqual([item["word"] for item in results], ["glad"])

    @patch.object(server, "_conceptnet_related")
    @patch.object(server, "_wiki_content")
    def test_join_results_must_match_every_source_word(self, wiki_content, conceptnet):
        wiki_content.return_value = None

        def related(word, language):
            if word == "seed-one":
                return [("en", "shared", 1.0), ("en", "only-one", 1.0)]
            return [("en", "shared", 1.0), ("en", "only-two", 1.0)]

        conceptnet.side_effect = related
        results, _ = server._collect_candidates(
            [{"word": "seed-one", "language": "en"}, {"word": "seed-two", "language": "en"}],
            "meaning",
            [],
            [],
            set(),
        )

        self.assertEqual([item["word"] for item in results], ["shared"])


if __name__ == "__main__":
    unittest.main()
