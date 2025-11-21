/**
 * AutopilotProvider - Implements Signal K Autopilot API
 */

const SignalKPaths = require('./SignalKPaths')
const N2KCommands = require('./N2KCommands')

class AutopilotProvider {
  constructor(app, settings) {
    this.app = app
    this.settings = settings
    this.deviceId = settings.deviceId || '711c'

    this.state = {
      state: 'disabled',
      mode: 'standby',
      target: 0,
      engaged: false,
      heading: null,
      rudderAngle: null,
      xte: null,
      alarms: []
    }

    this.signalKPaths = new SignalKPaths(app, this.onPathUpdate.bind(this))
    this.n2kCommands = new N2KCommands(app)
    this.detectionTimeout = null
    this.detected = false
    this.detectedHeading = false
    this.detectedRudder = false
    this.n2kListener = null
  }

  start() {
    this.app.debug('Registering autopilot provider: ' + this.deviceId)

    // Register with Signal K
    this.app.registerAutopilotProvider(this.getProvider(), [this.deviceId])

    // Subscribe to Signal K paths
    this.signalKPaths.subscribe()

    // Initialize N2K commands
    this.n2kCommands.initialize()

    // Listen for PGN 127237 (Heading/Track Control) from autopilot
    this.setupN2KListener()

    // Send initial state
    this.updateSignalK()

    // Set detection timeout
    const timeout = (this.settings.detectionTimeout || 10) * 1000
    this.detectionTimeout = setTimeout(() => {
      if (!this.detected) {
        this.app.setPluginStatus('Warning - No autopilot data detected. Check NMEA2000 connection.')
        this.app.debug('No heading or rudder data received after ' + (timeout/1000) + ' seconds')
      }
    }, timeout)

    this.app.setPluginStatus('Started - Waiting for autopilot data...')
  }

  stop() {
    if (this.detectionTimeout) {
      clearTimeout(this.detectionTimeout)
    }

    if (this.n2kListener) {
      this.app.removeListener('N2KAnalyzerOut', this.n2kListener)
      this.n2kListener = null
    }

    this.signalKPaths.unsubscribe()
    this.app.debug('AutopilotProvider stopped')
  }

  setupN2KListener() {
    this.n2kListener = (n2k) => {
      // Listen for PGN 127237 (Heading/Track Control) from autopilot
      if (n2k && n2k.pgn === 127237 && n2k.fields) {
        this.handlePGN127237(n2k.fields)
      }
    }

    this.app.on('N2KAnalyzerOut', this.n2kListener)
    this.app.debug('Listening for PGN 127237 (Heading/Track Control)')
  }

  handlePGN127237(fields) {
    // Process autopilot feedback from PGN 127237
    this.app.debug('Received PGN 127237: ' + JSON.stringify(fields))

    const alarms = []

    // Check for limit exceeded conditions
    if (fields.rudderLimitExceeded === 'Yes') {
      alarms.push({
        method: ['visual', 'sound'],
        state: 'alarm',
        message: 'Rudder limit exceeded'
      })
      this.app.debug('ALARM: Rudder limit exceeded')
    }

    if (fields.offHeadingLimitExceeded === 'Yes') {
      alarms.push({
        method: ['visual', 'sound'],
        state: 'alarm',
        message: 'Off heading limit exceeded'
      })
      this.app.debug('ALARM: Off heading limit exceeded')
    }

    if (fields.offTrackLimitExceeded === 'Yes') {
      alarms.push({
        method: ['visual', 'sound'],
        state: 'alarm',
        message: 'Off track limit exceeded'
      })
      this.app.debug('ALARM: Off track limit exceeded')
    }

    if (fields.override === 'Yes') {
      alarms.push({
        method: ['visual'],
        state: 'warn',
        message: 'Autopilot override active'
      })
      this.app.debug('WARNING: Autopilot override active')
    }

    // Update alarms if changed
    if (JSON.stringify(alarms) !== JSON.stringify(this.state.alarms)) {
      this.state.alarms = alarms
      this.updateSignalK()
    }

    // Log commanded rudder angle if available
    if (fields.commandedRudderAngle !== null && fields.commandedRudderAngle !== undefined) {
      const cmdRudderDeg = (fields.commandedRudderAngle * 180 / Math.PI).toFixed(1)
      this.app.debug('Autopilot commanding rudder: ' + cmdRudderDeg + '°')
    }
  }

  onPathUpdate(path, value) {
    let wasDetected = this.detected
    
    if (path === 'heading') {
      this.state.heading = value
      if (!this.detectedHeading) {
        this.detectedHeading = true
        this.app.debug('Heading data detected')
        this.checkDetection()
      }
    } else if (path === 'rudderAngle') {
      this.state.rudderAngle = value
      if (!this.detectedRudder) {
        this.detectedRudder = true
        this.app.debug('Rudder angle data detected')
        this.checkDetection()
      }
    } else if (path === 'xte') {
      this.state.xte = value
    }
    
    this.updateSignalK()
  }

  checkDetection() {
    // Consider autopilot detected if we have heading data
    // Rudder is nice to have but not required (some autopilots don't report it)
    if (this.detectedHeading && !this.detected) {
      this.detected = true
      
      let status = 'Connected - Autopilot detected ('
      if (this.detectedHeading) status += 'heading'
      if (this.detectedRudder) status += ', rudder'
      status += ')'
      
      this.app.setPluginStatus(status)
      this.app.debug('Autopilot fully detected')
      
      if (this.detectionTimeout) {
        clearTimeout(this.detectionTimeout)
        this.detectionTimeout = null
      }
    }
  }

  updateSignalK() {
    const update = {
      state: this.state.state,
      mode: this.state.mode,
      target: this.state.target,
      engaged: this.state.engaged
    }

    if (this.state.heading !== null) {
      update.heading = this.state.heading
    }

    if (this.state.rudderAngle !== null) {
      update.rudderAngle = this.state.rudderAngle
    }

    if (this.state.alarms && this.state.alarms.length > 0) {
      update.alarms = this.state.alarms
    }

    this.app.autopilotUpdate(this.deviceId, update)
  }

  // Signal K Autopilot Provider Interface
  getProvider() {
    return {
      getData: async (apDeviceId) => {
        this.validateDeviceId(apDeviceId)
        
        return {
          options: {
            states: ['enabled', 'disabled'],
            modes: ['standby', 'auto', 'nav'],
            actions: [
              { id: 'adjustHeading', name: 'Adjust Heading', available: this.state.mode === 'auto' },
              { id: 'advanceWaypoint', name: 'Advance Waypoint', available: this.state.mode === 'nav' }
            ]
          },
          state: this.state.state,
          mode: this.state.mode,
          target: this.state.target,
          engaged: this.state.engaged
        }
      },

      getState: async (apDeviceId) => {
        this.validateDeviceId(apDeviceId)
        return this.state.state
      },

      setState: async (newState, apDeviceId) => {
        this.validateDeviceId(apDeviceId)
        
        if (newState !== 'enabled' && newState !== 'disabled') {
          throw new Error('Invalid state: ' + newState)
        }

        this.app.debug('setState: ' + this.state.state + ' -> ' + newState)
        this.state.state = newState
        
        if (newState === 'disabled') {
          this.state.mode = 'standby'
          this.state.engaged = false
          this.n2kCommands.setMode('standby')
        }
        
        this.updateSignalK()
      },

      getMode: async (apDeviceId) => {
        this.validateDeviceId(apDeviceId)
        return this.state.mode
      },

      setMode: async (mode, apDeviceId) => {
        this.validateDeviceId(apDeviceId)

        const validModes = ['standby', 'auto', 'nav']
        if (!validModes.includes(mode)) {
          throw new Error('Invalid mode: ' + mode)
        }

        this.app.debug('setMode: ' + this.state.mode + ' -> ' + mode)
        this.state.mode = mode
        this.state.engaged = mode !== 'standby'

        if (mode !== 'standby') {
          this.state.state = 'enabled'
        }

        this.n2kCommands.setMode(mode)
        this.updateSignalK()
      },

      getTarget: async (apDeviceId) => {
        this.validateDeviceId(apDeviceId)
        return this.state.target
      },

      setTarget: async (value, apDeviceId) => {
        this.validateDeviceId(apDeviceId)

        const degrees = (value * 180 / Math.PI).toFixed(1)
        this.app.debug('setTarget: ' + degrees + '°')

        this.state.target = value

        if (this.state.mode === 'auto') {
          this.n2kCommands.setHeading(value)
        }

        this.updateSignalK()
      },

      adjustTarget: async (adjustment, apDeviceId) => {
        this.validateDeviceId(apDeviceId)
        
        const oldTarget = this.state.target
        this.state.target += adjustment
        
        // Normalize to 0-2π
        while (this.state.target < 0) this.state.target += 2 * Math.PI
        while (this.state.target >= 2 * Math.PI) this.state.target -= 2 * Math.PI

        const oldDeg = (oldTarget * 180 / Math.PI).toFixed(1)
        const newDeg = (this.state.target * 180 / Math.PI).toFixed(1)
        const adjDeg = (adjustment * 180 / Math.PI).toFixed(1)
        this.app.debug('adjustTarget: ' + oldDeg + '° -> ' + newDeg + '° (' + adjDeg + '°)')

        if (this.state.mode === 'auto') {
          this.n2kCommands.setHeading(this.state.target)
        }

        this.updateSignalK()
      },

      engage: async (apDeviceId) => {
        this.validateDeviceId(apDeviceId)
        
        this.app.debug('Engaging autopilot')
        this.state.engaged = true
        this.state.state = 'enabled'
        
        if (this.state.mode === 'standby') {
          this.state.mode = 'auto'
          this.n2kCommands.setMode('auto')
        }

        this.updateSignalK()
      },

      disengage: async (apDeviceId) => {
        this.validateDeviceId(apDeviceId)
        
        this.app.debug('Disengaging autopilot')
        this.state.engaged = false
        this.state.mode = 'standby'
        this.n2kCommands.setMode('standby')
        
        this.updateSignalK()
      },

      tack: async (direction, apDeviceId) => {
        this.validateDeviceId(apDeviceId)
        throw new Error('Tack not supported by Furuno NavPilot-711C')
      },

      gybe: async (direction, apDeviceId) => {
        this.validateDeviceId(apDeviceId)
        throw new Error('Gybe not supported by Furuno NavPilot-711C')
      },

      dodge: async (value, apDeviceId) => {
        this.validateDeviceId(apDeviceId)

        const degrees = (value * 180 / Math.PI).toFixed(1)
        this.app.debug('Dodge: ' + degrees + '°')
        this.n2kCommands.dodge(value)
      }
    }
  }

  validateDeviceId(apDeviceId) {
    if (apDeviceId !== this.deviceId && apDeviceId !== '_default') {
      throw new Error('Unknown autopilot device: ' + apDeviceId)
    }
  }
}

module.exports = AutopilotProvider