'use strict';
const knex = require('../knex/knex.js');

const Common = {
    captureRequest: async function (dataObj) {
        return knex('requests_capture').insert(dataObj);
    }
}

module.exports = Common;
