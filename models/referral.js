'use strict';
const knex = require('../knex/knex.js');
const knexReadOnly = require('../knex/knex_readonly.js');
const { TRANSACTIONS } = require('../utils/constants.js');
const { executeTransactions } = require('./transactions.js');
const TABLE_NAME = 'user_trading_fee';
const User = require('./user.js');
const {performance} = require('perf_hooks');

const Referral = {
	totalReferralEarning: async (userid) => {

		let sqlQuery = `SELECT CASE WHEN 
							SUM(a.amount) IS null THEN 0 ELSE 
							SUM(a.amount) END AS total_referral_earning 
						FROM transactions a 
						WHERE 
							a.userid = ${userid} AND 
							a.txnid LIKE 'RFR%'`;

		return knex.raw(sqlQuery)
			.then((res) => {
				return res['rows'][0];
			}).catch((err) => {
				throw err;
			});
	},
	totalReferralPromoEarning: async (userid) => {

		let sqlQuery = `SELECT CASE WHEN 
							SUM(a.amount) IS null THEN 0 ELSE 
							SUM(a.amount) END AS total_referral_promo_earning 
						FROM transactions a 
						WHERE 
							a.userid = ${userid} AND 
							a.txnid LIKE 'RFLC%'`;

		return knex.raw(sqlQuery)
			.then((res) => {
				return res['rows'][0];
			}).catch((err) => {
				throw err;
			});
	},
	getTotalReferrerEarnings: async( referrerId ) => {
        return knex
        .select( knex.raw( 'SUM(referrer_payout_amount) as amount' ) )
        .from( TABLE_NAME )
        .where({  'referrer_id': referrerId, is_deleted: false })
        .then( function( resp ) {
            return resp[0];
        })
        .catch( function( error ) {
            throw error;
        });
    },
	getTotalReferrerEarningsTx: async ( referrerId ) => {
		const sql = `
			SELECT
				(
					SELECT COALESCE(sum(amount), 0)
					FROM transactions WHERE userid = :referrerId AND txnid ~* '^RFR' AND message ~* '^A part of'
				) +
				(
					SELECT COALESCE(sum(amount), 0)
					FROM transactions_archive WHERE userid = :referrerId AND txnid ~* '^RFR' AND message ~* '^A part of'
				) as amount
		`;
		const res = await knex.raw(sql, {
			referrerId
		});
		return res?.rows?.[0]?.amount ?? Number(0);
    },
	getUnprocessedReferrerEarnings: async( referrerId ) => {
        return knex
        .select( knex.raw( 'SUM(referrer_payout_amount) as amount' ) )
        .from( TABLE_NAME )
        .where({  'referrer_id': referrerId, is_deleted: false, is_processed: false })
        .then( function( resp ) {
            return resp[0];
        })
        .catch( function( error ) {
            throw error;
        });
    },

	getTotalRedeemedAmount: async( referrerId ) => {
        return knex
        .select( knex.raw( 'SUM(referrer_payout_amount) as amount' ) )
        .from( TABLE_NAME )
        .where({  'referrer_id': referrerId, is_processed: true, 'referrer_id': referrerId, is_deleted: false })
        .then( function( resp ) {
            return resp[0];
        })
        .catch( function( error ) {
            throw error;
        });
    },

	referralEarningLastWeek: async (userid) => {

		let sqlQuery = `SELECT CASE WHEN 
							SUM(a.amount) IS null THEN 0 ELSE 
							SUM(a.amount) END AS last_week_earning 
						from transactions a 
						WHERE 
							a.userid = ${userid} AND 
							a.txnid LIKE 'RFR%' AND 
							a.createdat::date = (SELECT date_trunc('week', NOW())::date - 1)`;

		return knex.raw(sqlQuery)
			.then((res) => {
				return res['rows'][0];
			}).catch((err) => {
				throw err;
			});
	},

	totalReferredUsers: async (userid) => {

		let sqlQuery = `SELECT COUNT(id)::INT AS total_referred_users 
						FROM users a 
						WHERE 
							a.referrer_id = ${userid}`;

		return knex.raw(sqlQuery)
			.then((res) => {
				return res['rows'][0];
			}).catch((err) => {
				throw err;
			});
	},

	referredUsersThisWeek: async (userid) => {

		let sqlQuery = `SELECT COUNT(*)::INT AS referred_users_week 
						FROM users a 
						WHERE 
							a.referrer_id = ${userid} AND
							a.createdat > (SELECT date_trunc('week', NOW())::date - 2)`;

		return knex.raw(sqlQuery)
			.then((res) => {
				return res['rows'][0];
			}).catch((err) => {
				throw err;
			});
	},

	updateEventReferral: async (referredBy, clickedBy, eventId) => {
        try {
            const dataObj = {
                referred_by_user: referredBy,
                clicked_by_user: clickedBy,
                probeid: eventId,
                is_processed: false
            }
            var res = await knex('eventreferral').insert(dataObj).returning(['id']);
            return res;
            } catch (e) {
            throw e;
            }
    },

	getEventReferralsWithSum: async () => {
        let sqlQuery = `
		WITH referral AS (
			SELECT p.id,
				   p.referred_by_user,
				   p.clicked_by_user,
				   p.probeid,
				   p.created_at as referred_at,
				   p.is_processed,
				   ROW_NUMBER()
	OVER(PARTITION BY p.referred_by_user, p.clicked_by_user, p.probeid
										 ORDER BY p.id asc) AS rank
			  FROM eventreferral p where
	created_at >= (SELECT date_trunc('day', NOW())::date - 2) and
	created_at < (SELECT date_trunc('day', NOW())::date - 1)
),
expected as (
		SELECT *
		   FROM referral
		WHERE rank = 1 and is_processed=false
	), transactions as (
			select expected.id as referral_id, referred_by_user, userid as clicked_by_user, probeid, sum(surcharge) from transactions t
		inner join expected on (
			clicked_by_user = t.userid and
			txnid ~* '^(P1|EX1|P11|S1)' and
			cast(right(txnid, length(txnid) - position('0' in txnid)+1) as bigint) = probeid
		)
		where
		      createdat >= referred_at and  (createdat - referred_at) <= INTERVAL '1 day'

		group by referral_id, userid, probeid, referred_by_user
		having sum(surcharge)  >= 0.10
	), exepcted_t as (
		select * from transactions
	)
	select * from exepcted_t
		`;
		return knexReadOnly.raw(sqlQuery)
			.then((res) => {
				return res['rows'];
			}).catch((err) => {
				console.log(err)
				throw err;
			});
    },

	updateEventReferralDetails: async (commissionData, tdsData, tdsUserData, referralIds) => {
		try {
			await knex.transaction(async (trx) => {
				const startTime = performance.now()
				const results = await executeTransactions([
					{...commissionData, action: TRANSACTIONS.referralEventSharingFee },
					{...tdsData, action: TRANSACTIONS.referralTds },
				], false, trx)
				tdsUserData.transaction_id = results?.[0]?.transactionId
				tdsUserData.txnid_tds_id = results?.[1]?.transactionId
				await trx('tds_users').insert(tdsUserData)
				const eventReferralEndTime = performance.now()
				console.log(`Eventreferral update time taken: ${parseInt(eventReferralEndTime - startTime)} milliseconds `)
			})
		} catch(err) {
			throw err;
		}
	},

	insertEventTrading: async (dataObjs) => {
		try {
            let chunksize = 100;
            return knex.batchInsert('event_referral_trading_fee', dataObjs, chunksize)
                .catch(function (error) { throw error; });
        } catch (err) {
            throw err;
        }
	},
	getTotalReferingUsers: async function () {
        let sqlQuery = `select count( distinct referrer_id) from user_trading_fee where is_deleted = false`;
        return knexReadOnly.raw(sqlQuery)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
	getReferingUsersInfo: async function (offset) {
        // let sqlQuery = `select * from (SELECT  referrer_id, SUM(referrer_payout_amount) as amount FROM user_trading_fee WHERE is_deleted = false GROUP BY referrer_id ORDER BY referrer_id) a LEFT JOIN (select id, displayname, email, mobile from users ) b ON a.referrer_id = b.id limit 500 offset ?`;
		let sqlQuery = 'select * from (SELECT  referrer_id, SUM(referrer_payout_amount) as amount FROM user_trading_fee WHERE is_deleted = false GROUP BY referrer_id ORDER BY referrer_id) a LEFT JOIN (select id, displayname, email, mobile from users ) b ON a.referrer_id = b.id left join (SELECT referrer_id, COUNT(*)::INT AS total_referred_users FROM users group by referrer_id ) c on a.referrer_id = c.referrer_id limit 500 offset ?'
        return knexReadOnly.raw(sqlQuery, [offset])
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
	getModelConfig: async(model_id) =>{
        return knexReadOnly
            .select( knex.raw( '*' ) )
            .from( 'referral_model' )
            .where({ model_id: model_id })
            .then( function( resp ) {
                return resp[0];
            })
            .catch( function( error ) {
                throw error;
            });
    },
	getDistinctReferrers: async () => {

        return knexReadOnly
	        .select( knexReadOnly.raw('*') )
    	    .from( 'referral_model_user' )
        	.where({ active: true  })
        	.then( function( resp ) {
            	return resp;
        	})
        	.catch( function( error ) {
            	throw error;
        	});
    },
	getReferrerReward: async (startDate, config) => {
        try {
            let sqlQuery = `
				SELECT 
					(:startDate)::timestamptz + (reward ->> 'fromDay')::interval as from,
					(:startDate)::timestamptz + (reward ->> 'toDay')::interval as to,
					(reward ->> 'toDay')::interval as today, (reward ->> 'percent') as percent
				FROM json_array_elements(:config) reward`
            var res = await knexReadOnly.raw(sqlQuery, {
				startDate,
				config: JSON.stringify(config)
			});
            return res.rows.length ? res.rows : false;
        } catch (e) {
            throw e;
        }
    },
	getTotalAmountCreditForReferrer: async (userid, model_id) => {
        try {
            let sqlQuery = `select COALESCE(SUM(amount_credit), 0) as total FROM referral_model_job 
							where userid = ? and model_id = ? group by userid`;
            var res = await knexReadOnly.raw(sqlQuery, [userid, model_id]);
            return res.rows.length?res.rows[0].total: 0;
        } catch (e) {
            throw e;
        }
    },
	getLastProcessedTxnId: async (userid, model_id) => {
        try {
            let sqlQuery = `select processed_id FROM referral_model_job 
							where userid = ? and model_id = ? and status = 'success' order by id desc limit 1`;
            var res = await knexReadOnly.raw(sqlQuery, [userid, model_id]);
            return res.rows.length?res.rows[0].processed_id: null;
        } catch (e) {
            throw e;
        }
    },
	getDistinctRefereesFromUsersForSignup: async( userid, last_userid_processed, start_date, end_date) => {
        return knexReadOnly
        .select( knex.raw( 'id as referee, 10 as amount, createdat as ts ') )
        .from( 'users' )
        .where({ referrer_id: userid })
		.where( 'id' , '>', last_userid_processed )
		.where( 'createdat' , '<=', end_date )
		.where( 'createdat' , '>=', start_date )
		.orderBy ('id', 'asc')
        .then( function( resp ) {
            return resp;
        })
        .catch( function( error ) {
            throw error;
        });
    },
	insertJobStatus: async ( dataObj ) => {
		return knex.insert(dataObj, 'id').into('referral_model_job').then((id) => {
			return id.length > 0 ? parseInt(id[0]) : null
		}).catch(err => {
			throw err;
		});
	},
	getDistinctRefereesFromUsers: async( userid, last_userid_processed) => {
        return knexReadOnly
        .select( knex.raw( 'distinct( id )') )
        .from( 'users' )
        .where({ referrer_id: userid })
		.orderBy ('id', 'desc')
        .then( function( resp ) {
            return resp;
        })
        .catch( function( error ) {
            throw error;
        });
    },
	getAmountToBeCredited: async (referees, txnIdPattern, lastProcessedId, startDate, endDate, minTransactionAmount) => {
        try {
            let sqlQuery = `
			 SELECT 
					t.amount, COALESCE(tml.amount, 0) + t.surcharge as surcharge, t.id, t.userid as referee, t.createdat as ts
			 FROM transactions   t
			 left outer join transaction_lpc tml using (id) 
			 inner join transaction_breakup tb using (id)
			 where 
			 t.userid = any (SELECT k::bigint from json_array_elements_text(:referees) k) AND
			 tb.probeid NOT IN (SELECT id from probes where probe_type = 'promo') AND
			 txnid ~* :txnIdPattern AND
			 t.id > :lastProcessedId AND
			 t.amount >= :minTransactionAmount AND
			 t.createdat >= :startDate AND
			 t.createdat <= :endDate order by id`;
console.log(knexReadOnly.raw(sqlQuery, {
				referees: JSON.stringify(referees),
				txnIdPattern,
				lastProcessedId,
				minTransactionAmount,
				startDate,
				endDate
			}).toSQL().toNative().sql)
			//process.exit(0);
            var res = await knexReadOnly.raw(sqlQuery, {
				referees: JSON.stringify(referees),
				txnIdPattern,
				lastProcessedId,
				minTransactionAmount,
				startDate,
				endDate
			});
            return res.rows || [];
        } catch (e) {
            throw e;
        }
    },
	enterReferralJobDetails: async (userList) => {
        try {
            let chunksize = Math.min(userList.length, 50);
            return knex.batchInsert('referral_model_job_details', userList, chunksize)
                .catch(function (error) { throw error; });
        } catch (err) {
            throw err;
        }
    },
	updateReferrerInactive: async (userId, modelId) => {
		try {
			const sql = `UPDATE referral_model_user SET active = false WHERE userid = :userId and model_id = :modelId`;
			return knex.raw(sql, {
				userId, modelId
			});
		} catch(e) {
			throw e;
		}
	},
	getProcessedReferees: async (userId, modelId) => {
        try {
            let sqlQuery = `
			select json_object_agg(distinct(referee), true) as resp
			from referral_model_job_details where userid = :userId AND
			job_id in (select id from referral_model_job where status = 'success' and model_id = :modelId )`;
            var res = await knex.raw(sqlQuery, {
				userId, modelId
			});
            return res.rows.length ? res?.rows[0].resp : {};
        } catch (e) {
            throw e;
        }
    }

}

module.exports = Referral;
