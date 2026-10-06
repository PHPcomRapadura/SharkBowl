migrate((app) => {
  const collection = app.findCollectionByNameOrId('queue_entries')
  collection.fields.add(new NumberField({ name: 'order_index', min: 0 }))
  collection.fields.add(new NumberField({ name: 'speech_number', min: 0 }))
  app.save(collection)
  const positions = {}
  const speeches = {}
  for (const entry of app.findRecordsByFilter('queue_entries', '', '', 0, 0)) {
    const key = entry.getString('room') + ':' + entry.getString('question')
    positions[key] = (positions[key] || 0) + 1
    entry.set('order_index', positions[key])
    if (['speaking', 'finished'].includes(entry.getString('status'))) {
      speeches[key] = (speeches[key] || 0) + 1
      entry.set('speech_number', speeches[key])
    }
    app.save(entry)
  }
})
