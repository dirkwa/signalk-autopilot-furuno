# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- PGN 127237 (Heading/Track Control) listener for autopilot feedback and alarms
- Alarm monitoring for autopilot limit exceeded conditions:
  - Rudder limit exceeded
  - Off heading limit exceeded
  - Off track limit exceeded
  - Autopilot override active
- Commanded rudder angle logging from autopilot
- Debug logging for all received PGN 127237 messages to troubleshoot data reception

### Changed
- Renamed 'route' mode to 'nav' mode for clearer navigation terminology
- Simplified autopilot modes to focus on core functionality (standby, auto, nav)
- `tack()` and `gybe()` methods now throw errors indicating they are not supported
- Added alarms array to autopilot state for Signal K alarm integration

### Removed
- Removed 'wind' mode (not supported by Furuno NavPilot-711C)
- Removed 'fishingPattern' mode (not supported by Furuno NavPilot-711C)
- Removed `setWindAngle()`, `tack()`, and `gybe()` implementation from N2KCommands

### Fixed
- Fixed Signal K AutopilotProvider API compliance by keeping `tack()` and `gybe()` method stubs

## [0.0.1] - Initial Release

### Added
- Initial implementation of Furuno NavPilot-711C autopilot provider
- Support for autopilot modes: standby, auto, nav
- NMEA2000 command interface via proprietary PGN 130850
- Signal K path subscriptions for heading, rudder angle, and cross-track error
- Autopilot detection and status reporting
- Configuration options for device ID, hull type, and detection timeout
