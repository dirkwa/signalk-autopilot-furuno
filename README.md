# signalk-autopilot-furuno

Signal K Autopilot Provider plugin for the Furuno NavPilot (700/711C) via NMEA 2000.

Status: **feedback works; remote command is unverified.** This plugin reports the
NavPilot's live state to Signal K and can act as a feedback provider. Remote command
is disabled by default — see "Remote command" below.

## What works

- **Mode feedback** from PGN 127237 `Steering Mode`:
  `Main Steering` → standby, `Heading Control Standalone` → auto, `Track Control` → nav.
- **Rudder / heading feedback** from PGN 127245 / 127237.
- **Route following (nav mode):** the NavPilot follows an active route on its own from the
  standard route PGNs (129285 / 129284 / 129283). To command a GOTO from Signal K, emit those
  as an active route source — use https://github.com/dirkwa/signalk-to-nmea2000.

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
