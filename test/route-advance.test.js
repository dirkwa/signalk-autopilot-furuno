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

test('starts the new leg at the vessel through the Course API', async () => {
  const app = mockApp(routeCourse())
  const emitted = []
  app.courseApi = {
    courseInfo: { nextPoint: { position: P1 }, previousPoint: { position: P0 } },
    emitCourseInfo: (noSave, ...paths) => emitted.push([noSave, ...paths])
  }
  const adv = new RouteAdvancer(app, { minIntervalMs: 0 })
  assert.strictEqual(await approach(adv), true)
  assert.deepStrictEqual(app.courseApi.courseInfo.previousPoint, {
    position: { latitude: INSIDE.latitude, longitude: INSIDE.longitude },
    type: 'VesselPosition'
  })
  assert.deepStrictEqual(emitted, [[false, 'previousPoint']])
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
  assert.strictEqual(await approach(adv), true)
  assert.deepStrictEqual(app.courseApi.courseInfo.previousPoint.position, moved)
})

test('prefers the server restartCourse for the new leg when it is offered', async () => {
  const app = mockApp(routeCourse())
  let restarts = 0
  app.restartCourse = async () => { restarts++ }
  app.courseApi = { courseInfo: { nextPoint: {} }, emitCourseInfo: () => { throw new Error('not used') } }
  const adv = new RouteAdvancer(app, { minIntervalMs: 0 })
  assert.strictEqual(await approach(adv), true)
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
