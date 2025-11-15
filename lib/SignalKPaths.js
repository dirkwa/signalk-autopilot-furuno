/**
 * SignalKPaths - Subscribes to Signal K paths and monitors autopilot data
 */

class SignalKPaths {
  constructor(app, onUpdate) {
    this.app = app
    this.onUpdate = onUpdate
    this.subscriptions = []
    this.lastHeading = null
    this.lastRudder = null
    this.lastXTE = null
  }

  subscribe() {
    this.app.debug('Subscribing to Signal K paths...')
    
    // Subscribe to heading (try both magnetic and true)
    this.subscribePath('navigation.headingMagnetic', 'heading')
    this.subscribePath('navigation.headingTrue', 'heading')
    
    // Subscribe to rudder angle
    this.subscribePath('steering.rudderAngle', 'rudderAngle')
    
    // Subscribe to XTE for route mode
    this.subscribePath('navigation.courseGreatCircle.crossTrackError', 'xte')
  }

  subscribePath(path, dataType) {
    try {
      const unsubscribe = this.app.streambundle.getSelfBus(path).onValue((rawValue) => {
        // Extract actual value (might be wrapped in {value: ...})
        let value = rawValue
        if (typeof rawValue === 'object' && rawValue !== null && 'value' in rawValue) {
          value = rawValue.value
        }

        // Skip if value is null or undefined
        if (value === null || value === undefined) {
          return
        }

        // Throttle logging based on data type
        let shouldLog = false
        
        if (dataType === 'heading') {
          // Only log heading on significant change (>10 degrees) or first time
          if (this.lastHeading === null || Math.abs(value - this.lastHeading) > 0.174) {
            const degrees = (value * 180 / Math.PI).toFixed(1)
            this.app.debug('Heading updated: ' + degrees + '°')
            this.lastHeading = value
            shouldLog = true
          }
        } else if (dataType === 'rudderAngle') {
          // Only log rudder on significant change (>5 degrees) or first time
          if (this.lastRudder === null || Math.abs(value - this.lastRudder) > 0.087) {
            const degrees = (value * 180 / Math.PI).toFixed(1)
            this.app.debug('Rudder angle: ' + degrees + '°')
            this.lastRudder = value
            shouldLog = true
          }
        } else if (dataType === 'xte') {
          // Only log XTE on significant change (>10m) or first time
          if (this.lastXTE === null || Math.abs(value - this.lastXTE) > 10) {
            this.app.debug('Cross track error: ' + value.toFixed(1) + 'm')
            this.lastXTE = value
            shouldLog = true
          }
        }
        
        // Always call onUpdate, but only log occasionally
        this.onUpdate(dataType, value)
      })

      this.subscriptions.push({ path, unsubscribe })
      this.app.debug('Subscribed to: ' + path)
    } catch (err) {
      this.app.debug('Could not subscribe to ' + path + ': ' + err.message)
    }
  }

  unsubscribe() {
    this.subscriptions.forEach((sub) => {
      try {
        if (sub.unsubscribe && typeof sub.unsubscribe === 'function') {
          sub.unsubscribe()
          this.app.debug('Unsubscribed from: ' + sub.path)
        }
      } catch (err) {
        this.app.debug('Error unsubscribing from ' + sub.path + ': ' + err.message)
      }
    })
    
    this.subscriptions = []
  }
}

module.exports = SignalKPaths