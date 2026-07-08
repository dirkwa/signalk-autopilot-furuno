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
      hullType: {
        type: 'string',
        title: 'Hull Type',
        description: 'Type of vessel hull for autopilot tuning',
        enum: [
          'sail',
          'sailSlowTurn',
          'sailCatamaran',
          'power',
          'powerSlowTurn',
          'powerFastTurn'
        ],
        default: 'power'
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