const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

class ForbiddenError extends Error {}
class BadRequestError extends Error {}
class ApiError extends Error {}
const context = { module: { exports: {} }, ForbiddenError, BadRequestError, ApiError }
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pocketbase/hooks/shark-bowl.js'), 'utf8'), context)
const { applyAction, roomState } = context.module.exports

const record = (id, values) => ({ id, getString: (key) => String(values[key] || ''), getInt: (key) => Number(values[key] || 0), getBool: (key) => Boolean(values[key]), set: (key, value) => { values[key] = value }, load: (next) => Object.assign(values, next) })
const fixture = () => {
  const values = { owner: 'owner', duration_seconds: 180 }
  const room = record('room', values)
  const invited = record('membership', { room: 'room', user: 'guest', role: 'facilitator' })
  let saves = 0
  const app = {
    findFirstRecordByFilter: () => invited,
    findRecordsByFilter: (collection) => collection === 'memberships' ? [invited] : [],
    findRecordById: (_, id) => record(id, { name: id }),
    save: () => { saves += 1 },
  }
  return { app, room, values, saves: () => saves }
}

test('legacy facilitator membership grants no control permissions', () => {
  const { app, room } = fixture()
  assert.equal(roomState(app, room, 'guest').permissions.canFacilitate, false)
  assert.equal(roomState(app, room, 'owner').permissions.canFacilitate, true)
})

test('non-owner cannot perform control actions even with legacy facilitator role', () => {
  for (const type of ['select-question', 'start-next', 'finish-current', 'set-duration', 'close-question', 'reset-session', 'set-facilitator']) {
    const { app, room, saves } = fixture()
    assert.throws(() => applyAction(app, room, 'guest', { type, durationSeconds: 120 }), ForbiddenError)
    assert.equal(saves(), 0)
  }
})

test('owner keeps controls but cannot grant facilitator access', () => {
  const { app, room, values } = fixture()
  applyAction(app, room, 'owner', { type: 'set-duration', durationSeconds: 120, expectedControlVersion: 0 })
  assert.equal(values.duration_seconds, 120)
  assert.throws(() => applyAction(app, room, 'owner', { type: 'set-facilitator', userId: 'guest', enabled: true, expectedControlVersion: 1 }), BadRequestError)
})


test('duration accepts presets and custom values, rejecting invalid seconds', () => {
  for (const durationSeconds of [1, 30, 120, 180, 300, 450, 3600, 86400]) {
    const { app, room, values } = fixture()
    applyAction(app, room, 'owner', { type: 'set-duration', durationSeconds, expectedControlVersion: 0 })
    assert.equal(values.duration_seconds, durationSeconds)
  }
  for (const durationSeconds of [0, -1, 86401, 1.5, NaN, Infinity, '120', true, null]) {
    const { app, room, saves } = fixture()
    assert.throws(() => applyAction(app, room, 'owner', { type: 'set-duration', durationSeconds, expectedControlVersion: 0 }), BadRequestError)
    assert.equal(saves(), 0)
  }
})

test('stale control commands are rejected', () => {
  const { app, room, values } = fixture()
  applyAction(app, room, 'owner', { type: 'set-duration', durationSeconds: 300, expectedControlVersion: 0 })
  assert.throws(() => applyAction(app, room, 'owner', { type: 'set-duration', durationSeconds: 120, expectedControlVersion: 0 }), ApiError)
  assert.equal(values.duration_seconds, 300)
})

test('transfer grants exclusive control to recipient and revokes previous owner', () => {
  const { app, room, values } = fixture()
  applyAction(app, room, 'owner', { type: 'transfer-ownership', userId: 'guest', expectedControlVersion: 0 })
  assert.equal(values.owner, 'guest')
  assert.equal(roomState(app, room, 'owner').permissions.canFacilitate, false)
  assert.equal(roomState(app, room, 'guest').permissions.canFacilitate, true)
  assert.throws(() => applyAction(app, room, 'owner', { type: 'set-duration', durationSeconds: 120, expectedControlVersion: 1 }), ForbiddenError)
})
