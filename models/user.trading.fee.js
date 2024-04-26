'use strict';
const knex = require( '../knex/knex.js' );
const TABLE_NAME = 'user_trading_fee';
const minIdToProcess = process.env.NODE_ENV === 'production' ? 12946396 : 17276;
const UserTradingFee = {
    insert: async( data ) => {
        if(typeof data !== 'object' || !data.userid || !data.eventid || !data.trading_fee) {
            throw new Error( 'Invalid data for user_trading_fee table' );
        }

        return knex.insert( data )
            .into( TABLE_NAME ).then( () => {
                //no-op
            } ).catch( err => {
                throw err;
            } );
    },

    getUserCount: async() => {
        return knex( 'users' )
            .count( 'id' )
            .whereNot( 'referrer_id', null )
            .then( ( total ) => {
                return parseInt( total[0].count );
            } ).catch( ( err ) => {
                throw err;
            } );
    },

    getReferrerEarnings: async( maxId, referrerId, minId ) => {
        return knex
        .select( knex.raw( 'SUM(referrer_payout_amount) as amount' ) )
        .from( TABLE_NAME )
        .where({ is_processed: false, 'referrer_id': referrerId })
        .where( 'id', '<=', maxId )
        .where( 'id', '>', minId )
        .then( function( resp ) {
            return resp[0];
        })
        .catch( function( error ) {
            throw error;
        });
    },
    getMaxIdWithPendingTradingFee: async() =>{
        return knex
        .select( knex.raw( 'max(id)' ) )
        .from( TABLE_NAME )
        .where({ is_processed: false })
        .where( 'id', '>', minIdToProcess)
        .then( function( resp ) {
            return resp[0];
        })
        .catch( function( error ) {
            throw error;
        });
    },
    getMaxIdOfProcessedReferral: async(referrer_id) =>{
        return knex
            .select( knex.raw( 'max(id)' ) )
            .from( TABLE_NAME )
            .where({ is_processed: true, referrer_id })
            .then( function( resp ) {
                return resp[0];
            })
            .catch( function( error ) {
                throw error;
            });
    },
    getDistinctReferrers: async( maxId ) => {
        return knex
        .select( knex.raw( 'distinct(referrer_id )') )
        .from( TABLE_NAME )
        .where({ is_processed: false })
        .where( 'id', '>', minIdToProcess)
        .where( 'id', '<=' , maxId)
        .then( function( resp ) {
            return resp;
        })
        .catch( function( error ) {
            throw error;
        });
    },
    getAllUserRewardAmount: async( maxId ) => {
        return knex
        .select( knex.raw( 'distinct on(referrer_id) sum(trading_fee) as reward, referrer_id' ) )
        .from( TABLE_NAME )
        .where({ is_processed: false })
        .where( 'id', '<=', maxId )
        .groupBy( 'referrer_id' )
        .then( function( resp ) {
            return resp;
        })
        .catch( function( error ) {
            throw error;
        });
    },
    updateIsProcessed: async( referrerId, maxId, maxIdAlreadyProcessed ) => {
        return knex( TABLE_NAME )
            .update( { is_processed: true, paidat: "now()" } )
            .where( 'referrer_id', referrerId )
            .where( 'id', '<=', maxId )
            .where( 'id', '>', maxIdAlreadyProcessed)
            .then( ( rs ) => {
                return rs;
            }, ( err ) => {
                throw err;
            } );
    },
    deleteUnprocessedOnCancel: async( eventid ) => {
        return knex( TABLE_NAME ).where({
            is_processed: false,
            eventid
        }).del(['id']).then( ( rs ) => {
            return rs;
        }, ( err ) => {
            throw err;
        });
    },
    getTradingFeeRecoveries: async ( eventId ) => {
        const sql = `select 
        referrer_id as "userId",
        round(
            sum(referrer_payout_amount)::numeric, 2
        ) as "totalRecovery"
    from user_trading_fee 
    where 
    eventid = :eventId and 
    is_processed = true
    group by referrer_id`;
    return knex
      .raw(sql, { eventId })
      .then((res) => {
        return res?.rows?.length > 0 ? res.rows : [];
      })
      .catch((e) => {
        console.log("ERROR IN getRecoverTradingFee", e);
        throw e;
      });
  },
  getEventTradingFeeRecoveries: async ( eventId ) => {
    const sql = `select
    referrer_id as "userId",
    round(
        sum(referrer_payout_amount)::numeric, 2
    ) as "totalRecovery"
    from event_referral_trading_fee
    where
    eventid = :eventId
    group by referrer_id`;
return knex
  .raw(sql, { eventId })
  .then((res) => {
    return res?.rows?.length > 0 ? res.rows : [];
  })
  .catch((e) => {
    console.log("ERROR IN getRecoverTradingFee", e);
    throw e;
  });
},
  getTdsEntries: async ( maxId, referrerId ) => {
    
    return knex
        .select( knex.raw( 'eventid as probe_id, sum(referrer_payout_amount) referrer_payout_amount' ) )
        .from( TABLE_NAME )
        .where({ is_processed: false, 'referrer_id': referrerId })
        .where( 'id', '<=', maxId )
        .where( 'id', '>', minIdToProcess)
        .groupBy('eventid')
        .then( function( resp ) {
            return resp?.length ? resp : [];
        })
        .catch( function( error ) {
            throw error;
        });
  },
  deleteEventTradingFee: async function (probeId) {
    if(!probeId || String(probeId).trim() === '') {
        console.log("SOFT DELETE event_referral_trading_fee Recieved empty / Undefined Probe ID")
        return []
    }
    try {
        const sql = `UPDATE event_referral_trading_fee SET is_deleted = true WHERE eventid = :probeId`
        const resp = await knex.raw(sql, { probeId })
        return resp?.rows?.length ? resp?.rows : [];
    } catch(e) {
        throw e;
    }
  },
  setIsDeleted: async function (probeId) {
    if(!probeId || String(probeId).trim() === '') {
        console.log("SOFT DELETE user_trading_fee Recieved empty / Undefined Probe ID")
        return []
    }
    try {
        const sql = `UPDATE ${TABLE_NAME} SET is_deleted = true WHERE eventid = :probeId`
        const resp = await knex.raw(sql, { probeId })
        return resp?.rows?.length ? resp?.rows : [];
    } catch(e) {
        throw e;
    }
  },
  didUserTrade: async function (userId) {
    try {
        const sql = `SELECT count(id) > 0 as trade_done from probecalls where userid = ? and createdat >= now() - '1 day'::interval`;
        const res = await knex.raw(sql, [userId]);
        return res?.rows?.[0]?.trade_done;
    } catch(e) {
        console.log("ERROR", e.message);
        return false;
    }
  }

};

module.exports = UserTradingFee;