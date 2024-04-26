
const enableLatencyLogging = require('./latency-logging.js');
const environment = process.env.NODE_ENV || 'development'
const config = require('../knexfile.js')[environment !== 'development' ? environment + '_readonly' : environment];
const knex = require('knex')(config);
// enableLatencyLogging(knex, 'READ ONLY')
module.exports = knex;
