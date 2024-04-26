'use strict';
const knex = require('../knex/knex.js');
const knexReadOnly = require('../knex/knex_readonly.js');

const Config = {
    getConfig: async function (label) {
        return knex('config').where('label', label);
    },
    updateConfig: async function (label, payload) {
        if(!label) {
            throw new Error('Pass a service to update');
        }
        const config = await knex('config').where('label', label);
        if(!config?.[0]?.data) {
            throw new Error(`Service ${label} not found for update`);
        }
        const data = JSON.stringify({
            ...config?.[0]?.data,
            ...payload
        });
        const updated = await knex('config').where('label', label).update({ data }, ['id', 'label', 'data']);        
        return updated?.[0];
    }
}

module.exports = Config;
