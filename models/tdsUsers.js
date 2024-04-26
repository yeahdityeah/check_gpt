'use strict';

const knex = require('../knex/knex');

const tableName = 'tds_users';

const TdsUsers = {
    getTdsData: async (whereObj) => {
        try {
            var resp = await knex(tableName).where(whereObj).limit(1)
            return resp;
        } catch (err) {
            throw err;
        }

    },
    getTdsRefund: async (probeId) => {
        try {
            const sql = `SELECT user_id as "userId", round(sum(tax_deducted)::numeric, 2) as "totalRefund"
             from tds_users 
             where probe_id = :probeId and is_processed_govt = false
             group by user_id
             having round(sum(tax_deducted)::numeric, 2)  >= 0.01`
            const resp = await knex.raw(sql, {
                probeId
            })
            return resp?.rows?.length ? resp.rows : [];
        } catch (err) {
            throw err;
        }
    },
    addTdsUsers: async function (data, trx) {
        if (trx){
            return trx.insert(data)
            .into(tableName).then((res) => {
                return res;
            }).catch(err => {
                throw err;
            });
        }
        return knex.insert(data)
            .into(tableName).then((res) => {
                return res;
            }).catch(err => {
                throw err;
            });
    },
    addBatchInsertTds: async function (data) {
        return knex.batchInsert(tableName, data, 1000)
            .returning('id')
            .then(function(ids) { ids })
            .catch(function(error) { throw(error)});
    },
    deleteTDS: async function (whereObj) {
        if(Object.keys(whereObj || {}).length === 0 ) {
            console.log("TRYING TO DELETE WITH EMPTY WHERE OBJ DANGEROUS OP")
            return []
        }
        return knex(tableName).where(whereObj).del();
    },
    deleteTDSonCancellation: async function (probeId) {
        try {
            if(!probeId || String(probeId).trim() === '') {
                console.log("DELETE TDS Recieved empty / Undefined Probe ID")
                return []
            }
            const sql = `DELETE FROM tds_users WHERE probe_id = :probeId and is_processed_govt = false`
            const resp = await knex.raw(sql, {
                probeId
            })
            return resp?.rows?.length ? resp.rows : [];
        } catch (err) {
            throw err;
        }
    }
};

module.exports = TdsUsers;
