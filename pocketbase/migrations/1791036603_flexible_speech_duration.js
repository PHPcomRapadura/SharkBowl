migrate((app) => {
  const rooms = app.findCollectionByNameOrId('rooms')
  const duration = rooms.fields.getByName('duration_seconds')
  duration.min = 1
  duration.max = 86400
  app.save(rooms)
})
