migrate((app) => {
  const rooms = app.findCollectionByNameOrId('rooms')
  rooms.fields.add(new NumberField({ name: 'revision', min: 0 }))
  rooms.fields.add(new NumberField({ name: 'control_version', min: 0 }))
  app.save(rooms)
})
