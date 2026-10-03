function normalizedText(value, maxLength) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLength)
}

function timestamp(value) {
  const parsed = Date.parse(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : Date.now()
}

function userIdentity(user) {
  const name = normalizedText(user.getString('name'), 40)
  return { id: user.id, name: name || 'Participante' }
}

function getRoom(app, slug) {
  try {
    return app.findFirstRecordByFilter('rooms', 'slug = {:slug}', { slug })
  } catch {
    throw new NotFoundError('Sala não encontrada.')
  }
}

function getMembership(app, roomId, userId) {
  try {
    return app.findFirstRecordByFilter('memberships', 'room = {:room} && user = {:user}', { room: roomId, user: userId })
  } catch {
    return null
  }
}

function requireParticipant(app, room, userId) {
  const membership = getMembership(app, room.id, userId)
  if (!membership) throw new ForbiddenError('Entre na sala antes de continuar.')
  return membership
}

function requireOwner(room, userId) {
  if (room.getString('owner') !== userId) throw new ForbiddenError('Apenas o dono da sala pode controlar esta sala.')
}

function roomQuestions(app, roomId) {
  return app.findRecordsByFilter('questions', 'room = {:room}', '', 0, 0, { room: roomId }).sort((left, right) => timestamp(left.getString('created')) - timestamp(right.getString('created')))
}

function roomQueue(app, roomId) {
  return app.findRecordsByFilter('queue_entries', 'room = {:room}', '', 0, 0, { room: roomId }).sort((left, right) => timestamp(left.getString('created')) - timestamp(right.getString('created')))
}

function roomMemberships(app, roomId) {
  return app.findRecordsByFilter('memberships', 'room = {:room}', '', 0, 0, { room: roomId }).sort((left, right) => timestamp(left.getString('created')) - timestamp(right.getString('created')))
}

function findQuestion(app, roomId, questionId) {
  try {
    return app.findFirstRecordByFilter('questions', 'id = {:id} && room = {:room}', { id: questionId, room: roomId })
  } catch {
    throw new BadRequestError('Pergunta não encontrada.')
  }
}

function findQueueEntry(app, roomId, entryId) {
  try {
    return app.findFirstRecordByFilter('queue_entries', 'id = {:id} && room = {:room}', { id: entryId, room: roomId })
  } catch {
    return null
  }
}

function createSlug(app, title) {
  const base = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 38) || 'sala'
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const suffix = `${Date.now().toString(36).slice(-4)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`
    const slug = `${base.slice(0, 41 - suffix.length)}-${suffix}`
    try {
      app.findFirstRecordByFilter('rooms', 'slug = {:slug}', { slug })
    } catch {
      return slug
    }
  }
  throw new InternalServerError('Não foi possível criar um link único para a sala.')
}

function createRecord(app, collectionName, values) {
  const record = new Record(app.findCollectionByNameOrId(collectionName))
  record.load(values)
  app.save(record)
  return record
}

function touchRoom(app, room, values = {}) {
  room.load({ ...values, activity_at: Date.now() })
  app.save(room)
  return room
}

function userById(app, userId, cache) {
  if (cache[userId]) return cache[userId]
  try {
    const identity = userIdentity(app.findRecordById('users', userId))
    cache[userId] = identity
    return identity
  } catch {
    const identity = { id: userId, name: 'Participante' }
    cache[userId] = identity
    return identity
  }
}

function roomState(app, room, currentUserId) {
  const userCache = {}
  const questions = roomQuestions(app, room.id)
  const queue = roomQueue(app, room.id)
  const memberships = roomMemberships(app, room.id)
  const activeQuestionId = room.getString('active_question_id') || null
  const activeEntryId = room.getString('active_entry_id') || null
  const ownerId = room.getString('owner')
  const participants = memberships.map((entry) => {
    const identity = userById(app, entry.getString('user'), userCache)
    return { ...identity, lastSeenAt: timestamp(entry.getString('updated')) }
  })
  return {
    room: {
      id: room.id,
      slug: room.getString('slug'),
      title: room.getString('title'),
      access: 'public',
      ownerId,
      createdAt: timestamp(room.getString('created')),
      updatedAt: room.getInt('activity_at') || timestamp(room.getString('updated')),
    },
    session: {
      id: room.id,
      phase: room.getString('phase'),
      activeQuestionId,
      activeEntryId,
      speechStartedAt: room.getInt('speech_started_at') || null,
      durationSeconds: room.getInt('duration_seconds'),
      updatedAt: room.getInt('activity_at') || timestamp(room.getString('updated')),
    },
    questions: questions.map((question) => {
      const anonymous = question.getBool('anonymous')
      const author = userById(app, question.getString('author'), userCache)
      return {
        id: question.id,
        text: question.getString('text'),
        authorName: anonymous ? 'Anônimo' : author.name,
        anonymous,
        createdAt: timestamp(question.getString('created')),
        status: question.getString('status'),
      }
    }),
    queue: queue.map((entry) => {
      const participant = userById(app, entry.getString('participant'), userCache)
      const replyToId = entry.getString('reply_to_entry_id') || null
      const replyTo = replyToId ? findQueueEntry(app, room.id, replyToId) : null
      const replyToParticipant = replyTo ? userById(app, replyTo.getString('participant'), userCache) : null
      return {
        id: entry.id,
        questionId: entry.getString('question'),
        participantId: participant.id,
        participantName: participant.name,
        createdAt: timestamp(entry.getString('created')),
        status: entry.getString('status'),
        replyToEntryId: replyToId,
        replyToName: replyToParticipant?.name ?? null,
      }
    }),
    participants,
    permissions: {
      canFacilitate: ownerId === currentUserId,
    },
  }
}

function lobbyState(app) {
  const rooms = app.findRecordsByFilter('rooms', '', '', 0, 0).sort((left, right) => (right.getInt('activity_at') || timestamp(right.getString('updated'))) - (left.getInt('activity_at') || timestamp(left.getString('updated'))))
  return {
    rooms: rooms.map((room) => {
      const questions = roomQuestions(app, room.id)
      return {
        id: room.id,
        slug: room.getString('slug'),
        title: room.getString('title'),
        access: 'public',
        ownerId: room.getString('owner'),
        createdAt: timestamp(room.getString('created')),
        updatedAt: room.getInt('activity_at') || timestamp(room.getString('updated')),
        participantCount: roomMemberships(app, room.id).length,
        questionCount: questions.filter((question) => question.getString('status') !== 'closed').length,
        phase: room.getString('phase'),
      }
    }),
  }
}

function joinRoom(app, room, userId) {
  const membership = getMembership(app, room.id, userId)
  if (membership) {
    app.save(membership)
  } else {
    createRecord(app, 'memberships', { room: room.id, user: userId, role: 'participant' })
  }
  touchRoom(app, room)
}

function createRoom(app, userId, title) {
  const room = createRecord(app, 'rooms', {
    title,
    slug: createSlug(app, title),
    owner: userId,
    phase: 'lobby',
    active_question_id: '',
    active_entry_id: '',
    speech_started_at: 0,
    duration_seconds: 180,
    activity_at: Date.now(),
  })
  joinRoom(app, room, userId)
  return room
}

function applyAction(app, room, userId, body) {
  const type = String(body.type ?? '')
  const activeQuestionId = room.getString('active_question_id')
  const activeEntryId = room.getString('active_entry_id')
  if (type === 'submit-question') {
    requireParticipant(app, room, userId)
    const text = normalizedText(body.text, 280)
    if (!text) throw new BadRequestError('Escreva uma pergunta antes de enviar.')
    createRecord(app, 'questions', { room: room.id, author: userId, text, anonymous: Boolean(body.anonymous), status: 'waiting' })
    touchRoom(app, room)
    return
  }
  if (type === 'join-queue') {
    requireParticipant(app, room, userId)
    if (!activeQuestionId) throw new BadRequestError('O facilitador ainda não abriu uma pergunta.')
    const activeQuestion = findQuestion(app, room.id, activeQuestionId)
    if (activeQuestion.getString('status') !== 'active') throw new BadRequestError('O facilitador ainda não abriu uma pergunta.')
    const entries = roomQueue(app, room.id)
    if (entries.some((entry) => entry.getString('question') === activeQuestionId && entry.getString('participant') === userId && ['waiting', 'speaking'].includes(entry.getString('status')))) {
      throw new BadRequestError('Você já está na fila desta pergunta.')
    }
    const replyToEntryId = normalizedText(body.replyToEntryId, 15)
    if (replyToEntryId) {
      const replyTo = findQueueEntry(app, room.id, replyToEntryId)
      if (!replyTo || replyTo.getString('question') !== activeQuestionId || !['finished', 'speaking'].includes(replyTo.getString('status'))) {
        throw new BadRequestError('Essa réplica não está disponível nesta pergunta.')
      }
    }
    createRecord(app, 'queue_entries', { room: room.id, question: activeQuestionId, participant: userId, reply_to_entry_id: replyToEntryId, status: 'waiting' })
    touchRoom(app, room)
    return
  }
  requireOwner(room, userId)
  if (type === 'select-question') {
    if (activeEntryId) throw new BadRequestError('Finalize a fala atual antes de trocar de pergunta.')
    const question = findQuestion(app, room.id, normalizedText(body.questionId, 15))
    roomQuestions(app, room.id).forEach((item) => {
      if (item.getString('status') === 'active') {
        item.set('status', 'waiting')
        app.save(item)
      }
    })
    question.set('status', 'active')
    app.save(question)
    touchRoom(app, room, { phase: 'running', active_question_id: question.id, active_entry_id: '', speech_started_at: 0 })
    return
  }
  if (type === 'start-next') {
    if (!activeQuestionId) throw new BadRequestError('Selecione uma pergunta primeiro.')
    if (activeEntryId) throw new BadRequestError('Já existe uma fala em andamento.')
    const next = roomQueue(app, room.id).find((entry) => entry.getString('question') === activeQuestionId && entry.getString('status') === 'waiting')
    if (!next) throw new BadRequestError('A fila está vazia. Ela continua aberta para novas inscrições.')
    next.set('status', 'speaking')
    app.save(next)
    touchRoom(app, room, { active_entry_id: next.id, speech_started_at: Date.now() })
    return
  }
  if (type === 'finish-current') {
    if (!activeEntryId) throw new BadRequestError('Não há uma fala em andamento.')
    const current = findQueueEntry(app, room.id, activeEntryId)
    if (!current || current.getString('status') !== 'speaking') throw new BadRequestError('Estado da fala atual inválido.')
    current.set('status', 'finished')
    app.save(current)
    const next = roomQueue(app, room.id).find((entry) => entry.getString('question') === activeQuestionId && entry.getString('status') === 'waiting')
    if (next) {
      next.set('status', 'speaking')
      app.save(next)
      touchRoom(app, room, { active_entry_id: next.id, speech_started_at: Date.now() })
    } else {
      touchRoom(app, room, { active_entry_id: '', speech_started_at: 0 })
    }
    return
  }
  if (type === 'set-duration') {
    const durationSeconds = Number(body.durationSeconds)
    if (durationSeconds !== 120 && durationSeconds !== 180) throw new BadRequestError('O tempo deve ser de 2 ou 3 minutos.')
    touchRoom(app, room, { duration_seconds: durationSeconds })
    return
  }
  if (type === 'close-question') {
    if (!activeQuestionId) throw new BadRequestError('Não há pergunta ativa.')
    if (activeEntryId) throw new BadRequestError('Finalize a fala atual antes de encerrar a pergunta.')
    const activeQuestion = findQuestion(app, room.id, activeQuestionId)
    activeQuestion.set('status', 'closed')
    app.save(activeQuestion)
    roomQueue(app, room.id).forEach((entry) => {
      if (entry.getString('question') === activeQuestionId && entry.getString('status') === 'waiting') {
        entry.set('status', 'finished')
        app.save(entry)
      }
    })
    touchRoom(app, room, { phase: 'lobby', active_question_id: '', active_entry_id: '', speech_started_at: 0 })
    return
  }
  if (type === 'reset-session') {
    requireOwner(room, userId)
    roomQueue(app, room.id).forEach((entry) => app.delete(entry))
    roomQuestions(app, room.id).forEach((question) => app.delete(question))
    touchRoom(app, room, { phase: 'lobby', active_question_id: '', active_entry_id: '', speech_started_at: 0, duration_seconds: 180 })
    return
  }
  throw new BadRequestError('Ação desconhecida.')
}

module.exports = { applyAction, createRoom, getRoom, joinRoom, lobbyState, normalizedText, roomState }
