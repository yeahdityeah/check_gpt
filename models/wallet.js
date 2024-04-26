// @ts-ignore
const bcrypt_p = require( 'bcrypt-promise' );
const jwt = require( 'jsonwebtoken' );
const{ TE, to, waitTimer } = require( '../services/util.service' );
const CONFIG = require( '../config/config' );
const knex = require( '../knex/knex.js' );
const knexReadOnly = require( '../knex/knex_readonly.js' );
const{ redisCaching } = require( '../services/cache.service' );
const{ promisify } = require( 'util' );
const lock = promisify( require( 'redis-lock' )( redisCaching.client ) );
const lodash = require( 'lodash' );

const Wallet = {
    getUserBonusCreditLimit: async ( userId ) => {
        try {
            const sql = `select * from user_bonus_credit_limit where userid=${userId} order by id desc limit 1;`;
            const res = await knex.raw(sql, { userId });
            return res.rows.length > 0 ? res.rows[0] : null;
        } catch(e) {
            console.log("[TRANSACTIONS MODEL] error", e.message);
            throw(e);
        }
    },
    allNewBonusCreditLimit: ( dataObj ) => {
        return knex.insert( dataObj, 'id' ).into( 'user_bonus_credit_limit' ).then( ( id ) => {
            return id;
        }).catch( err => {
            throw err;
        });
    }
};

module.exports = Wallet;