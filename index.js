/**
 * Signal K Plugin for Furuno NavPilot-711C Autopilot
 * Main entry point
 */

const AutopilotProvider = require('./lib/AutopilotProvider')

module.exports = function(app) {
  const plugin = {
    id: 'signalk-autopilot-furuno',
    name: 'Furuno NavPilot-711C Autopilot Provider',
    description: 'Signal K Autopilot Provider for Furuno NavPilot-711C via NMEA2000'
  }

  let autopilotProvider = null

  plugin.start = function(settings) {
    try {
      app.debug('Starting Furuno NavPilot-711C plugin')
      
      autopilotProvider = new AutopilotProvider(app, settings)
      autopilotProvider.start()
      
      app.setPluginStatus('Started')
    } catch (error) {
      const errorMsg = 'Failed to start: ' + error.message
      app.error(errorMsg)
      app.setPluginError(errorMsg)
      throw error
    }
  }

  plugin.stop = function() {
    try {
      app.debug('Stopping Furuno NavPilot-711C plugin')
      
      if (autopilotProvider) {
        autopilotProvider.stop()
        autopilotProvider = null
      }
      
      app.setPluginStatus('Stopped')
    } catch (error) {
      app.error('Error stopping: ' + error.message)
    }
  }

  plugin.schema = {
    type: 'object',
    required: ['deviceId'],
    properties: {
      deviceId: {
        type: 'string',
        title: 'Autopilot Device ID',
        description: 'Unique identifier for this autopilot',
        default: '711c'
      },
      detectionTimeout: {
        type: 'number',
        title: 'Detection Timeout (seconds)',
        description: 'How long to wait for autopilot detection before showing warning',
        default: 10
      },
      connectionTimeout: {
        type: 'number',
        title: 'Connection Timeout (seconds)',
        description:
          'If no autopilot data (PGN 127237) is received for this long, raise a ' +
          '"NavPilot connection lost" notification.',
        default: 5
      },
      advertiseNavSource: {
        type: 'boolean',
        title: 'Advertise Signal K as NavPilot NAV data source',
        description:
          'Broadcasts a PGN 126464 transmit list with 129283/129284/129285 so the NavPilot ' +
          'offers Signal K\'s NMEA 2000 interface under Menu > Other Menu > NAV Option > Source. ' +
          'Needed for NAV mode to follow a destination or route set in Signal K.',
        default: true
      },
      autoAdvanceRoute: {
        type: 'boolean',
        title: 'Advance to the next route point on arrival',
        description:
          'While a Signal K route is active, switch to the next route point when the boat enters ' +
          'the arrival circle, or passes the waypoint outside it, and start the new leg at the ' +
          'boat, so in NAV mode the pilot turns towards the next waypoint instead of steering back ' +
          'to the passed one.',
        default: true
      },
      turnRate: {
        type: 'number',
        title: 'Pilot turn rate in NAV (°/s)',
        description:
          'How fast the NavPilot turns onto a new leg. The next route point is activated early ' +
          'enough for a turn at this rate to join the next leg without overshooting it (turn ' +
          'radius = speed ÷ turn rate). Lower it if the boat still overshoots the new leg, raise ' +
          'it if the boat turns in too early. 0 turns this off, leaving the arrival circle.',
        default: 2.2,
        minimum: 0
      },
      experimentalCommands: {
        type: 'boolean',
        title: 'Enable experimental remote commands (UNVERIFIED)',
        description:
          'Off by default. This NavPilot has no verified NMEA 2000 remote-control path; ' +
          'commands use Furuno proprietary PGNs (126720 mode / 130827 course) that ' +
          'are unproven and may do nothing. Leave disabled for a feedback-only provider.',
        default: false
      },
      deviceAddress: {
        type: 'number',
        title: 'Autopilot N2K source address (optional)',
        description:
          'Source address of the NavPilot on the bus, used as the command destination when ' +
          'experimental commands are enabled. Leave blank to broadcast.'
      }
    }
  }

  return plugin
}