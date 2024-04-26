'use strict';

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

const Level = {
    addUserLevel: ( dataObj ) => {
        return knex.insert( dataObj, 'id' ).into( 'level_user' ).then( ( id ) => {
            return id;
        }).catch( err => {
            throw err;
        });
    },
    getUsersLevel: async( level_ids, useReadOnly = true ) => {
        try {
            const knexClient = useReadOnly === true ? knexReadOnly : knex;
            const sqlQuery = `SELECT userid
                              FROM level_user
                              WHERE level_id in (${level_ids.join(",")}) `;
            const res = await knexClient.raw( sqlQuery );
            return res.rows.length > 0 ? res.rows : [];
        } catch( e ) {
            throw e;
        }
    },
    updateUserLevel: (userid, level_id) => {
        return knex('level_user')
            .where({ userid: userid, is_active: true })
            .update({ level_id: level_id })
            .then((updatedRows) => {
                if (updatedRows > 0) {
                    return true;
                } else {
                    return false
                }
            })
            .catch((err) => {
                throw err;
            });
    },
    

};

module.exports = Level;
