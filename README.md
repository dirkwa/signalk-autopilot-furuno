# signalk-autopilot-furuno

Signal K Autopilot Provider plugin for the Furuno NavPilot (700/711C) via NMEA 2000.

Status: **feedback works; remote command is unverified.** This plugin reports the
NavPilot's live state to Signal K and can act as a feedback provider. Remote command
is disabled by default — see "Remote command" below.

## What works

- **Mode feedback** from PGN 127237 `Steering Mode`:
  `Main Steering` → standby, `Heading Control Standalone` → auto, `Track Control` → nav.
- **Rudder / heading feedback** from PGN 127245 / 127237.
- **NAV mode from Signal K:** the NavPilot steers to a destination set in Signal K
  (e.g. Freeboard-SK "Navigate here") — see below.

## NAV mode: steering to a Signal K destination

In NAV mode the NavPilot follows the standard navigation PGNs 129283 (cross track error),
129284 (navigation data) and 129285 (route/waypoint information) from its selected NAV data
source. Signal K can be that source:

1. Emit the navigation PGNs with
   [signalk-to-nmea2000](https://github.com/dirkwa/signalk-to-nmea2000): enable
   "Cross Track Error (129283)", "Navigation Data (129284)" and "Route/WP Information (129285)".
2. Leave **Advertise Signal K as NavPilot NAV data source** enabled in this plugin (default).
   The NavPilot only offers a device as NAV data source if that device announces the navigation
   PGNs in its transmit PGN list (PGN 126464). The gateway Signal K sends through does not, so
   the plugin broadcasts that list on Signal K's NMEA 2000 output.
3. On the NavPilot, select Signal K's NMEA 2000 interface as NAV data source:
   **Menu → Other Menu → NAV Option → Source**. Devices are listed as `NMEA 20:<id>`; the entry
   for the gateway Signal K transmits through appears once this plugin is running. Set it as
   Source1 or Source2 — with *Data Source: Both* another navigator (e.g. TimeZero) stays usable
   as the other source.
4. Set a destination in Signal K, then press **NAV** on the NavPilot and confirm with the
   **ENTER** knob.

Without step 3 the NavPilot ignores Signal K's navigation data and raises *No nav data* shortly
after NAV is engaged.

### Routes

The NavPilot does not step through a route by itself: the navigator has to switch the destination
to the next waypoint, otherwise the pilot keeps steering to a waypoint it has already passed and
turns back towards it. With **Advance to the next route point on arrival** enabled (default), the
plugin does this whenever a Signal K route is active: once the boat enters the arrival circle set in
Signal K, or passes a waypoint outside it, the next route point becomes the destination. The new leg
starts at the boat's position, so in NAV the pilot turns towards the next waypoint rather than first
correcting onto the line between the two waypoints.

Set the arrival circle in Freeboard-SK (Settings → Course), e.g. 50 m for a close, gentle turn. The
same circle drives the NavPilot's *arrival* flag, so it switches together with the plugin. Waypoints
closer together than the circle are each passed rather than skipped, and the route ends at its last
waypoint. Freeboard-SK's own *Auto-advance to next point on arrival* is not needed.

## Remote command (experimental, off by default)

Remote command of this NavPilot over NMEA 2000 is **unverified**. The plugin can emit
Furuno-proprietary command PGNs (126720 for mode, 130827 for course), but they are unproven
and may do nothing, so they are gated behind the `experimentalCommands` setting and disabled by
default. The Simrad PGN 130850 an earlier version used is inert, and the standard PGN 126208 is
ignored by the pilot. "Adjust ±N°" is sent as an absolute course (there is no relative-course PGN).


# Known Limitations

## WIND-Mode
- Furuno FAP-7002 does not support wind mode remote
https://www.furuno.it/docs/OPERATOR_MANUAL/OME45120D_TZT9F_12F_16F_19F.pdf


# License

signalk-autopilot-furuno 0.2.0 and later is **source available, not open source**.
See [LICENSE.md](LICENSE.md).

**You may**, free of charge: run it on your own boat or fleet, private or
commercial; use it for internal company operations; modify it for your own use;
use it in education and research; and provide professional services around it.

**You may not**: redistribute it, or publish a modified version of it to npm or
anywhere else. Verbatim copies of official releases may be mirrored and cached.

Version 0.1.0 and earlier remain available under the MIT license — see
[LICENSE-MIT-through-v0.1.0.txt](LICENSE-MIT-through-v0.1.0.txt).
