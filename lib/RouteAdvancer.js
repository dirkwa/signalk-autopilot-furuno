/**
 * RouteAdvancer - moves an active Signal K route on to its next point on arrival.
 *
 * In NAV mode the NavPilot steers to the destination it receives in PGN 129284
 * and does not step through a route itself: the navigator has to switch the
 * destination to the next waypoint. Signal K's Course API leaves that to its
 * clients, so without it the pilot keeps steering to a waypoint it has already
 * passed and turns back towards it.
 *
 * While a route is active, this activates the next route point as soon as the
 * vessel enters the arrival circle, or has passed the line through the
 * waypoint perpendicular to the leg (when it goes by outside the circle, or was
 * already inside it when the point became the destination). It does so in any
 * pilot mode, like a chart plotter sequencing its route, so the destination
 * never lies behind the boat when NAV is engaged later. The target point index
 * is absolute, so an advance made elsewhere at the same moment (e.g. by
 * Freeboard-SK) cannot skip a point.
 *
 * The new leg then starts at the vessel's position rather than at the reached
 * waypoint, so the pilot turns towards the next point instead of first
 * correcting onto a track line the boat is not yet on.
 */

const EARTH_RADIUS = 6371008.8 // m
const DEG = Math.PI / 180
const DEFAULT_MIN_INTERVAL_MS = 1000

// Position relative to `origin` in metres (x east, y north), on a local flat
// projection - accurate enough within a few km of a waypoint. The longitude
// difference takes the short way round, across the antimeridian if needed.
function toLocal(origin, p) {
  const dLon = ((p.longitude - origin.longitude + 540) % 360) - 180
  return {
    x: dLon * DEG * Math.cos(origin.latitude * DEG) * EARTH_RADIUS,
    y: (p.latitude - origin.latitude) * DEG * EARTH_RADIUS
  }
}

// One activation of a route at one point: activateRoute() sets a new startTime,
// so re-running a route yields a new key for the same point.
function runKey(course) {
  const route = course && course.activeRoute
  return route ? route.href + '#' + route.pointIndex + '#' + (course.startTime || '') : null
}

function isPosition(p) {
  return p && typeof p.latitude === 'number' && typeof p.longitude === 'number'
}

class RouteAdvancer {
  constructor(app, options = {}) {
    this.app = app
    this.minIntervalMs = options.minIntervalMs !== undefined
      ? options.minIntervalMs
      : DEFAULT_MIN_INTERVAL_MS
    this.unsubscribe = null
    this.stopped = false
    this.lastCheck = 0
    this.checking = false
    this.advancedFrom = null // runKey() of the last advance
    this.seenOutside = null // runKey() of the point the vessel was last seen outside the circle of
  }

  start() {
    this.stop()
    this.stopped = false
    if (typeof this.app.getCourse !== 'function' || typeof this.app.activateRoute !== 'function') {
      this.app.error('Route auto-advance unavailable: this Signal K server has no Course API for plugins')
      return
    }
    try {
      this.unsubscribe = this.app.streambundle
        .getSelfBus('navigation.position')
        .onValue((raw) => {
          const value = raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw
          this.onPosition(value)
        })
    } catch (err) {
      this.app.error('Route auto-advance unavailable: ' + err.message)
    }
  }

  stop() {
    this.stopped = true
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
  }

  onPosition(position) {
    const now = Date.now()
    if (this.checking || now - this.lastCheck < this.minIntervalMs) return
    this.lastCheck = now
    this.check(position).catch((err) => {
      this.app.error('Route auto-advance failed: ' + err.message)
    })
  }

  // Returns true if it advanced the route.
  async check(position) {
    if (!isPosition(position)) return false
    this.checking = true
    try {
      const course = await this.app.getCourse()
      const route = course && course.activeRoute
      if (!route || !route.href) return false
      const index = route.pointIndex
      if (typeof index !== 'number' || typeof route.pointTotal !== 'number') return false
      if (index >= route.pointTotal - 1) return false // last point: nothing to advance to

      const key = runKey(course)
      if (key === this.advancedFrom) return false

      const next = course.nextPoint && course.nextPoint.position
      if (!isPosition(next)) return false

      const vessel = toLocal(next, position)
      const distance = Math.hypot(vessel.x, vessel.y)
      const circle = typeof course.arrivalCircle === 'number' ? course.arrivalCircle : 0
      const withinCircle = circle > 0 && distance <= circle
      // Entering the circle counts only once the vessel has been outside it for
      // this point. Where the circles of two close waypoints overlap, the vessel
      // is already inside the next one when it is activated; advancing again at
      // once would skip that waypoint, so it is left to the perpendicular.
      if (!withinCircle) this.seenOutside = key
      const inCircle = withinCircle && this.seenOutside === key

      // Past the waypoint's perpendicular: the vessel lies on the far side of the
      // line through the waypoint at right angles to the leg.
      let passed = false
      const prev = course.previousPoint && course.previousPoint.position
      if (isPosition(prev)) {
        const leg = toLocal(next, prev)
        passed = (leg.x !== 0 || leg.y !== 0) && vessel.x * leg.x + vessel.y * leg.y < 0
      }

      if (!inCircle && !passed) return false

      // Nothing may have changed while deciding: the plugin stopped, or the
      // destination was changed or cleared.
      const current = await this.app.getCourse()
      if (this.stopped || runKey(current) !== key) return false

      this.advancedFrom = key
      this.app.debug(
        'Route ' + (route.name || route.href) + ': ' +
        (inCircle ? 'arrival circle entered' : 'waypoint passed') +
        ' at point ' + index + ' (' + Math.round(distance) + ' m), advancing to point ' + (index + 1)
      )
      try {
        await this.app.activateRoute({
          href: route.href,
          pointIndex: index + 1,
          reverse: !!route.reverse
        })
      } catch (err) {
        this.advancedFrom = null
        throw err
      }
      this.startLegAtVessel(position)
      return true
    } finally {
      this.checking = false
    }
  }

  // Make the vessel's position the start of the current leg, as the Course
  // API's restart does. Servers that do not offer it to plugins get the same
  // change through their Course API object; failing both, the leg keeps
  // starting at the reached waypoint.
  startLegAtVessel(position) {
    try {
      if (typeof this.app.restartCourse === 'function') {
        Promise.resolve(this.app.restartCourse()).catch((err) => {
          this.app.error('Could not start the new leg at the vessel: ' + err.message)
        })
        return
      }
      const api = this.app.courseApi
      if (api && api.courseInfo && api.courseInfo.nextPoint && typeof api.emitCourseInfo === 'function') {
        api.courseInfo.previousPoint = {
          position: { latitude: position.latitude, longitude: position.longitude },
          type: 'VesselPosition'
        }
        api.emitCourseInfo(false, 'previousPoint')
      }
    } catch (err) {
      this.app.error('Could not start the new leg at the vessel: ' + err.message)
    }
  }
}

module.exports = RouteAdvancer
