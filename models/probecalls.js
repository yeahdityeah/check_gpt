'use strict';

const knex = require('../knex/knex.js');
const probeCallsTable = 'probecalls';

const ProbeCalls = {
    getPositions: function( whereClause, schema='public' ) {
        if( !whereClause ){
            throw new Error("where condition must not be a falsy value");
        }
        return knex.withSchema(schema).table(probeCallsTable)
            .select('noofcontracts','coins')
            .whereRaw(whereClause)
            .orderByRaw('id desc nulls last')
            .then((res) => {
                return res;
            }).catch((e) => {
                throw e;
            });
    },
    getPositionByUserIdAndOrderId: function (userId, orderId) {
        if (!orderId || !userId) {
            return [];
        }

        return knex(probeCallsTable)
            .select('id')
            .where({ orderid: orderId, userid: userId })
            .then((res) => {
                return res;
            }).catch((e) => {
                throw e;
            });
    },
    getProbecallsById: function (pbId) {
        return knex(probeCallsTable)
            .select()
            .where({ id: pbId })
            .then((res) => {
                return res;
            }).catch((e) => {
                throw e;
            });
    },
    getMatchedOrderList: function (dataObj, schema='public') {
        const selectionCriteria = {};

        if (dataObj['status'] === 'A') {
            selectionCriteria['status'] = 'A';
        }

        if (dataObj.orderType === 'sell') {
            if (!dataObj.numberOfContracts) {
                throw new Error('no. of contracts must not be a false value for a sell request');
            }
            selectionCriteria['status'] = 'A';
            selectionCriteria['callvalue'] = dataObj.callValue;
            selectionCriteria['userid'] = dataObj.userId;
            selectionCriteria['probeid'] = dataObj.probeId;
        } else {
            selectionCriteria['orderid'] = dataObj.orderId;
            selectionCriteria['callvalue'] = dataObj.callValue;
        }

        return knex.withSchema(schema).table(probeCallsTable)
            .select(
                'id',
                { probeId: 'probeid' },
                { userId: 'userid' },
                { pricePerContract: 'coins' },
                { callValue: 'callvalue' },
                { returns: 'returns' },
                { numberOfContracts: 'noofcontracts' },
                { orderId: 'orderid' },
                { status: 'status' },
                { lastexecid: 'lastexecid' },
                { execid: 'execid' },
                { lastprice: 'lastprice' },
                { lastorderid: 'lastorderid' }
            )
            .where(selectionCriteria)
            .then((res) => {
                return res;
            }).catch((e) => {
                throw e;
            });
    },

    insert: (data, schema='public') => {
        return knex.batchInsert(`${schema ?? 'public'}.${probeCallsTable}`, data, data.length)
            .then(() => { return; })
            .catch(function (error) { throw error });
    },

    insertWithResult: (data, schema='public') => {
        return knex.batchInsert(`${schema || 'public'}.${probeCallsTable}`, data, data.length)
            .returning(['*'])
            .then((res) => {
                return res;
            })
            .catch(function (error) { throw error });
    },

    update: (data, id, schema='public') => {
        return knex(probeCallsTable).withSchema(schema)
            .where({ id: id })
            .update(data)
            .then(() => { return; })
            .catch(function (error) { throw error });
    },

    delete: (primaryKeyList) => {
        return knex(probeCallsTable)
            .whereIn('id', primaryKeyList)
            .del()
            .then(() => { return; })
            .catch(function (error) { throw error });
    },

    getAllActiveProbes: ( data, schema='public' ) => {
        let sqlParams = [ data['probeid' ] ];
        let whereClause = ` where 1 = 1 and a.probeid = ? `;
        whereClause += ` and a.userid = ? `;
        sqlParams.push( data['userid'] );

        whereClause += ` and a.status = ? `;
        sqlParams.push( 'A' );

        let sql = `select a.*
                    ${knex.raw('FROM  :schema:.probecalls a', {schema}).toSQL().sql} 
                    ${whereClause}
                    order by id`;
        return knex.raw( sql, sqlParams ).then( ( res ) => {
            return res.rows;
        }).catch( ( e ) => {
            throw e;
        });
    }
};

module.exports = ProbeCalls;
