const FURUNO_PGNS = {
  // Heading & Navigation
  HEADING: 127250,
  RATE_OF_TURN: 127251,
  RUDDER: 127245,
  VESSEL_HEADING: 127258,
  
  // Navigation Data (received)
  POSITION_RAPID: 129025,
  COG_SOG: 129026,
  GNSS_POSITION: 129029,
  XTE: 129283,
  NAVIGATION_INFO: 129284,
  ROUTE_INFO: 129285,
  
  // Autopilot Commands (proprietary Furuno)
  FURUNO_COMMAND: 130850
}

const FURUNO_MODES = {
  standby: 0,
  auto: 1,
  wind: 2,
  route: 3,
  fishingPattern: 4
}

/**
 * Signal K Plugin for Furuno NavPilot-711C Autopilot
 * @param {object} app - Signal K server app object
 * @returns {object} Plugin object
 */
module.exports = function (app) {
  const plugin = {
    id: 'signalk-autopilot-furuno',
    name: 'Furuno NavPilot-711C Autopilot Provider',
    description: 'Signal K Autopilot Provider for Furuno NavPilot-711C via NMEA2000'
  }

  let deviceId
  let currentState = {
    state: 'disabled',
    mode: 'standby',
    target: 0,
    engaged: false
  }
  let n2kCallback

  // Helper functions to send NMEA2000 commands
  function sendAutopilotMode(mode) {
    if (!n2kCallback) return

    const modeValue = FURUNO_MODES[mode] || 0
    
    const pgn = {
      pgn: FURUNO_PGNS.FURUNO_COMMAND,
      dst: 255,
      fields: {
        'Command': 'SetMode',
        'Mode': modeValue
      }
    }

    n2kCallback(pgn)
  }

  function sendHeadingCommand(heading) {
    if (!n2kCallback) return

    // Convert radians to degrees
    const headingDeg = heading * 180 / Math.PI

    const pgn = {
      pgn: FURUNO_PGNS.FURUNO_COMMAND,
      dst: 255,
      fields: {
        'Command': 'SetHeading',
        'Heading': headingDeg
      }
    }

    n2kCallback(pgn)
  }

  function sendWindAngleCommand(angle) {
    if (!n2kCallback) return

    // Convert radians to degrees
    const angleDeg = angle * 180 / Math.PI

    const pgn = {
      pgn: FURUNO_PGNS.FURUNO_COMMAND,
      dst: 255,
      fields: {
        'Command': 'SetWindAngle',
        'Angle': angleDeg
      }
    }

    n2kCallback(pgn)
  }

  function sendTackCommand(direction) {
    if (!n2kCallback) return

    const pgn = {
      pgn: FURUNO_PGNS.FURUNO_COMMAND,
      dst: 255,
      fields: {
        'Command': 'Tack',
        'Direction': direction === 'port' ? 0 : 1
      }
    }

    n2kCallback(pgn)
  }

  function sendGybeCommand(direction) {
    if (!n2kCallback) return

    const pgn = {
      pgn: FURUNO_PGNS.FURUNO_COMMAND,
      dst: 255,
      fields: {
        'Command': 'Gybe',
        'Direction': direction === 'port' ? 0 : 1
      }
    }

    n2kCallback(pgn)
  }

  function sendDodgeCommand(adjustment) {
    if (!n2kCallback) return

    const adjustmentDeg = adjustment * 180 / Math.PI

    const pgn = {
      pgn: FURUNO_PGNS.FURUNO_COMMAND,
      dst: 255,
      fields: {
        'Command': 'Dodge',
        'Adjustment': adjustmentDeg
      }
    }

    n2kCallback(pgn)
  }

  function updateAutopilotData() {
    const updateMsg = {
      state: currentState.state,
      mode: currentState.mode,
      target: currentState.target,
      engaged: currentState.engaged
    }

    if (currentState.heading !== undefined) {
      updateMsg.heading = currentState.heading
    }

    if (currentState.rudderAngle !== undefined) {
      updateMsg.rudderAngle = currentState.rudderAngle
    }

    app.autopilotUpdate(deviceId, updateMsg)
  }

  // Handle incoming NMEA2000 messages from the autopilot
  function handleN2KMessage(n2k) {
    const pgn = n2k.pgn

    switch (pgn) {
      case FURUNO_PGNS.HEADING:
      case FURUNO_PGNS.VESSEL_HEADING:
        if (n2k.fields.Heading !== undefined) {
          currentState.heading = n2k.fields.Heading * Math.PI / 180
          updateAutopilotData()
        }
        break

      case FURUNO_PGNS.RUDDER:
        if (n2k.fields.Position !== undefined) {
          currentState.rudderAngle = n2k.fields.Position * Math.PI / 180
          updateAutopilotData()
        }
        break

      case FURUNO_PGNS.XTE:
        if (n2k.fields.XTE !== undefined) {
          currentState.xte = n2k.fields.XTE
          updateAutopilotData()
        }
        break
    }
  }

  // Define the autopilot provider interface
  const autopilotProvider = {
    
    getData: function(apDeviceId) {
      if (apDeviceId !== deviceId) {
        throw new Error(`Unknown autopilot device: ${apDeviceId}`)
      }
      
      return {
        options: {
          states: ['enabled', 'disabled'],
          modes: ['standby', 'auto', 'wind', 'route', 'fishingPattern'],
          actions: [
            { id: 'tack', name: 'Tack', available: currentState.mode === 'wind' },
            { id: 'adjustHeading', name: 'Adjust Heading', available: currentState.mode === 'auto' },
            { id: 'advanceWaypoint', name: 'Advance Waypoint', available: currentState.mode === 'route' }
          ]
        },
        state: currentState.state,
        mode: currentState.mode,
        target: currentState.target,
        engaged: currentState.engaged
      }
    },

    getState: function(apDeviceId) {
      if (apDeviceId !== deviceId) {
        throw new Error(`Unknown autopilot device: ${apDeviceId}`)
      }
      return currentState.state
    },

    setState: function(state, apDeviceId) {
      if (apDeviceId !== deviceId) {
        throw new Error(`Unknown autopilot device: ${apDeviceId}`)
      }
      
      if (state !== 'enabled' && state !== 'disabled') {
        throw new Error(`Invalid state: ${state}`)
      }

      currentState.state = state
      
      // Send N2K command to enable/disable autopilot
      if (state === 'disabled') {
        currentState.mode = 'standby'
        currentState.engaged = false
        sendAutopilotMode('standby')
      }
      
      updateAutopilotData()
      return Promise.resolve()
    },

    getMode: function(apDeviceId) {
      if (apDeviceId !== deviceId) {
        throw new Error(`Unknown autopilot device: ${apDeviceId}`)
      }
      return currentState.mode
    },

    setMode: function(mode, apDeviceId) {
      if (apDeviceId !== deviceId) {
        throw new Error(`Unknown autopilot device: ${apDeviceId}`)
      }

      const validModes = ['standby', 'auto', 'wind', 'route', 'fishingPattern']
      if (!validModes.includes(mode)) {
        throw new Error(`Invalid mode: ${mode}. Valid modes: ${validModes.join(', ')}`)
      }

      currentState.mode = mode
      currentState.engaged = mode !== 'standby'
      
      if (mode !== 'standby') {
        currentState.state = 'enabled'
      }

      sendAutopilotMode(mode)
      updateAutopilotData()
      return Promise.resolve()
    },

    getTarget: function(apDeviceId) {
      if (apDeviceId !== deviceId) {
        throw new Error(`Unknown autopilot device: ${apDeviceId}`)
      }
      return currentState.target
    },

    setTarget: function(value, apDeviceId) {
      if (apDeviceId !== deviceId) {
        throw new Error(`Unknown autopilot device: ${apDeviceId}`)
      }

      // Value is in radians
      currentState.target = value

      if (currentState.mode === 'auto') {
        sendHeadingCommand(value)
      } else if (currentState.mode === 'wind') {
        sendWindAngleCommand(value)
      }

      updateAutopilotData()
      return Promise.resolve()
    },

    adjustTarget: function(value, apDeviceId) {
      if (apDeviceId !== deviceId) {
        throw new Error(`Unknown autopilot device: ${apDeviceId}`)
      }

      // Adjust current target by value (in radians)
      currentState.target += value
      
      // Normalize to 0-2π
      while (currentState.target < 0) currentState.target += 2 * Math.PI
      while (currentState.target >= 2 * Math.PI) currentState.target -= 2 * Math.PI

      if (currentState.mode === 'auto') {
        sendHeadingCommand(currentState.target)
      }

      updateAutopilotData()
      return Promise.resolve()
    },

    engage: function(apDeviceId) {
      if (apDeviceId !== deviceId) {
        throw new Error(`Unknown autopilot device: ${apDeviceId}`)
      }

      currentState.engaged = true
      currentState.state = 'enabled'
      
      if (currentState.mode === 'standby') {
        currentState.mode = 'auto'
        sendAutopilotMode('auto')
      }

      updateAutopilotData()
      return Promise.resolve()
    },

    disengage: function(apDeviceId) {
      if (apDeviceId !== deviceId) {
        throw new Error(`Unknown autopilot device: ${apDeviceId}`)
      }

      currentState.engaged = false
      currentState.mode = 'standby'
      sendAutopilotMode('standby')
      
      updateAutopilotData()
      return Promise.resolve()
    },

    tack: function(direction, apDeviceId) {
      if (apDeviceId !== deviceId) {
        throw new Error(`Unknown autopilot device: ${apDeviceId}`)
      }

      if (currentState.mode !== 'wind') {
        throw new Error('Tack command only available in wind mode')
      }

      sendTackCommand(direction)
      return Promise.resolve()
    },

    gybe: function(direction, apDeviceId) {
      if (apDeviceId !== deviceId) {
        throw new Error(`Unknown autopilot device: ${apDeviceId}`)
      }

      if (currentState.mode !== 'wind') {
        throw new Error('Gybe command only available in wind mode')
      }

      sendGybeCommand(direction)
      return Promise.resolve()
    },

    dodge: function(value, apDeviceId) {
      if (apDeviceId !== deviceId) {
        throw new Error(`Unknown autopilot device: ${apDeviceId}`)
      }

      // Temporary heading adjustment
      sendDodgeCommand(value)
      return Promise.resolve()
    }
  }

  plugin.start = function(settings) {
    deviceId = settings.deviceId || '711c'

    try {
      // Register as autopilot provider
      // Note: registerAutopilotProvider takes (provider, deviceIds[])
      app.registerAutopilotProvider(autopilotProvider, [deviceId])
      app.debug('Registered Furuno NavPilot-711C autopilot provider: ' + deviceId)

      // Subscribe to NMEA2000 messages
      app.on('N2KAnalyzerOut', handleN2KMessage)

      // Get N2K send capability
      n2kCallback = app.emit.bind(app, 'nmea2000out')

      // Set initial state
      updateAutopilotData()

      // Emit autopilot info so FreeboardSK can discover it
      app.handleMessage(plugin.id, {
        updates: [
          {
            values: [
              {
                path: 'steering.autopilot.provider',
                value: deviceId
              }
            ]
          }
        ]
      })

      app.setPluginStatus('Started - NavPilot-711C connected')
    } catch (error) {
      const errorMsg = 'Failed to start: ' + error.message
      app.setPluginError(errorMsg)
      throw error
    }
  }

  plugin.stop = function() {
    try {
      app.removeListener('N2KAnalyzerOut', handleN2KMessage)
      app.setPluginStatus('Stopped')
    } catch (error) {
      const errorMsg = 'Error stopping: ' + error.message
      app.setPluginError(errorMsg)
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
      }
    }
  }

  return plugin
}