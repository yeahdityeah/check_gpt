
const knex = require('../knex/knex_analytics.js');
const knexReadOnly = require('../knex/knex_readonly.js');
const { redisCaching } = require('../services/cache.service');
const { promisify } = require('util');
const lock = promisify(require('redis-lock')(redisCaching.client));
const Analytics = {
    getInvoiceInfo: (month, year, offset) => {
        let sqlQuery = 'SELECT a.* FROM (select * from monthly_invoice_data where month_num = ? and year_num = ? and total_invoice_value > 5 and email is not null) a LEFT JOIN invoice_logs b ON a.invoice_number = b.invoice_reference where b.invoice_reference is null order by a.userid limit 500';
        // let sqlQuery = `select * from monthly_invoice_data where month_num = ? and year_num = ? and total_invoice_value > 5 and email is not null order by userid limit 500 offset ?`;
        return knex.raw(sqlQuery, [month, year])
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getCountInvoice: (month, year) => {
        let sqlQuery = 'SELECT count(*) FROM (select * from monthly_invoice_data where month_num = ? and year_num = ? and total_invoice_value > 5 and email is not null) a LEFT JOIN invoice_logs b ON a.invoice_number = b.invoice_reference where b.invoice_reference is null';
        // let sqlQuery = `select count(*) from monthly_invoice_data where month_num = ? and year_num = ? and total_invoice_value > 5 and email is not null`;
        return knex.raw(sqlQuery, [month, year])
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getLatestEntryInvoiceLogs: () => {
        let sqlQuery = `SELECT * FROM invoice_logs where invoice_number is not null ORDER BY id DESC LIMIT 1`;
        return knex.raw(sqlQuery)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    enterInvoiceLogs: async (userList) => {
        try {
            let chunksize = userList.length;
            return knex.batchInsert('invoice_logs', userList, chunksize)
                .catch(function (error) { throw error; });
        } catch (err) {
            throw err;
        }
    },
    getLatestLiveStats: async (id) => {
        try {
            let sqlQuery = `select json_build_object(
                'text', stat_text, 
                'time', currenttime
            ) live from live_stats_5mins 
            where probeid::integer = ? 
            order by currenttime desc limit 1`;
            const res = await knex.raw(sqlQuery, [id])
            return res?.rows?.[0]?.live ?? false
        } catch(e) {
            console.log(`ERROR in fetching live stats for probe Id ${id}: `, e)
            return false;
        }
        
    },
    

};

module.exports = Analytics;