# Persistent Web Skills Runtime

> Agents shouldn't relearn the web every time. Learn once, reuse, and self-repair when the web changes.

This hackathon MVP demonstrates the complete runtime loop:

`Native WebMCP → Cached Web Skill → Browser/DOM Learn → IndexedDB → Fingerprint Detect → Local Repair`

The built-in `taskboard.local` demo provides:

- a native `search_tasks()` WebMCP tool on page load;
- a guided **Learn → Reuse → Repair** run with 11 semantic browser actions;
- a **Break DOM** control that renames `Create Task` to `Add Task` and exercises a v1 → v2 locator patch;
- a **+ Native create_task** control that dispatches `toolchange` and proves live native catalog sync;
- a Runtime Inspector showing native tools, learned skills, versions, validation, and execution events.

## Run the demo

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:4173> and click **Run 90-sec demo**. The demo works without an API key because its browser-learning and local repair adapters are deterministic.

## Optional server reasoning layer

The server keeps the API key out of the browser bundle. It exposes:

- `POST /api/agent` — choose a catalog tool and input;
- `POST /api/generate-skill` — abstract an action trace into a skill draft;
- `POST /api/repair-skill` — patch one failed step;
- `GET /health` — report configuration without revealing credentials.

Copy `.env.example` to `.env.local` (never commit it) and set:

```bash
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5.5
PORT=8787
```

For an OpenAI-compatible gateway, set `OPENAI_BASE_URL` to its `/v1` endpoint. Start the API with:

```bash
npm run dev:server
```

The browser runtime treats API unavailability as a graceful fallback and can continue with local semantic repair.

## Build the MV3 extension

```bash
npm run build
```

Load `dist-extension/` as an unpacked extension in Chrome. The extension uses two content worlds:

1. `content/webmcp-bridge.js` runs in the page’s **MAIN** world and is the only code that touches `document.modelContext`.
2. `content/index.js` runs in the isolated world, stores snapshots, executes skills, and reports a tab-scoped snapshot to the service worker.

The bridge re-fetches `getTools()` before every native execution. RegisteredTool instances are never persisted; only `{name, description, inputSchema, origin, hash, lastSeen}` snapshots are stored.

## Verification

```bash
npm test
npm run typecheck
npm run build
```

The tests cover WebMCP discovery/rebinding and diffs, semantic locator priority, dependency-only fingerprints, explicit validation, IndexedDB version history, native-first catalog resolution, and the end-to-end Learn/Reuse/Repair orchestration.
