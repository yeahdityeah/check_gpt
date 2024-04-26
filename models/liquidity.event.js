'use strict';

const knex = require('../knex/knex');
const knexReadOnly = require('../knex/knex_readonly.js');

const tableName = 'liquidity_events';

const LiquidityEvent = {
    getLatestRow: function (probeId, useReadOnly, schema = 'public') {
        if (typeof probeId !== 'number' || probeId <= 0) {
            throw new Error('Invalid data received');
        }
        const knexClient = useReadOnly === true ? knexReadOnly: knex;
        if(schema == 'public') {
            const partitionName = `partitions.${tableName}_${probeId}`
            const resultSet = knexClient
                .select()
                .from(partitionName)
                .where({ probe_id: probeId })
                .orderBy('id', 'desc')
                .limit(1);
            return resultSet;
        }
        const resultSet = knexClient
            .withSchema(schema)
            .select()
            .from(tableName)
            .where({ probe_id: probeId })
            .orderBy('id', 'desc')
            .limit(1);
        return resultSet;
        
    },
    addLiquidity: function (data, schema = 'public') {
        return knex.withSchema(schema).insert(data)
            .into(tableName).then((res) => {
                return res;
            }).catch(err => {
                throw err;
            });
    },
    deleteLiquidityRow: function (whereCondition, schema = 'public') {
        return knex.withSchema(schema).table(tableName)
            .where(whereCondition)
            .del()
            .then((res) => {
                return res
            }, (err => { throw err }) );
    }
};

module.exports = LiquidityEvent;
