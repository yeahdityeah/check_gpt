'use strict';
const knex = require('../knex/knex.js');
const knexReadOnly = require('../knex/knex_readonly.js');

const CurrentPrice = {
    doesCurrentPriceExist: async function(eventId, schema = 'public') {
        const sql = `select count(*) from ${schema}.current_price where probeid = ${eventId}`;
        return knexReadOnly.raw(sql).then((res)=>{
            return parseInt(res.rows[0].count) !== 0;
        }).catch(err => {
            throw err;
        })
    },
    
    createCurrentPrice: async function (dataObj, schema = 'public') {
        return knex.withSchema(schema).insert(dataObj, 'probeid')
        .into('current_price').then((probeid) => {
            return probeid;
        }).catch(err => {
            throw err;
        });
    },

    updateCurrentPrice: async function (dataObj, schema = 'public') {
        const sql = `update ${schema}.current_price set 
            latest_cp_yes = ${dataObj['latest_cp_yes']},
            cp_history = '${dataObj['cp_history']}', 
            updated_at = now()
            where probeid = ${dataObj['eventId']}`;
        return knex.raw(sql).then((res)=>{
            return res;
        }).catch(err => {
            throw err;
        })
    },

    updateLatestCpYes: async function (dataObj, schema = 'public') {
        const sql = `update ${schema}.current_price set 
            latest_cp_yes = ${dataObj['latest_cp_yes']}
            where probeid = ${dataObj['eventId']}`;
        return knex.raw(sql).then((res)=>{
            return res;
        }).catch(err => {
            throw err;
        })
    },

    getCurrentPrice: async function (eventId, schema = 'public') {
        return knexReadOnly.withSchema(schema).table('current_price')
        .select('cp_history', 'latest_cp_yes', 'updated_at')
        .where({ probeid: eventId })
        .then((res) => {
            return res;
        }).catch(err => {
            throw err; 
        });
    },

    deleteCurrentPrice: async function (eventId, schema = 'public') {
        const sql = `delete from ??.current_price 
            where probeid = ${eventId}`;
        return knex.raw(sql, schema).then((res)=>{
            return res;
        }).catch(err => {
            throw err;
        })
    },

    insertCurrentPriceTemp: async function (dataObj, schema = 'public') {
        return knex.withSchema(schema).insert(dataObj, 'probeid')
        .into('temp_current_price').then((probeid) => {
            return probeid;
        }).catch(err => {
            throw err;
        });
    },

    batchInsert: async function (tempCurrentPrices, schema = 'public') {
        return knex.batchInsert(`${schema || 'public'}.temp_current_price`, tempCurrentPrices, 10).returning('probeid');
    },

    deleteCurrentPriceTemp: async function (eventId, schema = 'public') {
        const sql = `delete from ??.temp_current_price 
            where probeid = ${eventId}`;
        return knex.raw(sql, schema).then((res)=>{
            return res;
        }).catch(err => {
            throw err;
        })
    },

    getAverageCp: async (eventId, timeUnit, isLongEvent, duration, eventDuration, schema = 'public') => {
        try {
            
            if(isLongEvent || eventDuration > 15) {
                const sqlParams = [timeUnit, eventId];
                const sql = `select t as time, avg(price) as price from (
                    SELECT date_trunc(?, created_at):: timestamp as t, price ${knex.raw('FROM :schema:.temp_current_price', {schema}).toSQL().sql} 
                    where probeid = ?
                    ) a group by a.t limit 1`;
                const res = await  knex.raw(sql, sqlParams);
                return res?.rows[0];
            }
            const seconds = duration * 60;
            const sql = `select 
            t as time, avg(price) as price 
            from (
                SELECT
                    date_trunc('minute', created_at)::timestamp 
                    + date_part('second', created_at)::int/${seconds} * '${seconds} second'::interval
                    as t, 
                    price ${knex.raw('FROM :schema:.temp_current_price', {schema}).toSQL().sql}
                where probeid = ?
            ) a group by a.t order by t desc limit 1`;
            const res = await  knexReadOnly.raw(sql, [eventId]);
            return res?.rows[0];
        } catch(e) {
            console.log("[CP ERROR]", e.message)
            throw(e)
        }
        
    }
};

module.exports = CurrentPrice;
