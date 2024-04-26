'use strict';

const knex = require('../knex/knex');
const knexReadOnly = require('../knex/knex_readonly.js');

const tableName = 'embeddings';

const Embeddings = {
    addEmbeddingDB: function (data, schema = 'public') {
        return knex.withSchema(schema).insert(data)
            .into(tableName).then((res) => {
                return res;
            }).catch(err => {
                throw err;
            });
    },
    getLast10TradedProbesFromProbecalls: function (userid, schema = 'public') {
        let sqlQuery = `select probeid, max(createdat) as createdat from :schema:.probecalls where userid=${userid} group by probeid order by max(createdat) desc limit 10`;
        return knex.raw(sqlQuery, { schema })
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getLast10TradedProbesFromHistory: function (userid, schema = 'public') {
        let sqlQuery = `select probeid, createdat from :schema:.history where userid=${userid} order by createdat desc limit 10`;
        return knex.raw(sqlQuery, { schema })
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getAvgEmbeddingFromLastTradedEvents: function (probes, schema = 'public') {
        if( !probes || probes.length < 1) {
            return undefined;
        }
        let sqlQuery = ` SELECT AVG(embedding) FROM :schema:.embeddings where item_id in (${probes.join(",")})`;
        console.log(sqlQuery);
        return knex.raw(sqlQuery, { schema })
            .then((res) => {
                return res['rows'][0];
            }).catch((err) => {
                throw err;
            });
    },
    getProbesRankCosineEmbedding: function (avgEmbedding, probes, schema = 'public') {
        let sqlQuery = `SELECT item_id, 1 - (embedding <=> '${avgEmbedding}') as rank from :schema:.embeddings 
                                    where item_id in (${probes.join(",")}) group by item_id, embedding ORDER BY embedding <=> avg(embedding) asc`;
        console.log(sqlQuery);
        return knex.raw(sqlQuery, { schema })
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    }

};

module.exports = Embeddings;
