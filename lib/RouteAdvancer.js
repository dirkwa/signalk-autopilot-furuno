/**
 * RouteAdvancer - moves an active Signal K route on to its next point on arrival.
 *
 * In NAV mode the NavPilot steers to the destination it receives in PGN 129284
 * and does not step through a route itself: the navigator has to switch the
 * destination to the next waypoint. Signal K's Course API leaves that to its
 * clients, so without it the pilot keeps steering to a waypoint it has already
 * passed and turns back towards it.
 *
 * While a route is active, this activates the next route point at the
 * wheel-over point: the distance d = R * tan(delta / 2) before the waypoint at
 * which a turn of radius R onto the next leg meets both legs, where delta is
 * the course change and R the vessel's speed over the pilot's turn rate. The
 * new leg keeps running from the reached waypoint, so the boat starts its turn
 * on the inside of the next leg and comes onto it without overshooting. It
 * switches no later than the arrival circle, and when the vessel goes by the
 * waypoint off the track it switches on passing the waypoint's perpendicular
 * and starts the new leg at the vessel instead.
 *
 * It does so in any pilot mode, like a chart plotter sequencing its route, so
 * the destination never lies behind the boat when NAV is engaged later. The
 * target point index is absolute, so an advance made elsewhere at the same
 * moment (e.g. by Freeboard-SK) cannot skip a point.
 */

const EARTH_RADIUS = 6371008.8 // m
const DEG = Math.PI / 180
const DEFAULT_MIN_INTERVAL_MS = 1000
// Effective NAV-mode turn rate of a NavPilot-700 at about 6 kn, measured
// underway: it reacts some 3 s late, then turns at up to ~3 deg/s on large
// course changes and more slowly on small ones.
const DEFAULT_TURN_RATE = 2.2 // degrees per second
// The route is re-read this often, so an edit to it during a leg is picked up.
const DEFAULT_ROUTE_REFRESH_MS = 15000

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

// Route point `index` in travel order, as the Course API numbers it.
function routePoint(coordinates, index, reverse) {
  const c = coordinates[reverse ? coordinates.length - 1 - index : index]
  return Array.isArray(c) ? { latitude: c[1], longitude: c[0] } : null
}

class RouteAdvancer {
  constructor(app, options = {}) {
    this.app = app
    this.minIntervalMs = options.minIntervalMs !== undefined
      ? options.minIntervalMs
      : DEFAULT_MIN_INTERVAL_MS
    const turnRate = typeof options.turnRate === 'number' ? options.turnRate : DEFAULT_TURN_RATE
    this.turnRate = turnRate > 0 ? turnRate * DEG : 0 // radians per second
    this.routeRefreshMs = options.routeRefreshMs !== undefined
      ? options.routeRefreshMs
      : DEFAULT_ROUTE_REFRESH_MS
    this.route = { key: null, coordinates: null, at: 0 } // route read for the current leg
    this.unsubscribe = null
    this.stopped = false
    this.lastCheck = 0
    this.checking = false
    this.advancedFrom = null // runKey() of the last advance
    this.seenOutside = null // runKey() of the point the vessel was last seen outside the switch zone of
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

      // Along the inbound leg: distance still to go to the waypoint's
      // perpendicular (negative once past it) and the offset to either side.
      let toGo = null
      let offTrack = 0
      let inbound = null
      const prev = course.previousPoint && course.previousPoint.position
      if (isPosition(prev)) {
        const leg = toLocal(next, prev)
        const length = Math.hypot(leg.x, leg.y)
        if (length > 0) {
          inbound = { x: -leg.x / length, y: -leg.y / length, length }
          toGo = -(vessel.x * inbound.x + vessel.y * inbound.y)
          offTrack = Math.abs(vessel.x * inbound.y - vessel.y * inbound.x)
        }
      }
      const passed = toGo !== null && toGo < 0

      const wheelOver = inbound
        ? await this.wheelOverDistance(course, route, key, next, inbound)
        : 0
      const atWheelOver = wheelOver > 0 && toGo <= wheelOver && offTrack <= wheelOver
      const withinZone = (circle > 0 && distance <= circle) || atWheelOver
      // Entering the switch zone counts only once the vessel has been outside it
      // for this point. Where the zones of two close waypoints overlap, the
      // vessel is already inside the next one when it is activated; advancing
      // again at once would skip that waypoint, so it is left to the
      // perpendicular.
      if (!withinZone) this.seenOutside = key
      const entered = withinZone && this.seenOutside === key

      if (!entered && !passed) return false

      // Nothing may have changed while deciding: the plugin stopped, or the
      // destination was changed or cleared.
      const current = await this.app.getCourse()
      if (this.stopped || runKey(current) !== key) return false

      this.advancedFrom = key
      this.app.debug(
        'Route ' + (route.name || route.href) + ': ' +
        (entered ? 'turning onto the next leg' : 'waypoint passed off the track') +
        ' at point ' + index + ' (' + Math.round(distance) + ' m, wheel-over ' +
        Math.round(wheelOver) + ' m), advancing to point ' + (index + 1)
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
      if (!entered) this.startLegAtVessel(position)
      return true
    } finally {
      this.checking = false
    }
  }

  // Distance before the waypoint at which to switch so that a turn at the
  // pilot's turn rate joins the next leg; 0 when speed, turn rate or the next
  // leg are unknown. Capped at half of either leg, so short legs are not cut.
  async wheelOverDistance(course, route, key, next, inbound) {
    if (!(this.turnRate > 0)) return 0
    const sog = typeof this.app.getSelfPath === 'function'
      ? this.app.getSelfPath('navigation.speedOverGround')
      : null
    const speed = sog && typeof sog.value === 'number' ? sog.value : 0
    if (!(speed > 0)) return 0

    const coordinates = await this.routeCoordinates(route, key)
    const after = coordinates && routePoint(coordinates, route.pointIndex + 1, !!route.reverse)
    if (!isPosition(after)) return 0
    const out = toLocal(next, after)
    const outLength = Math.hypot(out.x, out.y)
    if (!(outLength > 0)) return 0

    const cos = (inbound.x * out.x + inbound.y * out.y) / outLength
    const turn = Math.acos(Math.max(-1, Math.min(1, cos)))
    const radius = speed / this.turnRate
    const distance = radius * Math.tan(turn / 2)
    return Math.min(distance, inbound.length / 2, outLength / 2)
  }

  // The active route's coordinates, read at the start of a leg and again every
  // routeRefreshMs while it lasts.
  async routeCoordinates(route, key) {
    const now = Date.now()
    if (this.route.key === key && now - this.route.at < this.routeRefreshMs) {
      return this.route.coordinates
    }
    let coordinates = null
    try {
      const api = this.app.resourcesApi
      if (api && typeof api.getResource === 'function') {
        const resource = await api.getResource('routes', route.href.split('/').pop())
        const c = resource && resource.feature && resource.feature.geometry &&
          resource.feature.geometry.coordinates
        coordinates = Array.isArray(c) ? c : null
      }
    } catch (err) {
      this.app.debug('Could not read route ' + route.href + ': ' + err.message)
    }
    this.route = { key, coordinates, at: now }
    return coordinates
  }

  // Make the vessel's position the start of the current leg, as the Course
  // API's restart does. Servers that do not offer it to plugins get the same
  // change through their Course API object, using the server's current vessel
  // position (the check that got here awaited the course and the route);
  // failing both, the leg keeps starting at the reached waypoint.
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
        const current = typeof this.app.getSelfPath === 'function'
          ? this.app.getSelfPath('navigation.position')
          : null
        const vessel = current && isPosition(current.value) ? current.value : position
        api.courseInfo.previousPoint = {
          position: { latitude: vessel.latitude, longitude: vessel.longitude },
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
