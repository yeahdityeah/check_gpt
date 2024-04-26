const enableLatencyLogging = require('./latency-logging.js');

const environment = process.env.NODE_ENV || 'development'
const config = require('../knexfile.js')[environment];

const knex = require('knex')(config);
// enableLatencyLogging(knex, 'READ WRITE')

module.exports = knex;