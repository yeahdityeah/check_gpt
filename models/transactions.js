'use strict';
const knex = require('../knex/knex.js');
const { promisify } = require('util');
const { redisCaching } = require('../services/cache.service');
const lock = promisify(require('redis-lock')(redisCaching.client));

const Transactions = {
    getUserProbeTransactions: async function (probeId, userId, amount, refId) {
        let sql = `select * from transactions where userid= ${userId} and txnid LIKE 'P1%${probeId}' 
                             and amount=${amount} and refid='${refId}'`;

        return knex.raw(sql).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    getUserAllTransactions: async function (probeId, userId, schema='public') {
        let sql = `select 
                            t.id, 
                            t.userid, t.createdat, t.updatedat, t.amount, t.txnid,
                            t.surcharge + COALESCE(tml.amount, 0) as surcharge,
                            t.type, t.wallettype, t.message
        from :schema:.transactions  t
        left outer join transaction_lpc tml using (id)
        where t.userid= :userId and txnid LIKE 'P1%' || :probeId`;

        return knex.raw(sql, {schema, probeId, userId}).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    insertTransactions: async function (dataObj, trx) {
        let ids =  await trx.batchInsert('transactions', dataObj, 25).returning(['id', 'userid', 'amount',  'surcharge', 'type', 'message', 'txnid'])
        return ids;
    },

    executeTransactions: async function(transactions, detailed = false, trx = null, schema='public' ) {
        const log = (...args) => console.log('[TRANSACTION AND WALLET]', ...args);
        const sanitized = transactions.map( t => ({
            ...t,
            amount: t?.amount ?? 0,
            surcharge: t?.surcharge ?? 0
        }));
        const sql = knex.raw('SELECT * from :schema:.execute_transactions(?::jsonb, ?::boolean) as results', {schema}).toSQL().sql;
        let client = trx || knex;

        // const res = await client.raw(sql, [JSON.stringify(sanitized), Boolean(detailed)]);
        // return res?.rows?.[0].results;

        let results = [];
        for(let i=0; i<sanitized.length; i++) {
            const t = sanitized[i];
            log(`Executing ${t.type} transaction ${t?.action?.type} - ${t?.action?.operation} for ${t.userid} with ${t.amount} credits at a surcharge of ${t.surcharge} `)
            const reqKey = `updating_wallet_${t['userid']}`;
            const unlock = await lock(reqKey, 300000);
            try {
                const res = await client.raw(sql, [JSON.stringify([t]), Boolean(detailed)]);
                results = results.concat(res?.rows?.[0].results ?? [])
            } catch (e) {
                log(e.message);
                unlock();
                throw e;
            } finally {
                unlock();
            }
        }
        return results;
    },
    getTransactionCount: async(userId, txnidPrefix, truncation) => {
        try {
            const sql = `select count(id)
            from transactions where userid = :userId and createdat >= date_trunc(:truncation, now())  and txnid ~* ('^(' || :txnidPrefix || ')')`;
            const res = await knex.raw(sql, { userId, txnidPrefix, truncation });
            return parseInt(res?.rows?.[0]?.count ?? 0, 10);
        } catch(e) {
            console.log("[TRANSACTIONS MODEL] error", e.message);
            throw(e);
        }    
    },
    getLatestTransaction: async(userId, probeId, txnType) => {
        try {
            const sql = `select tx.*, wn.id as wallet_id from transactions tx left join wallet_new wn on tx.userid=wn.userid
                         where tx.userid = ${userId} and txnid like '${txnType}%${probeId}' and wn.transaction_id = tx.id order by tx.id desc limit 1`;
            const res = await knex.raw(sql, { userId });
            return res.rows.length > 0 ? res.rows[0] : null;
        } catch(e) {
            console.log("[TRANSACTIONS MODEL] error", e.message);
            throw(e);
        }
    },
    getSettlementTransations: async(probeId, schema='public') => {
        let sql = `select count(*)
        from :schema:.transactions 
        where txnid LIKE 'S1%' || :probeId`;

        return knex.raw(sql, {schema, probeId}).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });

    },
    getAllTransactionsCount: async(userId, txnidPrefix, transactionId, count_to_check_archive) => {
        try {
            const sql = `select count(id)
            from transactions where id > :transactionId and userid = :userId and txnid ~* ('^(' || :txnidPrefix || ')')`;
            const res = await knex.raw(sql, { userId, txnidPrefix, transactionId});
            let txnCount =  parseInt(res?.rows?.[0]?.count ?? 0, 10);

            if (txnCount < count_to_check_archive){
                const sql = `select count(id)
                from transactions_archive where id > :transactionId and userid = :userId and txnid ~* ('^(' || :txnidPrefix || ')')`; 
                const res = await knex.raw(sql, { userId, txnidPrefix, transactionId });
                let txnCount_archive =  parseInt(res?.rows?.[0]?.count ?? 0, 10);
                return txnCount + txnCount_archive;
            }else{
                return txnCount;
            }
        } catch(e) {
            console.log("[TRANSACTIONS MODEL] error", e.message);
            throw(e);
        }    
    },
}

module.exports = Transactions;