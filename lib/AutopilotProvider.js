/**
 * AutopilotProvider - Implements Signal K Autopilot API
 */

const SignalKPaths = require('./SignalKPaths')
const N2KCommands = require('./N2KCommands')

const PLUGIN_ID = 'signalk-autopilot-furuno'

// PGN 127237 "Steering Mode" reported by the NavPilot maps to the
// Signal K autopilot mode/engaged/state:
//   Standby (hand steering) -> "Main Steering"
//   Auto (heading hold)     -> "Heading Control Standalone"
//   Nav / GOTO              -> "Track Control"
const FURUNO_STEERING_MODE = {
  'Main Steering': { mode: 'standby', engaged: false, state: 'disabled' },
  'Non-Follow-Up Device': { mode: 'standby', engaged: false, state: 'disabled' },
  'Follow-Up Device': { mode: 'standby', engaged: false, state: 'disabled' },
  'Heading Control Standalone': { mode: 'auto', engaged: true, state: 'enabled' },
  'Heading Control': { mode: 'auto', engaged: true, state: 'enabled' },
  'Track Control': { mode: 'nav', engaged: true, state: 'enabled' }
}

// Signal K server emits canboat Title-Case field names by default
// (useCamelCompat defaults to false), but a camelCase pipeline is possible.
// Read a PGN field tolerant of either spelling.
function field(fields, ...names) {
  for (const n of names) {
    if (fields[n] !== undefined) return fields[n]
  }
  return undefined
}

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
    this.n2kCommands = new N2KCommands(app, {
      experimentalCommands: settings.experimentalCommands === true,
      deviceAddress: settings.deviceAddress
    })
    this.detectionTimeout = null
    this.detected = false
    this.detectedHeading = false
    this.detectedRudder = false
    this.n2kListener = null

    // Feedback bookkeeping
    this.activeAlarms = {} // alarm/notification path -> boolean, for edge-triggered emits
    this.lastN2K = null // ms timestamp of the last PGN 127237
    this.connectionLost = false
    this.staleTimer = null
    // No 127237 for this long (ms) => NavPilot connection considered lost.
    this.staleTimeout = (settings.connectionTimeout || 5) * 1000
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

    // Connection watchdog: NavPilot broadcasts 127237 continuously, so a gap
    // means it is off / disconnected.
    this.staleTimer = setInterval(() => this.checkConnection(), 1000)

    this.app.setPluginStatus('Started - Waiting for autopilot data...')
  }

  stop() {
    if (this.detectionTimeout) {
      clearTimeout(this.detectionTimeout)
    }
    if (this.staleTimer) {
      clearInterval(this.staleTimer)
      this.staleTimer = null
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

    this.markConnectionAlive()

    let changed = false

    // Mode feedback: reflect the NavPilot's actual Steering Mode into Signal K
    // so the head and Signal K stay in sync (Auto -> Standby at the head, etc.).
    const steeringMode = field(fields, 'Steering Mode', 'steeringMode')
    const mapped = FURUNO_STEERING_MODE[steeringMode]
    if (mapped) {
      if (this.state.mode !== mapped.mode ||
          this.state.engaged !== mapped.engaged ||
          this.state.state !== mapped.state) {
        this.app.debug(
          'Mode feedback: ' + steeringMode + ' -> mode=' + mapped.mode +
          ' engaged=' + mapped.engaged + ' state=' + mapped.state
        )
        this.state.mode = mapped.mode
        this.state.engaged = mapped.engaged
        this.state.state = mapped.state
        changed = true
      }
    } else if (steeringMode !== undefined) {
      this.app.debug('Unmapped Steering Mode: ' + steeringMode)
    }

    // Target feedback: the pilot's own commanded course (Heading-To-Steer),
    // so Signal K reflects what the NavPilot is actually steering to.
    const hts = field(fields, 'Heading-To-Steer (Course)', 'headingToSteer')
    if (hts !== null && hts !== undefined && hts !== this.state.target) {
      this.state.target = hts
      changed = true
    }

    if (changed) {
      this.updateSignalK()
    }

    // Limit / override flags -> Signal K notifications (edge-triggered).
    // Off-heading and off-track map to the standard autopilot alarm paths;
    // rudder-limit and override have no standard path, so use a custom one.
    this.setAlarm('heading',
      field(fields, 'Off-Heading Limit Exceeded', 'offHeadingLimitExceeded') === 'Yes',
      'Off heading limit exceeded', 'alarm')
    this.setAlarm('xte',
      field(fields, 'Off-Track Limit Exceeded', 'offTrackLimitExceeded') === 'Yes',
      'Off track limit exceeded', 'alarm')
    this.setNotification('rudderLimit',
      field(fields, 'Rudder Limit Exceeded', 'rudderLimitExceeded') === 'Yes',
      'Rudder limit exceeded', 'alarm')
    this.setNotification('override',
      field(fields, 'Override', 'override') === 'Yes',
      'Autopilot override active', 'warn')

    // Log commanded rudder angle if available
    const commandedRudderAngle = field(fields, 'Commanded Rudder Angle', 'commandedRudderAngle')
    if (commandedRudderAngle !== null && commandedRudderAngle !== undefined) {
      const cmdRudderDeg = (commandedRudderAngle * 180 / Math.PI).toFixed(1)
      this.app.debug('Autopilot commanding rudder: ' + cmdRudderDeg + '°')
    }
  }

  // Emit a standard autopilot alarm (path is one of the SK autopilot alarm names:
  // heading, xte, wind, waypointAdvance, waypointArrival, routeComplete).
  setAlarm(apPath, active, message, level) {
    if (this.activeAlarms[apPath] === active) return
    this.activeAlarms[apPath] = active
    this.app.autopilotUpdate(this.deviceId, {
      alarm: {
        path: apPath,
        value: active
          ? { state: level || 'alarm', message, method: ['visual', 'sound'] }
          : { state: 'normal', message, method: [] }
      }
    })
    this.app.debug((active ? 'ALARM ' : 'clear ') + apPath + ': ' + message)
  }

  // Emit a notification on a non-standard autopilot path (rudderLimit, override,
  // connectionLost) that has no dedicated autopilot-API alarm name.
  setNotification(subPath, active, message, level) {
    if (this.activeAlarms[subPath] === active) return
    this.activeAlarms[subPath] = active
    this.app.handleMessage(PLUGIN_ID, {
      updates: [
        {
          values: [
            {
              path: 'notifications.steering.autopilot.' + subPath,
              value: active
                ? { state: level || 'alarm', message, method: ['visual', 'sound'] }
                : { state: 'normal', message, method: [] }
            }
          ]
        }
      ]
    })
    this.app.debug((active ? 'NOTIFY ' : 'clear ') + subPath + ': ' + message)
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
    // Heading/rudder/xte are not published as autopilot attributes (they are
    // already on standard paths), so no autopilotUpdate() is needed here.
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
    // Only the valid autopilot update attributes are published here. Heading and
    // rudder angle are already on standard paths (navigation.*, steering.rudderAngle);
    // alarms are emitted separately via setAlarm()/setNotification().
    this.app.autopilotUpdate(this.deviceId, {
      state: this.state.state,
      mode: this.state.mode,
      target: this.state.target,
      engaged: this.state.engaged
    })
  }

  // Record that the NavPilot is transmitting, and clear a connection-lost
  // notification if one was raised.
  markConnectionAlive() {
    this.lastN2K = Date.now()
    if (this.connectionLost) {
      this.connectionLost = false
      this.setNotification('connectionLost', false, 'NavPilot connection restored', 'alarm')
      this.app.setPluginStatus('Connected - NavPilot data OK')
    }
  }

  // Watchdog: if no PGN 127237 arrives within staleTimeout, flag the NavPilot as
  // disconnected (it stops broadcasting when powered off / bus fault).
  checkConnection() {
    if (this.lastN2K === null || this.connectionLost) return
    if (Date.now() - this.lastN2K > this.staleTimeout) {
      this.connectionLost = true
      this.setNotification('connectionLost', true, 'NavPilot connection lost', 'alarm')
      this.app.setPluginStatus('Warning - NavPilot connection lost (no data)')
      this.app.debug('No PGN 127237 for ' + (this.staleTimeout / 1000) + 's - connection lost')
    }
  }

  // Signal K Autopilot Provider Interface
  getProvider() {
    return {
      getData: async (apDeviceId) => {
        this.validateDeviceId(apDeviceId)
        
        return {
          options: {
            states: [
              { name: 'enabled', engaged: true },
              { name: 'disabled', engaged: false }
            ],
            modes: ['standby', 'auto', 'nav'],
            // 'dodge' is the only supported action, and only when experimental
            // commands are enabled (no verified command path otherwise).
            actions: [
              {
                id: 'dodge',
                name: 'Dodge',
                available: this.n2kCommands.commandsEnabled && this.state.mode !== 'standby'
              }
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

        if (newState === 'disabled') {
          this.requireCommands('Disable')
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
        this.requireCommands('setMode')

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
        this.requireCommands('setTarget')

        const degrees = (value * 180 / Math.PI).toFixed(1)
        this.app.debug('setTarget: ' + degrees + '°')

        this.state.target = value

        if (this.state.mode === 'auto') {
          this.n2kCommands.setCourse(value)
        }

        this.updateSignalK()
      },

      adjustTarget: async (adjustment, apDeviceId) => {
        this.validateDeviceId(apDeviceId)
        this.requireCommands('adjustTarget')

        const oldTarget = this.state.target
        this.state.target += adjustment
        
        // Normalize to 0-2π
        while (this.state.target < 0) this.state.target += 2 * Math.PI
        while (this.state.target >= 2 * Math.PI) this.state.target -= 2 * Math.PI

        const oldDeg = (oldTarget * 180 / Math.PI).toFixed(1)
        const newDeg = (this.state.target * 180 / Math.PI).toFixed(1)
        const adjDeg = (adjustment * 180 / Math.PI).toFixed(1)
        this.app.debug('adjustTarget: ' + oldDeg + '° -> ' + newDeg + '° (' + adjDeg + '°)')

        // The NavPilot has no relative command: send the new absolute course.
        if (this.state.mode === 'auto') {
          this.n2kCommands.setCourse(this.state.target)
        }

        this.updateSignalK()
      },

      engage: async (apDeviceId) => {
        this.validateDeviceId(apDeviceId)
        this.requireCommands('engage')

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
        this.requireCommands('disengage')

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
        this.requireCommands('dodge')

        const degrees = (value * 180 / Math.PI).toFixed(1)
        this.app.debug('Dodge: ' + degrees + '°')

        // No dodge PGN exists; send an absolute course offset from the current target.
        const base = this.state.target != null ? this.state.target : (this.state.heading || 0)
        let course = base + value
        while (course < 0) course += 2 * Math.PI
        while (course >= 2 * Math.PI) course -= 2 * Math.PI
        this.n2kCommands.setCourse(course)
      }
    }
  }

  validateDeviceId(apDeviceId) {
    if (apDeviceId !== this.deviceId && apDeviceId !== '_default') {
      throw new Error('Unknown autopilot device: ' + apDeviceId)
    }
  }

  // Remote command has no verified path on this hardware; refuse unless the
  // user opted into the experimental (unverified) command support.
  requireCommands(action) {
    if (!this.n2kCommands.commandsEnabled) {
      throw new Error(
        action + ' is not available: this NavPilot has no verified NMEA 2000 ' +
        'remote-control path (feedback only). Enable "experimentalCommands" in the ' +
        'plugin settings to attempt it (unverified, may do nothing).'
      )
    }
  }
}

module.exports = AutopilotProvider