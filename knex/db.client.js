// const environment = process.env.NODE_ENV || 'development';
// const config = require( '../knexfile.js' )[environment];
// const { Client }  = require('pg');
// const pgNotify = require( '@becual/pg-notify' );
//
// let client;
//
// async function _getClient() {
//
//     if(!client) {
//         const user = config.connection.user;
//         const password = config.connection.password;
//         const database = config.connection.database;
//         const host = config.connection.host;
//         client = new Client({ connectionString: `postgresql://${user}:${password}@${host}/${database}?charset=utf8` });
//         await client.connect();
//     }
//     return client;
// }
//
// async function registerEvent( tableName, events, eventHandler ){
//     const client = await _getClient();
//     const sub = await pgNotify(client, {schema: 'public'}).subscribe([tableName]);
//     for(const event of events) {
//         sub.on(event, eventHandler);
//     }
// }
//
// module.exports.registerEvent = registerEvent;
