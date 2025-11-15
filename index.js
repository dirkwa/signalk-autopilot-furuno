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
      }
    }
  }

  return plugin
}