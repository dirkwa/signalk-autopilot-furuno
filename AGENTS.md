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
- [lib/NavSourceAdvertiser.js](lib/NavSourceAdvertiser.js) — broadcasts a PGN 126464 Transmit PGN list containing 129283/129284/129285 on `nmea2000JsonOut` (on start, on `nmea2000OutAvailable`, and every 60 s), so the NavPilot offers Signal K's N2K interface as NAV data source. Gated by the `advertiseNavSource` setting (default on).
- [lib/RouteAdvancer.js](lib/RouteAdvancer.js) — while a Signal K route is active (any pilot mode), activates the next route point (`app.activateRoute`, absolute `pointIndex`) once the vessel enters the course's arrival circle (having been outside it for that point) or is past the waypoint's perpendicular, then starts the new leg at the vessel (see below). Computes both from positions itself; checked at most once per second on `navigation.position`. Gated by the `autoAdvanceRoute` setting (default on).
- [test/feedback.test.js](test/feedback.test.js) — `node:test` smoke suite for the feedback mapping, alarms, watchdog, and command gating.
- [test/nav-source.test.js](test/nav-source.test.js) — `node:test` suite for the Transmit PGN list advertisement.
- [test/route-advance.test.js](test/route-advance.test.js) — `node:test` suite for route auto-advance.

## How feedback works (the part that works)

Everything hangs off **PGN 127237 (Heading/Track Control)** delivered on the `N2KAnalyzerOut` event:

- `Steering Mode` → autopilot `mode`/`state`/`engaged` via `FURUNO_STEERING_MODE`: `Main Steering` → standby, `Heading Control Standalone` → auto, `Track Control` → nav.
- `Heading-To-Steer (Course)` → `target`.
- Limit flags → `Off-Heading Limit Exceeded` maps to the standard `heading` alarm, `Off-Track Limit Exceeded` to `xte`; `Rudder Limit Exceeded` / `Override` go out as notifications on `notifications.steering.autopilot.*`. All edge-triggered via `setAlarm()` / `setNotification()`.
- A watchdog (`checkConnection`) raises `connectionLost` if no 127237 arrives within `connectionTimeout` seconds, and clears it on recovery.

## NAV mode from Signal K (NAV data source)

The NavPilot steers NAV mode from the navigation PGNs 129283/129284/129285 of the device(s) selected under **Menu → Other Menu → NAV Option → Source** — and only offers a device there if its PGN 126464 Transmit PGN list includes those PGNs. Navigation PGNs from any other source address are ignored, and the pilot raises *No nav data* shortly after NAV is engaged. The gateway Signal K transmits through does not list them, so `NavSourceAdvertiser` broadcasts a Transmit PGN list on Signal K's output (same source address). The navigation PGNs themselves come from signalk-to-nmea2000, not from this plugin. Don't remove or narrow the advertisement without re-testing NAV on the pilot.

The pilot does not sequence a route itself — it steers to whatever destination 129284 carries, and after passing it turns back towards it. Signal K's Course API does not advance a route on arrival either (that is left to clients such as Freeboard-SK, whose option runs in the browser and is off by default), so `RouteAdvancer` switches to the next route point as soon as the vessel enters the arrival circle, or passes the waypoint's perpendicular. Entering the circle only counts once the vessel has been outside it for that point: where the circles of close waypoints overlap, the next one is advanced from on passing it rather than at once, so no waypoint is skipped. It advances in any pilot mode, so with `autoAdvanceRoute` on (the default) the destination is not left behind the boat when NAV is engaged later; with it off, advancing is up to the user or another client.

After switching, the leg starts at the vessel rather than at the reached waypoint (`activateRoute` always starts it at the previous route point, which leaves the boat off the new track line and makes the pilot correct hard). The Course API does this for `PUT …/navigation/course/restart`, but offers it to plugins only as `app.restartCourse()` where the server has it; on older servers `startLegAtVessel` sets `app.courseApi.courseInfo.previousPoint` and calls `emitCourseInfo(false, 'previousPoint')` — server internals, feature-checked, with the reached waypoint as the leg start if neither exists. Drop the internals path once `restartCourse` is in the servers this plugin supports.

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
- Release notes are GitHub's generated notes (`changelog-type: github`), grouped by PR label via [.github/release.yml](.github/release.yml). There is no CHANGELOG file (`skip-changelog`).
- Pre-releases: push a `vX.Y.Z-beta.N` / `-rc.N` tag by hand → published under the `beta` dist-tag.
- Repo setting **Allow GitHub Actions to create and approve pull requests** must stay on, or release-please cannot open its PR.
- `publish.yml` installs `npm@^11`: Node 22's bundled npm 10.9 has no OIDC support (the publish falls back to legacy auth and fails with a misleading 404). **Do NOT use `npm@latest`** — npm 12 breaks `--provenance` with `Cannot find module 'sigstore'`.
- The published tarball is controlled by the `files` whitelist in `package.json` (ships `index.js`, `lib/`, `doc/`, `LICENSE.md`, `LICENSE-MIT-through-v0.1.0.txt` + the always-included `README`). Keep dev/test files out of it.

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
