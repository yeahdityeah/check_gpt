'use strict';
const _ = require('lodash');
const knex = require('../knex/knex.js');
const probeCallsOpenTable = 'probecallsopen';

const ProbeCallsOpen = {
    getOpenPositions: function (where, schema='public') {
        if (!where) {
            throw new Error("where condition must not be a falsy value");
        }
        return knex.withSchema(schema).table(probeCallsOpenTable)
            .select('noofcontracts', 'coins')
            .whereRaw(where)
            .then((res) => {
                return res;
            }).catch((e) => {
                throw e;
            });
    },
    getOpenOrdersByEventId: function (eventId, userId) {
        if (!eventId) {
            throw new Error('event should not be a falsy value');
        }

        return knex(probeCallsOpenTable)
            .select('id', 'probeid', 'noofcontracts', 'coins', 'callvalue', 'status', 'createdat')
            .where({ probeid: eventId })
            .whereNot({ userid: userId })
            .then((res) => {
                return res;
            }).catch((e) => {
                throw e;
            });
    },
    getAllOpenOrdersForUserByEventId: function (eventId, userId, callValue) {
        if (!eventId || !userId) {
            throw new Error('event should not be a falsy value');
        }

        let whereObj = { probeid: eventId, userid: userId }
        if (callValue) {
            whereObj['callvalue'] = callValue;
        }

        return knex(probeCallsOpenTable)
            .select()
            .where(whereObj)
            .then((res) => {
                return res;
            }).catch((e) => {
                throw e;
            });
    },
    getOpenPositionByUserIdAndOrderId: function (userId, orderId, schema='public') {
        if (!orderId || !userId) {
            return new Promise((res, rej) => {
                rej(new Error('Invalid UserId or OrderId'))
            })
        }

        return knex.withSchema(schema).table(probeCallsOpenTable)
            .select('id', 'noofcontracts', 'coins')
            .where({ orderid: orderId, userid: userId })
            .then((res) => {
                return res;
            }).catch((e) => {
                throw e;
            });
    },
    onHoldOrderByOrderId: function (orderId) {
        if (!orderId) {
            return;
        }
        const selectionCriteria = {
            orderid: orderId
        };

        return knex(probeCallsOpenTable)
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
            .orderBy('createdat')
            .then((res) => {
                return res;
            }).catch((e) => {
                throw e;
            });
    },
    getUnmatchedOrderList: function (dataObj, maxReturn) {

        const selectionCriteria = {
            probeid: dataObj.probeId,
            callvalue: dataObj.callValue,
            status: 'A'
        };
        selectionCriteria[`${probeCallsOpenTable}.coins`] = dataObj.pricePerContract;


        let orSelectionCriteria = {};
        if (dataObj.status !== 'H') {
            orSelectionCriteria = {
                probeid: dataObj.probeId,
                callvalue: dataObj.callValue === 'N' ? 'Y' : 'N',
                status: 'H'
            }
            const pricePerContract = parseFloat(parseFloat((maxReturn - dataObj.pricePerContract).toString()).toFixed(2));
            orSelectionCriteria[`${probeCallsOpenTable}.coins`] = dataObj.pricePerContract;
        }

        let notWhere = {
            userid: dataObj.userId
        };
        if (dataObj.orderId) {
            selectionCriteria['orderid'] = dataObj.orderId;
            orSelectionCriteria['orderid'] = dataObj.orderId;
            notWhere = {};
        }

        return knex(probeCallsOpenTable)
            .select(
                { id: `${probeCallsOpenTable}.id` },
                { probeId: 'probeid' },
                { userId: 'userid' },
                { pricePerContract: `${probeCallsOpenTable}.coins` },
                { callValue: 'callvalue' },
                { returns: 'returns' },
                { numberOfContracts: 'noofcontracts' },
                { orderId: 'orderid' },
                { status: 'status' },
                { lastexecid: 'lastexecid' },
                { execid: 'execid' },
                { lastprice: 'lastprice' },
                { lastorderid: 'lastorderid' },
                { fcmToken: 'users.fcmtoken' }
            )
            .innerJoin('users', 'users.id', `${probeCallsOpenTable}.userid`)
            .where(builder => {
                builder.orWhere(selectionCriteria).orWhere(orSelectionCriteria);
            })
            .andWhereNot(notWhere)
            .orderBy(`${probeCallsOpenTable}.createdat`)
            .then((res) => {
                return res;
            }).catch((e) => {
                throw e;
            });
    },
    getUnmatchedOrderListCda: function (dataObj, maxReturn) {
        let orWhereCondition;
        let orWhereCondition1;
        let caseSpread;
        if (dataObj.status !== 'H') {
            orWhereCondition = `( probecallsopen.status = 'H' and probecallsopen.probeid = ${dataObj.probeId} and probecallsopen.callvalue = ${dataObj.callValue === 'N' ? "'Y'" : "'N'"} and (${dataObj.pricePerContract} - ${probeCallsOpenTable}.coins) >= 0 )`;
            orWhereCondition1 = `( probecallsopen.status = 'A' and probecallsopen.probeid = ${dataObj.probeId} and probecallsopen.callvalue = '${dataObj.callValue}' and ((${probeCallsOpenTable}.coins + ${dataObj.pricePerContract}) - ${maxReturn}) >= 0 )`;
            caseSpread = `CASE WHEN probecallsopen.status = 'A' THEN ((${probeCallsOpenTable}.coins + ${dataObj.pricePerContract}) - ${maxReturn}) ELSE (${dataObj.pricePerContract} - ${probeCallsOpenTable}.coins) END AS spread`
        } else {
            caseSpread = `CASE WHEN probecallsopen.status = 'A' THEN ((${probeCallsOpenTable}.coins + ${dataObj.pricePerContract}) - ${maxReturn}) ELSE ${maxReturn} - ( ${dataObj.pricePerContract} + ${probeCallsOpenTable}.coins) END AS spread`
            orWhereCondition = `( probecallsopen.status = 'H' and probecallsopen.probeid = ${dataObj.probeId} and probecallsopen.callvalue = ${dataObj.callValue === 'N' ? "'Y'" : "'N'"} and (${dataObj.pricePerContract} + ${probeCallsOpenTable}.coins) <= ${maxReturn} )`;
            orWhereCondition1 = `( probecallsopen.status = 'A' and probecallsopen.probeid = ${dataObj.probeId} and probecallsopen.callvalue = '${dataObj.callValue}' and ${probeCallsOpenTable}.coins >= ${dataObj.pricePerContract} )`;
        }


        return knex(probeCallsOpenTable)
            .select(
                { id: `${probeCallsOpenTable}.id` },
                { probeId: 'probecallsopen.probeid' },
                { userId: 'probecallsopen.userid' },
                { pricePerContract: `${probeCallsOpenTable}.coins` },
                { callValue: 'probecallsopen.callvalue' },
                { returns: 'probecallsopen.returns' },
                { numberOfContracts: 'probecallsopen.noofcontracts' },
                { orderId: 'probecallsopen.orderid' },
                { status: 'probecallsopen.status' },
                { lastexecid: 'probecallsopen.lastexecid' },
                { execid: 'probecallsopen.execid' },
                { lastprice: 'probecallsopen.lastprice' },
                { lastorderid: 'probecallsopen.lastorderid' },
                knex.raw(caseSpread)
            )
            .orWhereRaw(orWhereCondition1)
            .orWhereRaw(orWhereCondition)
            // .andWhereNot({
            //     "probecallsopen.userid" : dataObj.userId
            // })
            .orderBy([{ column: 'spread', order: 'desc' }, { column: `${probeCallsOpenTable}.createdat`, order: 'asc' }])
            .then((res) => {
                res = _.uniqBy(res, 'id');
                return res;
            }).catch((e) => {
                throw e;
            });
    },

    insert: (data) => {
        return knex.batchInsert(probeCallsOpenTable, data, data.length)
            .then(() => {

            })
            .catch(function (error) {
                throw error;
            });
    },

    update: (data, id) => {
        return knex(probeCallsOpenTable)
            .where({ id })
            .update(data)
            .then(() => {

            })
            .catch(function (error) {
                throw error;
            });
    },

    delete: (primaryKeyList, schema='public') => {
        return knex.withSchema(schema).table(probeCallsOpenTable)
            .whereIn('id', primaryKeyList)
            .del()
            .then(() => {

            })
            .catch(function (error) {
                throw error;
            });
    },
    getAllActiveCalls: async (eventId, userId) => {
        try {

            const sql = `select status, coins, rank, callvalue
                            from probecalls 
                            where status = 'A' and rank = 0 and probeid = ${eventId} and userid = ${userId}
                         union
                         select status, coins, -1 as rank, callvalue
                            from probecallsopen 
                            where status in ('A', 'H') and probeid = ${eventId} and userid = ${userId}`;

            const res = await knex.raw(sql);
            return res.rows;
        } catch (e) {
            throw e;
        }
    }
};

module.exports = ProbeCallsOpen;
