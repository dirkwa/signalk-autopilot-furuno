# signalk-autopilot-furuno
SK autopilot api support for Furuno autopilots (NavPilot-711C)

# FULLY EXPERIMENTAL!

# signalk-autopilot-furuno

Signal K Autopilot Provider plugin for Furuno NavPilot-711C via NMEA2000.

This plugin implements the [Signal K Autopilot API](https://demo.signalk.org/documentation/develop/rest-api/autopilot_api.html) to provide standardized control of Furuno NavPilot-711C autopilots through NMEA2000 (N2K) commands.

## Features

- ✅ Full implementation of Signal K Autopilot Provider API
- ✅ NMEA2000 communication with Furuno NavPilot-711C
- ✅ Support for all autopilot modes:
  - Standby
  - Auto (compass heading)
  - Wind (apparent wind angle)
  - Route (GPS navigation)
  - Fishing Pattern (FishHunter mode)
- ✅ Control from FreeboardSK and other Signal K clients
- ✅ Tack and gybe commands for sailing
- ✅ Heading adjustments and dodge maneuvers
- ✅ Real-time autopilot state monitoring

## Requirements

- Signal K Server v2.0.0 or later
- Furuno NavPilot-711C autopilot
- NMEA2000 network connection
- Node.js 18 or later

## Installation

### Via Signal K App Store (Recommended)

1. Open Signal K Server admin interface
2. Navigate to **Appstore**
3. Search for **signalk-autopilot-furuno**
4. Click **Install**

### Manual Installation

```bash
cd ~/.signalk
npm install signalk-autopilot-furuno
```

### From Source

```bash
git clone https://github.com/dirkwa/signalk-autopilot-furuno.git
cd signalk-autopilot-furuno
npm install
npm run build
```

## Configuration

1. Open Signal K Server admin interface
2. Navigate to **Server → Plugin Config**
3. Find **Furuno NavPilot-711C Autopilot Provider**
4. Configure the following settings:

### Settings

- **Device ID**: Unique identifier for the autopilot (default: `furuno-navpilot-711c`)
- **Hull Type**: Select your vessel's hull type for optimal autopilot tuning:
  - `sail` - Standard sailing vessel
  - `sailSlowTurn` - Sailing vessel with slow turning characteristics
  - `sailCatamaran` - Catamaran or multihull
  - `power` - Standard powerboat
  - `powerSlowTurn` - Powerboat with slow turning (displacement hull)
  - `powerFastTurn` - High-performance powerboat (planing hull)

## NMEA2000 Setup

Ensure your Furuno NavPilot-711C is properly configured to send and receive the required PGNs:

### Required Input PGNs (to NavPilot)
- 129025 - Position Rapid Update
- 129026 - COG & SOG Rapid Update
- 129029 - GNSS Position Data
- 129283 - Cross Track Error
- 129284 - Navigation Data
- 129285 - Navigation - Route/WP Information

### Output PGNs (from NavPilot)
- 127245 - Rudder
- 127250 - Vessel Heading
- 127251 - Rate of Turn

## Usage

### Via FreeboardSK

Once installed and configured, the autopilot will appear in FreeboardSK:

1. Open **FreeboardSK** interface
2. Navigate to the **Autopilot** widget
3. Select the Furuno NavPilot as the active autopilot
4. Use the controls to:
   - Engage/disengage autopilot
   - Switch modes (Auto, Wind, Route)
   - Adjust heading
   - Perform tacks and gybes

### Via REST API

The plugin exposes the standard Signal K Autopilot API endpoints:

#### Get Autopilot Information
```bash
GET /signalk/v2/api/vessels/self/autopilots/furuno-navpilot-711c
```

#### Engage Autopilot
```bash
PUT /signalk/v2/api/vessels/self/autopilots/furuno-navpilot-711c/engage
```

#### Set Mode
```bash
PUT /signalk/v2/api/vessels/self/autopilots/furuno-navpilot-711c/mode
Content-Type: application/json

{"value": "auto"}
```

Available modes: `standby`, `auto`, `wind`, `route`, `fishingPattern`

#### Set Target Heading (Auto mode)
```bash
PUT /signalk/v2/api/vessels/self/autopilots/furuno-navpilot-711c/target
Content-Type: application/json

{"value": 1.5708}
```
Note: Values are in radians (1.5708 rad = 90°)

#### Adjust Heading
```bash
PUT /signalk/v2/api/vessels/self/autopilots/furuno-navpilot-711c/target/adjust
Content-Type: application/json

{"value": 0.0873}
```
Note: Adjustment in radians (0.0873 rad = 5°)

#### Tack to Port
```bash
POST /signalk/v2/api/vessels/self/autopilots/furuno-navpilot-711c/tack
Content-Type: application/json

{"value": "port"}
```

#### Disengage Autopilot
```bash
PUT /signalk/v2/api/vessels/self/autopilots/furuno-navpilot-711c/disengage
```

### Via WebSocket

Subscribe to autopilot updates:

```javascript
{
  "context": "vessels.self",
  "subscribe": [
    {
      "path": "steering.autopilot.*",
      "period": 1000
    }
  ]
}
```

Send commands:

```javascript
{
  "context": "vessels.self",
  "requestId": "unique-request-id",
  "put": {
    "path": "steering.autopilot.target",
    "value": 1.5708
  }
}
```

## Signal K Paths

The plugin publishes data to the following Signal K paths:

- `steering.autopilot.state` - Current state (enabled/disabled)
- `steering.autopilot.mode` - Current mode (standby/auto/wind/route/fishingPattern)
- `steering.autopilot.target` - Target value (heading or wind angle in radians)
- `steering.autopilot.engaged` - Whether autopilot is actively steering
- `navigation.headingMagnetic` - Current magnetic heading
- `steering.rudderAngle` - Current rudder position

## Furuno NavPilot-711C Features

This plugin supports the following NavPilot-711C specific features:

- **FishHunter Mode**: Automated fishing patterns (circle, orbit, spiral, figure-eight, square, zigzag)
- **Safe Helm**: Temporary manual override with automatic return
- **Power Assist**: Helm-activated assisted steering
- **Fantum Feedback**: Software-based steering control for outboards
- **Sabiki Mode**: Stern-first drift control for fishing

## Troubleshooting

### Autopilot not appearing in FreeboardSK

1. Check plugin is enabled in Signal K Server
2. Verify NMEA2000 network connectivity
3. Ensure NavPilot is powered on and functioning
4. Check Signal K Server logs for errors

### Commands not working

1. Verify required PGNs are enabled on the NavPilot
2. Check NMEA2000 network for proper termination
3. Ensure no bus conflicts with other devices
4. Review Signal K Server debug logs

### Mode switching issues

1. Ensure all required navigation data is available:
   - **Wind mode**: Requires wind sensor data (PGN 130306)
   - **Route mode**: Requires active route with waypoints (PGNs 129283-129285)
2. Check that the NavPilot display shows valid source data

## Development

### Building from source

```bash
npm install
npm run build
```

### Watch mode (auto-rebuild)

```bash
npm run watch
```

### Running tests

```bash
npm test
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Support

- **Issues**: [GitHub Issues](https://github.com/dirkwa/signalk-autopilot-furuno/issues)
- **Discussions**: [Signal K Forum](https://github.com/SignalK/signalk-server/discussions)
- **Documentation**: [Signal K Autopilot API](https://demo.signalk.org/documentation/develop/rest-api/autopilot_api.html)

## License

MIT License - see LICENSE file for details

## Credits

- Based on the [Signal K Autopilot API specification](https://demo.signalk.org/documentation/develop/rest-api/autopilot_api.html)
- Inspired by signalk-raymarine-autopilot and other autopilot provider plugins
- Furuno NavPilot-711C specifications from Furuno Electric Company

## Changelog

### v1.0.0 (2025-01-XX)
- Initial release
- Full Signal K Autopilot Provider API implementation
- Support for all NavPilot-711C modes and features
- NMEA2000 communication
- Compatible with FreeboardSK and other Signal K clients