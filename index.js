/**
 * Signal K Plugin for Furuno NavPilot-711C Autopilot
 * @param {object} app - Signal K server app object
 * @returns {object} Plugin object
 */

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
  let autopilotDetected = false
  let detectionTimeout = null
  let lastMessageTime = null

  // Helper functions to send NMEA2000 commands
  function sendAutopilotMode(mode) {
    if (!n2kCallback) {
      app.debug('sendAutopilotMode() - N2K callback not initialized')
      return
    }

    const modeValue = FURUNO_MODES[mode] || 0
    app.debug('sendAutopilotMode() - Sending mode: ' + mode + ' (value: ' + modeValue + ')')
    
    const pgn = {
      pgn: FURUNO_PGNS.FURUNO_COMMAND,
      dst: 255,
      fields: {
        'Command': 'SetMode',
        'Mode': modeValue
      }
    }

    n2kCallback(pgn)
    app.debug('sendAutopilotMode() - N2K message sent: PGN ' + FURUNO_PGNS.FURUNO_COMMAND)
  }

  function sendHeadingCommand(heading) {
    if (!n2kCallback) {
      app.debug('sendHeadingCommand() - N2K callback not initialized')
      return
    }

    // Convert radians to degrees
    const headingDeg = heading * 180 / Math.PI
    app.debug('sendHeadingCommand() - Sending heading: ' + headingDeg.toFixed(1) + '° (' + heading + ' rad)')

    const pgn = {
      pgn: FURUNO_PGNS.FURUNO_COMMAND,
      dst: 255,
      fields: {
        'Command': 'SetHeading',
        'Heading': headingDeg
      }
    }

    n2kCallback(pgn)
    app.debug('sendHeadingCommand() - N2K message sent: PGN ' + FURUNO_PGNS.FURUNO_COMMAND)
  }

  function sendWindAngleCommand(angle) {
    if (!n2kCallback) {
      app.debug('sendWindAngleCommand() - N2K callback not initialized')
      return
    }

    // Convert radians to degrees
    const angleDeg = angle * 180 / Math.PI
    app.debug('sendWindAngleCommand() - Sending wind angle: ' + angleDeg.toFixed(1) + '° (' + angle + ' rad)')

    const pgn = {
      pgn: FURUNO_PGNS.FURUNO_COMMAND,
      dst: 255,
      fields: {
        'Command': 'SetWindAngle',
        'Angle': angleDeg
      }
    }

    n2kCallback(pgn)
    app.debug('sendWindAngleCommand() - N2K message sent: PGN ' + FURUNO_PGNS.FURUNO_COMMAND)
  }

  function sendTackCommand(direction) {
    if (!n2kCallback) {
      app.debug('sendTackCommand() - N2K callback not initialized')
      return
    }

    app.debug('sendTackCommand() - Sending tack command: ' + direction)

    const pgn = {
      pgn: FURUNO_PGNS.FURUNO_COMMAND,
      dst: 255,
      fields: {
        'Command': 'Tack',
        'Direction': direction === 'port' ? 0 : 1
      }
    }

    n2kCallback(pgn)
    app.debug('sendTackCommand() - N2K message sent: PGN ' + FURUNO_PGNS.FURUNO_COMMAND)
  }

  function sendGybeCommand(direction) {
    if (!n2kCallback) {
      app.debug('sendGybeCommand() - N2K callback not initialized')
      return
    }

    app.debug('sendGybeCommand() - Sending gybe command: ' + direction)

    const pgn = {
      pgn: FURUNO_PGNS.FURUNO_COMMAND,
      dst: 255,
      fields: {
        'Command': 'Gybe',
        'Direction': direction === 'port' ? 0 : 1
      }
    }

    n2kCallback(pgn)
    app.debug('sendGybeCommand() - N2K message sent: PGN ' + FURUNO_PGNS.FURUNO_COMMAND)
  }

  function sendDodgeCommand(adjustment) {
    if (!n2kCallback) {
      app.debug('sendDodgeCommand() - N2K callback not initialized')
      return
    }

    const adjustmentDeg = adjustment * 180 / Math.PI
    app.debug('sendDodgeCommand() - Sending dodge adjustment: ' + adjustmentDeg.toFixed(1) + '° (' + adjustment + ' rad)')

    const pgn = {
      pgn: FURUNO_PGNS.FURUNO_COMMAND,
      dst: 255,
      fields: {
        'Command': 'Dodge',
        'Adjustment': adjustmentDeg
      }
    }

    n2kCallback(pgn)
    app.debug('sendDodgeCommand() - N2K message sent: PGN ' + FURUNO_PGNS.FURUNO_COMMAND)
  }

  function updateAutopilotData() {
    app.debug('updateAutopilotData() - Broadcasting autopilot state update')
    
    const updateMsg = {
      state: currentState.state,
      mode: currentState.mode,
      target: currentState.target,
      engaged: currentState.engaged
    }

    if (currentState.heading !== undefined) {
      updateMsg.heading = currentState.heading
      app.debug('  - Including heading: ' + (currentState.heading * 180 / Math.PI).toFixed(1) + '°')
    }

    if (currentState.rudderAngle !== undefined) {
      updateMsg.rudderAngle = currentState.rudderAngle
      app.debug('  - Including rudder angle: ' + (currentState.rudderAngle * 180 / Math.PI).toFixed(1) + '°')
    }

    app.debug('  - State: ' + updateMsg.state + ', Mode: ' + updateMsg.mode + ', Engaged: ' + updateMsg.engaged)
    app.autopilotUpdate(deviceId, updateMsg)
  }

  // Handle incoming NMEA2000 messages from the autopilot
  function handleN2KMessage(n2k) {
    const pgn = n2k.pgn

    // Check if this message is from the autopilot
    const isAutopilotPGN = (
      pgn === FURUNO_PGNS.HEADING ||
      pgn === FURUNO_PGNS.VESSEL_HEADING ||
      pgn === FURUNO_PGNS.RUDDER ||
      pgn === FURUNO_PGNS.XTE
    )

    if (isAutopilotPGN) {
      lastMessageTime = Date.now()
      
      if (!autopilotDetected) {
        autopilotDetected = true
        app.debug('NavPilot-711C detected on NMEA2000 network!')
        app.setPluginStatus('Connected - NavPilot-711C detected (Device ID: ' + deviceId + ')')
        
        // Clear the detection timeout
        if (detectionTimeout) {
          clearTimeout(detectionTimeout)
          detectionTimeout = null
        }
      }
    }

    switch (pgn) {
      case FURUNO_PGNS.HEADING:
      case FURUNO_PGNS.VESSEL_HEADING:
        if (n2k.fields.Heading !== undefined) {
          const headingDeg = n2k.fields.Heading
          currentState.heading = headingDeg * Math.PI / 180
          app.debug('Received heading from N2K PGN ' + pgn + ': ' + headingDeg.toFixed(1) + '°')
          updateAutopilotData()
        }
        break

      case FURUNO_PGNS.RUDDER:
        if (n2k.fields.Position !== undefined) {
          const rudderDeg = n2k.fields.Position
          currentState.rudderAngle = rudderDeg * Math.PI / 180
          app.debug('Received rudder angle from N2K PGN ' + pgn + ': ' + rudderDeg.toFixed(1) + '°')
          updateAutopilotData()
        }
        break

      case FURUNO_PGNS.XTE:
        if (n2k.fields.XTE !== undefined) {
          currentState.xte = n2k.fields.XTE
          app.debug('Received XTE from N2K PGN ' + pgn + ': ' + n2k.fields.XTE.toFixed(2) + ' m')
          updateAutopilotData()
        }
        break
    }
  }

  // Check for autopilot timeout (no messages received)
  function checkAutopilotConnection() {
    if (autopilotDetected && lastMessageTime) {
      const timeSinceLastMessage = Date.now() - lastMessageTime
      
      // If no message for 30 seconds, mark as disconnected
      if (timeSinceLastMessage > 30000) {
        autopilotDetected = false
        app.setPluginStatus('Warning - No data from NavPilot-711C (check NMEA2000 connection)')
        app.debug('Warning: No messages from NavPilot-711C for 30 seconds')
      }
    }
  }

  // Define the autopilot provider interface with ASYNC functions
  const autopilotProvider = {
    
    getData: async function(apDeviceId) {
      app.debug('getData() called for device: ' + apDeviceId)
      
      // Accept both the actual device ID and _default
      if (apDeviceId !== deviceId && apDeviceId !== '_default') {
        app.error('getData() failed: Unknown device ' + apDeviceId + ' (expected: ' + deviceId + ' or _default)')
        throw new Error('Unknown autopilot device: ' + apDeviceId)
      }
      
      const data = {
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
      
      app.debug('getData() returning: ' + JSON.stringify(data))
      return data
    },

    getState: async function(apDeviceId) {
      app.debug('getState() called for device: ' + apDeviceId + ', current state: ' + currentState.state)
      
      if (apDeviceId !== deviceId && apDeviceId !== '_default') {
        app.error('getState() failed: Unknown device ' + apDeviceId)
        throw new Error('Unknown autopilot device: ' + apDeviceId)
      }
      return currentState.state
    },

    setState: async function(state, apDeviceId) {
      app.debug('setState() called: state=' + state + ', device=' + apDeviceId)
      
      if (apDeviceId !== deviceId && apDeviceId !== '_default') {
        app.error('setState() failed: Unknown device ' + apDeviceId)
        throw new Error('Unknown autopilot device: ' + apDeviceId)
      }
      
      if (state !== 'enabled' && state !== 'disabled') {
        app.error('setState() failed: Invalid state ' + state)
        throw new Error('Invalid state: ' + state)
      }

      app.debug('Setting autopilot state from ' + currentState.state + ' to ' + state)
      currentState.state = state
      
      // Send N2K command to enable/disable autopilot
      if (state === 'disabled') {
        app.debug('State disabled - setting mode to standby')
        currentState.mode = 'standby'
        currentState.engaged = false
        sendAutopilotMode('standby')
      }
      
      updateAutopilotData()
      app.debug('setState() completed successfully')
    },

    getMode: async function(apDeviceId) {
      app.debug('getMode() called for device: ' + apDeviceId + ', current mode: ' + currentState.mode)
      
      if (apDeviceId !== deviceId && apDeviceId !== '_default') {
        app.error('getMode() failed: Unknown device ' + apDeviceId)
        throw new Error('Unknown autopilot device: ' + apDeviceId)
      }
      return currentState.mode
    },

    setMode: async function(mode, apDeviceId) {
      app.debug('setMode() called: mode=' + mode + ', device=' + apDeviceId)
      
      if (apDeviceId !== deviceId && apDeviceId !== '_default') {
        app.error('setMode() failed: Unknown device ' + apDeviceId)
        throw new Error('Unknown autopilot device: ' + apDeviceId)
      }

      const validModes = ['standby', 'auto', 'wind', 'route', 'fishingPattern']
      if (!validModes.includes(mode)) {
        app.error('setMode() failed: Invalid mode ' + mode)
        throw new Error('Invalid mode: ' + mode + '. Valid modes: ' + validModes.join(', '))
      }

      app.debug('Changing mode from ' + currentState.mode + ' to ' + mode)
      currentState.mode = mode
      currentState.engaged = mode !== 'standby'
      
      if (mode !== 'standby') {
        app.debug('Mode is active - setting state to enabled')
        currentState.state = 'enabled'
      }

      app.debug('Sending N2K mode change command')
      sendAutopilotMode(mode)
      updateAutopilotData()
      app.debug('setMode() completed successfully')
    },

    getTarget: async function(apDeviceId) {
      app.debug('getTarget() called for device: ' + apDeviceId + ', current target: ' + currentState.target + ' rad (' + (currentState.target * 180 / Math.PI).toFixed(1) + '°)')
      
      if (apDeviceId !== deviceId && apDeviceId !== '_default') {
        app.error('getTarget() failed: Unknown device ' + apDeviceId)
        throw new Error('Unknown autopilot device: ' + apDeviceId)
      }
      return currentState.target
    },

    setTarget: async function(value, apDeviceId) {
      const degrees = (value * 180 / Math.PI).toFixed(1)
      app.debug('setTarget() called: value=' + value + ' rad (' + degrees + '°), device=' + apDeviceId)
      
      if (apDeviceId !== deviceId && apDeviceId !== '_default') {
        app.error('setTarget() failed: Unknown device ' + apDeviceId)
        throw new Error('Unknown autopilot device: ' + apDeviceId)
      }

      app.debug('Changing target from ' + currentState.target + ' to ' + value + ' rad (' + degrees + '°)')
      currentState.target = value

      if (currentState.mode === 'auto') {
        app.debug('Mode is AUTO - sending heading command to autopilot')
        sendHeadingCommand(value)
      } else if (currentState.mode === 'wind') {
        app.debug('Mode is WIND - sending wind angle command to autopilot')
        sendWindAngleCommand(value)
      } else {
        app.debug('Mode is ' + currentState.mode + ' - no N2K command sent')
      }

      updateAutopilotData()
      app.debug('setTarget() completed successfully')
    },

    adjustTarget: async function(value, apDeviceId) {
      const adjustDegrees = (value * 180 / Math.PI).toFixed(1)
      app.debug('adjustTarget() called: adjustment=' + value + ' rad (' + adjustDegrees + '°), device=' + apDeviceId)
      
      if (apDeviceId !== deviceId && apDeviceId !== '_default') {
        app.error('adjustTarget() failed: Unknown device ' + apDeviceId)
        throw new Error('Unknown autopilot device: ' + apDeviceId)
      }

      const oldTarget = currentState.target
      currentState.target += value
      
      // Normalize to 0-2π
      while (currentState.target < 0) currentState.target += 2 * Math.PI
      while (currentState.target >= 2 * Math.PI) currentState.target -= 2 * Math.PI

      const oldDeg = (oldTarget * 180 / Math.PI).toFixed(1)
      const newDeg = (currentState.target * 180 / Math.PI).toFixed(1)
      app.debug('Adjusted target from ' + oldDeg + '° to ' + newDeg + '° (change: ' + adjustDegrees + '°)')

      if (currentState.mode === 'auto') {
        app.debug('Mode is AUTO - sending adjusted heading command')
        sendHeadingCommand(currentState.target)
      } else {
        app.debug('Mode is ' + currentState.mode + ' - no heading adjustment sent')
      }

      updateAutopilotData()
      app.debug('adjustTarget() completed successfully')
    },

    engage: async function(apDeviceId) {
      app.debug('engage() called for device: ' + apDeviceId)
      
      if (apDeviceId !== deviceId && apDeviceId !== '_default') {
        app.error('engage() failed: Unknown device ' + apDeviceId)
        throw new Error('Unknown autopilot device: ' + apDeviceId)
      }

      app.debug('Engaging autopilot - current mode: ' + currentState.mode)
      currentState.engaged = true
      currentState.state = 'enabled'
      
      if (currentState.mode === 'standby') {
        app.debug('Was in standby - switching to AUTO mode')
        currentState.mode = 'auto'
        sendAutopilotMode('auto')
      } else {
        app.debug('Already in active mode (' + currentState.mode + '), just engaging')
      }

      updateAutopilotData()
      app.debug('engage() completed successfully - autopilot is now engaged')
    },

    disengage: async function(apDeviceId) {
      app.debug('disengage() called for device: ' + apDeviceId)
      
      if (apDeviceId !== deviceId && apDeviceId !== '_default') {
        app.error('disengage() failed: Unknown device ' + apDeviceId)
        throw new Error('Unknown autopilot device: ' + apDeviceId)
      }

      app.debug('Disengaging autopilot - switching to standby mode')
      currentState.engaged = false
      currentState.mode = 'standby'
      sendAutopilotMode('standby')
      
      updateAutopilotData()
      app.debug('disengage() completed successfully - autopilot is now in standby')
    },

    tack: async function(direction, apDeviceId) {
      app.debug('tack() called: direction=' + direction + ', device=' + apDeviceId)
      
      if (apDeviceId !== deviceId && apDeviceId !== '_default') {
        app.error('tack() failed: Unknown device ' + apDeviceId)
        throw new Error('Unknown autopilot device: ' + apDeviceId)
      }

      if (currentState.mode !== 'wind') {
        app.error('tack() failed: Not in wind mode (current mode: ' + currentState.mode + ')')
        throw new Error('Tack command only available in wind mode')
      }

      app.debug('Executing tack to ' + direction)
      sendTackCommand(direction)
      app.debug('tack() completed - command sent to autopilot')
    },

    gybe: async function(direction, apDeviceId) {
      app.debug('gybe() called: direction=' + direction + ', device=' + apDeviceId)
      
      if (apDeviceId !== deviceId && apDeviceId !== '_default') {
        app.error('gybe() failed: Unknown device ' + apDeviceId)
        throw new Error('Unknown autopilot device: ' + apDeviceId)
      }

      if (currentState.mode !== 'wind') {
        app.error('gybe() failed: Not in wind mode (current mode: ' + currentState.mode + ')')
        throw new Error('Gybe command only available in wind mode')
      }

      app.debug('Executing gybe to ' + direction)
      sendGybeCommand(direction)
      app.debug('gybe() completed - command sent to autopilot')
    },

    dodge: async function(value, apDeviceId) {
      const dodgeDegrees = (value * 180 / Math.PI).toFixed(1)
      app.debug('dodge() called: value=' + value + ' rad (' + dodgeDegrees + '°), device=' + apDeviceId)
      
      if (apDeviceId !== deviceId && apDeviceId !== '_default') {
        app.error('dodge() failed: Unknown device ' + apDeviceId)
        throw new Error('Unknown autopilot device: ' + apDeviceId)
      }

      app.debug('Executing dodge maneuver: ' + dodgeDegrees + '°')
      sendDodgeCommand(value)
      app.debug('dodge() completed - command sent to autopilot')
    }
  }

  plugin.start = function(settings) {
    deviceId = settings.deviceId || '711c'

    try {
      app.debug('Starting Furuno NavPilot-711C plugin with device ID: ' + deviceId)
      
      // Register as autopilot provider
      // Note: registerAutopilotProvider takes (provider, deviceIds[])
      app.registerAutopilotProvider(autopilotProvider, [deviceId])
      app.debug('Registered Furuno NavPilot-711C autopilot provider: ' + deviceId)

      // Subscribe to NMEA2000 messages
      app.on('N2KAnalyzerOut', handleN2KMessage)
      app.debug('Subscribed to N2K messages')

      // Get N2K send capability
      n2kCallback = app.emit.bind(app, 'nmea2000out')
      app.debug('N2K send capability initialized')

      // Set initial state
      updateAutopilotData()
      app.debug('Initial autopilot state: ' + JSON.stringify(currentState))

      // Set a timeout to warn if autopilot not detected
      detectionTimeout = setTimeout(function() {
        if (!autopilotDetected) {
          app.setPluginStatus('Warning - NavPilot-711C not detected on NMEA2000 network')
          app.debug('Warning: NavPilot-711C not detected after 10 seconds')
          app.debug('Commands will be sent, but no feedback will be received')
          app.debug('Please check: 1) NavPilot is powered on, 2) NMEA2000 connection, 3) PGN configuration')
        }
      }, 10000) // Wait 10 seconds for detection

      // Start periodic connection check (every 60 seconds)
      setInterval(checkAutopilotConnection, 60000)

      app.setPluginStatus('Started - Waiting for NavPilot-711C... (Device ID: ' + deviceId + ')')
    } catch (error) {
      const errorMsg = 'Failed to start: ' + error.message
      app.error(errorMsg)
      app.error('Stack trace: ' + error.stack)
      app.setPluginError(errorMsg)
      throw error
    }
  }

  plugin.stop = function() {
    app.debug('Stopping Furuno NavPilot-711C plugin')
    
    try {
      // Clear timeouts
      if (detectionTimeout) {
        clearTimeout(detectionTimeout)
        detectionTimeout = null
      }
      
      app.removeListener('N2KAnalyzerOut', handleN2KMessage)
      app.debug('Unsubscribed from N2K messages')
      app.setPluginStatus('Stopped')
    } catch (error) {
      const errorMsg = 'Error stopping: ' + error.message
      app.error(errorMsg)
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