# Namerator

A self-hosted word explorer for following meaning, sound, and etymology across languages.

## Run locally

Python 3.9 or newer is required. No package installation is needed.

```bash
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The Python server serves the app and its same-origin generator API. Use `python3 server.py --host 0.0.0.0` to make it reachable on your local network.

If word actions report that the local server returned an unexpected page, an older static-only server is still running. Stop it and restart with `npm start`; the word explorer requires `server.py` for its API.

## Explore

- Right-click the canvas or use **Add word** to create an editable word block.
- Right-click a word to explore by meaning or sound, add its description and roots, join it to another block, or remove it.
- Joining two blocks creates a shared node; exploring that node searches for suggestions connected to every linked word.
- Set a result count and preferred or avoided languages in the sidebar. Settings, blocks, and removed-word exclusions last for the current page session.
- Drag blocks to arrange the canvas, drag the blank canvas to pan, and use the zoom buttons to adjust the view.

## Word data and attribution

The backend uses the read-only [ConceptNet API](https://github.com/commonsense/conceptnet5/wiki/API) for semantic associations and [Wiktionary](https://en.wiktionary.org/) for definitions, translations, etymologies, pronunciations, and rhyme lists. Both sources are free to query and do not require API keys. The app links to sources on generated blocks; Wiktionary text is available under CC BY-SA 4.0 and GFDL, and ConceptNet data carries source-specific licenses (commonly CC BY-SA 4.0).

Coverage depends on the source entry: a word may have no etymology, pronunciation, translations, or rhyme index in the selected language. ConceptNet is an optional source; if it is unavailable, the backend reports that and uses matching Wiktionary data when possible. The app requires an internet connection to retrieve word data.

## Checks

```bash
npm test
npm run check
```
