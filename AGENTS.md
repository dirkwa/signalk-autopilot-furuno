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

Releases are cut by [release-please](.github/workflows/release-please.yml) and published by [.github/workflows/publish.yml](.github/workflows/publish.yml) using **npm Trusted Publishing (OIDC, keyless)** with provenance:

- Don't bump `version` or tag by hand. A merge to `main` carrying a releasable commit makes release-please open or update a `chore: release X.Y.Z` PR. The version follows the commit types: `feat` → minor, `fix`/`perf` → patch, `!` or a `BREAKING CHANGE:` footer → major; a `Release-As: X.Y.Z` footer pins it.
- The `gate` job lets only releasable pushes reach release-please: `feat`, `fix`, `perf`, `revert`, any `type!:`, a `BREAKING CHANGE:` or `Release-As:` footer, `build(deps):`, or the release PR's own merge. A `docs:`/`ci:`/`chore:` merge does not propose a release. The gate's last alternative must match `pull-request-title-pattern` in [release-please-config.json](release-please-config.json) — change one, change both, or the release PR's merge stops creating tags. Run the workflow by hand (workflow_dispatch) to bypass the gate.
- Merging the release PR bumps `package.json` and [.release-please-manifest.json](.release-please-manifest.json), creates the `vX.Y.Z` tag and the GitHub release, then dispatches `publish.yml` on the tag (a tag created with `GITHUB_TOKEN` starts no workflow on its own). `publish.yml` must stay the publishing workflow: npm trusted publishing is bound to that file name.
- Release notes are GitHub's generated notes (`changelog-type: github`), grouped by PR label via [.github/release.yml](.github/release.yml). No CHANGELOG entries (`skip-changelog`); `CHANGELOG.md` covers 0.2.0 and earlier.
- Pre-releases: push a `vX.Y.Z-beta.N` / `-rc.N` tag by hand → published under the `beta` dist-tag.
- Repo setting **Allow GitHub Actions to create and approve pull requests** must stay on, or release-please cannot open its PR.
- `publish.yml` installs `npm@^11`: Node 22's bundled npm 10.9 has no OIDC support (the publish falls back to legacy auth and fails with a misleading 404). **Do NOT use `npm@latest`** — npm 12 breaks `--provenance` with `Cannot find module 'sigstore'`.
- The published tarball is controlled by the `files` whitelist in `package.json` (ships `index.js`, `lib/`, `doc/`, `CHANGELOG.md` + the always-included `README`/`LICENSE`). Keep dev/test files out of it.

## Licensing

From **0.2.0** this plugin is source-available, not open source: use and
modification are free, redistribution is not. `LICENSE.md` is authoritative.

- **0.1.0 and earlier were MIT and stay that way, permanently.** Never rewrite
  history, retag old releases, or edit the license on an existing tag.
- `LICENSE-MIT-through-v0.1.0.txt` keeps that history discoverable in the
  tarball. Do not delete it.
- The MIT copyright line read "SignalK Community" through v0.1.0 — an unedited
  GitHub template default, not an assignment. Every commit here is Dirk
  Wahrheit's; he was always the sole holder. The renamed file records both the
  correction and the reason. **Do not "restore" the old line** thinking it was
  deliberate.
- **Never propose returning to a permissive license** — that is the copyright
  holder's decision alone.
- `package.json` uses `"license": "SEE LICENSE IN LICENSE.md"`. This is not an
  SPDX-listed license; inventing an identifier breaks tooling validation.
- `CONTRIBUTING.md` carries an inbound contribution grant. Without it, merged
  contributions fragment ownership and make this kind of decision impossible to
  take again.
- The license text derives from a plain-language template whose authors permit
  adaptation only if all mention of their project is removed. It has been. Do
  not add attribution to them back in.
- **Runtime dependencies gate this.** A copyleft or share-alike runtime
  dependency would override the arrangement. This plugin currently has **zero**
  runtime dependencies, so the question is trivially settled — re-check if that
  ever changes.

## Conventions

- **Conventional commit** subjects and PR titles (`feat:`, `fix:`, `ci:`, `build:`, `chore:`).
- Work on a branch and open a PR; don't commit directly to `main`.
- `research/` holds local analysis notes and bus captures — it is **gitignored and must never be committed**. Keep it that way.
