/**
 * SignalKPaths - Subscribes to Signal K paths and monitors autopilot data
 */

class SignalKPaths {
  constructor(app, onUpdate) {
    this.app = app
    this.onUpdate = onUpdate
    this.subscriptions = []
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
      const unsubscribe = this.app.streambundle.getSelfBus(path).onValue((value) => {
        // Only log on significant changes to reduce spam
        if (dataType === 'heading') {
          // Only log heading occasionally (every 10 degrees change or first time)
          if (!this.lastHeading || Math.abs(value - this.lastHeading) > 0.174) { // ~10 degrees
            this.app.debug('Heading updated: ' + (value * 180 / Math.PI).toFixed(1) + '°')
            this.lastHeading = value
          }
        } else {
          this.app.debug('Path ' + path + ' updated: ' + value)
        }
        
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