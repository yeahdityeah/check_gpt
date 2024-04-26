'use strict';
const knex = require('../knex/knex.js');

const Intervals = {
    getFunctions: async function () {
        return knex('intervals')
            .select('function_name', 'duration', 'last_updated')
            .then((res) => {
                return res;
            }).catch((err) => {
                throw err;
            });
    },

    updateLastUpdated: async function (function_name) {
        try {
            let sql1 = `update intervals set last_updated = now() where function_name = '${function_name}'`;
            if(function_name === 'processReferralModels') {
                sql1 = `update intervals set last_updated = last_updated + (duration::text || ' minutes')::interval
                where function_name = '${function_name}'`;
            }
            let _ = await knex.raw(sql1);
            return true;
        } catch (e) {
            throw e;
        }
    }
}

module.exports = Intervals;