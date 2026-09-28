const { test } = require('node:test')
const assert = require('node:assert')
const EventEmitter = require('node:events')
const AutopilotProvider = require('../lib/AutopilotProvider')
const NavSourceAdvertiser = require('../lib/NavSourceAdvertiser')

function mockApp() {
  const app = new EventEmitter()
  app.sent = []
  app.on('nmea2000JsonOut', (pgn) => app.sent.push(pgn))
  app.debug = () => {}
  app.error = () => {}
  app.setPluginStatus = () => {}
  app.autopilotUpdate = () => {}
  app.handleMessage = () => {}
  app.registerAutopilotProvider = () => {}
  app.streambundle = { getSelfBus: () => ({ onValue: () => () => {} }) }
  return app
}

const pgnLists = (app) => app.sent.filter((p) => p.pgn === 126464)

test('advertises a transmit PGN list with the navigation PGNs on start', () => {
  const app = mockApp()
  const adv = new NavSourceAdvertiser(app)
  adv.start()
  adv.stop()

  const lists = pgnLists(app)
  assert.strictEqual(lists.length, 1)
  assert.strictEqual(lists[0].dst, 255)
  assert.strictEqual(lists[0].fields['Function Code'], 'Transmit PGN list')
  const pgns = lists[0].fields.list.map((e) => e.PGN)
  for (const nav of [129283, 129284, 129285]) {
    assert.ok(pgns.includes(nav), nav + ' advertised')
  }
})

test('re-advertises when the NMEA 2000 output becomes available', () => {
  const app = mockApp()
  const adv = new NavSourceAdvertiser(app)
  adv.start()
  app.emit('nmea2000OutAvailable')
  assert.strictEqual(pgnLists(app).length, 2)

  adv.stop()
  app.emit('nmea2000OutAvailable')
  assert.strictEqual(pgnLists(app).length, 2, 'no advertisement after stop')
})

test('re-advertises periodically', async () => {
  const app = mockApp()
  const adv = new NavSourceAdvertiser(app, { intervalMs: 10 })
  adv.start()
  await new Promise((resolve) => setTimeout(resolve, 35))
  adv.stop()
  assert.ok(pgnLists(app).length >= 3, 'initial + periodic advertisements')
})

test('provider advertises by default and stops with the plugin', () => {
  const app = mockApp()
  const p = new AutopilotProvider(app, { deviceId: '711c' })
  p.start()
  p.stop()
  assert.strictEqual(pgnLists(app).length, 1)
  app.emit('nmea2000OutAvailable')
  assert.strictEqual(pgnLists(app).length, 1)
})

test('provider does not advertise when advertiseNavSource is off', () => {
  const app = mockApp()
  const p = new AutopilotProvider(app, { deviceId: '711c', advertiseNavSource: false })
  p.start()
  p.stop()
  assert.strictEqual(pgnLists(app).length, 0)
})
