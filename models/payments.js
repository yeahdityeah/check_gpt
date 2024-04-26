'use strict';
const { TE, to } = require('../services/util.service');
const CONFIG = require('../config/config');
const knex = require('../knex/knex.js');
const Payments = {
    get: async (paymentId, orderId) => {
        if (!paymentId && !orderId) {
            throw new Error('Invalid data received');
        }
        const whereObj = {};
        if (paymentId) {
            whereObj['paymentid'] = paymentId;
        }
        if (orderId) {
            whereObj['orderid'] = orderId;
        }
        try {
            const resultSet = await knex
                .from('payments')
                .where(whereObj);
            return resultSet[0];
        } catch (e) {
            throw e;
        }

    },
    add: async (dataObj) => {
        try {
            const resultSet = await knex('payments').insert(dataObj).returning(['id', 'paymentid', 'orderid', 'amount', 'status']);
            return resultSet[0];
        } catch (e) {
            throw e;
        }
    },
    update: async (whereObj, updateObj) => {
        try {
            const resultSet = await knex('payments').update(updateObj).where(whereObj).returning(['id', 'userid', 'paymentid', 'orderid', 'amount', 'status']);
            return resultSet[0];
        } catch (e) {
            throw e;
        }

    },
    getLastDecentroTxns: async () => {
        let sqlQuery = `select * from payments where status is null and source = '3' and createdat > now() - interval '310 seconds' order by id desc`;
        return knex.raw(sqlQuery)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getTotalRecharge: async (userId) => {
        let sqlQuery = `SELECT SUM (amount) AS total
                            FROM payments
                        WHERE userid = ? and 
                              paymentid IS NOT NULL
                        LIMIT 1000`;
        return knex.raw(sqlQuery, [userId])
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    }
}

module.exports = Payments;