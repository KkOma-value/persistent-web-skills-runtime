# Title

Persistent Web Skills Runtime

## One-line Summary

A WebMCP-first Chrome runtime that lets agents learn a browser workflow once, reuse it as a versioned skill, and repair it when a page changes.

## Problem

Today, agents often have to rediscover a website through fragile clicks every time they perform a task. A workflow that succeeded yesterday can fail after a small UI change, while websites that expose structured WebMCP tools are not consistently prioritized or remembered. This makes browser automation slow, brittle, and difficult for people to trust.

## Solution

Persistent Web Skills Runtime (PWS) is a reliability layer for agentic web work. It routes every task through a clear priority ladder:

`Native WebMCP → Cached Web Skill → Browser/DOM learning fallback`

PWS discovers the page's current WebMCP tools first. If no suitable native tool exists, it can learn a successful browser workflow using semantic targets, store it in IndexedDB, validate the outcome on reuse, and patch only the failed step when a dependency changes. The result is a workflow that gets faster and more resilient with use instead of starting from zero.

## Why This Matters

WebMCP makes the web more usable by agents, but a useful agent experience also needs continuity. PWS gives people a way to demonstrate a task once and then gives agents durable, inspectable memory of how to complete it. When a site publishes a native capability, the agent takes the safer, structured route; when the site changes, the runtime detects the relevant change and repairs the smallest possible part of the saved workflow.

This creates a better experience for both sides:

- People retain control through a visible Runtime Inspector, execution log, validation status, and skill versions.
- Agents prefer native WebMCP capabilities over UI emulation.
- Repeated browser workflows become faster and more reliable instead of more fragile.

## How We Used AI

The optional server-side reasoning layer uses the OpenAI Responses API to turn an observed action trace into a reusable skill draft and to turn failed-step evidence into a targeted repair proposal. The browser bundle never receives an API key; when the API is unavailable, the runtime continues with deterministic local semantic repair.

AI is used as a bounded reasoning assistant, not as an opaque substitute for validation: PWS re-checks page dependencies and explicit success criteria before accepting a result.

## How We Used Codex

Codex was used to turn the product brief into the Chrome MV3 architecture, implement the React demo and extension runtime, add the server-side Responses API boundary, write automated tests, and run browser-based verification. It also helped iterate on the semantic locator and repair logic so a renamed control can create a validated v2 skill rather than replaying a brittle selector.

## Key Features

- **Native-first WebMCP routing.** The extension discovers `document.modelContext.getTools()`, subscribes to `toolchange`, and refreshes the active `RegisteredTool` immediately before executing a native call.
- **Safe capability snapshots.** It persists tool metadata only—name, description, input schema, origin, hash, and last-seen timestamp—never executable tool handlers.
- **Learn once, reuse later.** A successful browser trace is abstracted into a semantic skill and stored with version history in IndexedDB.
- **Semantic browser actions.** Locators prefer role/name, labels, stable attributes, and meaningful text before CSS; this avoids brittle structural selectors.
- **Dependency-only fingerprints.** The runtime fingerprints only the DOM elements a skill depends on, reducing false failures from unrelated page changes.
- **Validation and focused repair.** Every execution checks an explicit success condition. If a dependency is missing, PWS repairs the failed step, validates it, and saves an immutable successor version.
- **Observable live demo.** The taskboard demo shows an 11-action Learn → Reuse → Repair flow, a v1 → v2 patch after `Create Task` becomes `Add Task`, native `search_tasks()`, and live registration of `create_task()` through `toolchange`.

## Architecture

- **Demo UI:** React, TypeScript, Vite
- **Browser runtime:** Chrome Manifest V3 extension with a MAIN-world WebMCP bridge and isolated-world orchestration
- **Execution core:** native tool catalog, semantic DOM resolver, skill executor, validator, dependency fingerprinting, and repair engine
- **Persistence:** IndexedDB skill registry with immutable versions
- **Optional AI service:** Node API using the OpenAI Responses API; keys stay server-side

The extension limits access to `document.modelContext` to its MAIN-world bridge. The bridge re-discovers current tools for execution, while the isolated runtime works from snapshots and routes tasks through native tools, learned skills, or browser learning in that order.

## Testing Instructions

### Local demo

1. Run `npm install`.
2. Run `npm run dev`.
3. Open `http://127.0.0.1:4173`.
4. Click **Run 90-sec demo**. The demo learns a create-task workflow, reuses it, changes the button label from **Create Task** to **Add Task**, repairs the failed semantic step, and validates the v2 skill.
5. Click **+ Native create_task** to observe a live `toolchange` synchronization, then click **Test native search** to see native-first execution and current-tool rebinding.

The demo runs without an API key because its browser-learning and local repair adapters are deterministic. For the optional server reasoning layer, copy `.env.example` to `.env.local`, configure the Responses API credentials, and run `npm run dev:server`.

### Automated verification

- `npm test` — passed: 5 test files / 13 tests
- `npm run build` — passed: TypeScript type-check, production demo build, and extension build

The automated coverage includes WebMCP discovery and rebinding, tool-change synchronization, semantic locator resolution, fingerprint validation, IndexedDB version history, native-first routing, and end-to-end Learn/Reuse/Repair orchestration.

## Public Demo Link

**TODO — required before final submission.** The working demo is currently local only. Deploy the Vite app to a public HTTPS URL that judges can open in ChatGPT's in-app browser or Chrome with WebMCP enabled.

## Public Repository Link

**TODO — required before final submission.** The code is currently at [KkOma-value/persistent-web-skills-runtime](https://github.com/KkOma-value/persistent-web-skills-runtime), but that repository is currently private and has no open-source license. It must be made public and include a visible open-source license before being used in the Devpost submission.

## Demo Video

**TODO — required before final submission.** Publish a public YouTube video under three minutes, with audio, covering:

1. The problem: agents repeatedly relearn brittle browser workflows.
2. The priority ladder: Native WebMCP → Cached Skill → Browser/DOM learning.
3. The interactive demo: Learn → Reuse → Break DOM → Repair v1 → v2.
4. Dynamic native tool registration and native `search_tasks()` execution.
5. The user impact: agents become faster, more reliable, and easier to inspect.

## Screenshot Shot List

1. The hero and Runtime Inspector showing `search_tasks()` as a live native WebMCP tool.
2. The completed Learn → Reuse → Repair phases with timings.
3. The repaired v2 skill and the execution log showing `Create Task` → `Add Task`.
4. The Native WebMCP panel after `create_task()` appears through `toolchange`.
5. A native `search_tasks()` execution log showing current-tool rebinding.

## Submission Readiness Notes

The core application, tests, build, and a local interactive proof are ready. The remaining blockers are public release and hosted-demo assets, not the implementation:

- confirm project ownership and choose an open-source license;
- make the repository public;
- deploy a working HTTPS demo;
- record and publish the required YouTube demo;
- confirm personal and submission-specific Devpost answers below.

## Known Limitations

- The public live deployment, public source repository, public YouTube demo, and Devpost thumbnail are not yet available.
- The deterministic taskboard demo uses a WebMCP-compatible `document.modelContext` harness so the behavior is reproducible even when the experimental browser API is unavailable.
- The optional AI service requires server-side configuration; local semantic repair remains available without it.
- The current MVP covers a focused taskboard workflow rather than arbitrary multi-site automation.

## TODO Official Form Fields

### Devpost project profile

- **Name:** Persistent Web Skills Runtime
- **Tagline:** A WebMCP-first runtime that learns browser workflows once, reuses them reliably, and repairs them when the web changes.
- **Built with:** React, TypeScript, Vite, Chrome Extension Manifest V3, IndexedDB, Node.js, OpenAI Responses API
- **Description:** Use the sections above, condensed to the Devpost project description field.

### Required submission fields

- **Submitter Type:** TODO — confirm whether this is an `Individual`, `Team of Individuals`, or `Organization`.
- **Country of residence of yourself and team members if applicable:** TODO — enter directly on Devpost after confirming eligibility; do not place private residence data in this repository.
- **App Status:** Proposed answer: `New`. Please confirm this is correct. If the project existed before the submission period, select `Existing` and document the WebMCP work added during the submission period.
- **If Existing, explain updates:** Leave blank only if `New` is confirmed. Otherwise, describe the meaningful WebMCP extension with dated evidence.
- **Live URL:** TODO — add the deployed HTTPS URL.
- **Testing instructions:** Use the testing instructions above; add credentials only if a future deployment requires them.
- **Public code repository:** TODO — add the public, licensed repository URL after its visibility and license are confirmed.
- **Which agents or clients did you test your WebMCP tools with?:** Google Chrome local demo, the Chrome MV3 extension path, and deterministic automated WebMCP runtime tests. The local demo verifies native `search_tasks()`, live `toolchange` synchronization, current-tool rebinding, semantic workflow reuse, result validation, and a v1 → v2 repair.
- **Which AI tools have you leveraged?:** OpenAI Codex for planning, implementation, testing, and iteration; an OpenAI-compatible Responses API for optional server-side skill drafting and failed-step repair.
- **Level of learning derived:** Proposed answer: `Significant`. TODO — confirm this is your answer.
- **Did you gain AI value usable in your career?:** Proposed answer: `Yes`. TODO — confirm this is your answer.
