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
      rudderAngle: null
    }

    this.signalKPaths = new SignalKPaths(app, this.onPathUpdate.bind(this))
    this.n2kCommands = new N2KCommands(app)
    this.detectionTimeout = null
    this.detected = false
  }

  start() {
    this.app.debug('Registering autopilot provider: ' + this.deviceId)
    
    // Register with Signal K
    this.app.registerAutopilotProvider(this.getProvider(), [this.deviceId])
    
    // Subscribe to Signal K paths
    this.signalKPaths.subscribe()
    
    // Initialize N2K commands
    this.n2kCommands.initialize()
    
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
    
    this.signalKPaths.unsubscribe()
    this.app.debug('AutopilotProvider stopped')
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
            modes: ['standby', 'auto', 'wind', 'route', 'fishingPattern'],
            actions: [
              { id: 'tack', name: 'Tack', available: this.state.mode === 'wind' },
              { id: 'adjustHeading', name: 'Adjust Heading', available: this.state.mode === 'auto' },
              { id: 'advanceWaypoint', name: 'Advance Waypoint', available: this.state.mode === 'route' }
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
        
        const validModes = ['standby', 'auto', 'wind', 'route', 'fishingPattern']
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
        } else if (this.state.mode === 'wind') {
          this.n2kCommands.setWindAngle(value)
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
        
        if (this.state.mode !== 'wind') {
          throw new Error('Tack only available in wind mode')
        }

        this.app.debug('Tack: ' + direction)
        this.n2kCommands.tack(direction)
      },

      gybe: async (direction, apDeviceId) => {
        this.validateDeviceId(apDeviceId)
        
        if (this.state.mode !== 'wind') {
          throw new Error('Gybe only available in wind mode')
        }

        this.app.debug('Gybe: ' + direction)
        this.n2kCommands.gybe(direction)
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