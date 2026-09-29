const { test } = require('node:test')
const assert = require('node:assert')
const EventEmitter = require('node:events')
const AutopilotProvider = require('../lib/AutopilotProvider')
const RouteAdvancer = require('../lib/RouteAdvancer')

// Route along the meridian: 0.001° of latitude is ~111 m.
const P0 = { latitude: 0, longitude: 0 }
const P1 = { latitude: 0.01, longitude: 0 }

function mockApp(course) {
  const app = new EventEmitter()
  app.course = course
  app.activations = []
  app.positionListeners = []
  app.debug = () => {}
  app.error = () => {}
  app.setPluginStatus = () => {}
  app.autopilotUpdate = () => {}
  app.handleMessage = () => {}
  app.registerAutopilotProvider = () => {}
  app.streambundle = {
    getSelfBus: (path) => ({
      onValue: (cb) => {
        if (path === 'navigation.position') app.positionListeners.push(cb)
        return () => {
          app.positionListeners = app.positionListeners.filter((l) => l !== cb)
        }
      }
    })
  }
  app.getCourse = async () => app.course
  app.activateRoute = async (dest) => {
    app.activations.push(dest)
  }
  return app
}

function routeCourse(overrides = {}) {
  return {
    arrivalCircle: 100,
    activeRoute: { href: '/resources/routes/r1', name: 'test', pointIndex: 1, pointTotal: 3, reverse: false },
    previousPoint: { position: P0 },
    nextPoint: { position: P1 },
    ...overrides
  }
}

const OUTSIDE = { latitude: 0.0085, longitude: 0 } // ~167 m before P1
const INSIDE = { latitude: 0.0095, longitude: 0 } // ~56 m before P1

// Arrival by circle needs the vessel seen outside it first.
async function approach(adv) {
  assert.strictEqual(await adv.check(OUTSIDE), false)
  return adv.check(INSIDE)
}

// Goes by P1 ~333 m to the east: outside the circle, then past the perpendicular.
const PASSING_WIDE = { latitude: 0.0101, longitude: 0.003 }
async function passWide(adv) {
  assert.strictEqual(await adv.check(OUTSIDE), false)
  return adv.check(PASSING_WIDE)
}

test('advances to the next point inside the arrival circle', async () => {
  const app = mockApp(routeCourse())
  const adv = new RouteAdvancer(app, { minIntervalMs: 0 })

  assert.strictEqual(await adv.check({ latitude: 0.0085, longitude: 0 }), false, '~167 m out')
  assert.strictEqual(await adv.check({ latitude: 0.0095, longitude: 0 }), true, '~56 m out')
  assert.deepStrictEqual(app.activations, [{ href: '/resources/routes/r1', pointIndex: 2, reverse: false }])
})

test('advances when the waypoint is passed outside the arrival circle', async () => {
  const app = mockApp(routeCourse())
  const adv = new RouteAdvancer(app, { minIntervalMs: 0 })

  // ~333 m east of the waypoint: outside the circle, before the perpendicular
  assert.strictEqual(await adv.check({ latitude: 0.0099, longitude: 0.003 }), false)
  // same offset, just past the perpendicular
  assert.strictEqual(await adv.check({ latitude: 0.0101, longitude: 0.003 }), true)
  assert.strictEqual(app.activations[0].pointIndex, 2)
})

test('uses only the perpendicular when there is no arrival circle', async () => {
  const app = mockApp(routeCourse({ arrivalCircle: 0 }))
  const adv = new RouteAdvancer(app, { minIntervalMs: 0 })

  assert.strictEqual(await adv.check({ latitude: 0.0099, longitude: 0 }), false)
  assert.strictEqual(await adv.check({ latitude: 0.01001, longitude: 0 }), true)
})

test('starts the new leg at the vessel when passing the waypoint off the track', async () => {
  const app = mockApp(routeCourse())
  const emitted = []
  app.courseApi = {
    courseInfo: { nextPoint: { position: P1 }, previousPoint: { position: P0 } },
    emitCourseInfo: (noSave, ...paths) => emitted.push([noSave, ...paths])
  }
  const adv = new RouteAdvancer(app, { minIntervalMs: 0 })
  assert.strictEqual(await passWide(adv), true)
  assert.deepStrictEqual(app.courseApi.courseInfo.previousPoint, {
    position: PASSING_WIDE,
    type: 'VesselPosition'
  })
  assert.deepStrictEqual(emitted, [[false, 'previousPoint']])
})

test('keeps the leg from the reached waypoint when switching in the zone', async () => {
  const app = mockApp(routeCourse())
  const emitted = []
  app.courseApi = {
    courseInfo: { nextPoint: { position: P1 }, previousPoint: { position: P0 } },
    emitCourseInfo: (noSave, ...paths) => emitted.push([noSave, ...paths])
  }
  // activateRoute() makes the reached waypoint the start of the next leg
  app.activateRoute = async (dest) => {
    app.activations.push(dest)
    app.courseApi.courseInfo.previousPoint = { position: P1 }
  }
  const adv = new RouteAdvancer(app, { minIntervalMs: 0 })
  assert.strictEqual(await approach(adv), true)
  assert.deepStrictEqual(app.courseApi.courseInfo.previousPoint, { position: P1 })
  assert.deepStrictEqual(emitted, [], 'no restart at the vessel')
})

test('starts the new leg at the server\'s current vessel position', async () => {
  const app = mockApp(routeCourse())
  const moved = { latitude: 0.0096, longitude: 0.0001 }
  app.getSelfPath = (path) => (path === 'navigation.position' ? { value: moved } : undefined)
  app.courseApi = {
    courseInfo: { nextPoint: { position: P1 }, previousPoint: { position: P0 } },
    emitCourseInfo: () => {}
  }
  const adv = new RouteAdvancer(app, { minIntervalMs: 0 })
  assert.strictEqual(await passWide(adv), true)
  assert.deepStrictEqual(app.courseApi.courseInfo.previousPoint.position, moved)
})

test('prefers the server restartCourse for the new leg when it is offered', async () => {
  const app = mockApp(routeCourse())
  let restarts = 0
  app.restartCourse = async () => { restarts++ }
  app.courseApi = { courseInfo: { nextPoint: {} }, emitCourseInfo: () => { throw new Error('not used') } }
  const adv = new RouteAdvancer(app, { minIntervalMs: 0 })
  assert.strictEqual(await passWide(adv), true)
  assert.strictEqual(restarts, 1)
})

test('still advances when the server offers no way to restart the leg', async () => {
  const app = mockApp(routeCourse())
  const adv = new RouteAdvancer(app, { minIntervalMs: 0 })
  assert.strictEqual(await approach(adv), true)
  assert.strictEqual(app.activations.length, 1)
})

test('does not advance from the last point or without a route', async () => {
  const last = mockApp(routeCourse({
    activeRoute: { href: '/resources/routes/r1', pointIndex: 2, pointTotal: 3 }
  }))
  assert.strictEqual(await new RouteAdvancer(last, { minIntervalMs: 0 }).check(P1), false)

  const goto = mockApp(routeCourse({ activeRoute: null }))
  assert.strictEqual(await new RouteAdvancer(goto, { minIntervalMs: 0 }).check(P1), false)

  assert.strictEqual(last.activations.length + goto.activations.length, 0)
})

test('advances once per point while the course update is pending', async () => {
  const app = mockApp(routeCourse())
  const adv = new RouteAdvancer(app, { minIntervalMs: 0 })
  await approach(adv)
  await adv.check({ latitude: 0.0096, longitude: 0 })
  assert.strictEqual(app.activations.length, 1)

  // Once the course has moved on, the next point is advanced from as usual.
  app.course = routeCourse({
    activeRoute: { href: '/resources/routes/r1', pointIndex: 2, pointTotal: 4 },
    previousPoint: { position: P1 },
    nextPoint: { position: { latitude: 0.02, longitude: 0 } }
  })
  await adv.check({ latitude: 0.0185, longitude: 0 })
  await adv.check({ latitude: 0.0195, longitude: 0 })
  assert.deepStrictEqual(app.activations.map((a) => a.pointIndex), [2, 3])
})

test('retries when activating the next point fails', async () => {
  const app = mockApp(routeCourse())
  let fail = true
  app.activateRoute = async (dest) => {
    if (fail) throw new Error('no route')
    app.activations.push(dest)
  }
  const adv = new RouteAdvancer(app, { minIntervalMs: 0 })
  await assert.rejects(() => approach(adv), /no route/)
  fail = false
  assert.strictEqual(await adv.check(INSIDE), true)
})

test('does not skip a close waypoint whose arrival circle it is already in', async () => {
  const app = mockApp(routeCourse({
    activeRoute: { href: '/resources/routes/r1', pointIndex: 1, pointTotal: 4 }
  }))
  const adv = new RouteAdvancer(app, { minIntervalMs: 0 })
  assert.strictEqual(await approach(adv), true)

  // Next waypoint only ~44 m beyond P1: the vessel is inside its circle at once.
  const P2 = { latitude: 0.0104, longitude: 0 }
  app.course = routeCourse({
    activeRoute: { href: '/resources/routes/r1', pointIndex: 2, pointTotal: 4 },
    previousPoint: { position: P1 },
    nextPoint: { position: P2 }
  })
  assert.strictEqual(await adv.check({ latitude: 0.0096, longitude: 0 }), false, 'P2 not skipped')
  assert.strictEqual(await adv.check({ latitude: 0.01035, longitude: 0 }), false)
  assert.strictEqual(await adv.check({ latitude: 0.01045, longitude: 0 }), true, 'advances on passing P2')
  assert.deepStrictEqual(app.activations.map((a) => a.pointIndex), [2, 3])
})

test('handles a leg across the antimeridian', async () => {
  const app = mockApp(routeCourse({
    previousPoint: { position: { latitude: 0, longitude: 179.99 } },
    nextPoint: { position: { latitude: 0, longitude: -179.9995 } }
  }))
  const adv = new RouteAdvancer(app, { minIntervalMs: 0 })
  assert.strictEqual(await adv.check({ latitude: 0, longitude: 179.995 }), false, '~612 m before it')
  assert.strictEqual(await adv.check({ latitude: 0, longitude: 179.9999 }), true, '~67 m before it, across 180°')
})

test('reverse routes step on in travel order, as the Course API counts them', async () => {
  const app = mockApp(routeCourse({
    activeRoute: { href: '/resources/routes/r1', pointIndex: 1, pointTotal: 3, reverse: true }
  }))
  const adv = new RouteAdvancer(app, { minIntervalMs: 0 })
  assert.strictEqual(await approach(adv), true)
  assert.deepStrictEqual(app.activations, [{ href: '/resources/routes/r1', pointIndex: 2, reverse: true }])

  const last = mockApp(routeCourse({
    activeRoute: { href: '/resources/routes/r1', pointIndex: 2, pointTotal: 3, reverse: true }
  }))
  assert.strictEqual(await new RouteAdvancer(last, { minIntervalMs: 0 }).check(P1), false)
})

test('advances again from the same point when the route is started anew', async () => {
  const app = mockApp(routeCourse({ startTime: '2026-09-29T01:00:00.000Z' }))
  const adv = new RouteAdvancer(app, { minIntervalMs: 0 })
  assert.strictEqual(await approach(adv), true)

  app.course = routeCourse({ startTime: '2026-09-29T02:00:00.000Z' })
  assert.strictEqual(await approach(adv), true)
  assert.strictEqual(app.activations.length, 2)
})

test('does not activate after stop or when the course changed meanwhile', async () => {
  const stopped = mockApp(routeCourse())
  const adv = new RouteAdvancer(stopped, { minIntervalMs: 0 })
  assert.strictEqual(await adv.check(OUTSIDE), false)
  let release
  const gate = new Promise((resolve) => { release = resolve })
  stopped.getCourse = async () => { await gate; return stopped.course }
  const pending = adv.check(INSIDE)
  adv.stop()
  release()
  assert.strictEqual(await pending, false)

  const cleared = mockApp(routeCourse())
  const adv2 = new RouteAdvancer(cleared, { minIntervalMs: 0 })
  assert.strictEqual(await adv2.check(OUTSIDE), false)
  let calls = 0
  cleared.getCourse = async () => (++calls === 1 ? cleared.course : routeCourse({ activeRoute: null }))
  assert.strictEqual(await adv2.check(INSIDE), false)
  assert.strictEqual(stopped.activations.length + cleared.activations.length, 0)
})

// Wheel-over: 2.8 m/s at 1.5 deg/s is a turn radius of ~107 m.
const SOG = 2.8
const M_PER_DEG = 111195.08

function withRoute(app, points, { reverse = false, sog = SOG } = {}) {
  const coordinates = points.map((p) => [p.longitude, p.latitude])
  if (reverse) coordinates.reverse()
  app.fetches = 0
  app.resourcesApi = {
    getResource: async (type, id) => {
      app.fetches++
      assert.strictEqual(type, 'routes')
      assert.strictEqual(id, 'r1')
      return { feature: { geometry: { coordinates } } }
    }
  }
  app.getSelfPath = (path) =>
    path === 'navigation.speedOverGround' && sog !== null ? { value: sog } : undefined
  return app
}

const before = (m) => ({ latitude: P1.latitude - m / M_PER_DEG, longitude: 0 })
const EAST_OF_P1 = { latitude: 0.01, longitude: 0.01 } // 90 deg turn, ~1.1 km leg

test('switches at the wheel-over point before a sharp turn', async () => {
  const app = withRoute(mockApp(routeCourse({ arrivalCircle: 20 })), [P0, P1, EAST_OF_P1])
  const adv = new RouteAdvancer(app, { minIntervalMs: 0, turnRate: 1.5 })
  assert.strictEqual(await adv.check(before(150)), false)
  assert.strictEqual(await adv.check(before(115)), false)
  assert.strictEqual(await adv.check(before(100)), true, 'd = R tan 45 = ~107 m')
  assert.strictEqual(app.activations[0].pointIndex, 2)
  assert.strictEqual(app.fetches, 1, 'route read once per leg')
})

test('picks up an edit to the route during a leg', async () => {
  const straightOn = { latitude: 0.02, longitude: 0 }
  const app = withRoute(mockApp(routeCourse({ arrivalCircle: 20 })), [P0, P1, straightOn])
  const adv = new RouteAdvancer(app, { minIntervalMs: 0, turnRate: 1.5, routeRefreshMs: 0 })
  assert.strictEqual(await adv.check(before(150)), false)
  assert.strictEqual(await adv.check(before(100)), false, 'no turn ahead: circle only')

  // The next leg is redrawn as a 90 degree turn while the boat is still on this one.
  withRoute(app, [P0, P1, EAST_OF_P1])
  assert.strictEqual(await adv.check(before(95)), true, 'wheel-over for the new geometry')
})

test('switches at the arrival circle before a gentle turn', async () => {
  const twentyDegrees = {
    latitude: P1.latitude + 939.7 / M_PER_DEG,
    longitude: 342.0 / M_PER_DEG
  }
  const app = withRoute(mockApp(routeCourse({ arrivalCircle: 50 })), [P0, P1, twentyDegrees])
  const adv = new RouteAdvancer(app, { minIntervalMs: 0, turnRate: 1.5 })
  assert.strictEqual(await adv.check(before(150)), false)
  assert.strictEqual(await adv.check(before(60)), false, 'd = R tan 10 = ~19 m, inside the circle')
  assert.strictEqual(await adv.check(before(45)), true)
})

test('caps the wheel-over distance at half of a short leg', async () => {
  const shortLegEast = { latitude: 0.01, longitude: 100 / M_PER_DEG }
  const app = withRoute(mockApp(routeCourse({ arrivalCircle: 0 })), [P0, P1, shortLegEast])
  const adv = new RouteAdvancer(app, { minIntervalMs: 0, turnRate: 1.5 })
  assert.strictEqual(await adv.check(before(150)), false)
  assert.strictEqual(await adv.check(before(70)), false)
  assert.strictEqual(await adv.check(before(45)), true, 'capped at 50 m')
})

test('switches at the arrival circle without speed over ground', async () => {
  const app = withRoute(mockApp(routeCourse({ arrivalCircle: 20 })), [P0, P1, EAST_OF_P1], { sog: null })
  const adv = new RouteAdvancer(app, { minIntervalMs: 0, turnRate: 1.5 })
  assert.strictEqual(await adv.check(before(150)), false)
  assert.strictEqual(await adv.check(before(100)), false)
  assert.strictEqual(await adv.check(before(15)), true)
})

test('treats a waypoint passed between two position samples as passed, not turned', async () => {
  const app = withRoute(mockApp(routeCourse({ arrivalCircle: 20 })), [P0, P1, EAST_OF_P1])
  const emitted = []
  app.courseApi = {
    courseInfo: { nextPoint: { position: P1 }, previousPoint: { position: P0 } },
    emitCourseInfo: (noSave, ...paths) => emitted.push([noSave, ...paths])
  }
  const adv = new RouteAdvancer(app, { minIntervalMs: 0, turnRate: 1.5 })
  const offset = 50 / M_PER_DEG
  assert.strictEqual(await adv.check({ latitude: P1.latitude - 150 / M_PER_DEG, longitude: offset }), false)
  // The next sample, after a gap, is already 50 m past the waypoint and 50 m off the track.
  const past = { latitude: P1.latitude + 50 / M_PER_DEG, longitude: offset }
  assert.strictEqual(await adv.check(past), true)
  assert.deepStrictEqual(emitted, [[false, 'previousPoint']], 'new leg starts at the boat')
  assert.deepStrictEqual(app.courseApi.courseInfo.previousPoint.position, past)
})

test('does not anticipate a turn when well off the track', async () => {
  const app = withRoute(mockApp(routeCourse({ arrivalCircle: 20 })), [P0, P1, EAST_OF_P1])
  const adv = new RouteAdvancer(app, { minIntervalMs: 0, turnRate: 1.5 })
  const west = (m) => ({ latitude: P1.latitude - m / M_PER_DEG, longitude: -150 / M_PER_DEG })
  assert.strictEqual(await adv.check(west(150)), false)
  assert.strictEqual(await adv.check(west(100)), false, '150 m off the track')
  assert.strictEqual(await adv.check(west(-5)), true, 'past the perpendicular')
})

test('finds the next leg of a reversed route in travel order', async () => {
  const app = withRoute(
    mockApp(routeCourse({
      arrivalCircle: 20,
      activeRoute: { href: '/resources/routes/r1', pointIndex: 1, pointTotal: 3, reverse: true }
    })),
    [P0, P1, EAST_OF_P1],
    { reverse: true }
  )
  const adv = new RouteAdvancer(app, { minIntervalMs: 0, turnRate: 1.5 })
  assert.strictEqual(await adv.check(before(150)), false)
  assert.strictEqual(await adv.check(before(100)), true)
})

test('turn rate 0 switches at the arrival circle only', async () => {
  const app = withRoute(mockApp(routeCourse({ arrivalCircle: 20 })), [P0, P1, EAST_OF_P1])
  const adv = new RouteAdvancer(app, { minIntervalMs: 0, turnRate: 0 })
  assert.strictEqual(await adv.check(before(150)), false)
  assert.strictEqual(await adv.check(before(100)), false)
  assert.strictEqual(await adv.check(before(15)), true)
})

test('defaults to the measured NavPilot turn rate of 2.2 deg/s', async () => {
  const app = withRoute(mockApp(routeCourse({ arrivalCircle: 20 })), [P0, P1, EAST_OF_P1])
  const adv = new RouteAdvancer(app, { minIntervalMs: 0 })
  assert.strictEqual(await adv.check(before(150)), false)
  assert.strictEqual(await adv.check(before(80)), false)
  assert.strictEqual(await adv.check(before(70)), true, 'd = 2.8 / 2.2 deg/s * tan 45 = ~73 m')
})

test('provider advances on position updates in any pilot mode and stops with the plugin', async () => {
  const app = mockApp(routeCourse())
  const p = new AutopilotProvider(app, { deviceId: '711c', advertiseNavSource: false })
  p.start()
  p.handlePGN127237({ 'Steering Mode': 'Main Steering' })
  assert.strictEqual(app.positionListeners.length, 1)
  p.routeAdvancer.minIntervalMs = 0

  for (const value of [OUTSIDE, INSIDE]) {
    app.positionListeners[0]({ path: 'navigation.position', value })
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.strictEqual(app.activations.length, 1)

  p.stop()
  assert.strictEqual(app.positionListeners.length, 0)
})

test('provider does not auto-advance when autoAdvanceRoute is off', () => {
  const app = mockApp(routeCourse())
  const p = new AutopilotProvider(app, { deviceId: '711c', advertiseNavSource: false, autoAdvanceRoute: false })
  p.start()
  p.stop()
  assert.strictEqual(app.positionListeners.length, 0)
})
