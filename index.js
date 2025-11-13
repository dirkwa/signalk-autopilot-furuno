import { Plugin, ServerAPI } from '@signalk/server-api'
import { AutopilotProvider, AutopilotUpdateMessage } from '@signalk/server-api'

interface PluginConfig {
  enabled: boolean
  deviceId: string
  hullType: string
}

interface FurunoState {
  state: 'enabled' | 'disabled'
  mode: 'standby' | 'auto' | 'wind' | 'route' | 'fishingPattern'
  target: number
  engaged: boolean
  heading?: number
  windAngle?: number
  rudderAngle?: number
  xte?: number
}

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

const FURUNO_MODES: { [key: string]: number } = {
  standby: 0,
  auto: 1,
  wind: 2,
  route: 3,
  fishingPattern: 4
}

module.exports = function (app: ServerAPI): Plugin {
  const plugin: Plugin = {
    id: 'signalk-autopilot-furuno',
    name: 'Furuno NavPilot-711C Autopilot Provider',
    description: 'Signal K Autopilot Provider for Furuno NavPilot-711C via NMEA2000'
  }

  let deviceId: string
  let currentState: FurunoState = {
    state: 'disabled',
    mode: 'standby',
    target: 0,
    engaged: false
  }
  let n2kCallback: any

  // Define the autopilot provider interface
  const autopilotProvider: AutopilotProvider = {
    
    getData: (apDeviceId: string) => {
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

    getState: (apDeviceId: string) => {
      if (apDeviceId !== deviceId) {
        throw new Error(`Unknown autopilot device: ${apDeviceId}`)
      }
      return currentState.state
    },

    setState: (state: string, apDeviceId: string) => {
      if (apDeviceId !== deviceId) {
        throw new Error(`Unknown autopilot device: ${apDeviceId}`)
      }
      
      if (state !== 'enabled' && state !== 'disabled') {
        throw new Error(`Invalid state: ${state}`)
      }

      currentState.state = state as 'enabled' | 'disabled'
      
      // Send N2K command to enable/disable autopilot
      if (state === 'disabled') {
        currentState.mode = 'standby'
        currentState.engaged = false
        sendAutopilotMode('standby')
      }
      
      updateAutopilotData()
      return Promise.resolve()
    },

    getMode: (apDeviceId: string) => {
      if (apDeviceId !== deviceId) {
        throw new Error(`Unknown autopilot device: ${apDeviceId}`)
      }
      return currentState.mode
    },

    setMode: (mode: string, apDeviceId: string) => {
      if (apDeviceId !== deviceId) {
        throw new Error(`Unknown autopilot device: ${apDeviceId}`)
      }

      const validModes = ['standby', 'auto', 'wind', 'route', 'fishingPattern']
      if (!validModes.includes(mode)) {
        throw new Error(`Invalid mode: ${mode}. Valid modes: ${validModes.join(', ')}`)
      }

      currentState.mode = mode as any
      currentState.engaged = mode !== 'standby'
      
      if (mode !== 'standby') {
        currentState.state = 'enabled'
      }

      sendAutopilotMode(mode)
      updateAutopilotData()
      return Promise.resolve()
    },

    getTarget: (apDeviceId: string) => {
      if (apDeviceId !== deviceId) {
        throw new Error(`Unknown autopilot device: ${apDeviceId}`)
      }
      return currentState.target
    },

    setTarget: (value: number, apDeviceId: string) => {
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

    adjustTarget: (value: number, apDeviceId: string) => {
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

    engage: (apDeviceId: string) => {
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

    disengage: (apDeviceId: string) => {
      if (apDeviceId !== deviceId) {
        throw new Error(`Unknown autopilot device: ${apDeviceId}`)
      }

      currentState.engaged = false
      currentState.mode = 'standby'
      sendAutopilotMode('standby')
      
      updateAutopilotData()
      return Promise.resolve()
    },

    tack: (direction: 'port' | 'starboard', apDeviceId: string) => {
      if (apDeviceId !== deviceId) {
        throw new Error(`Unknown autopilot device: ${apDeviceId}`)
      }

      if (currentState.mode !== 'wind') {
        throw new Error('Tack command only available in wind mode')
      }

      sendTackCommand(direction)
      return Promise.resolve()
    },

    gybe: (direction: 'port' | 'starboard', apDeviceId: string) => {
      if (apDeviceId !== deviceId) {
        throw new Error(`Unknown autopilot device: ${apDeviceId}`)
      }

      if (currentState.mode !== 'wind') {
        throw new Error('Gybe command only available in wind mode')
      }

      sendGybeCommand(direction)
      return Promise.resolve()
    },

    dodge: (value: number, apDeviceId: string) => {
      if (apDeviceId !== deviceId) {
        throw new Error(`Unknown autopilot device: ${apDeviceId}`)
      }

      // Temporary heading adjustment
      sendDodgeCommand(value)
      return Promise.resolve()
    }
  }

  // Helper functions to send NMEA2000 commands
  function sendAutopilotMode(mode: string) {
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

  function sendHeadingCommand(heading: number) {
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

  function sendWindAngleCommand(angle: number) {
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

  function sendTackCommand(direction: 'port' | 'starboard') {
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

  function sendGybeCommand(direction: 'port' | 'starboard') {
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

  function sendDodgeCommand(adjustment: number) {
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
    const updateMsg: AutopilotUpdateMessage = {
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
  function handleN2KMessage(n2k: any) {
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

  plugin.start = (settings: PluginConfig) => {
    deviceId = settings.deviceId || 'furuno-navpilot-711c'

    try {
      // Register as autopilot provider
      app.registerAutopilotProvider(deviceId, autopilotProvider)
      app.debug(`Registered Furuno NavPilot-711C autopilot provider: ${deviceId}`)

      // Subscribe to NMEA2000 messages
      app.on('N2KAnalyzerOut', handleN2KMessage)

      // Get N2K send capability
      n2kCallback = app.emit.bind(app, 'nmea2000out')

      // Set initial state
      updateAutopilotData()

      app.setPluginStatus('Started - NavPilot-711C connected')
    } catch (error) {
      app.setPluginError(`Failed to start: ${error}`)
      throw error
    }
  }

  plugin.stop = () => {
    try {
      app.removeListener('N2KAnalyzerOut', handleN2KMessage)
      app.setPluginStatus('Stopped')
    } catch (error) {
      app.setPluginError(`Error stopping: ${error}`)
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
        default: 'furuno-navpilot-711c'
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