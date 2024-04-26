'use strict';

// @ts-ignore
const bcrypt_p = require('bcrypt-promise');
const jwt = require('jsonwebtoken');
const { TE, to, waitTimer } = require('../services/util.service');
const CONFIG = require('../config/config');
const knex = require('../knex/knex.js');
const knexReadOnly = require('../knex/knex_readonly.js');
const { redisCaching } = require('../services/cache.service');
const { promisify } = require('util');
const lock = promisify(require('redis-lock')(redisCaching.client));
const lodash = require('lodash');
const logger = require("../services/logger.service");


const User = {
    updateCoupon: async (userId, coupon) => {
        try {
            await knex('users')
                .where({ id: userId })
                .update({ coupon: coupon });
        } catch (e) {
            throw e;
        }
    },

    getReferralEligibility: async (userId) => {
        try {
            const sqlQuery = `SELECT id FROM 
                                ( SELECT id   FROM probecalls x
                                    WHERE 
                                        x.userid = ${userId} AND
                                        x.status NOT IN ('CN', 'I')
                                UNION
                                    SELECT  id FROM probecallsopen y
                                    WHERE
                                        y.userid = ${userId}
                                        
                                UNION
                                    SELECT id FROM history h
                                    WHERE 
                                        h.userid = ${userId}
                                LIMIT 1
                            )a `;
            const res = await knexReadOnly.raw(sqlQuery);
            return res.rows;
        } catch (e) {
            throw e
        }
    },
    deleteFcmToken: async (userId) => {
        try {
            await knex('users')
                .where({ id: userId })
                .update({ fcmtoken: null });
        } catch (e) {
            throw e;
        }
    },
    getWallet: async (whereObj) => {
        try {
            var resp = await knex('wallet').where(whereObj).limit(1)
            return resp;
        } catch (e) {
            throw e;
        }
    },
    getWalletBalance: async (userId, useReadOnly, schema = 'public') => {
        try {
            if (!userId) {
                throw new Error('userId must not be a falsy value');
            }
            const knexClient = useReadOnly === true ? knexReadOnly : knex;
            const sqlQuery = `SELECT * FROM :schema:.wallet_new WHERE userid = :userId ORDER BY id DESC limit 1`;
            const res = await knexClient.raw(sqlQuery, { userId, schema });
            return res.rows[0];
        } catch (e) {
            throw e;
        }
    },
    getContestUserEventBalance: async (userId, fantasyId, useReadOnly, schema = 'fantasy') => {
        try {
            if (!userId) {
                throw new Error('userId must not be a falsy value');
            }
            const knexClient = useReadOnly === true ? knexReadOnly : knex;
            const sqlQuery = `SELECT * FROM :schema:.wallet WHERE userid = :userId and fantasy_type = 'contest' and fantasy_id = :fantasyId ORDER BY id DESC limit 1`;
            const res = await knexClient.raw(sqlQuery, { schema, userId, fantasyId });
            return res.rows[0];
        } catch (e) {
            throw e;
        }
    },
    getWalletBalanceAfterTime: async (userId, useReadOnly, timeStamp) => {
        try {
            if (!userId) {
                throw new Error('userId must not be a falsy value');
            }
            const knexClient = useReadOnly === true ? knexReadOnly : knex;
            const sqlQuery = `SELECT * FROM wallet_new WHERE userid = ? and createdat <= ? ORDER BY id DESC limit 1`;
            const res = await knexReadOnly.raw(sqlQuery, [userId, timeStamp]);
            // if (res.rows.length == 0) {
            //     const sqlQueryArchive = `SELECT * FROM wallet_new_archive WHERE userid = ? and createdat <= ? ORDER BY id DESC limit 1`;
            //     const resArchive = await knexReadOnly.raw(sqlQueryArchive, [userId, timeStamp]);
            //     return resArchive.rows.length > 0 ? resArchive.rows[0] : undefined;
            // }
            return res.rows.length > 0 ? res.rows[0] : undefined;
        } catch (e) {
            throw e;
        }
    },
    getUserDeviceId: async function (userId) {
        let sqlQuery = `select deviceuuid from deviceid where userid = ?`;
        let pArray = [userId];
        return knexReadOnly.raw(sqlQuery, pArray)
            .then((res) => {
                return res['rows'][0];
            }).catch((err) => {
                throw err;
            });
    },
    putUserDeviceId: async function (userId, deviceID) {
        try {
            var sqlQuery = `insert into deviceid (userid, deviceuuid) VALUES (?, ?)`;
            var res = await knex.raw(sqlQuery, [userId, deviceID]);
            return res.rows;
        } catch (e) {
            throw e;
        }
    },
    findById: async (userId, useReadOnly, updateUpdatedAt) => {
        try {
            const knexClient = useReadOnly === true ? knexReadOnly : knex;
            // if (updateUpdatedAt) {
            //     await knex('users')
            //         .where({ id: userId })
            //         .update({ updatedat: 'now()' });
            // }
            let sqlQuery = `SELECT a.*, CASE 
            WHEN c2.region <> 'INDIA' THEN 'REST_OF_WORLD'
            ELSE c2.region
            END as region, c2.isd_code, c2.region as region_code, b.coinsd, b.coinsb, b.coinsw, b.coinsp, 0 as locked_amount, b.userid, json_build_object('name', c.name, 'dob', c.dob, 'number', c.number, 'type','PAN') as kycdetails,
            case when d.status = 'A' then d.wallet_address end wallet_address
			FROM users a 
			JOIN wallet_new b ON b.userid = a.id
			LEFT JOIN kycdetails c ON c.userid = a.id
            LEFT JOIN crypto_wallet_address d on d.userid = a.id
            join country c2 on a.signup_country = c2.iso_code
			WHERE a.id = ? and a.userstatus = 'A'
            ORDER  BY b.id DESC limit 1`;

            var res = await knexClient.raw(sqlQuery, [userId]);
            return res.rows[0];
        } catch (e) {
            throw e;
        }
    },
    getFrom: async (table, whereObj) => {
        try {
            var res = await knex('users').where(whereObj).limit(1);
            return res;
        } catch (e) {
            throw e;
        }

    },
    getUserCount: async function () {
        let sqlQuery = `select count(*) from users`;
        return knex.raw(sqlQuery)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    enterOpeningBalance: async (userList) => {
        try {
            let chunksize = userList.length;
            return knex.batchInsert('opening_balance', userList, chunksize)
                .catch(function (error) { throw error; });
        } catch (err) {
            throw err;
        }
    },
    get: async (table, wherObj) => {
        try {
            let _arr = [];
            let whrStr = '';
            if (wherObj['mobile']) {
                whrStr += ` a.mobile = ? `;
                _arr.push(wherObj['mobile']);
            }
            if (wherObj['email']) {
                whrStr += ` a.email = ?  `;
                _arr.push(wherObj['email']);
            }
            if (wherObj['apple_userid']) {
                whrStr += ` a.apple_userid = ?  `;
                _arr.push(wherObj['apple_userid']);
            }
            if (wherObj['partner']) {
                whrStr += ` and a.partner = ?  `;
                _arr.push(wherObj['partner']);
            }
            let sqlQuery = `SELECT a.*  
				FROM users a 
				WHERE a.userstatus = 'A'
                and ${whrStr}`;
            var res = await knex.raw(sqlQuery, _arr);

            let res1;
            if (res.rows.length > 0) {
                const user = res.rows[0];
                const query = `Select a.coinsd, a.coinsb, a.coinsw, a.locked_amount, a.userid, json_build_object('name', b.name, 'dob', b.dob, 'number', b.number, 'type', 'PAN') as kycdetails
							   from wallet as a
							   Left Join kycdetails b ON b.userid = a.userid
							   where a.userid =${user.id}
							   order by a.createdat Desc Limit 1`;
                res1 = await knex.raw(query);
            }
            if (res && res1 && res.rows && res1.rows) {
                res.rows = [Object.assign({}, res.rows[0], res1.rows[0])];
            }
            // res.rows = [Object.assign({}, res.rows[0], res1.rows[0])]

            return res.rows;
        } catch (e) {
            throw e;
        }
    },
    addBankDetails: async (dataObj) => {
        try {
            var res = await knex('bankdetails').insert(dataObj).returning(['userid', 'rp_fundid', 'rp_ba_active', 'rp_vpa_active', 'vpa', 'ifsc', 'accountnumber', 'cg_beneid', 'bankname']);
            return res;
        } catch (e) {
            throw e;
        }
    },
    removeBankDetails: async (userid, beneid) => {
        return knex('bankdetails')
            .where('userid', userid)
            .where('cg_beneid', beneid)
            .del()
            .then((res) => {
                return res;
            }, err => { throw err; });
    },
    updateBankDetails: async (dataObj) => {
        try {
            let newObj = Object.assign({}, dataObj);
            delete newObj['userid'];
            var res = await knex('bankdetails').update(newObj).where({ 'userid': dataObj['userid'] }).returning(['userid', 'rp_fundid', 'rp_ba_active', 'rp_vpa_active', 'vpa', 'ifsc', 'accountnumber']);
            return res;
        } catch (e) {
            throw e;
        }
    },
    getDepositedAmountByUserId: async (userId) => {
        try {
            if (!userId) {
                throw new Error('User ID must not be a falsy value');
            }
            const query = `select sum(amount)::float as total_deposit from payments where paymentid is not null and userid = ${userId}`;
            const res = await knexReadOnly.raw(query);
            return res.rows[0];
        } catch (e) {
            throw e;
        }
    },
    getDepositedAmountByUserIdArchive: async (userId) => {
        try {
            if (!userId) {
                throw new Error('User ID must not be a falsy value');
            }
            const query = `select sum(amount)::float as total_deposit from payments_archive where paymentid is not null and userid = ${userId}`;
            const res = await knexReadOnly.raw(query);
            return res.rows[0];
        } catch (e) {
            throw e;
        }
    },
    getBankDetails: async (userId) => {
        try {
            var res = await knexReadOnly('bankdetails')
                .join('users', 'users.id', '=', 'bankdetails.userid')
                .join('kycdetails', 'kycdetails.userid', '=', 'bankdetails.userid')
                .where({ 'bankdetails.userid': userId });
            return res[0];
        } catch (e) {
            throw e;
        }
    },
    getBankDetailsArray: async (userId) => {
        try {
            var res = await knexReadOnly('bankdetails')
                .join('users', 'users.id', '=', 'bankdetails.userid')
                .join('kycdetails', 'kycdetails.userid', '=', 'bankdetails.userid')
                .where({ 'bankdetails.userid': userId });
            //return res[0]
            return res;
        } catch (e) {
            throw e;
        }
    },
    getCryptoWalletAddress: async function (userId) {
        let sqlQuery = `select * from crypto_wallet_address where userid = ? and status = 'A'`;
        let pArray = [userId];
        return knexReadOnly.raw(sqlQuery, pArray)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getUserIdFromCryptoWalletAddress: async function (wallet_address) {
        let sqlQuery = `select * from crypto_wallet_address where wallet_address = ?`;
        let pArray = [wallet_address];
        return knex.raw(sqlQuery, pArray)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    addCryptoWalletAddress: (userId, walletAddress) => {
        let dataObj = { 'userid': userId, 'wallet_address': walletAddress, 'status': 'A' };
        return knex('crypto_wallet_address').insert(dataObj).returning(['userid', 'wallet_address']);
    },
    getPennyDropStatusTruncateZero: async function (accountNumber, ifsc, partnerId) {
        let sqlQuery = `select * from bank_details_verif_status where accountnumber like '%${accountNumber}' and partner = ${partnerId}`;
        // let pArray = [ifsc, accountNumber];
        return knexReadOnly.raw(sqlQuery)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getPennyDropStatus: async function (accountNumber, ifsc, partnerId) {
        let sqlQuery = `select * from bank_details_verif_status where accountnumber = ? and partner = ?`;
        // let pArray = [ifsc, accountNumber];
        let pArray = [accountNumber, partnerId];
        return knexReadOnly.raw(sqlQuery, pArray)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getKycApprovalStatus: async function (userId, accountNumber) {
        let sqlQuery = `select * from bank_details_verif_status where userid = ? and accountnumber = ?`;
        // let pArray = [ifsc, accountNumber];
        let pArray = [userId, accountNumber];
        return knexReadOnly.raw(sqlQuery, pArray)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    putBankEqPan: async function (userId, accountNumber, ifsc, toUpdate, partnerId) {
        try {
            var resp = await knex('bank_details_verif_status')
                .update({ bankeqpanname_status: toUpdate })
                .where({ userid: userId, accountnumber: accountNumber, ifsc: ifsc, partner: partnerId })
                .returning(['userid', 'accountnumber', 'ifsc', 'bankeqpanname_status']);
            return resp;
        } catch (e) {
            throw e;
        }
    },
    approveKYC: async function (userId, accountNumber, ifsc, status, partnerId) {
        try {
            var resp = await knex('bank_details_verif_status')
                .update({ approval_status: status })
                .where({ userid: userId, accountnumber: accountNumber, ifsc: ifsc, partner: partnerId })
                .returning(['userid', 'accountnumber', 'ifsc', 'approval_status']);
            return resp;
        } catch (e) {
            throw e;
        }
    },
    getBankVerif: async function (ids) {
        let sql = `SELECT * FROM bank_details_verif_status WHERE id in (${ids.join(',')})`;
        return knexReadOnly.raw(sql)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    approveRejectKYC: async (id, status) => {
        try {
            var resp = await knex('bank_details_verif_status')
                .update({ approval_status: status })
                .where({ id: id })
            return resp;
        } catch (e) {
            throw e;
        }
    },
    addPennyDropStatus: async (dataObj) => {
        return knex('bank_details_verif_status').insert(dataObj).returning(['userid', 'accountnumber', 'ifsc']);
    },
    getTemp: async (wherObj) => {
        try {
            var res = await knexReadOnly('tempusers').where(wherObj);
            return res;
        } catch (e) {
            throw e;
        }
    },
    updateTemp: async (whereObj, dataObj, partner) => {
        try {
            var resp = await knex('tempusers')
                .update(dataObj)
                .where({ mobile: whereObj['mobile'], country_code: whereObj['country_code'] ?? null, partner: partner })
                .returning(['mobile', 'attempt']);
            return resp;
        } catch (e) {
            throw e;
        }
    },
    getFromDeviceId: (dataObj) => {
        let sqlQuery = `select * from deviceid where userid = ? and deviceuuid = ? order by id desc limit 1`;
        let pArray = [dataObj['userid'], dataObj['deviceuuid']];
        return knexReadOnly.raw(sqlQuery, pArray)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    addToDeviceId: (dataObj) => {
        return knex('deviceid').insert(dataObj).returning(['userid', 'deviceuuid']);
    },
    addToUsersIp: (dataObj) => {
        return knex('users_ip').insert(dataObj).returning(['userid', 'location']);
    },

    updateEmailVerified: async (email_id, userId, verify) => {
        try {
            var resp = await knex('users')
                .update({ email: email_id, isEmailVerified: verify })
                .where({ id: userId })
                .returning(['id', 'email', 'mobile', 'displayname', 'kycstatus', 'isEmailVerified']);
            return resp;
        } catch (e) {
            throw e;
        }
    },
    updateMobileVerified: async (mobile, mobile_code, userId, verify) => {
        try {
            var resp = await knex('users')
                .update({ mobile: mobile, mobile_code: mobile_code, is_mobile_verified: verify })
                .where({ id: userId })
                .returning(['id', 'email', 'mobile', 'displayname', 'kycstatus', 'isEmailVerified']);
            return resp;
        } catch (e) {
            throw e;
        }
    },
    getExistingEmail: async (userId, email_id, partnerId) => {
        try {
            var resp = await knexReadOnly('users')
                .where({ email: email_id })
                .where({ isEmailVerified: true })
                .where({ partner: partnerId })
                .where('id', '!=', userId);
            return resp;
        } catch (e) {
            throw e;
        }
    },

    updatePreferenceTable: async (whereObj, dataObj) => {
        if (whereObj) {
            await knex('preferences').where(whereObj).del();
        }

        return knex('preferences').insert(dataObj).onConflict(["userid", "preference_type"]).ignore().returning(['userid', 'preference_type', 'preference_value'])
    },
    getPreferenceEmail: async (whereCond) => {
        var res = await knexReadOnly('preferences').where(whereCond);
        return res;
    },
    deleteTempUser: async (wherObj) => {
        try {
            var res = await knex('tempusers').where(wherObj).del();
            return res;
        } catch (e) {
            throw e;
        }
    },
    getUsers: (whereObj) => {
        const pageNo = whereObj['page'];
        const noOfResults = 100;
        const offSet = ((pageNo || 1) - 1) * noOfResults;
        let lastId = whereObj['lastid'] || 9999999;
        let whereStr = `WHERE 1=1 `;
        let _paramsArr = [];
        if (whereObj['kycstatus']) {
            whereStr += ' AND a.kycstatus = ? ';
            _paramsArr.push(whereObj['kycstatus']);
        }
        if (whereObj['id']) {
            whereStr += ' AND a.id = ? ';
            _paramsArr.push(whereObj['id']);
        } if (whereObj['name']) {
            whereStr += ` AND a.displayname LIKE '%?%' `;
            _paramsArr.push(knex.raw(whereObj['name']));
        } if (whereObj['email']) {
            whereStr += ` AND a.email LIKE '%?%' `;
            _paramsArr.push(knex.raw(whereObj['email']));
        } if (whereObj['mobile']) {
            whereStr += ` AND a.mobile LIKE '%?%' `;
            _paramsArr.push(knex.raw(whereObj['mobile']));
        } if (whereObj['isBlockedUsers'] === true) {
            whereStr += ` AND a.id in (SELECT userid from blocked_users)`;
        } if (whereObj['isBlockedUsers'] === false) {
            whereStr += ` AND a.id not in (SELECT userid from blocked_users)`;
        } if (whereObj['partner']) {
            whereStr += ' AND a.partner = ? ';
            _paramsArr.push(whereObj['partner']);
        }

        _paramsArr.push(noOfResults);
        _paramsArr.push(offSet);
        const columns = ` a.*, b.coinsd, b.coinsb, b.coinsw, b.userid, json_build_object('name', c.name, 'dob', c.dob, 'photo', c.photo, 'number', c.number, 'type','PAN') as kycdetails `;
        const joins = ` JOIN (select distinct ON (userid) * from wallet_new order by userid, createdat desc) as b ON a.id = b.userid 
						LEFT  JOIN kycdetails c ON c.userid = a.id`;
        const limitOffSet = ` LIMIT ? OFFSET ? `;
        const orderBy = ` ORDER BY a.id DESC`;
        const sqlQuery = `SELECT ${columns}  
						FROM users a
						${joins}
						${whereStr}
						AND a.id < ${lastId}
						${orderBy}
						${limitOffSet}`;
        const countQuery = `select count(a.id) from users a ${joins} ${whereStr} AND a.id < ${lastId}`;
        return knexReadOnly.raw(countQuery, _paramsArr.slice(0, _paramsArr.length - 2))
            .then((resp) => {
                const totalCount = resp.rows[0];
                return knex.raw(sqlQuery, _paramsArr)
                    .then((res) => {
                        return { total: totalCount, rows: res['rows'] };
                    }).catch((err) => {
                        throw err;
                    });
            }).catch((err) => {
                throw err;
            });
    },
    getMessagess: (dataObj) => {
        let lastId = dataObj['lastid'] || 9999999;
        let sqlQuery = `select * from messages where userid = ? and id < ? order by id desc limit 40`;
        return knex.raw(sqlQuery, [dataObj['userid'], lastId])
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getLastRecharge: (dataObj) => {
        let sqlQuery = `select id from transactions where userid = ? and txnid like 'PM%' order by id desc limit 1`;
        let pArray = [dataObj['userid']];
        return knexReadOnly.raw(sqlQuery, pArray)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },

    getTransactions: (data, schema = 'public', readOnly = true) => {

        let limitq = ``;

        let whereClause = ` WHERE t.userid = ?`;
        let pArray = [data['userid']];

        if (data['txnid']) {
            whereClause += ` AND txnid = ?`;
            pArray.push(data['txnid']);
        }

        if (data['latest']) {
            whereClause += ` AND id > ?`;
            pArray.push(data['latest']);
        }

        if (data['oldest']) {
            whereClause += ` AND id < ?`;
            pArray.push(data['oldest']);
        }

        if (data['probeid']) {
            whereClause += ` AND txnid ~* '^(P1|EX|MG|CN|S1|RF1)' AND cast(right(txnid, length(txnid) - position('0' in txnid)+1) as bigint )=? `;
            pArray.push(data['probeid']);
        }

        if (data['limit']) {
            limitq = `LIMIT ?`;
            pArray.push(data['limit']);
        }

        whereClause += ` AND NOT (txnid ~* '^(PCR|PDB)')`;
        const orderBy = ` ORDER BY id DESC`;
        // let sqlSubQuery = `select case when wallettype ='B' then 'B' else 'D' end wallettype, id, userid, amount, surcharge, type, txnid, message, createdat from transactions where userid = ? order by id desc`;

        let sqlQuery = `SELECT 
                            t.id, 
                            t.userid, t.createdat, t.updatedat, t.amount, t.txnid,
                            t.surcharge + COALESCE(tml.amount, 0) as surcharge,
                            t.type, t.wallettype, t.message
                        ${knex.raw('FROM :schema:.transactions t left join :schema:.transaction_lpc tml using (id)', { schema }).toSQL().sql}
						${whereClause}
						${orderBy}
						${limitq}`;

        // let sqlQuery = `select wallettype, max(id) as id, sum(amount) as amount, sum(surcharge) as surcharge, max(createdat) as createdat, userid, min(message) as message, type, txnid from
        // 	(${sqlSubQuery}) a
        // 	group by userid, type, txnid, wallettype order by id desc`;
        if(readOnly) {
            return knexReadOnly.raw(sqlQuery, pArray)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
        }
        return knex.raw(sqlQuery, pArray)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
        
    },
    deleteTransaction: (dataObj) => {
        return knex('transactions').where(dataObj).del();
    },
    deleteMessage: (uId, msgBody) => {
        let sqlQuery = `delete from messages where id = (select id from messages where message like '%${msgBody}%' and userid = ${uId} order by id desc limit 1)`;
        return knex.raw(sqlQuery)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    addCoupon: (dataObj) => {
        return knex('appliedcoupons').insert(dataObj).returning(['userid', 'coupon']);
    },
    addReferrerId: (userId, referrerId) => {
        if (!userId || !referrerId) {
            throw new Error('Invalid user/referred id');
        }
        return knex('users').update({ referrer_id: referrerId }).where({ id: userId }).returning(['id']);
    },
    getReferrerIdAndEarning: (userId) => {
        if (!userId) {
            throw new Error('Invalid userid');
        }
        const sql = `select u.referrer_id, case when sum(utf.referrer_payout_amount) is null then 0 else sum(utf.referrer_payout_amount) END as sum 
						from users u 
							left join (
							select utf.referrer_id, utf.referrer_payout_amount from user_trading_fee utf where is_deleted = false
						) utf on utf.referrer_id = u.referrer_id 
						where u.id = ${userId} group by u.referrer_id`;
        return knex.raw(sql)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getAppliedCoupon: (coupon, couponsCap) => {
        let sql = `SELECT * FROM appliedcoupons WHERE coupon = ? limit ?`;
        return knex.raw(sql, [coupon, couponsCap])
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    appliedCouponsByOrderId: (orderid) => {
        let sql = `SELECT * FROM appliedcoupons WHERE orderid = ?`;
        return knex.raw(sql, [orderid])
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getMinRechargeAmount: (cc, amount) => {
        let sql = `SELECT (min_recharge_amount <= ?) as valid FROM couponconfig WHERE couponcode = ? LIMIT 1`;
        return knex.raw(sql, [amount, cc])
            .then((res) => {
                return res.rows.length > 0 ? res.rows[0].valid : false;
            }).catch((err) => {
                throw err;
            });
    },
    appliedCouponsByOrderIdsetTrue: async function (orderid, trx) {
        try {
            const client = trx || knex;
            var resp = await client('appliedcoupons')
                .update({ isexecuted: true })
                .where({ orderid: orderid })
                .returning(['userid']);
            return resp;
        } catch (e) {
            throw e;
        }
    },
    getAppliedCouponForUser: (coupon, userid) => {
        let sql = `SELECT * FROM appliedcoupons WHERE coupon = ? and userid = ? and isexecuted is true and type != 'NU'`;
        return knex.raw(sql, [coupon, userid])
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getFromCouponConfig: async (table, whereObj) => {
        try {
            var res = await knex('couponconfig').where(whereObj).limit(1);
            return res;
        } catch (e) {
            throw e;
        }

    },
    getActiveFromCouponConfig: async (whereObj) => {
        try {
            const currentDate = new Date();
            var res = await knex('couponconfig')
                .where('start_date', '<=', currentDate)
                .andWhere('end_date', '>=', currentDate)
                .where(whereObj)
                .orderBy('created_at', 'desc');
    
            return res;
        } catch (e) {
            throw e;
        }
    },
    updateRef: (dataObj) => {
        var rawStr = 'INSERT INTO refs (userid, refid) SELECT ?, ? WHERE NOT EXISTS(SELECT 1 FROM refs WHERE userid = ? and refid = ?) returning userid, refid';
        return knex.raw(rawStr, [dataObj['userid'], dataObj['refid'], dataObj['userid'], dataObj['refid']])
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });

    },
    getPayment: (dataObj) => {
        return knex('payments').where(dataObj).then((rows) => {
            return rows;
        }).catch((err) => {
            throw err;
        });
    },
    addToPayments: (dataObj) => {
        return knex('payments').insert(dataObj).returning(['userid', 'orderid', 'amount']);
    },
    updatePayment: (whereObj, updateObj, trx) => {
        const client = trx || knex
        return client('payments').update(updateObj).where(whereObj).returning(['id', 'paymentid', 'orderid', 'amount']);
    },
    updatePayment2: (whereObj, updateObj) => {
        let sqlQuery = `update payments set paymentid = ? where orderid = ? and paymentid is null returning id, paymentid, orderid, amount;`;
        return knex.raw(sqlQuery, [updateObj['paymentid'], whereObj['orderid']])
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    updatePayment3: (whereObj, updateObj) => {
        let sqlQuery = `update payments set paymentid = ?, amount = ? where orderid = ? and paymentid is null returning id, paymentid, orderid, amount, metadata;`;
        return knex.raw(sqlQuery, [updateObj['paymentid'], updateObj['amount'], whereObj['orderid']])
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    addToWallet: (dataObj) => {
        return knex('wallet_new').insert(dataObj).returning(['userid', 'coinsd', 'coinsb', 'coinsw']);
    },
    addTransaction: (dataObj) => {
        return knex('transactions').insert(dataObj).returning(['id', 'userid', 'amount', 'wallettype', 'txnid', 'type', 'surcharge', 'createdat']);
    },
    addBatchTransaction: function (txnData) {
        return knex.batchInsert('transactions', txnData, 1000)
            .returning(['id', 'userid', 'amount', 'wallettype', 'txnid', 'message', 'type', 'createdat', 'surcharge'])
            .then(function (txns) { return txns; })
            .catch(function (error) { throw error; });
    },
    deleteRedeemRequest: async (payout_reference) => {
        const sqlQuery = `delete from redeem 
            where refid = ? and transactionid = 'tobeupdated' `;
        return knex.raw(sqlQuery, [payout_reference])
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
            });
    },
    putRedeemRequests: (dataObj) => {
        return knex('redeem').insert(dataObj).returning(['id', 'userid', 'transactionid']);
    },
    getRedeemRequests: (ids, requestParams) => {

        let whereClause = ` WHERE 1=1 ${(requestParams && requestParams.is_user_history) ? '' : " AND a.STATUS = 'A' "} AND TRANSACTIONID != 'tobeupdated' AND a.userid NOT IN (1699, 1848, 2029, 959, 3383, 11345, 8355, 14116, 14045, 15804, 16254, 10076, 10239, 8824, 6317, 9685, 14045, 16524, 18035, 5530) `;
        if (ids) {
            whereClause += ` AND a.id in (${ids.join(',')}) and a.status = 'A' `;
        }
        const whereBindings = [];
        if (requestParams) {
            if (requestParams.userid) {
                whereClause += ` AND a.userid = ?`;
                whereBindings.push(requestParams.userid);
            }
            if (requestParams.redeemid) {
                whereClause += ` AND a.id = ?`;
                whereBindings.push(requestParams.redeemid);
            }
            if (requestParams.amount) {
                whereClause += ` AND a.amount = ?`;
                whereBindings.push(requestParams.amount);
            }
            if (requestParams.mobile) {
                whereClause += ` AND b.mobile = ?`;
                whereBindings.push(requestParams.mobile);
            }
            if (requestParams.email) {
                whereClause += ` AND lower(b.email)  LIKE '%?%' `;
                whereBindings.push(knex.raw(requestParams.email.toLowerCase()));
            }
            if (requestParams.createdat) {
                whereClause += ` AND CAST(a.createdat as VARCHAR)  LIKE '%?%' `;
                whereBindings.push(knex.raw(requestParams.createdat));
            }
        }
        let sqlQuery = `SELECT a.*, b.email, b.mobile FROM REDEEM a left join users b on a.userid = b.id ${whereClause} ORDER BY a.id ASC`;
        return knex.raw(sqlQuery, whereBindings)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getRedeemReqForCancellation: (ids) => {
        let sql = `SELECT * FROM redeem WHERE id in (${ids.join(',')})`;
        return knex.raw(sql)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getRedeemStatus: (dataObj) => {
        const sqlQuery = `select * from redeem where userid = ? and status = ? and transactionid != 'tobeupdated' order by id desc limit ?`;
        const limit = dataObj['limit'] || 3;
        let statusArray = [];
        if (Array.isArray(dataObj['status'])) {
            statusArray = dataObj['status'];
        } else {
            statusArray.push(dataObj['status']);
        }
        return knex('redeem').where({
            userid: dataObj['userid']
        }).whereNot({
            transactionid: 'tobeupdated'
        }).whereIn(
            'status', statusArray
        ).orderBy('id', 'desc').limit(limit).then((res) => {
            return res;
        }).catch((e) => {
            throw e;
        });

        // return knex.raw(sqlQuery, [dataObj['userid'], dataObj['status'], limit])
        // 	.then((res) => {
        // 		return res['rows'];
        // 	}).catch((err) => {
        // 		throw err;
        // 	});
    },
    getRedeemById: (id) => {
        const sqlQuery = `select * from redeem where id = ?`;
        return knex.raw(sqlQuery, [id])
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getRedeemRequestsForWhatsappNotif: () => {
        const sqlQuery = `SELECT distinct(userid) FROM redeem WHERE createdat >= NOW() - INTERVAL '60 minutes' and createdat < NOW() - INTERVAL '30 minutes'`;
        return knex.raw(sqlQuery)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    updateRedeemStatus: (dataObj) => {
        let sqlQuery = `update redeem set status = ? where refid = ?`;
        return knex.raw(sqlQuery, [dataObj['status'], dataObj['refid']])
            .then((res) => {
                return res['rows'][0];
            }).catch((err) => {
                throw err;
            });
    },
    updateRedeemStatusByTx: (dataObj) => {
        let sqlQuery = `update redeem set status = ? where transactionid = ?`;
        return knex.raw(sqlQuery, [dataObj['status'], dataObj['txnId']])
            .then((res) => {
                return res['rows'][0];
            }).catch((err) => {
                throw err;
            });
    },
    getLastReconStatus: () => {
        let _query = `
        select *
        FROM  reconciliation_job_status rjs
        WHERE job_status = 'success'
        ORDER BY id desc limit 1`
        return knex.raw(_query).then((res) => {
            return res.rows
        }).catch((e) => {
            throw e;
        });
    },
    getUnprocessedRedeemRequests: (datetime) => {
        let sqlQuery = `
        SELECT a.id, a.amount, a.userid  FROM REDEEM a
        WHERE a.STATUS = 'A'
        AND pg != 'Paykassma'
        AND a.TRANSACTIONID != 'tobeupdated'
        AND (pg is null or pg!='triplea')
        AND a.userid not in (select distinct(userid) FROM  blocked_users)
        AND a.userid not in (select distinct(userid) from reconciliation_mismatched_data where status = 'hold')
        AND a.createdat < ?
        ORDER by id asc
        limit 500
        `
        return knex.raw(sqlQuery, [datetime])
            .then((res) => {
                return res.rows;
            }).catch((err) => {
                throw err;
            });
    },
    getUnprocessedPaykassmaRedeemRequests: (datetime) => {
        let sqlQuery = `
        SELECT a.id, a.amount, a.userid  FROM REDEEM a
        WHERE a.STATUS = 'A'
        AND pg ='Paykassma'
        AND refid is null
        AND a.userid not in (select distinct(userid) FROM  blocked_users)
        AND a.userid not in (select distinct(userid) from reconciliation_mismatched_data where status = 'hold')
        AND a.createdat < ?
        ORDER by id asc
        limit 500
        `
        return knex.raw(sqlQuery, [datetime])
            .then((res) => {
                return res.rows;
            }).catch((err) => {
                throw err;
            });
    },
    getUnprocessedDirect24RedeemRequests: (datetime) => {
        let sqlQuery = `
        SELECT a.id, a.amount, a.userid FROM REDEEM a
        WHERE a.STATUS = 'A'
        AND pg = 'direct24'
        AND refid is null
        AND a.userid not in (select distinct(userid) FROM  blocked_users)
        AND a.userid not in (select distinct(userid) from reconciliation_mismatched_data where status = 'hold')
        AND a.createdat < ?
        ORDER by id asc
        limit 500
        `
        return knex.raw(sqlQuery, [datetime])
            .then((res) => {
                return res.rows;
            }).catch((err) => {
                throw err;
            });
    },
    getProcessedRedeemRequests: (dataObj) => {
        let sqlQuery = `with a as (
            SELECT id, userid, amount, surcharge, createdat
            FROM transactions 
            WHERE userid = ${dataObj['userid']} and (txnid like 'TDSW%' or txnid like 'RD%') and createdat > '${CONFIG.TIMESTAMP_TDS_LIVE}'), b as (
            SELECT id, userid, amount, surcharge, createdat
            FROM transactions_archive
            WHERE userid = ${dataObj['userid']} and (txnid like 'TDSW%' or txnid like 'RD%') and createdat > '${CONFIG.TIMESTAMP_TDS_LIVE}'
        ) select userid, COALESCE(SUM(amount),0) +  SUM(CASE WHEN id <= ${CONFIG.EXCLUDE_SURCHARGE_ID} THEN surcharge ELSE 0 END) AS total FROM (
            select * from a union all select * from b
        ) k group by userid`;
        return knex.raw(sqlQuery)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getCancelledRedeemRequests: (dataObj) => {
        let sqlQuery = `with a as (
            SELECT userid, amount, createdat
            FROM transactions 
            WHERE userid = ${dataObj['userid']} and (txnid like 'TDSRF%' or txnid like 'RC%') and createdat > '${CONFIG.TIMESTAMP_TDS_LIVE}'), b as (
            SELECT userid, amount, createdat
            FROM transactions_archive
            WHERE userid = ${dataObj['userid']} and (txnid like 'TDSRF%' or txnid like 'RC%') and createdat > '${CONFIG.TIMESTAMP_TDS_LIVE}'
        ) select userid, COALESCE(SUM(amount),0) AS total FROM (
            select * from a union all select * from b
        ) k group by userid`;
        return knex.raw(sqlQuery)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getRefundedTdsAmount: (dataObj) => {
        let sqlQuery = `with a as (
            SELECT userid, amount, createdat
            FROM transactions
            WHERE userid = ${dataObj['userid']} and txnid like 'TDSRF%' and createdat > '${CONFIG.TIMESTAMP_TDS_LIVE}'), b as (
            SELECT userid, amount, createdat
            FROM transactions_archive
            WHERE userid = ${dataObj['userid']} and txnid like 'TDSRF%' and createdat > '${CONFIG.TIMESTAMP_TDS_LIVE}'
        ) select userid, COALESCE(SUM(amount),0) AS total FROM (
            select * from a union all select * from b
        ) k group by userid`;
        return knex.raw(sqlQuery)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getProcessedPayments: (dataObj) => {
        let sqlQuery = `with a as (
            SELECT userid, amount, createdat
            FROM transactions
            WHERE userid = ${dataObj['userid']} and (txnid like 'PM%' OR txnid like 'CACB%' OR txnid LIKE 'CTM%') and createdat > '${CONFIG.TIMESTAMP_TDS_LIVE}'), b as (
            SELECT userid, amount, createdat
            FROM transactions_archive
            WHERE userid = ${dataObj['userid']} and (txnid like 'PM%' OR txnid like 'CACB%' OR txnid LIKE 'CTM%') and createdat > '${CONFIG.TIMESTAMP_TDS_LIVE}'
        ) select userid, COALESCE(SUM(amount),0) AS total FROM (
            select * from a union all select * from b
        ) k group by userid`;
        return knex.raw(sqlQuery)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    previousTdsDeductedOnWithdrawal: (dataObj) => {
        let sqlQuery = `with a as (
            SELECT userid, amount, createdat
            FROM transactions
            WHERE userid = ${dataObj['userid']} and txnid like 'TDSW%' and createdat > '${CONFIG.TIMESTAMP_TDS_LIVE}'), b as (
            SELECT userid, amount, createdat
            FROM transactions_archive
            WHERE userid = ${dataObj['userid']} and txnid like 'TDSW%' and createdat > '${CONFIG.TIMESTAMP_TDS_LIVE}'
        ) select userid, COALESCE(SUM(amount),0) AS total FROM (
            select * from a union all select * from b
        ) k group by userid`;
        return knex.raw(sqlQuery)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getReferralEarnings: (dataObj) => {
        let sqlQuery = `with a as (
            SELECT userid, amount, createdat
            FROM transactions 
            WHERE userid = ${dataObj['userid']} and (txnid like 'RFR1%' or txnid like 'ERFR%') and createdat > '${CONFIG.TIMESTAMP_TDS_LIVE}'), b as (
            SELECT userid, amount, createdat
            FROM transactions_archive
            WHERE userid = ${dataObj['userid']} and (txnid like 'RFR1%' or txnid like 'ERFR%') and createdat > '${CONFIG.TIMESTAMP_TDS_LIVE}'
        ) select userid, COALESCE(SUM(amount),0) AS total FROM (
            select * from a union all select * from b
        ) k group by userid`;
        return knex.raw(sqlQuery)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getReferralTds: (dataObj) => {
        let sqlQuery = `with a as (
            SELECT userid, amount, createdat
            FROM transactions 
            WHERE userid = ${dataObj['userid']} and (txnid like 'TD1%' or txnid like 'TDSERFR%') and createdat > '${CONFIG.TIMESTAMP_TDS_LIVE}'), b as (
            SELECT userid, amount, createdat
            FROM transactions_archive
            WHERE userid = ${dataObj['userid']} and (txnid like 'TD1%' or txnid like 'TDSERFR%') and createdat > '${CONFIG.TIMESTAMP_TDS_LIVE}'
        ) select userid, COALESCE(SUM(amount),0) AS total FROM (
            select * from a union all select * from b
        ) k group by userid`;
        return knex.raw(sqlQuery)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getClubTds: (dataObj) => {
        let sqlQuery = `with a as (
            SELECT COALESCE(sum(amount), 0) as amount_earning_1
            FROM transactions 
            WHERE type = 'CREDIT' and userid = ${dataObj['userid']} and (txnid like 'CLBRF1%' ) and createdat > '${CONFIG.TIMESTAMP_TDS_LIVE}'),
            b as (
            SELECT COALESCE(sum(amount), 0) as amount_earning_2
            FROM transactions_archive
            WHERE type = 'CREDIT' and userid = ${dataObj['userid']} and (txnid like 'CLBRF1%') and createdat > '${CONFIG.TIMESTAMP_TDS_LIVE}'), 
            c as (
            SELECT COALESCE(sum(amount), 0) as amount_deduction_1
            FROM transactions 
            WHERE  userid = ${dataObj['userid']} and (txnid like 'TDSCLB1%' ) and createdat > '${CONFIG.TIMESTAMP_TDS_LIVE}'),
            d as (
            SELECT COALESCE(sum(amount), 0) as amount_deduction_2
            FROM transactions_archive
            WHERE  userid = ${dataObj['userid']} and (txnid like 'TDSCLB1%' ) and createdat > '${CONFIG.TIMESTAMP_TDS_LIVE}')
            select a.amount_earning_1 + b.amount_earning_2 - c.amount_deduction_1 - d.amount_deduction_2 as total from a,b,c,d`;
        return knex.raw(sqlQuery)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getPortfolioValue: (dataObj) => {
        let sqlQuery = `select * from opening_balance where userid = ? limit 1`;
        return knex.raw(sqlQuery, [dataObj['userid']])
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getTransaction: (txnId) => {
        let sql = `select * from transactions where txnid = ? limit 1`;
        return knex.raw(sql, [txnId])
            .then((res) => {
                return res['rows'][0];
            }).catch((err) => {
                throw err;
            });
    },
    getLastPayment: (dataObj) => {
        let sql = `select * from payments where userid = ? order by id desc limit 1`;
        return knex.raw(sql, [dataObj['userid']])
            .then((res) => {
                return res['rows'][0];
            }).catch((err) => {
                throw err;
            });
    },
    getLastRedeem: (dataObj) => {
        let sql = `select * from redeem where userid = ? order by id desc limit 1`;
        return knex.raw(sql, [dataObj['userid']])
            .then((res) => {
                return res['rows'][0];
            }).catch((err) => {
                throw err;
            });
    },
    getFcmToken: (userid) => {
        let sql = `select * from users where id = ? limit 1`;
        return knex.raw(sql, [userid])
            .then((res) => {
                return res['rows'][0];
            }).catch((err) => {
                throw err;
            });
    },
    getRedeemByRefId: async (refId) => {
        try {
            if (!refId) {
                throw new Error('refId ID incorrect');
            }
            const query = `select * from redeem where refid = '${refId}'`;
            const res = await knex.raw(query);
            return res.rows[0];
        } catch (e) {
            throw e;
        }
    },
    getRedeemByTransferId: async (transferid) => {
        try {
            if (!transferid) {
                throw new Error('transferid ID incorrect');
            }
            const query = `select * from redeem where transferid = '${transferid}'`;
            const res = await knex.raw(query);
            return res.rows[0];
        } catch (e) {
            throw e;
        }
    },
    updateRedeemRequests: (dataObj) => {
        var updateObj = {};
        var colsArray = ['transactionid', 'refid', 'status', 'link', 'transferid', 'pgstatus', 'pgacknowledged', 'pg', 'currency', 'exchange_rate'];
        for (let col of colsArray) {
            if (!lodash.isNil(dataObj[col])) {
                updateObj[col] = knex.raw('?', [dataObj[col]]);
            }
        }
        return knex('redeem').update(updateObj).where('id', dataObj['id']).returning(['id'].concat(colsArray));
    },
    updateTransactions: (dataObj) => {
        let sqlQuery = `update transactions set txnid = ? where txnid = ?`;
        return knex.raw(sqlQuery, [dataObj['txnid'], dataObj['oldtxnid']])
            .then((res) => {
                return res['rows'][0];
            }).catch((err) => {
                throw err;
            });
    },
    createUser: (dataObj) => {
        return knex.insert(dataObj, 'id').into('users').then((id) => {
            return id;
        }).catch(err => {
            throw err;
        });
    },
    addToTemp: async (dataObj) => {
        await knex('tempusers').where({ 'mobile': dataObj['mobile'] }).del();
        return knex('tempusers').insert(dataObj).returning(['mobile', 'otp']);
    },
    addMessage: (dataObj) => {
        return knex.insert(dataObj, 'id').into('messages').then((id) => {
            return id;
        }).catch(err => {
            throw err;
        });
    },
    update: (dataObj, isAdmin) => {
        var updateObj = {};
        var colsArray = ['coins', 'coupon', 'avatar', 'displayname', 'otp', 'fcmtoken', 'email', 'ageconsent', 'howitworks', 'dob', 'pincode', 'signup_country', 'signup_ip_country', 'preferred_locale', 'mobile', 'mobile_code', 'is_mobile_verified', 'referrer_id'];
        if (isAdmin) {
            colsArray.push('kycstatus');
        }
        for (let col of colsArray) {
            if (dataObj[col]) {
                if (col == 'coins') {
                    updateObj[col] = knex.raw('?? - ?', [col, dataObj[col]]);
                } else {
                    updateObj[col] = knex.raw('?', [dataObj[col]]);
                }
            }
        }
        return knex('users').update(updateObj).where('id', dataObj['userid']).returning(['id', 'isEmailVerified'].concat(colsArray));
    },
    searchPan: async (panNumber, userid, partner) => {
        try {
            let pan = panNumber.toLowerCase();
            let sqlQuery = `SELECT * FROM kycdetails a WHERE LOWER(a.number) = ? AND userid <> ? and partner = ?`;
            const param = [pan, userid, partner];
            return knex.raw(sqlQuery, param)
                .then((res) => {
                    return res['rows'].length;
                }).catch((err) => {
                    throw err;
                });
        } catch (e) {
            throw e;
        }
    },
    findPanCard: async (dataObj) => {
        return knex('kycdetails').where(dataObj).then((rows) => {
            return rows[0];
        }).catch((err) => {
            throw err;
        });
    },
    searchBankAcc: async (accountNumber, ifsc, userId, partner) => {
        try {
            var resp = await knex('bankdetails')
                .where({ accountnumber: accountNumber })
                .where({ ifsc: ifsc })
                .where({ partner: partner })
                .where('userid', '!=', userId);
            return resp;
        } catch (e) {
            throw e;
        }
    },
    addKyc: async (dataObj) => {
        try {
            var res = await knex('kycdetails').where({ 'userid': dataObj['userid'] });
            if (res.length > 0) {
                var objToUpdate = Object.assign({}, dataObj);
                delete objToUpdate['userid'];
                await knex('users').update({ 'kycstatus': 'P' }).where('id', dataObj['userid']);
                return knex('kycdetails').update(objToUpdate).where('userid', dataObj['userid']);
            } else {
                await knex('users').update({ 'kycstatus': 'P' }).where('id', dataObj['userid']);
                return knex('kycdetails').insert(dataObj);
            }
        } catch (e) {
            throw e;
        }
    },
    checkKyc: async (userid) => {
        let sql = `select * from kycdetails where userid = ? limit 1`;
        return knex.raw(sql, [userid])
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getAccountsActive: async (userId) => {
        let sql = `select * from bankdetails where userid = ?`;
        return knex.raw(sql, [userId])
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },

    updateKyc: async (dataObj, userId) => {
        try {
            var res = await knex('kycdetails').update(dataObj).where('userid', userId).returning(['userid']);
            return res;
        } catch (e) {
            throw e; l;
        }
    },
    updateWallet: async (dataObj, mul, orderType, amt) => {
        const reqKey = `updating_wallet_${dataObj['userid']}`;
        const unlock = await lock(reqKey, 300000);
        try {
            if (!mul) {
                mul = 1;
            }
            var updateObj = {};
            var colsArray = ['coinsb', 'coinsd', 'coinsw'];
            var res;
            //     var p = async function () {
            //         return await knex.transaction(async trx => {
            //             const sqlQuery = `SELECT * FROM wallet where userid = ? ORDER  BY id DESC limit 1 for update`;
            //             var res = await knex.raw(sqlQuery, [dataObj['userid']]).transacting(trx);
            //             const walletEntry = Object.assign({}, res.rows[0]);
            //             const userData = Object.assign({}, res.rows[0]);

            //             const availableBonus = parseFloat(userData['coinsb'].toFixed(2));
            //             let lockedAmount = parseFloat(userData['locked_amount'].toFixed(2));

            //             if (orderType === 'order' || orderType === 'debit') {
            //                 if (availableBonus > 0) {
            //                     if (dataObj['coinsd'] - availableBonus > 0) {
            //                         dataObj['coinsb'] = availableBonus;
            //                         lockedAmount = availableBonus;
            //                     } else {
            //                         const coinsD = parseFloat(dataObj['coinsd']);
            //                         lockedAmount += coinsD;
            //                         dataObj['coinsb'] = coinsD;
            //                     }
            //                 }
            //             } else if (orderType === 'cancel' || orderType === 'credit') {
            //                 if (lockedAmount > 0) {
            //                     if (dataObj['coinsd'] - lockedAmount > 0) {
            //                         userData['coinsb'] = lockedAmount;
            //                         dataObj['coinsb'] = parseFloat((userData['coinsb']).toFixed(2));
            //                         lockedAmount = 0;
            //                     } else {
            //                         userData['coinsb'] = dataObj['coinsd'];
            //                         dataObj['coinsb'] = parseFloat((userData['coinsb']).toFixed(2));
            //                         const coinsD = parseFloat(dataObj['coinsd']);
            //                         lockedAmount -= coinsD;
            //                     }
            //                 }
            //             } else if (orderType == 'settle') {
            //                 lockedAmount -= Math.min(amt, lockedAmount);
            //             }

            //             for (let col of colsArray) {
            //                 if (dataObj[col]) {
            //                     updateObj[col] = walletEntry[col] + mul * dataObj[col];
            //                 } else {
            //                     updateObj[col] = walletEntry[col];
            //                 }
            //             }

            //             await waitTimer(10000);

            //             updateObj['locked_amount'] = parseFloat(lockedAmount.toFixed(2));
            //             updateObj['userid'] = dataObj['userid'];
            //             var updateRes = await knex('wallet').insert(updateObj).returning(['userid', 'coinsd', 'coinsb', 'coinsw', 'locked_amount']).transacting(trx);
            //             trx.commit();
            //             return updateRes
            //         })
            //     };
            //     var res = await p();
            //     return res;
            const sqlQuery = `SELECT * FROM wallet where userid = ? ORDER  BY id DESC limit 1`;
            var res = await knex.raw(sqlQuery, [dataObj['userid']]);
            const walletEntry = Object.assign({}, res.rows[0]);
            const userData = Object.assign({}, res.rows[0]);

            // let [err, userData] = await to(User.findById(dataObj['userid'], false));
            // if (err) {
            // 	throw err;
            // }
            const availableBonus = parseFloat(userData['coinsb'].toFixed(2));
            let lockedAmount = parseFloat(userData['locked_amount'].toFixed(2));

            if (orderType === 'order' || orderType === 'debit') {
                if (availableBonus > 0) {
                    if (dataObj['coinsd'] - availableBonus > 0) {
                        dataObj['coinsb'] = availableBonus;
                        lockedAmount = availableBonus;
                    } else {
                        const coinsD = parseFloat(dataObj['coinsd']);
                        lockedAmount += coinsD;
                        dataObj['coinsb'] = coinsD;
                    }
                }
            } else if (orderType === 'cancel' || orderType === 'credit') {
                if (lockedAmount > 0) {
                    if (dataObj['coinsd'] - lockedAmount > 0) {
                        userData['coinsb'] = lockedAmount;
                        dataObj['coinsb'] = parseFloat((userData['coinsb']).toFixed(2));
                        lockedAmount = 0;
                    } else {
                        userData['coinsb'] = dataObj['coinsd'];
                        dataObj['coinsb'] = parseFloat((userData['coinsb']).toFixed(2));
                        const coinsD = parseFloat(dataObj['coinsd']);
                        lockedAmount -= coinsD;
                    }
                }
            } else if (orderType == 'settle') {
                lockedAmount -= Math.min(amt, lockedAmount);
            }

            // let sqlQuery = `SELECT * FROM wallet where userid = ? ORDER  BY id DESC limit 1`;
            // res = await knex.raw( sqlQuery, [ dataObj['userid'] ] );

            for (let col of colsArray) {
                if (dataObj[col]) {
                    updateObj[col] = walletEntry[col] + mul * dataObj[col];
                } else {
                    updateObj[col] = walletEntry[col];
                }
            }

            updateObj['locked_amount'] = parseFloat(lockedAmount.toFixed(2));
            updateObj['userid'] = dataObj['userid'];
            if ('transactionId' in dataObj && dataObj['transactionId'] > 0) {
                updateObj['transaction_id'] = dataObj['transactionId']
            }

            var updateRes = await knex('wallet').insert(updateObj).returning(['userid', 'coinsd', 'coinsb', 'coinsw', 'locked_amount']);
            unlock();

            return updateRes;
        } catch (e) {
            unlock();
            throw e;
        } finally {
            unlock();
        }
        // return knex('wallet').update(updateObj).where('userid', dataObj['userid']).returning(['userid'].concat(colsArray));
    },
    updateWalletTransaction: async (dataObj, mul, orderType, amt, trx) => {
        const reqKey = `updating_wallet_${dataObj['userid']}`;
        const unlock = await lock(reqKey, 300000);
        try {
            if (!mul) {
                mul = 1;
            }
            var updateObj = {};
            var colsArray = ['coinsb', 'coinsd', 'coinsw'];
            var res;
            const sqlQuery = `SELECT * FROM wallet where userid = ? ORDER  BY id DESC limit 1`;
            var res = await trx.raw(sqlQuery, [dataObj['userid']]);
            const walletEntry = Object.assign({}, res.rows[0]);
            const userData = Object.assign({}, res.rows[0]);

            // let [err, userData] = await to(User.findById(dataObj['userid'], false));
            // if (err) {
            // 	throw err;
            // }
            const availableBonus = parseFloat(userData['coinsb'].toFixed(2));
            let lockedAmount = parseFloat(userData['locked_amount'].toFixed(2));

            if (orderType === 'order' || orderType === 'debit') {
                if (availableBonus > 0) {
                    if (dataObj['coinsd'] - availableBonus > 0) {
                        dataObj['coinsb'] = availableBonus;
                        lockedAmount = availableBonus;
                    } else {
                        const coinsD = parseFloat(dataObj['coinsd']);
                        lockedAmount += coinsD;
                        dataObj['coinsb'] = coinsD;
                    }
                }
            } else if (orderType === 'cancel' || orderType === 'credit') {
                if (lockedAmount > 0) {
                    if (dataObj['coinsd'] - lockedAmount > 0) {
                        userData['coinsb'] = lockedAmount;
                        dataObj['coinsb'] = parseFloat((userData['coinsb']).toFixed(2));
                        lockedAmount = 0;
                    } else {
                        userData['coinsb'] = dataObj['coinsd'];
                        dataObj['coinsb'] = parseFloat((userData['coinsb']).toFixed(2));
                        const coinsD = parseFloat(dataObj['coinsd']);
                        lockedAmount -= coinsD;
                    }
                }
            } else if (orderType == 'settle') {
                lockedAmount -= Math.min(amt, lockedAmount);
            }

            // let sqlQuery = `SELECT * FROM wallet where userid = ? ORDER  BY id DESC limit 1`;
            // res = await knex.raw( sqlQuery, [ dataObj['userid'] ] );

            for (let col of colsArray) {
                if (dataObj[col]) {
                    updateObj[col] = walletEntry[col] + mul * dataObj[col];
                } else {
                    updateObj[col] = walletEntry[col];
                }
            }

            updateObj['locked_amount'] = parseFloat(lockedAmount.toFixed(2));
            updateObj['userid'] = dataObj['userid'];
            if ('transactionId' in dataObj && dataObj['transactionId'] > 0) {
                updateObj['transaction_id'] = dataObj['transactionId']
            }

            var updateRes = await trx('wallet').insert(updateObj).returning(['userid', 'coinsd', 'coinsb', 'coinsw', 'locked_amount']);
            unlock();

            return updateRes;
        } catch (e) {
            unlock();
            throw e;
        } finally {
            unlock();
        }
        // return knex('wallet').update(updateObj).where('userid', dataObj['userid']).returning(['userid'].concat(colsArray));
    },
    getEngagedCoins: (dataObj) => {
        var sqlQuery = `SELECT coalesce(round(sum(a.coins)::DECIMAL, 2)::float,0) AS coinse, c.userid,
							   AVG(round(c.coinsb::DECIMAL, 2))::float as coinsb,
								AVG(round(c.coinsw::DECIMAL, 2))::float as coinsw,
								AVG(round(c.coinsd::DECIMAL, 2)) ::float as coinsd
		FROM   (SELECT sum(a.coins) AS coins, a.userid
					FROM   probecallsopen a JOIN probes b ON a.probeid = b.id
					WHERE  a.userid = ? and b.status = 'A'
					GROUP  BY userid
					UNION ALL
					SELECT sum(a.coins) AS coins, a.userid
					FROM   probecalls a JOIN probes b ON a.probeid = b.id
					WHERE  userid = ? and b.status = 'A'
					   AND rank = 0
					GROUP  BY userid) a 
				Right JOIN (select * from wallet where userid = ? order by id desc limit 1) c ON c.userid = a.userid
				WHERE c.userid = ? group by c.userid`;
        return knex.raw(sqlQuery, [dataObj['userid'], dataObj['userid'], dataObj['userid'], dataObj['userid']])
            .then((res) => {
                return res['rows'][0];
            }).catch((err) => {
                throw err;
            });
    },

    getHomeMessages: () => {
        var sqlQuery = `select max(id), uid1, toid from (
			select max(a.id) as id, a.userid as toid, b.userid as uid1 from message a join message_recepient b on a.id = b.messageid 
			where a.userid = 39871 
			group by a.userid, b.userid, b.groupid
			union
			select max(a.id) as id, b.userid as toid, a.userid as uid1 from message a join message_recepient b on a.id = b.messageid 
			where b.userid = 39871 
			group by b.userid, a.userid, b.groupid) a
			group by a.uid1, a.toid`;
    },

    getLeaders: (dataObj) => {
        var sqlQuery = `SELECT a.id, a.coins, a.returns,  c.title as ptitle, c.correctvalue, a.callvalue, a.userid, b.displayname, b.avatar, a.createdat 
					FROM probecalls a 
					JOIN users b ON b.id = a.userid
					JOIN probes c ON c.id = a.probeid
					WHERE rank > 0 AND c.status = 'C'
					ORDER BY c.updatedat desc`;
        return knex.raw(sqlQuery)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getJWT: (userId, isDashboardUser, isV2) => {
        let oUserId = {
            user_id: userId
        };
        if (isDashboardUser) {
            oUserId = { dashboard_user_id: userId };
        }
        return new Promise((resolve, reject) => {
            try {
                let token;
                if (isV2 === true) {
                    token = 'Bearer ' + jwt.sign(oUserId, CONFIG.jwt_encryption_v2, {
                        expiresIn: CONFIG.jwt_expiration
                    });
                } else {
                    token = 'Bearer ' + jwt.sign(oUserId, CONFIG.jwt_encryption, {
                        expiresIn: CONFIG.jwt_expiration
                    });
                }
                resolve(token);
            } catch (err) {
                reject(err);
            }
        });
    },
    getTempJWT: (userId) => {
        let oUserId = {
            user_id: userId
        };
        return new Promise((resolve, reject) => {
            try {
                let token;
                token = 'Bearer ' + jwt.sign(oUserId, CONFIG.jwt_encryption_v2, {
                    expiresIn: CONFIG.jwt_temp_expiration
                });
                resolve(token);
            } catch (err) {
                reject(err);
            }
        });
    },
    getPermissions: (userId) => {
        let sql = `select p.name from dashboard_users du join user_permissions up on up.userid = du.id join permissions p on p.id = up.permissionid where du.id = ?;`
        return knex.raw(sql, [userId])
            .then((res) => {
                return res['rows'];
            })
            .catch((e) => {
                throw e;
            });
    },
    findDashboardUserByEmail: (email) => {
        if (!email) {
            throw new Error();
        }
        return knex.raw(`select * from dashboard_users where email = ?`, [email])
            .then((res) => {
                const record = res['rows'][0];
                return record;
            })
            .catch((e) => {
                throw e;
            });
    },
    findDashboardUserById: async (userId) => {
        try {
            const res = await knex('dashboard_users').where({ id: userId }).select();
            return res[0];
        } catch (e) {
            throw e;
        }
    },

    findFCMTokenByUserId: async (userId) => {
        try {
            const res = await knex('users')
                .where({ id: userId })
                .select('fcmtoken');
            return res[0].fcmtoken;
        } catch (e) {
            throw e;
        }
    },

    getAllExistingUserIds: async () => {
        try {
            const sql = `select id from users order by id desc`;
            return knex.raw(sql).then((res) => {
                return res.rows;
            });
        } catch (err) {
            throw err;
        }
    },

    getUserPreferenceMap: async (userId) => {
        try {
            const sql = `select COALESCE(json_agg( json_build_object('category', x.category, 'count', x.count)), '[]')
			as participation_map from
			((select b.category, count(*) from probecalls a 
			 left join probes b on b.id = a.probeid where a.userid = ${userId} group by b.category)
			union 
			 (select b.category, count(*) from probecallsopen a 
			 left join probes b on b.id = a.probeid where a.userid = ${userId} group by b.category)
			)x`;
            return knex.raw(sql).then((res) => {
                return res.rows[0].participation_map;
            });
        } catch (err) {
            throw err;
        }
    },

    getUserGroups: async (userId) => {
        try {
            const sql = `select array_agg(group_name) as group_names from user_groups ug where userid=?`;
            const param = [userId];
            return knex.raw(sql, param).then((res) => {
                return res.rows[0].group_names;
            });
        } catch (err) {
            throw err;
        }
    },

    isUserBlocked: async (userId) => {
        try {
            // const sql = `select count(*) from blocked_users where userid = ? and status = 'P'`;
            const sql = `select count(*) from blocked_users where userid = ?`;
            const param = [userId];
            return knex.raw(sql, param).then((res) => {
                return parseInt(res.rows[0].count) >= 1;
            });
        } catch (err) {
            throw err;
        }
    },

    isUserWithdrawalBlocked: async (userId) => {
        try {
            let _query = `
            SELECT distinct (a.id) from
            (select bu.id
                        FROM  blocked_users bu
                        where bu.userid = ${userId}
            UNION
            select rmd.userid
                        FROM  reconciliation_mismatched_data rmd
                        where rmd.userid = ${userId} and rmd.status = 'hold' ) a`
            return knex.raw(_query).then((res) => {
                return res.rows.length ? true : false;
            }).catch((e) => {
                throw e;
            });
        } catch (err) {
            throw err;
        }
    },

    enterBlockedUser: async (userList) => {
        try {
            let chunksize = 1000;
            return knex.batchInsert('blocked_users', userList, chunksize)
                .catch(function (error) { throw error; });
        } catch (err) {
            throw err;
        }
    },

    removeBlockedUser: async (userids) => {
        return knex('blocked_users').whereIn('userid', userids).delete()
            .then((res) => {
                return res;
            }, err => { throw err; });
    },
    addToPrivateEventUser: (dataObj) => {
        return knex.insert(dataObj, 'id').into('private_event_users').then((id) => {
            return id;
        }).catch(err => {
            throw err;
        });
    },
    getConfig: async (userid) => {
        return knex('user_config')
            .where({ 'userid': userid })
            .orderBy('id', 'desc')
            .limit(1)
            .then((res) => {
                return res[0];
            }, err => { throw err; });
    },
    getBankUnverifiedRows: async function (userId) {
        let sql = `SELECT * FROM bank_details_verif_status WHERE userid = ${userId} and approval_status = 'P'`;
        return knex.raw(sql)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    isUserAllowed: async (userId) => {
        if (!userId) {
            throw new Error("UserId must not be a falsy value");
        }
        const sqlParams = [userId];
        let sql = `select * from transactions where userid = ? and createdat > '2023-07-01 03:01:46.141427' and createdat < '2023-07-01 05:01:46.141427'`;
        return knex.raw(sql, sqlParams).then((res) => {
            return res.rows.length == 0;
        }).catch((e) => {
            throw e;
        })
    },
    getIncompleteKycInfo: async function (offset) {
        let sqlQuery = `select id, displayname, email, mobile from users where kycstatus != 'C' order by id limit 500 offset ?`;
        return knex.raw(sqlQuery, [offset])
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getIncompleteKycCount: async function () {
        let sqlQuery = `select count(*) from users where kycstatus != 'C'`;
        return knex.raw(sqlQuery)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getTotalParticipatingUsers: async function (probeid) {
        let sqlQuery = `select count(distinct(userid)) from (select distinct(userid) from probecalls where probeid = ${probeid} UNION select distinct(userid) from probecallsopen where probeid = ${probeid}) a`;
        return knex.raw(sqlQuery)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getTotalParticipatingUsersInfo: async function (probeid, offset) {
        let sqlQuery = `select distinct(userid) from (select distinct(userid) from probecalls where probeid = ${probeid} UNION select distinct(userid) from probecallsopen where probeid = ${probeid}) a order by a.userid limit 500 offset ${offset}`;
        return knex.raw(sqlQuery)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    setUpdatedAt: async (userId) => {
        try {
            await knex('users')
                .where({ id: userId })
                .update({ updatedat: 'now()' });
        } catch (e) {
            console.log(`Error Updating updated at for user ${userId}`)
        }
    },
    getBlockedUsers: async () => {
        try {
            const sql = `select distinct userid as id from blocked_users`;
            const res = await knex.raw(sql);
            return res?.rows;
        } catch (err) {
            throw err;
        }
    },
    getUserByMobile: async (mobile, signup_country, partnerId) => {
        try {
            const sql = 'SELECT id from users where mobile LIKE ? and signup_country = ? and partner = ?'
            const mobilePattern = `%${mobile}%`
            const res = await knex.raw(sql, [mobilePattern, signup_country, partnerId])
            return res?.rows?.[0]?.id ?? false
        } catch (e) {
            console.error('Error in getUserByMobile', e.message)
            return false;
        }
    },

    getIsoFromCountryCode: async (dataObj) => {
        let sqlQuery = `select * from country where isd_code = ? limit 1`;
        return knex.raw(sqlQuery, [dataObj['country_code']])
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },

    resetKYC: async (id, reason, name) => {
        try {
            const sql = `update 
                bank_details_verif_status set
                 approval_status = 'P', reset_reason = ?,
                 name = ? 
                where approval_status = 'R' and id = ? returning id`
            const res = await knex.raw(sql, [reason, name, id])
            return res?.rows?.[0]?.id ?? false
        } catch (e) {
            console.log(e.message)
            return false;
        }

    },
    getProTrader: async (user_id) => {
        try {
            let sqlQuery = `SELECT * from pro_trader where user_id = ? and is_active=true limit 1`;
            var res = await knex.raw(sqlQuery, [user_id]);
            return res.rows.length ? res.rows[0] : null;
        } catch (e) {
            throw e;
        }
    },
    addProTraders: async (userids) => {
        try {
            var sqlQuery = `with q as (select k::bigint from json_array_elements_text(?) k), 
            inserts as (insert into pro_trader (user_id) select * from q on conflict (user_id) do update set is_active = true 
            returning user_id) 
            select count(*) from inserts`;
            var res = await knex.raw(sqlQuery, [JSON.stringify(userids)]);
            return res.rows.length ? res.rows[0]['count'] : 0;
        } catch (e) {
            throw e;
        }
    },
    removeProTraders: async (userids) => {
        try {
            var sqlQuery = `with q as (select k::bigint from json_array_elements_text(?) k), 
            updates as (update pro_trader set is_active = false where user_id in (select * from q)
            returning user_id)
            select count(*) from updates`;
            var res = await knex.raw(sqlQuery, [JSON.stringify(userids)]);
            return res.rows.length ? res.rows[0]['count'] : 0;
        } catch (e) {
            throw e;
        }
    },
    getLevelConfig: async (userId, params) => {
        try {
            const res = await knex('level_user as ul')
                .join('level as l', 'l.id', '=', 'ul.level_id')
                .join('level_config as lc', 'l.id', '=', 'lc.level_id')
                .select(knex.raw("l.label as level, COALESCE(json_object_agg(key, config), '{}') as config"))
                .where('ul.userid', userId).whereIn('lc.key', params).where('ul.is_active', true).groupBy('l.label');
            const data = res?.[0]?.config ?? {};
            data['level'] = res?.[0]?.level ?? 'Novice';
            return data;
        } catch (e) {
            throw (e);
        }
    },
    getPartnerId: async (userId) => {
        try {
            let partner = false;
            let user = await knex.raw('SELECT id, partner from users where id = :userId', {userId});
            user = (user?.rows ?? [])[0];
            return user?.partner ?? 1;
        } catch (e) {
            console.log('[FETCH USER PARTNER ERROR]', userId, e.message);
            return 1;
        }
    },
    getCountInvoice: async function () {
        let sqlQuery = `SELECT COUNT(*) as user_count
        FROM users u
        JOIN transactions t ON u.id = t.userid
        WHERE t.createdat >= '2023-10-01 00:00:00'  :: date
        AND t.createdat <= '2023-10-31 23:59:59' :: date
        AND t.txnid LIKE 'PM%'
        AND u.signup_country = 'IN'`;
        return knex.raw(sqlQuery)
            .then((res) => {
                return res?.rows?.[0]?.user_count ?? 0;
            }).catch((err) => {
                throw err;
            });
    },
    getInvoiceInfo: (offset) => {
        let sqlQuery = `SELECT t.userid, ROUND(t.amount * 1.28) as amount, t.txnid, t.createdat, t.id
        FROM users u
        JOIN transactions t ON u.id = t.userid
        WHERE t.createdat >= '2023-10-01 00:00:00'  :: date
        AND t.createdat <= '2023-10-31 23:59:59' :: date
        AND t.txnid LIKE 'PM%'
        AND u.signup_country = 'IN' order by t.id desc limit 500 offset ?`;
        return knex.raw(sqlQuery, [offset])
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getUserRegion: async (userId) => {
        try {
            const sql = `SELECT region from users inner join country on users.signup_country = country.iso_code WHERE users.id = ?`;
            const data = await knex.raw(sql, [userId]);
            return data?.rows?.[0]?.region ?? 'INDIA';
        } catch(e) {
            console.log('[ERROR GETTING USER REGION]', userId);
            return 'INDIA';
        }
    },
    getPartnerUserId: async(id, partner) => {
        try {
            const sql = `SELECT email from users WHERE users.id = :id AND partner = :partner`;
            const data = await knex.raw(sql, { id, partner });
            return data?.rows?.[0]?.email ?? null;
        } catch(e) {
            console.log('[ERROR GETTING USER REGION]', userId);
            return 'INDIA';
        }
    },
    addToPaymentDetails: async (paymentDetailsData) => {
        // Insert new record into payment_details table
        const insertedPaymentDetails = await knex('payment_details').insert(paymentDetailsData).returning('*');
        return insertedPaymentDetails;
    },
    getLatestMobileRedeemReq: async (userId) => {
        try {
            const knexClient = knexReadOnly;

            const sqlQuery =`select * from redeem where userid = :userId and mobile is not null order by id desc limit 1`;
            const res = await knexClient.raw(sqlQuery, { userId });
            if(res?.rows?.length > 0){
                return res.rows[0].mobile;
            }else{
                return null
            }
        } catch (e) {
            throw e;
        }
    },
    getLatestMobilePaymentReq: async (userId) => {
        try {
            const knexClient = knexReadOnly;

            const sqlQuery =`select * from payments where userid = :userId and metadata is not null order by id desc limit 1`;
            const res = await knexClient.raw(sqlQuery, { userId });
            if(res?.rows?.length > 0){
                let metadata =  res.rows[0].metadata;
                return metadata?.mobile ?? null;
            }else{
                return null
            }
        } catch (e) {
            throw e;
        }
    },
    isFirstTrade: async (userId) => {
        try {
            const knexClient = knexReadOnly;
            const sql = `SELECT count(id) = 1 as is_first_trade from transactions t inner join transaction_breakup tb using (id)
            WHERE tb.userid = :userId AND tb.probeid is not null`;
            const res = await knexClient.raw(sql, { userId });
            return res.rows?.[0]?.is_first_trade ?? false;
        } catch(e) {
            console.log("FIRST TRADE CHECK ERROR", e.message);
            return false; 
        }
    }

};

async function comparePwd(pwdRef, pwdSrc) {
    let err, pass;
    if (!pwdRef) {
        TE('Password not set');
    }
    [err, pass] = await to(bcrypt_p.compare(pwdRef, pwdSrc));

    if (err) TE(err);

    if (!pass) TE('Invalid Password');

    return pass;
}
module.exports = User;
