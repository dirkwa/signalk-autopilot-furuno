const { test } = require('node:test')
const assert = require('node:assert')
const EventEmitter = require('node:events')
const AutopilotProvider = require('../lib/AutopilotProvider')

function mockApp() {
  const app = new EventEmitter()
  app.apUpdates = []
  app.notifications = []
  app.debug = () => {}
  app.error = () => {}
  app.setPluginStatus = () => {}
  app.autopilotUpdate = (id, u) => app.apUpdates.push(u)
  app.handleMessage = (pid, delta) => app.notifications.push(delta.updates[0].values[0])
  return app
}

test('maps PGN 127237 Steering Mode to autopilot mode/engaged/state', () => {
  const app = mockApp()
  const p = new AutopilotProvider(app, { deviceId: '711c' })

  p.handlePGN127237({ 'Steering Mode': 'Heading Control Standalone' })
  assert.strictEqual(p.state.mode, 'auto')
  assert.strictEqual(p.state.engaged, true)

  p.handlePGN127237({ 'Steering Mode': 'Main Steering' })
  assert.strictEqual(p.state.mode, 'standby')
  assert.strictEqual(p.state.engaged, false)

  p.handlePGN127237({ 'Steering Mode': 'Track Control' })
  assert.strictEqual(p.state.mode, 'nav')
})

test('publishes commanded course (Heading-To-Steer) as target', () => {
  const app = mockApp()
  const p = new AutopilotProvider(app, { deviceId: '711c' })
  p.handlePGN127237({ 'Steering Mode': 'Heading Control Standalone', 'Heading-To-Steer (Course)': 1.5708 })
  const withTarget = app.apUpdates.find((u) => u.target === 1.5708)
  assert.ok(withTarget, 'target update emitted')
})

test('emits and clears standard alarms edge-triggered', () => {
  const app = mockApp()
  const p = new AutopilotProvider(app, { deviceId: '711c' })

  p.handlePGN127237({ 'Steering Mode': 'Track Control', 'Off-Heading Limit Exceeded': 'Yes' })
  const raised = app.apUpdates.filter((u) => u.alarm && u.alarm.path === 'heading')
  assert.strictEqual(raised.length, 1)
  assert.strictEqual(raised[0].alarm.value.state, 'alarm')

  // Same flag again -> no duplicate emit
  p.handlePGN127237({ 'Steering Mode': 'Track Control', 'Off-Heading Limit Exceeded': 'Yes' })
  assert.strictEqual(app.apUpdates.filter((u) => u.alarm && u.alarm.path === 'heading').length, 1)

  // Flag gone -> cleared
  p.handlePGN127237({ 'Steering Mode': 'Track Control', 'Off-Heading Limit Exceeded': 'No' })
  const cleared = app.apUpdates.filter((u) => u.alarm && u.alarm.path === 'heading').pop()
  assert.strictEqual(cleared.alarm.value.state, 'normal')
})

test('connection watchdog raises and restores connectionLost', () => {
  const app = mockApp()
  const p = new AutopilotProvider(app, { deviceId: '711c', connectionTimeout: 0.01 })
  p.markConnectionAlive()
  p.lastN2K = Date.now() - 1000 // force stale
  p.checkConnection()
  assert.strictEqual(p.connectionLost, true)
  p.handlePGN127237({ 'Steering Mode': 'Track Control' })
  assert.strictEqual(p.connectionLost, false)
})

test('commands are refused unless experimentalCommands is enabled', async () => {
  const app = mockApp()
  const p = new AutopilotProvider(app, { deviceId: '711c' })
  const prov = p.getProvider()
  await assert.rejects(() => prov.setMode('auto', '711c'), /not available/)
  await assert.rejects(() => prov.engage('711c'), /not available/)
})

test('experimental commands emit Furuno command PGNs', async () => {
  const app = mockApp()
  const sent = []
  app.on('nmea2000JsonOut', (pgn) => sent.push(pgn.pgn))
  const p = new AutopilotProvider(app, { deviceId: '711c', experimentalCommands: true, deviceAddress: 11 })
  const prov = p.getProvider()
  p.state.mode = 'auto'
  await prov.setTarget(1.5708, '711c')
  await prov.setMode('nav', '711c')
  assert.ok(sent.includes(130827), 'course command PGN 130827 emitted')
  assert.ok(sent.includes(126720), 'mode command PGN 126720 emitted')
})
