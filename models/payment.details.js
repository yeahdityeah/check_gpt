const knex = require( '../knex/knex.js' );
const knexReadOnly = require( '../knex/knex_readonly.js' );

const log = (...args)  => console.log('[PAYMENT_DETAILS]', ...args);

const PaymentDetails = {
    getPaymentDetailsByUserId: async (userId, source) => {
        try {
            const sql = `SELECT * FROM payment_details where userid = :userId and source = :source AND end_date = 'infinity' AND is_active = true`;
            const res = await knexReadOnly.raw(sql, { userId, source });
            return res?.rows?.[0] ?? false;
        } catch(e) {
            log('ERROR', e.message);
            return false;
        }        
    },
    removePaymentDetailsByUserId: async (userId, source) => {
        try {
            const updateSql = `
                UPDATE payment_details 
                SET is_active = false,
                end_date = NOW() 
                WHERE userid = :userId 
                AND source = :source 
                AND is_active = true
            `;
            const updateRes = await knex.raw(updateSql, { userId, source });
    
            // Check if any rows were affected
            if (updateRes?.rowCount > 0) {
                return true;
            } else {
                return false;
            }
        } catch (e) {
            log('ERROR', e.message);
            return false;
        }
    }
}

module.exports = PaymentDetails;