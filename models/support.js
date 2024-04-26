'use strict';
const { TE, to } = require('../services/util.service');
const CONFIG = require('../config/config');
const knex = require('../knex/knex.js');
const { content } = require('googleapis/build/src/apis/content/index.js');
const Support = {
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
    add: async (tkt) => {
        try {
            var dataObj = {
                ticket_id: tkt['id'],
                thread_id: tkt['id'],
                created_at: 'now()',
                tkt_creation_time: tkt['createdTime'],
                status: tkt['status'], contest: JSON.stringify(content)
            }
            const resultSet = await knex('payments').insert(dataObj).returning(['id', 'paymentid', 'orderid', 'amount', 'status']);
            return resultSet[0];
        } catch (e) {
            throw e;
        }
    },
    getLatestTicket: async () => {
        try {
            const resultSet = await knex.raw(`select * from tickets order by id desc limit 1`);
            return resultSet[0] || { tkt_number: 0 };
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

    }
}

module.exports = Support;