migrate((app) => {
  const votes = new Collection({
    name: 'question_votes',
    type: 'base',
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: 'relation', name: 'room', required: true, maxSelect: 1, collectionId: app.findCollectionByNameOrId('rooms').id, cascadeDelete: true },
      { type: 'relation', name: 'question', required: true, maxSelect: 1, collectionId: app.findCollectionByNameOrId('questions').id, cascadeDelete: true },
      { type: 'relation', name: 'user', required: true, maxSelect: 1, collectionId: app.findCollectionByNameOrId('users').id, cascadeDelete: true },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_question_votes_question_user ON question_votes (question, user)', 'CREATE INDEX idx_question_votes_room ON question_votes (room)'],
  })
  app.save(votes)
})
