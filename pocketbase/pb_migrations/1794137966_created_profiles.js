migrate((app) => {
  const collection = new Collection({
    "createRule": "user = @request.auth.id",
    "deleteRule": "user = @request.auth.id",
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "help": "",
        "hidden": false,
        "id": "text3208210256",
        "max": 15,
        "min": 15,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "required": true,
        "system": true,
        "type": "text"
      },
      {
        "cascadeDelete": true,
        "collectionId": "_pb_users_auth_",
        "help": "",
        "hidden": false,
        "id": "relation2375276105",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "user",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "relation"
      },
      {
        "autogeneratePattern": "",
        "help": "",
        "hidden": false,
        "id": "text1579384326",
        "max": 32,
        "min": 0,
        "name": "name",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "help": "",
        "hidden": false,
        "id": "select2841696002",
        "maxSelect": 1,
        "name": "avatar_kind",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "select",
        "values": [
          "smiley",
          "anime",
          "media"
        ]
      },
      {
        "exceptDomains": [],
        "help": "",
        "hidden": false,
        "id": "url2190673250",
        "name": "avatar_url",
        "onlyDomains": [],
        "presentable": false,
        "required": false,
        "system": false,
        "type": "url"
      },
      {
        "autogeneratePattern": "",
        "help": "",
        "hidden": false,
        "id": "text1716930793",
        "max": 9,
        "min": 0,
        "name": "color",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "help": "",
        "hidden": false,
        "id": "bool1123602836",
        "name": "kids",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "bool"
      },
      {
        "help": "",
        "hidden": false,
        "id": "select1340663467",
        "maxSelect": 1,
        "name": "max_rating",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "select",
        "values": [
          "L",
          "10",
          "12",
          "14",
          "16",
          "18"
        ]
      },
      {
        "help": "",
        "hidden": false,
        "id": "date4016875332",
        "max": "",
        "min": "",
        "name": "last_used",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "date"
      }
    ],
    "id": "pbc_3414089001",
    "indexes": [],
    "listRule": "user = @request.auth.id",
    "name": "profiles",
    "system": false,
    "type": "base",
    "updateRule": "user = @request.auth.id",
    "viewRule": "user = @request.auth.id"
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3414089001");

  return app.delete(collection);
})
