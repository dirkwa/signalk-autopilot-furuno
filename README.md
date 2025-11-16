# signalk-autopilot-furuno

Signal K Autopilot Provider plugin for Furuno NavPilot-711C via NMEA2000.

  PURELY EXPERIMENTAL, DO NOT USE!

# TODO:

## Startup
Check if all nessecary paths are available (rudder angle, etc)

## General
Sniff N2K communication between AP and TZ Pro
Fork Canboat to support this
Figure out how to enable etc.

## External work needed
PGN 129285 missing in SK to N2k: https://github.com/SignalK/signalk-to-nmea2000/issues/136

## TZ for Route mode.
TZ Pro sents  in goto:

{
  "pgn": 129285,
  "prio": 6,
  "src": 4,
  "dst": 255,
  "timestamp": "2025-11-15T22:32:21.673Z",
  "description": "Navigation - Route/WP Information",
  "fields": {
    "startRps": null,
    "nitems": 2,
    "databaseId": 0,
    "routeId": null,
    "navigationDirectionInRoute": "Forward",
    "supplementaryRouteWpDataAvailable": "Off",
    "reserved": null,
    "routeName": null,
    "reserved9": null,
    "list": [
      {
        "wpId": null,
        "wpName": null,
        "wpLatitude": -17.6814665,
        "wpLongitude": 177.3838499
      },
      {
        "wpId": 1,
        "wpName": "WPT001",
        "wpLatitude": -17.6936884,
        "wpLongitude": 177.3707721
      }
    ]
  },
  "id": "navigationRouteWpInformation"
}

{
  "pgn": 129284,
  "prio": 3,
  "src": 4,
  "dst": 255,
  "timestamp": "2025-11-15T22:32:31.125Z",
  "description": "Navigation Data",
  "fields": {
    "sid": 127,
    "distanceToWaypoint": 1934.78,
    "courseBearingReference": "True",
    "perpendicularCrossed": "No",
    "arrivalCircleEntered": "No",
    "calculationType": "Rhumbline",
    "etaTime": null,
    "etaDate": null,
    "bearingOriginToDestinationWaypoint": 3.9396,
    "bearingPositionToDestinationWaypoint": 3.9409,
    "originWaypointNumber": null,
    "destinationWaypointNumber": 1,
    "destinationLatitude": -17.6936884,
    "destinationLongitude": 177.3707721,
    "waypointClosingVelocity": 0
  },
  "id": "navigationData"
}

{
  "pgn": 129283,
  "prio": 3,
  "src": 4,
  "dst": 255,
  "timestamp": "2025-11-15T22:32:52.161Z",
  "description": "Cross Track Error",
  "fields": {
    "sid": 147,
    "xteMode": "Autonomous",
    "reserved": null,
    "navigationTerminated": "No",
    "xte": -2.54,
    "reserved6": null
  },
  "id": "crossTrackError"
}


