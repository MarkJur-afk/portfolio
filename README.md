# Portfolio — Developer in the Ruins

An interactive portfolio presented as a map of a ruined city. Each of four zones represents one technology; opening a zone lets you run real code for that technology directly in the browser. No build step and no backend: it is a static site.

## Zones

| Zone | Technology | What runs |
|------|------------|-----------|
| The Quiet City | Python | CPython compiled to WebAssembly (Pyodide 0.26.4) with a small `world` module that controls the scene |
| Snowbound | C# | `csharp.js`, a small C#-to-JavaScript translator and runtime (a subset of C#, not the .NET runtime) |
| The Drowned Quarter | SQL | SQLite compiled to WebAssembly (sql.js); results are rendered back into the scene |
| The Metro | JavaScript / HTML / CSS | Live editor running user code in a sandboxed iframe, with a `postMessage` bridge to the scene |

## Stack

- Vanilla JavaScript (no framework, no bundler), HTML, CSS
- Canvas 2D for the map effects and animated sprites (weather, particles, walk cycles)
- Pyodide (Python in WebAssembly) and sql.js (SQLite in WebAssembly), both vendored in `assets/vendor/` so the site works without a CDN
- Fonts: IBM Plex Mono and Special Elite (Google Fonts)

## Structure

```
.
├── index.html      # page shell: map stage, scene layer, HUD
├── app.js          # map, markers, camera transitions, effects, zone UIs
├── csharp.js       # C# -> JavaScript translator and runtime
├── style.css       # layout, HUD, panels
└── assets/
    ├── map.jpg     # main map
    ├── scenes/     # one background per zone (python, csharp, sql, web)
    ├── zombies/    # sprite frames (.webp)
    └── vendor/     # pyodide/, sql-wasm.js, sql-wasm.wasm
```

## Run locally

The site is static, but it loads WebAssembly files, so serve it over HTTP rather than opening `index.html` directly:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Notes

- The C# translator covers an everyday subset (classes, properties, constructors, inheritance, `if`/`for`/`foreach`/`while`/`switch`, string interpolation, `try`/`catch`, lambdas, `List<T>`, arrays, `Console`, `Math`, `Random`). LINQ, `Dictionary` and exact integer-division semantics are not supported.
- Python and SQL run client-side only; nothing is sent to a server.
- Interface: drag to pan, scroll to zoom, click a marker to enter a zone.

## Development

Developed with the help of AI tools (Claude Code with an MCP server) as an assistant.
