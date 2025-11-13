# Contributing to signalk-autopilot-furuno

Thank you for your interest in contributing! This document provides guidelines and information for contributors.

## Getting Started

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR-USERNAME/signalk-autopilot-furuno.git
   cd signalk-autopilot-furuno
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Create a branch for your changes:
   ```bash
   git checkout -b feature/my-new-feature
   ```

## Development Setup

### Prerequisites

- Node.js 18 or later
- TypeScript 5.0 or later
- Signal K Server (for testing)
- Access to a Furuno NavPilot-711C (for hardware testing)

### Building

```bash
npm run build
```

### Watch Mode

For active development:
```bash
npm run watch
```

### Testing Locally

1. Build the plugin
2. Link it to your Signal K installation:
   ```bash
   cd ~/.signalk
   npm link /path/to/signalk-autopilot-furuno
   ```
3. Restart Signal K Server
4. Enable the plugin in the admin interface

## Code Style

### TypeScript Guidelines

- Use TypeScript strict mode
- Add type annotations for all public APIs
- Avoid `any` types when possible
- Use meaningful variable names
- Keep functions small and focused

### Formatting

- Use 2 spaces for indentation
- Maximum line length: 100 characters
- Use semicolons
- Use single quotes for strings

### Example

```typescript
function calculateHeading(target: number, current: number): number {
  let diff = target - current
  
  // Normalize to -π to π range
  while (diff > Math.PI) diff -= 2 * Math.PI
  while (diff < -Math.PI) diff += 2 * Math.PI
  
  return diff
}
```

## Commit Messages

Use clear, descriptive commit messages:

- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation changes
- **refactor**: Code refactoring
- **test**: Adding or updating tests
- **chore**: Maintenance tasks

Examples:
```
feat: add support for FishHunter patterns
fix: correct heading normalization in wind mode
docs: update API examples in README
```

## Pull Request Process

1. **Update documentation**: Ensure README.md reflects any changes
2. **Test thoroughly**: Test on actual hardware if possible
3. **Update CHANGELOG**: Add entry describing your changes
4. **Create PR**: Submit pull request with clear description
5. **Respond to feedback**: Address review comments promptly

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
Describe how changes were tested

## Checklist
- [ ] Code follows project style guidelines
- [ ] Documentation updated
- [ ] Tests pass (if applicable)
- [ ] CHANGELOG updated
```

## Testing Guidelines

### Manual Testing

When testing with actual hardware:

1. Test all autopilot modes (standby, auto, wind, route)
2. Verify mode transitions
3. Test heading adjustments
4. Verify tack/gybe commands (if sailing)
5. Check FreeboardSK integration
6. Monitor NMEA2000 traffic for errors

### Test Scenarios

#### Basic Functionality
- [ ] Plugin starts successfully
- [ ] Autopilot registers with Signal K
- [ ] State updates propagate correctly
- [ ] Commands execute without errors

#### Mode Switching
- [ ] Standby → Auto
- [ ] Auto → Wind
- [ ] Wind → Route
- [ ] Route → Standby
- [ ] Direct mode changes work

#### Navigation Commands
- [ ] Set target heading
- [ ] Adjust heading ±1°, ±10°
- [ ] Set wind angle
- [ ] Engage/disengage
- [ ] Tack port/starboard
- [ ] Gybe port/starboard

#### Edge Cases
- [ ] Invalid mode transitions
- [ ] Out-of-range values
- [ ] Missing navigation data
- [ ] NMEA2000 bus errors
- [ ] Rapid command sequences

## NMEA2000 Development

### Understanding PGNs

The NavPilot-711C uses specific NMEA2000 PGNs for communication:

**Input PGNs** (received by autopilot):
- 129025: Position Rapid Update
- 129026: COG & SOG Rapid Update
- 129029: GNSS Position Data
- 129283: Cross Track Error
- 129284: Navigation Data
- 129285: Route/WP Information

**Output PGNs** (sent by autopilot):
- 127245: Rudder
- 127250: Vessel Heading
- 127251: Rate of Turn

### Proprietary Commands

Furuno uses proprietary PGN 130850 for autopilot commands. The structure is:

```typescript
{
  pgn: 130850,
  dst: 255,  // Broadcast
  fields: {
    'Command': string,  // Command type
    // Additional fields vary by command
  }
}
```

### Debugging N2K Messages

Use `candump` or Signal K's debug logging:

```bash
# Signal K Server
DEBUG=signalk:autopilot:* signalk-server
```

## Architecture

### Plugin Structure

```
src/
├── index.ts           # Main plugin file
├── types.ts           # TypeScript type definitions
├── n2k.ts            # NMEA2000 message handlers
└── commands.ts       # Autopilot command implementations
```

### Key Components

1. **AutopilotProvider Interface**: Implements Signal K API
2. **N2K Message Handler**: Processes incoming NMEA2000 data
3. **Command Sender**: Sends commands to autopilot
4. **State Manager**: Maintains current autopilot state

### Data Flow

```
FreeboardSK/Client
    ↓ (HTTP/WebSocket)
Signal K Server
    ↓ (Provider API)
signalk-autopilot-furuno
    ↓ (NMEA2000 PGNs)
Furuno NavPilot-711C
```

## Documentation

### Code Comments

Add comments for:
- Complex algorithms
- NMEA2000 message structures
- Furuno-specific behaviors
- Edge cases and workarounds

### README Updates

Update README.md when:
- Adding new features
- Changing API behavior
- Adding configuration options
- Fixing significant bugs

### API Documentation

Document all public methods:

```typescript
/**
 * Sends a tack command to the autopilot
 * @param direction - 'port' or 'starboard'
 * @param deviceId - Autopilot device identifier
 * @throws {Error} If not in wind mode or invalid direction
 * @returns Promise that resolves when command is sent
 */
async tack(direction: 'port' | 'starboard', deviceId: string): Promise<void> {
  // Implementation
}
```

## Reporting Issues

### Bug Reports

Include:
- Signal K Server version
- Plugin version
- NavPilot-711C software version
- Complete error logs
- Steps to reproduce
- Expected vs actual behavior

### Feature Requests

Include:
- Use case description
- Proposed solution
- Alternative approaches
- Impact on existing functionality

## Resources

- [Signal K Documentation](https://demo.signalk.org/)
- [Signal K Autopilot API](https://demo.signalk.org/documentation/develop/rest-api/autopilot_api.html)
- [NMEA2000 Specification](https://www.nmea.org/nmea-2000.html)
- [Furuno NavPilot-711C Manual](https://www.furuno.com/en/products/autopilot/NAVpilot-711C)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

## Community

- **Signal K Slack**: [Join here](https://signalk-dev.slack.com/)
- **Forum**: [GitHub Discussions](https://github.com/SignalK/signalk-server/discussions)
- **Issues**: [Project Issues](https://github.com/dirkwa/signalk-autopilot-furuno/issues)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Questions?

Feel free to:
- Open an issue for questions
- Ask in Signal K Slack
- Start a discussion on the forum

Thank you for contributing! 🎉