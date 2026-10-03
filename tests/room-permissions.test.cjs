const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

class ForbiddenError extends Error {}
class BadRequestError extends Error {}
const context = { module: { exports: {} }, ForbiddenError, BadRequestError }
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pocketbase/hooks/shark-bowl.js'), 'utf8'), context)
const { applyAction, roomState } = context.module.exports

const record = (id, values) => ({ id, getString: (key) => String(values[key] || ''), getInt: (key) => Number(values[key] || 0), load: (next) => Object.assign(values, next) })
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
  applyAction(app, room, 'owner', { type: 'set-duration', durationSeconds: 120 })
  assert.equal(values.duration_seconds, 120)
  assert.throws(() => applyAction(app, room, 'owner', { type: 'set-facilitator', userId: 'guest', enabled: true }), BadRequestError)
})
