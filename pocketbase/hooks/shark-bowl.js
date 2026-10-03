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

function checkControlVersion(room, body) {
  if (!Number.isSafeInteger(body.expectedControlVersion) || body.expectedControlVersion !== room.getInt('control_version')) {
    throw new ApiError(409, 'A sala mudou em outra tela. Confira o estado atualizado e tente novamente.')
  }
  room.set('control_version', room.getInt('control_version') + 1)
}

function requireOwner(room, userId) {
  if (room.getString('owner') !== userId) throw new ForbiddenError('Apenas o dono da sala pode controlar esta sala.')
}

function roomQuestions(app, roomId) {
  return app.findRecordsByFilter('questions', 'room = {:room}', '', 0, 0, { room: roomId }).sort((left, right) => timestamp(left.getString('created')) - timestamp(right.getString('created')))
}

function roomQueue(app, roomId) {
  return app.findRecordsByFilter('queue_entries', 'room = {:room}', '', 0, 0, { room: roomId }).sort((left, right) => left.getInt('order_index') - right.getInt('order_index') || left.id.localeCompare(right.id))
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
  room.load({ ...values, activity_at: Date.now(), revision: room.getInt('revision') + 1 })
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
  const votes = app.findRecordsByFilter('question_votes', 'room = {:room}', '', 0, 0, { room: room.id })
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
      revision: room.getInt('revision'),
      controlVersion: room.getInt('control_version'),
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
        voteCount: votes.filter((vote) => vote.getString('question') === question.id).length,
        votedByMe: votes.some((vote) => vote.getString('question') === question.id && vote.getString('user') === currentUserId),
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
        replyToSpeechNumber: replyTo?.getInt('speech_number') || null,
        speechNumber: entry.getInt('speech_number') || null,
        orderIndex: entry.getInt('order_index'),
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

function validateDuration(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 86400) {
    throw new BadRequestError('Informe um tempo entre 1 segundo e 1440 minutos, em segundos inteiros.')
  }
  return value
}

function applyAction(app, room, userId, body) {
  const type = String(body.type ?? '')
  const activeQuestionId = room.getString('active_question_id')
  const activeEntryId = room.getString('active_entry_id')
  if (type === 'set-vote') {
    requireParticipant(app, room, userId)
    if (typeof body.enabled !== 'boolean') throw new BadRequestError('Informe se deseja votar ou desfazer o voto.')
    const question = findQuestion(app, room.id, normalizedText(body.questionId, 15))
    if (question.getString('status') !== 'waiting') throw new BadRequestError('Vote apenas nas perguntas aguardando abertura.')
    const existing = app.findRecordsByFilter('question_votes', 'question = {:question} && user = {:user}', '', 1, 0, { question: question.id, user: userId })[0]
    if (body.enabled && !existing) createRecord(app, 'question_votes', { room: room.id, question: question.id, user: userId })
    if (!body.enabled && existing) app.delete(existing)
    touchRoom(app, room)
    return
  }
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
    if (body.isReply === true && !replyToEntryId) throw new BadRequestError('Escolha a fala à qual deseja responder.')
    if (replyToEntryId) {
      const replyTo = findQueueEntry(app, room.id, replyToEntryId)
      if (!replyTo || replyTo.getString('question') !== activeQuestionId || !['finished', 'speaking'].includes(replyTo.getString('status')) || replyTo.getInt('speech_number') < 1) {
        throw new BadRequestError('Essa réplica não está disponível nesta pergunta.')
      }
    }
    createRecord(app, 'queue_entries', { room: room.id, question: activeQuestionId, participant: userId, reply_to_entry_id: replyToEntryId, status: 'waiting', order_index: Math.max(0, ...entries.filter((entry) => entry.getString('question') === activeQuestionId).map((entry) => entry.getInt('order_index'))) + 1 })
    touchRoom(app, room)
    return
  }
  requireOwner(room, userId)
  checkControlVersion(room, body)
  if (type === 'prioritize-reply') {
    if (!activeQuestionId) throw new BadRequestError('Não há pergunta ativa.')
    const entry = findQueueEntry(app, room.id, normalizedText(body.entryId, 15))
    if (!entry || entry.getString('question') !== activeQuestionId || entry.getString('status') !== 'waiting') throw new BadRequestError('A réplica precisa estar aguardando nesta pergunta.')
    const target = findQueueEntry(app, room.id, entry.getString('reply_to_entry_id'))
    if (!target || target.getString('question') !== activeQuestionId || target.getInt('speech_number') < 1 || !['speaking', 'finished'].includes(target.getString('status'))) throw new BadRequestError('Este pedido não é uma réplica válida.')
    const waiting = roomQueue(app, room.id).filter((item) => item.getString('question') === activeQuestionId && item.getString('status') === 'waiting' && item.id !== entry.id)
    const reordered = [entry, ...waiting]
    reordered.forEach((item, index) => {
      item.set('order_index', index + 1)
      app.save(item)
    })
    touchRoom(app, room)
    return
  }
  if (type === 'transfer-ownership') {
    const targetId = normalizedText(body.userId, 15)
    if (!targetId || targetId === userId) throw new BadRequestError('Escolha outro participante para receber a sala.')
    if (!getMembership(app, room.id, targetId)) throw new BadRequestError('A pessoa precisa entrar nesta sala antes de recebê-la.')
    touchRoom(app, room, { owner: targetId })
    return
  }
  if (type === 'select-question') {
    if (activeEntryId) throw new BadRequestError('Finalize a fala atual antes de trocar de pergunta.')
    const durationSeconds = validateDuration(body.durationSeconds ?? room.getInt('duration_seconds'))
    const question = findQuestion(app, room.id, normalizedText(body.questionId, 15))
    roomQuestions(app, room.id).forEach((item) => {
      if (item.getString('status') === 'active') {
        item.set('status', 'waiting')
        app.save(item)
      }
    })
    question.set('status', 'active')
    app.save(question)
    touchRoom(app, room, { phase: 'running', active_question_id: question.id, active_entry_id: '', speech_started_at: 0, duration_seconds: durationSeconds })
    return
  }
  if (type === 'start-next') {
    if (!activeQuestionId) throw new BadRequestError('Selecione uma pergunta primeiro.')
    if (activeEntryId) throw new BadRequestError('Já existe uma fala em andamento.')
    const next = roomQueue(app, room.id).find((entry) => entry.getString('question') === activeQuestionId && entry.getString('status') === 'waiting')
    if (!next) throw new BadRequestError('A fila está vazia. Ela continua aberta para novas inscrições.')
    next.set('speech_number', Math.max(0, ...roomQueue(app, room.id).filter((entry) => entry.getString('question') === activeQuestionId).map((entry) => entry.getInt('speech_number'))) + 1)
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
      next.set('speech_number', Math.max(0, ...roomQueue(app, room.id).filter((entry) => entry.getString('question') === activeQuestionId).map((entry) => entry.getInt('speech_number'))) + 1)
      next.set('status', 'speaking')
      app.save(next)
      touchRoom(app, room, { active_entry_id: next.id, speech_started_at: Date.now() })
    } else {
      touchRoom(app, room, { active_entry_id: '', speech_started_at: 0 })
    }
    return
  }
  if (type === 'set-duration') {
    if (activeEntryId) throw new BadRequestError('Finalize a fala atual antes de alterar o tempo.')
    const durationSeconds = validateDuration(body.durationSeconds)
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
