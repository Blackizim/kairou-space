migrate((app) => {
  const users = app.findCollectionByNameOrId('users');
  const profiles = app.findCollectionByNameOrId('profiles');
  const collection = new Collection({
    name: 'profile_state', type: 'base',
    listRule: 'user = @request.auth.id', viewRule: 'user = @request.auth.id',
    createRule: 'user = @request.auth.id && profile.user = @request.auth.id',
    updateRule: 'user = @request.auth.id && @request.body.user:isset = false && @request.body.profile:isset = false',
    deleteRule: 'user = @request.auth.id',
    fields: [
      {name:'user',type:'relation',collectionId:users.id,required:true,maxSelect:1,cascadeDelete:true},
      {name:'profile',type:'relation',collectionId:profiles.id,required:true,maxSelect:1,cascadeDelete:true},
      {name:'saved',type:'json',maxSize:262144},
      {name:'watched',type:'json',maxSize:262144},
      {name:'progress',type:'json',maxSize:2097152}
    ],
    indexes:['CREATE UNIQUE INDEX idx_profile_state_profile ON profile_state (profile)']
  });
  return app.save(collection);
}, (app) => app.delete(app.findCollectionByNameOrId('profile_state')));
