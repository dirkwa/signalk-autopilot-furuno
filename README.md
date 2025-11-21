# signalk-autopilot-furuno

Signal K Autopilot Provider plugin for Furuno NavPilot-711C via NMEA2000.

  PURELY EXPERIMENTAL, DO NOT USE!


# Requirements:

1. Use https://github.com/dirkwa/visual-analyzer to see transmitted PGNs
2. Use https://github.com/dirkwa/signalk-to-nmea2000 to get PGN 129284 and fix for PGN 129285


# TODO:

## General
- Improve PGN 127237 handling, to give feedback on data path "steering.autopilot.*" 
 - PGN 126208 (NMEA Command/Request/Acknowledge)
 - PGN 126464 (PGN List TX/RX group funvtion)
 - PGN 126996 (Product information)
 - PGN 130827 (Unknown)
 - PGN 126208 (NMEA Command/Request/Acknowledge)
 - Or additional fields in PGN 127237 that change based on mode

- Alerting is autopilot has a issue and disengages PGN 127237
 - PGN 65360 (Proprietary Furuno)
 - PGN 126208 (NMEA Command/Request/Acknowledge)
 - Or additional fields in PGN 127237 that change based on mode

### Questions when comparing Signal K to Timezero Pro:
- Why does TZ in GOTO sent also 129285? TZ does not. Is it to give the display a destination name?

## Startup
- Check if all nessecary paths are available (rudder angle, etc)

## Future wish
- Figure out how to remotely enable the Autopilot
- Get feedback to SK on status changes at the Furuno display (f.e. Auto -> Standby) to prevent logic loops
- Migrate to SK autopilot project


# Known Limitations

## WIND-Mode
- Furuno FAP-7002 does not support wind mode remote
https://www.furuno.it/docs/OPERATOR_MANUAL/OME45120D_TZT9F_12F_16F_19F.pdf
