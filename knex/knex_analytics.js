const environment = process.env.NODE_ENV || 'development'
const config = require('../knexfile.js')['analytics'];
module.exports = require('knex')(config);