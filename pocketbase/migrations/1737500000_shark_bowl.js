migrate((app) => {
  const users = app.findCollectionByNameOrId('users')
  users.listRule = null
  users.viewRule = 'id = @request.auth.id'
  users.createRule = null
  users.updateRule = 'id = @request.auth.id'
  users.deleteRule = null
  users.fields.getByName('name').max = 40
  users.passwordAuth.enabled = false
  users.oauth2.enabled = true
  app.save(users)

  const rooms = new Collection({
    id: 'sharkroom000001',
    type: 'base',
    name: 'rooms',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: 'text', name: 'title', required: true, min: 3, max: 80 },
      { type: 'text', name: 'slug', required: true, min: 3, max: 48 },
      { type: 'relation', name: 'owner', required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true },
      { type: 'select', name: 'phase', required: true, maxSelect: 1, values: ['lobby', 'running'] },
      { type: 'text', name: 'active_question_id', max: 15 },
      { type: 'text', name: 'active_entry_id', max: 15 },
      { type: 'number', name: 'speech_started_at', min: 0 },
      { type: 'number', name: 'duration_seconds', required: true, min: 120, max: 180 },
      { type: 'number', name: 'activity_at', required: true, min: 0 },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_rooms_slug ON rooms (slug)'],
  })
  app.save(rooms)

  const memberships = new Collection({
    id: 'sharkmemb000001',
    type: 'base',
    name: 'memberships',
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: 'relation', name: 'room', required: true, maxSelect: 1, collectionId: rooms.id, cascadeDelete: true },
      { type: 'relation', name: 'user', required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true },
      { type: 'select', name: 'role', required: true, maxSelect: 1, values: ['participant', 'facilitator'] },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_memberships_room_user ON memberships (room, user)'],
  })
  app.save(memberships)

  const questions = new Collection({
    id: 'sharkquest00001',
    type: 'base',
    name: 'questions',
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: 'relation', name: 'room', required: true, maxSelect: 1, collectionId: rooms.id, cascadeDelete: true },
      { type: 'relation', name: 'author', required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true },
      { type: 'text', name: 'text', required: true, min: 1, max: 280 },
      { type: 'bool', name: 'anonymous' },
      { type: 'select', name: 'status', required: true, maxSelect: 1, values: ['waiting', 'active', 'closed'] },
    ],
  })
  app.save(questions)

  const queueEntries = new Collection({
    id: 'sharkqueue00001',
    type: 'base',
    name: 'queue_entries',
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: 'relation', name: 'room', required: true, maxSelect: 1, collectionId: rooms.id, cascadeDelete: true },
      { type: 'relation', name: 'question', required: true, maxSelect: 1, collectionId: questions.id, cascadeDelete: true },
      { type: 'relation', name: 'participant', required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true },
      { type: 'text', name: 'reply_to_entry_id', max: 15 },
      { type: 'select', name: 'status', required: true, maxSelect: 1, values: ['waiting', 'speaking', 'finished'] },
    ],
  })
  app.save(queueEntries)
}, (app) => {
  for (const name of ['queue_entries', 'questions', 'memberships', 'rooms']) {
    try {
      app.delete(app.findCollectionByNameOrId(name))
    } catch {}
  }
})
