# AGENTS.md

Notes for AI coding agents (and humans) working on this repository. User-facing usage lives in [README.md](README.md); this file is the orientation needed before making non-trivial changes.

## What this is

A Signal K server plugin that acts as an **autopilot provider** for the Furuno NavPilot (700 / 711C) over NMEA 2000. It registers with the Signal K Autopilot API (`registerAutopilotProvider`) and is **feedback-first**: it reports the pilot's live state into `steering.autopilot.*`. Remote command is unverified on this hardware and disabled by default (see "Commands").

Discovered by the appstore via the `signalk-node-server-plugin` / `signalk-category-autopilot` keywords. Plain CommonJS, no build step, no runtime dependencies.

## File layout

- [index.js](index.js) — plugin entrypoint: `id`/`name`, `schema`, and `start`/`stop` that create and drive one `AutopilotProvider`.
- [lib/AutopilotProvider.js](lib/AutopilotProvider.js) — the core. Registers the provider, subscribes to Signal K paths, listens for PGN 127237 on `N2KAnalyzerOut`, maps feedback into autopilot state, emits alarms/notifications, runs the connection watchdog, and implements the provider command methods (all gated — see below).
- [lib/N2KCommands.js](lib/N2KCommands.js) — builds/sends the (experimental) command PGNs. Emits on `nmea2000JsonOut`.
- [lib/SignalKPaths.js](lib/SignalKPaths.js) — subscribes to `navigation.heading*`, `steering.rudderAngle`, and XTE via `streambundle.getSelfBus`, for autopilot-detection and internal state.
- [test/feedback.test.js](test/feedback.test.js) — `node:test` smoke suite for the feedback mapping, alarms, watchdog, and command gating.

## How feedback works (the part that works)

Everything hangs off **PGN 127237 (Heading/Track Control)** delivered on the `N2KAnalyzerOut` event:

- `Steering Mode` → autopilot `mode`/`state`/`engaged` via `FURUNO_STEERING_MODE`: `Main Steering` → standby, `Heading Control Standalone` → auto, `Track Control` → nav.
- `Heading-To-Steer (Course)` → `target`.
- Limit flags → `Off-Heading Limit Exceeded` maps to the standard `heading` alarm, `Off-Track Limit Exceeded` to `xte`; `Rudder Limit Exceeded` / `Override` go out as notifications on `notifications.steering.autopilot.*`. All edge-triggered via `setAlarm()` / `setNotification()`.
- A watchdog (`checkConnection`) raises `connectionLost` if no 127237 arrives within `connectionTimeout` seconds, and clears it on recovery.

## Signal K Autopilot API gotchas (get these wrong and it silently breaks)

- **`autopilotUpdate(deviceId, apInfo)` only accepts** the keys `mode`, `state`, `target`, `engaged`, `options`, `actions`, `alarm`. Anything else (e.g. `heading`, `rudderAngle`) is silently dropped — those already live on standard paths, so don't republish them here.
- **Alarms** are emitted as `autopilotUpdate(id, { alarm: { path, value } })` where `path` ∈ `{waypointAdvance, waypointArrival, routeComplete, xte, heading, wind}`; the server publishes them to `notifications.steering.autopilot.<path>`. Non-standard alarms use `handleMessage` directly.
- **`getData` option shapes are strict**: `states` must be `[{ name, engaged }]` objects (not strings); `action.id` must be one of `dodge | tack | gybe | courseCurrentPoint | courseNextPoint`.
- **Field names are canboat Title-Case** (`"Steering Mode"`, `"Heading-To-Steer (Course)"`) because the server runs canboatjs with `useCamelCompat=false`. Use the tolerant `field()` helper (accepts Title-Case and camelCase) rather than reading a fixed spelling.

## Commands (experimental, off by default)

Remote command of this NavPilot over NMEA 2000 is **unverified**. Command methods (`setMode`, `engage`, `disengage`, `setTarget`, `adjustTarget`, `dodge`, and `setState`→disabled) call `requireCommands()` and **throw** unless the `experimentalCommands` setting is on. When enabled, `N2KCommands` emits Furuno-proprietary PGNs — 126720 for mode, 130827 for course — on `nmea2000JsonOut`. There is no relative-course PGN: "adjust ±N°" and dodge send a new **absolute** course. These may do nothing; treat any command work as best-effort until proven on real hardware.

## Build / test

- No build step. `npm test` runs the `node:test` suite. **Requires Node ≥ 22** (`engines.node`).
- Local install for on-boat testing: `npm install /path/to/signalk-autopilot-furuno` into the Signal K data dir, then enable the plugin.

## Publish

Tag-triggered via [.github/workflows/publish.yml](.github/workflows/publish.yml) using **npm Trusted Publishing (OIDC, keyless)** with provenance:

- Bump `version` in `package.json`, push a `vX.Y.Z` tag → the workflow runs `npm test` and `npm publish --provenance --access public`. `-beta.*` / `-rc.*` tags publish under the `beta` dist-tag.
- **Do NOT add `npm install -g npm@latest`** to the workflow — the self-update leaves a broken tree and `--provenance` fails with `Cannot find module 'sigstore'`. Use Node 22's bundled npm.
- The published tarball is controlled by the `files` whitelist in `package.json` (ships `index.js`, `lib/`, `doc/`, `CHANGELOG.md` + the always-included `README`/`LICENSE`). Keep dev/test files out of it.

## Conventions

- **Conventional commit** subjects and PR titles (`feat:`, `fix:`, `ci:`, `build:`, `chore:`).
- Work on a branch and open a PR; don't commit directly to `main`.
- `research/` holds local analysis notes and bus captures — it is **gitignored and must never be committed**. Keep it that way.
