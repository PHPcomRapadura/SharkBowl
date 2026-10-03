onRecordAuthWithOAuth2Request((e) => {
  const shark = require(`${__hooks}/shark-bowl.js`)
  if (e.providerName !== 'github') throw new ForbiddenError('Entre com sua conta do GitHub.')
  if (e.isNewRecord) {
    e.createData = { ...e.createData, name: shark.normalizedText(e.oAuth2User?.name || e.oAuth2User?.username || e.oAuth2User?.email, 40) || 'Participante' }
  }
  return e.next()
}, 'users')

routerAdd('GET', '/api/shark-bowl/lobby', (e) => {
  const shark = require(`${__hooks}/shark-bowl.js`)
  return e.json(200, shark.lobbyState(e.app))
}, $apis.requireAuth('users'))

routerAdd('POST', '/api/shark-bowl/rooms', (e) => {
  const shark = require(`${__hooks}/shark-bowl.js`)
  const title = shark.normalizedText(e.requestInfo().body.title, 80)
  if (title.length < 3) throw new BadRequestError('Dê um nome de pelo menos 3 caracteres para a sala.')
  let state = null
  e.app.runInTransaction((txApp) => {
    const room = shark.createRoom(txApp, e.auth.id, title)
    state = shark.roomState(txApp, room, e.auth.id)
  })
  return e.json(201, state)
}, $apis.requireAuth('users'))

routerAdd('GET', '/api/shark-bowl/rooms/{slug}/state', (e) => {
  const shark = require(`${__hooks}/shark-bowl.js`)
  const room = shark.getRoom(e.app, e.request.pathValue('slug'))
  return e.json(200, shark.roomState(e.app, room, e.auth.id))
}, $apis.requireAuth('users'))

routerAdd('POST', '/api/shark-bowl/rooms/{slug}/join', (e) => {
  const shark = require(`${__hooks}/shark-bowl.js`)
  let state = null
  e.app.runInTransaction((txApp) => {
    const room = shark.getRoom(txApp, e.request.pathValue('slug'))
    shark.joinRoom(txApp, room, e.auth.id)
    state = shark.roomState(txApp, room, e.auth.id)
  })
  return e.json(200, state)
}, $apis.requireAuth('users'))

routerAdd('POST', '/api/shark-bowl/rooms/{slug}/actions', (e) => {
  const shark = require(`${__hooks}/shark-bowl.js`)
  let state = null
  e.app.runInTransaction((txApp) => {
    const room = shark.getRoom(txApp, e.request.pathValue('slug'))
    shark.applyAction(txApp, room, e.auth.id, e.requestInfo().body)
    state = shark.roomState(txApp, room, e.auth.id)
  })
  return e.json(200, state)
}, $apis.requireAuth('users'))

routerAdd('GET', '/{path...}', $apis.static('/pb/pb_public', true))
