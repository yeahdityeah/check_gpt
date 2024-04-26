const knex = require('../knex/knex.js');

const log = (...args) => console.log('[OTPLESS MODEL]', ...args);

const Otpless = {
    insertSession: async (data) => {
        try {
            const res = await knex('otpless').insert(data).returning('session_id');
            return res;
        } catch(e) {
            log(e);
            throw(e);
        }
    },
    getSessionByUid: async (uid) => {
        try {
            const raw = `uid = :uid and now() - created_at <= expires_in and status = 'START'`
            const res = await knex('otpless').select().where(knex.raw(raw, { uid }));
            console.log(res);
            return res?.[0] ?? false;
        } catch(e) {
            log(e);
            throw(e);
        }
    },
    getSessionById: async (session_id) => {
        try {
            const raw = `session_id = :session_id`
            const res = await knex('otpless').select().where(knex.raw(raw, { session_id }));
            console.log(res);
            return res?.[0] ?? false;
        } catch(e) {
            log(e);
            throw(e);
        }
    },
    validateSession: async (session_id) => {
        try {
            const sql = `SELECT * FROM otpless WHERE session_id = ? AND now() - created_at <= expires_in and status IN ('MESSAGE_RECEIVED')`;
            const res = await knex.raw(sql, [session_id]);            
            return res?.rows?.[0] ?? false;
        } catch(e) {
            log(e);
            throw(e);
        }
    },
    validateApprovedSession: async (session_id) => {
        try {
            const sql = `SELECT * FROM otpless WHERE session_id = ? AND now() - created_at <= expires_in and status IN ('APPROVED')`;
            const res = await knex.raw(sql, [session_id]);            
            return res?.rows?.[0] ?? false;
        } catch(e) {
            log(e);
            throw(e);
        }
    },
    updateSession: async ( session_id, data) => {
        try {
            if(!session_id) {
                log('No session Id passed');
                return {};
            }
            const res  = await knex('otpless').update(data).where({session_id})
            return res;
        } catch(e) {
            log(e);
            throw(e);
        }
    }
}

module.exports = Otpless;