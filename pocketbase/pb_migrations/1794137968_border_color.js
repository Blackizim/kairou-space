migrate((app) => {
 const c = app.findCollectionByNameOrId('profiles');
 c.fields.add(new Field({name:'border_color',type:'text',max:9})); return app.save(c);
}, (app) => { const c=app.findCollectionByNameOrId('profiles'); c.fields.removeByName('border_color'); return app.save(c); });
