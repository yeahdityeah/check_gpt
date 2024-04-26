'use strict';
const knex = require('../knex/knex.js');
const knexReadOnly = require('../knex/knex_readonly.js');
const History = {
    getHistory: async function (probeid, userid) {
        const sql = `select a.*, b.settlement_proof, b.type, b.entryfee, b.settledate, b.is_price_editable, b.subcat, b.start_date, b.correctvalue, b.endsat, c.max_pool, c.max_players
        from history a 
        left join probes b on a.probeid = b.id 
        left join tournament_info c on c.probe_id = b.id
        where a.userid = ${userid} and a.probeid = ${probeid}`;
        return knexReadOnly.raw(sql).then((res)=>{
            return res.rows.length > 0 ? res.rows: [];
        });
    },

    getClosedEvent: async function (){
        const sql = `select id from probes where status = 'C'`;
        return knexReadOnly.raw(sql)
        .then((res) => {
            return res['rows'];
        }).catch((err) => {
            throw err;
        });
    },

    getClosedTournaments: async function (){
        const sql = `select id from probes where status = 'C' and type = 'Competition' order by id asc`;
        return knexReadOnly.raw(sql)
        .then((res) => {
            return res['rows'];
        }).catch((err) => {
            throw err;
        });
    },

    insertIntoHistory: async function(dataObj, schema = 'public') {
        return knex('history')
            .withSchema(schema)
            .insert({
                'userid': dataObj.userid,
                'probeid': dataObj.probeid,
                'orders': JSON.stringify(dataObj.orders),
                'totalinvested': dataObj.totalinvested,
                'totalreturn': dataObj.totalreturn,
                'totalrefund': dataObj.totalrefund,
                'proofofsettlement': dataObj.proofofsettlement
            })
            .then((res) => {
                return res;
            }).catch((err) => {
                console.log(err);
                throw err;
            });
    },

    removeFromHistory: async function (eventId, schema = 'public') {
        return knex.withSchema(schema).table('history').where({probeid: eventId}).del();
    },

    getClosedEventForUserMarkets: async function (userid) {
        const sql = `select a.totalInvested, a.totalReturn, a.totalRefund, a.probeid, b.title, 
                        b.imageurl, b.category, b.resolution, b.correctvalue, b.source, b.is_price_editable, b.subcat, b.type, b.endsat, b.start_date, b.settledate
                        from history a 
                        Left Join probes b on a.probeid = b.id
                        where a.userid = ${userid} and b.type = 'Bet'
                        order by b.settledate desc`;
        return knexReadOnly.raw(sql).then((res)=>{
            return res.rows.length > 0 ? res.rows: [];
        }).catch((err) => {
            console.log(err);
            throw err;
        });
    },

    getClosedEventHeaderForUserMarkets: async function (userid) {
        const sql = `select sum(a.totalInvested) as total_invested, 
                            sum(a.totalReturn + a.totalrefund) as total_return,
                            count(*)::int as total_events
                        from history a 
                        Left Join probes b on a.probeid = b.id and b.type = 'Bet'
                        where a.userid = ${userid} `;
        return knexReadOnly.raw(sql).then((res)=>{
            return res.rows[0];
        }).catch((err) => {
            console.log(err);
            throw err;
        });
    },

    getClosedEventForUserTournaments: async function (userid) {
        const sql = `select a.totalInvested, a.totalReturn, a.totalRefund, a.probeid, b.title, 
                        b.imageurl, b.category, b.resolution, b.correctvalue, b.source, b.type, b.endsat,
                        b.entryfee, c.max_players, c.max_pool
                        from history a 
                        Left Join probes b on a.probeid = b.id
                        Left Join tournament_info c on c.probe_id = a.probeid
                        where a.userid = ${userid} and b.type = 'Competition'
                        order by b.settledate desc`;
        return knexReadOnly.raw(sql).then((res)=>{
            return res.rows.length > 0 ? res.rows: [];
        }).catch((err) => {
            console.log(err);
            throw err;
        });
    },

    getProbeCorrectValue: async function (probeid, schema = 'public') {
        const sql = `select correctvalue from ??.probes where id = ${probeid}`;
        return knexReadOnly.raw(sql, schema)
        .then((res) => {
            return res['rows'][0];
        }).catch((err) => {
            throw err;
        });
    },
    getHistoryEvent: async(probeId, schema='public') => {
        let sql = `select count(*)
        from :schema:.history 
        where probeid = :probeId`;

        return knex.raw(sql, {schema, probeId}).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });

    }
}

module.exports = History;
