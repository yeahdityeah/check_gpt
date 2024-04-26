'use strict';

const knex = require('../knex/knex.js');
const knexReadOnly = require('../knex/knex_readonly.js');
const { isLongEvent, trimDataSet } = require('../utils/redis.utilities/is.long.event');
const Probe = require('../models/probe');
const { TournamentInfo } = require('../utils/tournament.info.util');
const { to } = require('../services/util.service');

const ProbeV2 = {
    getProbeCallsOpen: function (dataObj) {
        var pageNo = dataObj['page'];
        let noOfResults = 100;
        let offSet = ((pageNo || 1) - 1) * noOfResults;
        let _whereStr = ` a.probeid = ?`;
        let _paramsList = [dataObj['probeid']];

        if (dataObj['callvalue']) {
            _whereStr += ` and a.callvalue = ?`
            _paramsList.push(dataObj['callvalue'])
        }
        if (dataObj['coins']) {
            _whereStr += ` and a.coins = ?`
            _paramsList.push(dataObj['coins'])
        }

        let _query = `SELECT callvalue, probeid, sum(noofcontracts)::int AS noofcontracts, coins, 0 as returns
                        FROM probecallsopen a
                        WHERE ${_whereStr}
                        GROUP BY coins, probeid, callvalue
                        ORDER BY coins desc`;
        return knex.raw(_query, _paramsList).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    getProbeCallsOpen2: function (dataObj, maxReturn, useReadOnly, schema = 'public') {
        const knexClient = useReadOnly === true ? knexReadOnly : knex;
        var pageNo = dataObj['page'];
        let noOfResults = 100;
        let offSet = ((pageNo || 1) - 1) * noOfResults;
        let _whereStr = ` a.probeid = ?`;
        let _paramsList = [dataObj['probeid']];

        if (dataObj['callvalue']) {
            _whereStr += ` and a.callvalue = ?`
            _paramsList.push(dataObj['callvalue'])
        }
        if (dataObj['coins']) {
            _whereStr += ` and a.coins = ?`
            _paramsList.push(dataObj['coins'])
        }
        let userId = dataObj['userid'];

        let cv1 = dataObj['callvalue'] == 'Y' ? 'N' : 'Y';

        let _query = `select a.callvalue, sum(a.noofcontracts)::int AS noofcontracts, a.coins, a.returns, a.probeid from (
                        SELECT a.callvalue, a.probeid, sum(a.noofcontracts)::int AS noofcontracts, a.coins, 0 as returns
                        FROM :schema:.probecallsopen a
                        WHERE  a.userid != ${userId} and a.probeid =  ${dataObj['probeid']} and a.callvalue='${dataObj['callvalue']}' and a.status = 'A' GROUP BY a.coins, a.probeid, a.callvalue
                        UNION ALL
                        SELECT CASE WHEN b.callvalue = 'Y' THEN 'N' ELSE 'Y' END AS callvalue, b.probeid, sum(b.noofcontracts)::int AS noofcontracts, round( CAST(float8 (${maxReturn} - b.coins) as numeric), 2) as coins, 0 as returns
                        FROM :schema:.probecallsopen b
                        WHERE  b.userid != ${userId} and b.probeid =  ${dataObj['probeid']} and b.callvalue = '${cv1}' and b.status = 'H' GROUP BY b.coins, b.probeid, b.callvalue
                        ) a group by coins, callvalue, a.returns, a.probeid ORDER BY a.coins desc`;
        return knexClient.raw(_query, { schema }).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    getMyBetsV2: async function (data) {
        let pageNo = data['page'];
        let whereClause = ` where 1=1 and b.userid = ? and type = 'Bet' `;
        let noOfResults = 100;
        let offSet = ((pageNo || 1) - 1) * noOfResults;
        let paramsArray = [noOfResults, offSet]
        paramsArray = [data['userid']];
        if (data['eventid']) {
            whereClause += ` and a.id = ? `;
            paramsArray.push(data['eventid']);
        }
        if (data['eventsStatus']) {
            whereClause += ` and a.status in ( ? ) `;
            paramsArray.push(knex.raw(data['eventsStatus']));
        }
        let orderByClause = ' ORDER BY a.id DESC ';
        if (data['eventsStatus'] && data['eventsStatus'] === 'C') {
            orderByClause = ' ORDER BY a.settledate ';
        }
        const sql = `SELECT a.id, a.createdat, a.start_date, a.settledate, a.endsat, a.totalamount, a.is_price_editable, 
                    a.type, a.imageurl, a.title, a.resolution, a.source, a.is_variable_liquidity_pool, a.liquidity_fee_factor
                        , b.calls
                FROM  probes a
                LEFT  JOIN (
                    SELECT  probeid, userid, json_agg( json_build_object( 'rank', b.rank, 'coins', b.coins, 'callvalue', b.callvalue, 'userid', b.userid, 'noofcontracts', b.n, 'orderid', b.orderid, 'status', b.status, 'createdat', b.createdat, 'lastprice', b.lastprice ))  as calls
                    FROM   ( select -1 as rank, m.userid, m.probeid, m.callvalue, m.coins, m.status, sum(noofcontracts) as n, m.orderid, m.createdat, m.lastprice from probecallsopen m where m.status in ('A', 'H') and m.userid = ${data['userid']} group by m.userid, m.probeid, m.callvalue, m.coins, m.status, m.orderid, m.createdat, m.lastprice
                    UNION
                    SELECT  n.rank, n.userid, n.probeid, n.callvalue, CASE WHEN n.status = 'H' THEN n.lastprice ELSE n.coins END as coins, CASE WHEN n.status = 'H' THEN 'A' ELSE n.status END as status, sum(noofcontracts) as n, n.orderid, n.createdat, n.lastprice from probecalls n where n.status in ('A', 'H') and n.userid = ${data['userid']} group by n.rank, n.userid, n.probeid, n.callvalue, n.coins, n.status, n.orderid, n.createdat, n.lastprice  ) b
                    GROUP  BY userid, probeid
                    ) b ON b.probeid = a.id
                ${whereClause}
                ${orderByClause}
                ${data.limit ? ' LIMIT 1 OFFSET 0 ' : ''}
                `;
        return knexReadOnly.raw(sql, paramsArray).then(async (res) => {
            const response = res.rows;
            // const response = await modifyTournamentRows(res.rows);
            return response;
        }).catch((e) => {
            throw e;
        })
    },
    addToSlippageTracker: async (dataObj) => {
        try {
            var res = await knex('slippage_tracker')
                .insert({ userid: dataObj['userid'], probeid: dataObj['probeid'], execution_price: dataObj['execution_price'], display_price: dataObj['display_price'], total_trade_amt: dataObj['total_trade_amt'], no_of_shares: dataObj['no_of_shares'], slippage_percentage: dataObj['slippage_percentage'] })
                .returning(['id', 'userid', 'probeid', 'execution_price', 'display_price']);
            return res;
        } catch (e) {
            throw e;
        }
    },
    //probecalls table matched orders saved usmei jaake userid probeid  order by id highest value of id is the execution price
    //instant match or cda ispriceeditable in probes table 
    getLatestProbeData: async function (userId, probeId, status) {
        let sqlQuery = `select * from probecalls where userid = ? and probeid = ? and status = ? order by id desc limit 1`;
        let pArray = [userId, probeId, status];
        return knex.raw(sqlQuery, pArray)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getUserProbeOrderIdsAfterTs: async function (userId, probeId, callValue, ts, schema = 'public') {
        const whereClause = `userid = :userId and probeid = :probeId and callvalue = :callValue and createdat >= :ts`;
        let _query = `
                select distinct(a.orderid) from (
                    select orderid
                    from :schema:.probecallsopen
                    where ${whereClause}
                union
                    select orderid
                    from :schema:.probecalls
                    where ${whereClause}
                ) a`;
        return knex.raw(_query, {
            userId, probeId, callValue, ts, schema
        }).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },

    getMyBets: async function (data, useReadOnly, schema = 'public') {
        const knexClient = useReadOnly === true ? knexReadOnly : knex;
        let pageNo = data['page'];
        let whereClause = ' where 1=1 and b.userid = ? ';
        let noOfResults = 100;
        let offSet = ((pageNo || 1) - 1) * noOfResults;
        let paramsArray = [noOfResults, offSet]
        paramsArray = [data['userid']];
        if (data['eventid']) {
            whereClause += ` and a.id = ? `;
            paramsArray.push(data['eventid']);
        }
        if (data['eventsStatus']) {
            whereClause += ` and a.status in ( ? ) `;
            paramsArray.push(knex.raw(data['eventsStatus']));
        }
        let orderByClause = ' ORDER BY a.id DESC ';
        if (data['eventsStatus'] && data['eventsStatus'] === 'C') {
            orderByClause = ' ORDER BY a.settledate ';
        }

        let sql = knex.raw(`SELECT a.*
        , true as news_available
        , b.calls
FROM  :schema:.probes a
LEFT  JOIN (
    SELECT  probeid, userid, json_agg( json_build_object( 'rank', b.rank, 'coins', b.coins, 'callvalue', b.callvalue, 'userid', b.userid, 'noofcontracts', b.n, 'orderid', b.orderid, 'status', b.status, 'createdat', b.createdat, 'lastprice', b.lastprice ) order by b.createdat desc)  as calls
    FROM   ( select -1 as rank, m.userid, m.probeid, m.callvalue, m.coins, m.status, sum(noofcontracts) as n, m.orderid, m.createdat, m.lastprice from :schema:.probecallsopen m where m.status!='I' group by m.userid, m.probeid, m.callvalue, m.coins, m.status, m.orderid, m.createdat, m.lastprice
    UNION
    SELECT  n.rank, n.userid, n.probeid, n.callvalue, n.coins, n.status, sum(noofcontracts) as n, n.orderid, n.createdat, n.lastprice from :schema:.probecalls n where n.status!='I' group by n.rank, n.userid, n.probeid, n.callvalue, n.coins, n.status, n.orderid, n.createdat, n.lastprice  ) b
    GROUP  BY userid, probeid
    ) b ON b.probeid = a.id`, { schema }).toSQL().sql;
        sql = ` ${sql}
                ${whereClause}
                ${orderByClause}
                ${data.limit ? ' LIMIT 1 OFFSET 0 ' : ''}
                `;
        return knexClient.raw(sql, paramsArray).then(async (res) => {
            const response = await modifyTournamentRows(res.rows);
            return response;
        }).catch((e) => {
            throw e;
        })
    },

    getMyTournamentsParticipation: async function (data) {
        let pageNo = data['page'];
        let whereClause = ` where 1=1 and b.userid = ?  and type = 'Competition' `;
        let noOfResults = 100;
        let offSet = ((pageNo || 1) - 1) * noOfResults;
        let paramsArray = [noOfResults, offSet]
        paramsArray = [data['userid']];
        if (data['eventid']) {
            whereClause += ` and a.id = ? `;
            paramsArray.push(data['eventid']);
        }
        if (data['eventsStatus']) {
            whereClause += ` and a.status in ( ? ) `;
            paramsArray.push(knex.raw(data['eventsStatus']));
        }
        let orderByClause = ' ORDER BY a.id DESC ';
        if (data['eventsStatus'] && data['eventsStatus'] === 'C') {
            orderByClause = ' ORDER BY a.settledate ';
        }
        const sql = `SELECT a.id, a.createdat, a.start_date, a.settledate, a.endsat, a.totalamount, a.is_price_editable, 
                        a.type, a.imageurl, a.title, a.resolution, a.source, a.entryfee
                        , b.calls
                FROM  probes a
                LEFT  JOIN (
                    SELECT  probeid, userid, json_agg( json_build_object( 'rank', b.rank, 'coins', b.coins, 'callvalue', b.callvalue, 'userid', b.userid, 'noofcontracts', b.n, 'orderid', b.orderid, 'status', b.status, 'createdat', b.createdat ))  as calls
                    FROM   (
                                SELECT  n.rank, n.userid, n.probeid, n.callvalue, n.coins, n.status, sum(noofcontracts) as n, n.orderid, n.createdat, n.lastprice 
                                from probecalls n 
                                where n.userid = ${data['userid']} and rank = 0
                                group by n.rank, n.userid, n.probeid, n.callvalue, n.coins, n.status, n.orderid, n.createdat, n.lastprice  
                            ) b
                    GROUP  BY userid, probeid
                    ) b ON b.probeid = a.id
                ${whereClause}
                ${orderByClause}
                ${data.limit ? ' LIMIT 1 OFFSET 0 ' : ''}
                `;
        return knex.raw(sql, paramsArray).then(async (res) => {
            return await modifyTournamentRows(res.rows);
        }).catch((e) => {
            throw e;
        })
    },
    getProbeCallsStats: async function (data, useReadOnly, schema = 'public') {
        const knexClient = useReadOnly === true ? knexReadOnly : knex;
        let sql = `select sum(noofcontracts*coins) as sum, count(userid) as traders  from :schema:.probecallsopen where probeid=:probeId group by userid  
                    union all
                    select sum(noofcontracts*coins) as sum, count(userid) as traders  from :schema:.probecalls where probeid=:probeId and status <> 'O' group by userid`;
        // let paramsArray = [data['probeid'], data['probeid']]
        let probeId = data['probeid'];
        return knexClient.raw(sql, { schema, probeId }).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        })
    },
    getInvestedAmount: async function (userId, eventId, schema = 'public') {
        let sql = `select sum(a.invested) as invested from ( 
                      select case when status = 'A' THEN sum(noofcontracts*coins) else sum(noofcontracts * lastprice) END as invested 
                      from :schema:.probecallsopen 
                      where probeid = :eventId and userid = :userId group by userid, status
                    union all
                      select sum(noofcontracts*coins) as invested  
                      from :schema:.probecalls 
                      where probeid = :eventId and userid = :userId and status = 'A' group by userid, status
                    ) a`;
        let paramsArray = [eventId, userId, eventId, userId];
        return knexReadOnly.raw(sql, { userId, eventId, schema }).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        })
    },
    updateFilledCalls: async (ids, status) => {
        let _query = `update probecalls set status = '${status}' where id in (${ids.join(',')})`;
        return knex.raw(_query).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    getEventsCallsOpen: function (dataObj) {
        var pageNo = dataObj['page'];
        let noOfResults = 100;
        let offSet = ((pageNo || 1) - 1) * noOfResults;
        let _whereStr = ` a.probeid = ?`;
        let _paramsList = [dataObj['probeid']];

        if (dataObj['callvalue']) {
            _whereStr += ` and a.callvalue = ?`
            _paramsList.push(dataObj['callvalue'])
        }
        if (dataObj['coins']) {
            _whereStr += ` and a.coins = ?`
            _paramsList.push(dataObj['coins'])
        }
        if (dataObj['orderid']) {
            _whereStr += ` and a.orderid = ?`
            _paramsList.push(dataObj['orderid'])
        }
        if (dataObj['userid']) {
            _whereStr += ` and a.userid = ?`
            _paramsList.push(dataObj['userid'])
        }
        let _query = `SELECT a.*, -1 as rank, b.id as userid, b.fcmtoken
                        FROM  probecallsopen a 
                        JOIN users b ON a.userid = b.id
                        WHERE ${_whereStr}
                        ORDER BY id DESC`;
        return knex.raw(_query, _paramsList).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    getEventsCallsOpen2: function (dataObj) {
        var pageNo = dataObj['page'];
        let noOfResults = 100;
        let offSet = ((pageNo || 1) - 1) * noOfResults;
        let _whereStr = ` a.probeid = ?`;
        let _paramsList = [dataObj['probeid']];

        let probeId = dataObj['probeid'];
        let coins1 = dataObj['coins'];
        let coins2 = 100 - coins1;
        let callvalue1 = dataObj['callvalue'];
        let callvalue2 = callvalue1 == 'Y' ? 'N' : 'Y'

        if (dataObj['callvalue']) {
            _whereStr += ` and a.callvalue = ?`
            _paramsList.push(dataObj['callvalue'])
        }
        if (dataObj['coins']) {
            _whereStr += ` and a.coins = ?`
            _paramsList.push(dataObj['coins'])
        }
        if (dataObj['orderid']) {
            _whereStr += ` and a.orderid = ?`
            _paramsList.push(dataObj['orderid'])
        }
        if (dataObj['userid']) {
            _whereStr += ` and a.userid = ?`
            _paramsList.push(dataObj['userid'])
        }
        let userId = dataObj['userid'];
        let _query = `select c.*, b.id as userid, b.fcmtoken from (
                        SELECT a.*, -1 as rank
                        FROM  probecallsopen a where a.userid != ${userId} and a.probeid= ${probeId} and a.status = 'A' and a.coins = ${coins1} and a.callvalue = '${callvalue1}'
                        UNION
                        SELECT b.*, -1 as rank
                        FROM  probecallsopen b where b.userid != ${userId} and b.probeid= ${probeId} and b.status = 'H' and b.coins = ${coins2} and b.callvalue = '${callvalue2}'
                        ) c
                        JOIN users b ON c.userid = b.id
                        ORDER BY id DESC`;
        return knex.raw(_query).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    getUserCall: (dataObj) => {
        let _whereStr = ` a.probeid = ?`;
        let _paramsList = [dataObj['eventid']];
        if (dataObj['orderid']) {
            _whereStr += ` and a.orderid = ?`;
            _paramsList.push(dataObj['orderid']);
        }
        if (dataObj['userid']) {
            _whereStr += ` and a.userid = ?`;
            _paramsList.push(dataObj['userid']);
        }
        let _query = `SELECT a.*, b.id as userid, b.fcmtoken
                        FROM  probecalls a 
                        JOIN users b ON a.userid = b.id
                        WHERE ${_whereStr}
                        and a.rank = 0
                        ORDER BY a.id DESC`;
        return knex.raw(_query, _paramsList).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    getFilledOrders: (dataObj) => {
        let _whereStr = ` a.rank = 0 and a.status = 'A' `;
        let _paramsList = [];
        if (dataObj['orderid']) {
            _whereStr += ` and a.orderid = ? `;
            _paramsList.push(dataObj['orderid']);
        }
        if (dataObj['userid']) {
            _whereStr += ` and a.userid = ? `;
            _paramsList.push(dataObj['userid']);
        }
        let _query = `SELECT a.*
                        FROM  probecalls a 
                        WHERE ${_whereStr}
                        ORDER BY a.noofcontracts desc`;
        return knex.raw(_query, _paramsList).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    getExitOptions: (dataObj) => {
        let _whereStr = ` a.probeid = ? and a.userid != ? and a.status = 'A' `;
        let _paramsList = [dataObj['probeid'], dataObj['userid']];
        if (dataObj['callvalue']) {
            _whereStr += ` and a.callvalue = ?`
            _paramsList.push(dataObj['callvalue'])
        }
        if (dataObj['coins']) {
            _whereStr += ` and a.coins = ?`
            _paramsList.push(dataObj['coins'])
        }
        let _query = `SELECT a.*, -1 as rank, b.id as userid, b.fcmtoken
                        FROM  probecallsopen a 
                        LEFT JOIN users b ON a.userid = b.id
                        WHERE ${_whereStr}
                        ORDER BY a.noofcontracts DESC`;
        return knex.raw(_query, _paramsList).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    getBestExitOptions: async (dataObj) => {
        let _whereStr = ` a.probeid = ? and a.userid != ? and a.status = 'A' `;
        let _paramsList = [dataObj['probeid'], dataObj['userid']];
        if (dataObj['callvalue']) {
            _whereStr += ` and a.callvalue = ?`
            _paramsList.push(dataObj['callvalue'])
        }
        let _query = `SELECT a.*, -1 as rank, b.id as userid, b.fcmtoken
                        FROM  probecallsopen a 
                        LEFT JOIN users b ON a.userid = b.id
                        WHERE ${_whereStr}
                        ORDER BY a.coins DESC`;
        return knex.raw(_query, _paramsList).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    getProbeCallsWithUsers: async function (dataObj, schema = 'public') {
        var pageNo = dataObj['page'];
        let noOfResults = 100;
        let offSet = ((pageNo || 1) - 1) * noOfResults;
        let sqlParams = [dataObj['probeid']];
        let whereClause = ` where 1 = 1 and a.probeid = ? and a.status in ('A','H') `;
        if (dataObj['userid']) {
            whereClause += ` and a.userid = ? `;
            sqlParams.push(dataObj['userid']);
        }
        if (dataObj['rank']) {
            whereClause += ` and a.rank = ? `;
            sqlParams.push(dataObj['rank']);
        }
        let sql = `SELECT a.*, b.id as userid, b.fcmtoken
                    ${knex.raw("FROM :schema:.probecalls a", { schema }).toSQL().sql} 
                    JOIN users b ON a.userid = b.id
                    ${whereClause}
                    ORDER BY id desc`;
        return knex.raw(sql, sqlParams).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    getEventCallsByEventId: async (eventId, schema = 'public') => {
        let sql = `Select a.*, b.type from :schema:.probecalls a left join :schema:.probes b on a.probeid = b.id where probeid = ${eventId} order by a.createdat desc`;
        return knex.raw(sql, { schema }).then((res) => {
            return res.rows.length > 0 ? res.rows : [];
        }).catch((err) => {
            throw err;
        })
    },
    getPreviousTimeSeries: async (dataObj) => {
        const eventId = dataObj['eventid'];
        const longEventFlag = await isLongEvent(eventId);
        const timeUnit = (longEventFlag) ? 'days' : 'hours';
        const sqlParams = [timeUnit, eventId];

        let _probeInfo, _probesObject, err;
        [err, _probesObject] = await to(Probe.getProbes({ 'probeid': eventId, 'isDashboardUser': false, isInternalTestUser: false }));
        if (err) throw err;
        _probeInfo = _probesObject.rows;
        /* Case-1 Using average over a time period! */
        let sql = `select t as time, avg(coins) as price from (
            SELECT date_trunc(?, createdat):: timestamp as t, coins FROM probecalls where probeid = ? and callvalue = 'Y'
            ) a group by a.t order by a.t asc;`
        // let sql = `select a.time, b.coins as price from
        // (SELECT a.t as time, max(a.id) as id from
        // (SELECT date_trunc(?, createdat):: timestamp as t, id FROM probecalls
        //  where probeid = ? and callvalue = 'Y')a
        // group by a.t order by a.t)a left join (select id, coins from probecalls)b on a.id = b.id;`;

        return knex.raw(sql, sqlParams).then((res) => {
            // let dataSet = await trimDataSet(res.rows, _probeInfo[0]['totalamount']);
            // if (dataSet.length > 0) {
            //     const lastDataPoint = await ProbeV2.getLastTraded(eventId, timeUnit);
            //     dataSet.push(lastDataPoint);
            // }
            let dataSet = res.rows;
            return dataSet;
        }).catch((err) => {
            throw err;
        });
    },
    // getLastTraded: async (eventId, timeUnit) => {
    //     const sqlParams = [timeUnit, eventId];
    //     let sql = `select date_trunc(?, createdat):: timestamp as time, coins as price from probecalls where probeid = ? and callvalue = 'Y' and status <> 'CAN'
    //      order by id desc limit 1`;
    //     return knex.raw(sql, sqlParams).then((res) => {
    //         return res.rows[0];
    //     }).catch((e) => {
    //         throw e;
    //     })
    // },
    getTimeSeries: async (dataObj, schema = 'public') => {
        const eventId = dataObj.eventId;
        const longEventFlag = await isLongEvent(eventId);
        const timeUnit = (longEventFlag) ? 'days' : 'second';
        const sqlParams = { timeUnit, eventId, schema };
        let sql = `select cp_history, latest_cp_yes,
        date_trunc(:timeUnit, updated_at):: timestamp as time  
        from :schema:.current_price where probeid = :eventId and latest_cp_yes is not null`;
        let _probeInfo, _probesObject, err;
        [err, _probesObject] = await to(Probe.getProbes({ 'probeid': eventId, 'isDashboardUser': false, isInternalTestUser: false }, 1, schema));
        if (err) throw err;
        _probeInfo = _probesObject.rows;
        return knex.raw(sql, sqlParams).then(async (res) => {
            let dataSet = await trimDataSet(res.rows[0].cp_history, _probeInfo[0]['totalamount']);
            if (dataSet.length > 0) {
                const lastDataPoint = { time: res.rows[0].time, price: res.rows[0].latest_cp_yes };
                dataSet.push(lastDataPoint);
            }
            return res.rows[0].cp_history;
        }).catch((err) => {
            throw err;
        });
    },
    getBetsCountByUserId: async (userId) => {
        if (!userId) {
            throw new Error("UserId must not be a falsy value");
        }
        const sqlParams = [userId, userId];
        let sql = `select count(id) as count from probecallsopen where userid = ? group by userid  
                    union all
                    select count(id) as count from probecalls where userid = ? group by userid`;

        return knex.raw(sql, sqlParams).then((res) => {
            return res.rows.length;
        }).catch((e) => {
            throw e;
        })
    },
    getRecentlySettledProbeIds: async () => {
        const sql = `Select id from probes 
        where status='C' and EXTRACT(EPOCH FROM (now()-settledate)) < 86400 order by id desc`;
        return knex.raw(sql).then((res) => {
            return res.rows.length > 0 ? res.rows : [];
        }).catch((e) => {
            throw e;
        })
    },
    getClosedUnsettledProbeIds: async () => {
        const sql = `Select distinct(a.probeid), b.status, b.title from probecallsopen a
        inner join probes b on b.id = a.probeid 
        where b.endsat < now() and b.settledate > now() and b.type = 'Bet'
        order by a.probeid desc`;
        return knex.raw(sql).then((res) => {
            return res.rows.length > 0 ? res.rows : [];
        }).catch((e) => {
            throw e;
        })
    },
    getEvent: async (eventId, columns, schema = 'public') => {
        try {
            // const colString = columns.join(',');
            const res = await knex.withSchema(schema).table('probes').where({ id: eventId }).select(...columns);
            return res[0];
        } catch (e) {
            throw e;
        }
    },
    getUserAvgBuyPrice: async (userId, eventId, callvalue) => {
        try {
            const sqlQuery = `
                with closed_trades as (
                    select 
                        n.probeid as id,
                        n.id as trade_id,
                        0 as rank,
                        n.callvalue,
                        n.noofcontracts,
                        n.userid,
                        n.orderid,
                        n.lastprice,
                        n.createdat,
                        CASE WHEN n.status = 'H' THEN n.lastprice ELSE n.coins END as coins, 
                        CASE WHEN n.status = 'H' THEN 'A' ELSE n.status END as status 
                    from probecalls n
                    where n.status in ('A', 'H') and n.userid = ${userId} and n.probeid = ${eventId} and n.rank != -1
                ), closed_stats as (
                    select 
                    id,
                    sum (noofcontracts*coins)/COALESCE(NULLIF(sum(noofcontracts), 0), 1) as price
                    from closed_trades  where callvalue = '${callvalue}' group by id
                )
                select * from closed_stats
            `
            return knex.raw(sqlQuery)
                .then((res) => {
                    if (res['rows'])
                        return res['rows'].length ? res['rows'][0] : null
                }).catch((err) => {
                    throw err;
                });
        } catch (e) {
            throw e;
        }
    },
    getCDACurrentPrice: function (probeId, useReadOnly = true, schema = 'public') {

        const _query = `with probe as (
            select id, totalamount 
            from :schema:.probes 
            where 
                id = :probeId and 
                status in ('A', 'H') and
                parent_id <> '-1' and 
                is_price_editable = true
        ), pco as (
            SELECT
                case when status = 'H' then 100 - COALESCE(coins, 0) else coins end as coins,
                case when status = 'H' then
                case when callvalue = 'Y' THEN 'N' ELSE 'Y' END  else
                callvalue end as callvalue,
                probeid
            from :schema:.probecallsopen
            where probeid = :probeId
        ), proptions as (
            select callvalue, 0 as amt, id as probeid 
            from probe, unnest(ARRAY['Y', 'N']) callvalue
        ), stats as (
            select
                COALESCE(max(coins), 0) as max,
                COALESCE(pco.callvalue, proptions.callvalue) as callvalue,
                COALESCE(pco.probeid, proptions.probeid) as probeid
            from proptions left join pco on 
                proptions.callvalue = pco.callvalue and
                proptions.probeid = pco.probeid
            group by 
                COALESCE(pco.callvalue, proptions.callvalue), 
                COALESCE(pco.probeid, proptions.probeid)
        ), params as (
            select totalamount as maxreturns, stats.* from stats, probe
        ), cp as (
                select 
                    :probeId as id,
                    y.maxreturns,
                    case 
                        when (y.maxreturns + y.max - n.max)/2 > y.maxreturns/2 
                        then floor((y.maxreturns + y.max - n.max)/2) 
                        else ceil((y.maxreturns + y.max - n.max)/2) end as "yCP",
                    now() as "timestamp"
            from 
                (select * from params where callvalue = 'Y') y inner join
                (select * from params where callvalue = 'N') n using (probeid)
    
        )
        select *, maxreturns - "yCP" as "nCP"  from cp`;
        const knexClient = useReadOnly === true ? knexReadOnly : knex;
        return knexClient.raw(_query, {
            probeId, schema
        }).then((res) => {
            return res.rows;
        }).catch((e) => {
            console.log("ERROR IN QFN", e)
            throw e;
        });
    },
    getCDABestPrice: function (probeId, useReadOnly = true, schema = 'public') {

        let _query = `with probe as (
            select id, totalamount, range
            from :schema:.probes 
            where 
                id = :probeId and 
                status in ('A', 'F', 'H') and
                parent_id <> '-1' and 
                is_price_editable = true
        ), pco as (
            SELECT
                case when status = 'H' then 100 - COALESCE(coins, 0) else coins end as coins,
                case when status = 'H' then
                case when callvalue = 'Y' THEN 'N' ELSE 'Y' END  else
                callvalue end as callvalue,
                probeid
            from :schema:.probecallsopen
            where probeid = :probeId
        ), proptions as (
            select callvalue, 0 as amt, id as probeid 
            from probe, unnest(ARRAY['Y', 'N']) callvalue
        ), stats as (
            select
                COALESCE(max(coins), 0) as max,
                COALESCE(pco.callvalue, proptions.callvalue) as callvalue,
                COALESCE(pco.probeid, proptions.probeid) as probeid
            from proptions left join pco on 
                proptions.callvalue = pco.callvalue and
                proptions.probeid = pco.probeid
            group by 
                COALESCE(pco.callvalue, proptions.callvalue), 
                COALESCE(pco.probeid, proptions.probeid)
        ), params as (
            select totalamount as maxreturns, range, stats.* from stats, probe
        ), cp as (
                select 
                    :probeId as id,
                    y.maxreturns,
                    case when y.max = 0 then 50 else 100 - y.max end as "nCP",
                    case when n.max = 0 then 50 else 100 - n.max end as "yCP",
                    case when y.max = 0 then null else 100 - y.max end as "portfolioNCP",
                    case when n.max = 0 then null else 100 - n.max end as "portfolioYCP",
                    case
                        when n.max = 0 and y.max = 0 then 50
                        when n.max != 0 and y.max = 0 then n.max
                        when y.max != 0 then 100 - y.max
                    end as "newNCP",
                    case
                        when n.max = 0 and y.max = 0 then 50
                        when n.max = 0 and y.max != 0 then y.max
                        when n.max != 0 then 100 - n.max
                    end as "newYCP",
                    now() as "timestamp"
            from 
                (select * from params where callvalue = 'Y') y inner join
                (select * from params where callvalue = 'N') n using (probeid)
    
        )
        select * from cp`;

        const knexClient = useReadOnly === true ? knexReadOnly : knex;
        return knexClient.raw(_query, {
            probeId,
            schema
        }).then((res) => {
            return res.rows;
        }).catch((e) => {
            console.log("ERROR IN QFN", e)
            throw e;
        });
    },
    getLeadershipProbes: async (probeId) => {
        try {
            const sqlCDA = `with p as (select :probeId::int as id),
                              open_values
                                  as (SELECT case when status = 'H' then 100 - COALESCE(coins, 0) else coins end as coins,
                                             case
                                                 when status = 'H' then
                                                     case when callvalue = 'Y' THEN 'N' ELSE 'Y' END
                                                 else
                                                     callvalue end                                               as callvalue,
                                             probeid
                                      from probecallsopen,
                                           p
                                      where probeid = p.id),
                              current_price as (select (select p.id)           as id,
                                                       (select COALESCE(100 - max(coins), 50)
                                                        from open_values
                                                        where callvalue = 'Y') as "yCP",
                                                       (select COALESCE(100 - max(coins), 50)
                                                        from open_values
                                                        where callvalue = 'N') as "nCP"
                                                from p),
                              closed_stats as (select userid,
                                                      p.id,
                                                      sum(noofcontracts * coins)                                   as closed_investment,
                                                      sum(case when callvalue = 'Y' then noofcontracts * coins else 0 end) /
                                                      COALESCE(NULLIF(
                                                                       sum(case when callvalue = 'Y' then noofcontracts else 0 end),
                                                                       0), 1)                                      as
                                                                                                                      avg_price_matched_contract_yes,
                                                      sum(case when callvalue = 'N' then noofcontracts * coins else 0 end) /
                                                      COALESCE(NULLIF(
                                                                       sum(case when callvalue = 'N' then noofcontracts else 0 end),
                                                                       0), 1)                                      as
                                                                                                                      avg_price_matched_contract_no,
                                                      sum(case when callvalue = 'Y' then noofcontracts else 0 end) as total_matched_contract_yes,
                                                      sum(case when callvalue = 'N' then noofcontracts else 0 end) as total_matched_contract_no
                                               from probecalls n,
                                                    p
                                               where n.status in ('A', 'H')
                                                 and n.rank <> -1
                                                 and n.probeid = p.id
                                               group by userid, p.id),
                              open_stats as (select userid,
                                                    p.id,
                                                    sum(noofcontracts * coins) as open_investment
                                             from probecallsopen n,
                                                  p
                                             where n.status in ('A', 'H')
                                               and n.probeid = p.id
                                             group by userid, p.id),

                              tb_breakup as (select userid,
                                                    probeid                       as id,
                                                    sum(coinsb + coinsd + coinsw) as winnings,
                                                    count(distinct tb.id)         as no_of_trades
                                             from transaction_breakup tb,
                                                  p
                                             where probeid = p.id
                                             group by userid, probeid),
                              results as (select tb.userid,
                                                 tb.id,
                                                 no_of_trades,
                                                 100 - "yCP"                    as yes_sell_price,
                                                 100 - "nCP"                    as no_sell_price,
                                                 -1 * COALESCE(winnings, 0)     as winnings,
                                                 COALESCE(c.total_matched_contract_yes, 0) * (100 - "yCP") +
                                                 COALESCE(c.total_matched_contract_no, 0) * (100 - "nCP") +
                                                 COALESCE(o.open_investment, 0) as current_value,
                                                 -1 * COALESCE(winnings, 0) +
                                                 COALESCE(c.total_matched_contract_yes, 0) * (100 - "yCP") +
                                                 COALESCE(c.total_matched_contract_no, 0) * (100 - "nCP") +
                                                 COALESCE(o.open_investment, 0) as profit
                                          from tb_breakup tb
                                                   left outer join
                                               closed_stats c using (userid, id)
                                                   left outer join
                                               open_stats o using (userid, id)
                                                   left outer join
                                               current_price cp using (id)
                                          order by -1 * COALESCE(winnings, 0) +
                                                   COALESCE(c.total_matched_contract_yes, 0) * (100 - "yCP") +
                                                   COALESCE(c.total_matched_contract_no, 0) * (100 - "nCP") desc)
                         select left(mobile, 2) || 'XXXXXX' || right(mobile, 2) as mobile, results.*
                         from
                             results inner join users
                         on results.userid = users.id
                         order by profit desc`

            const sqlIM = ` with p as (select :probeId::int as id),
                               le as (select probe_id               as id,
                                             price_per_contract_yes as "yCP",
                                             price_per_contract_no  as "nCP"
                                      from liquidity_events,
                                           p
                                      where probe_id = p.id
                                      order by liquidity_events.id desc limit 1
                              ),
                              open_values as (
                          SELECT
                              case when status = 'H' then 100 - COALESCE (coins, 0) else coins end as coins,
                              case when status = 'H' then
                              case when callvalue = 'Y' THEN 'N' ELSE 'Y' END else
                              callvalue end as callvalue,
                              probeid
                          from probecallsopen, p
                          where probeid = p.id
                              )
                              , current_price as (
                          select
                              (select p.id) as id,
                              (select COALESCE (100 - max (coins), 100) from open_values where callvalue = 'Y') as "yCP",
                              (select COALESCE (100 - max (coins), 100) from open_values where callvalue = 'N') as "nCP"
                          from p
                              ), closed_stats as (
                          select
                              userid,
                              p.id,
                              sum (noofcontracts * coins) as closed_investment,
                              sum ( case when callvalue = 'Y' then noofcontracts * coins else 0 end ) /
                              COALESCE (NULLIF (
                              sum ( case when callvalue = 'Y' then noofcontracts else 0 end ), 0 ), 1) as
                              avg_price_matched_contract_yes,
                              sum ( case when callvalue = 'N' then noofcontracts * coins else 0 end ) /
                              COALESCE (NULLIF (
                              sum ( case when callvalue = 'N' then noofcontracts else 0 end ), 0 ), 1) as
                              avg_price_matched_contract_no,
                              sum ( case when callvalue = 'Y' then noofcontracts else 0 end ) as total_matched_contract_yes,
                              sum ( case when callvalue = 'N' then noofcontracts else 0 end ) as total_matched_contract_no
                          from probecalls n, p
                          where
                              n.status in ('A'
                              , 'H')
                            and
                              n.rank <> -1
                            and
                              n.probeid = p.id
                          group by userid, p.id
                              ), open_stats as (
                          select
                              userid,
                              p.id,
                              sum (noofcontracts * coins) as open_investment
                          from probecallsopen n, p
                          where n.status in ('A', 'H') and n.probeid = p.id
                          group by userid, p.id
                              ),
                              tb_breakup as (
                          select
                              userid, probeid as id,
                              sum (coinsb + coinsd + coinsw) as winnings,
                              count (distinct tb.id) as no_of_trades
                          from transaction_breakup tb, p
                          where probeid = p.id
                          group by userid, probeid
                              ), results as (
                          select
                              tb.userid,
                              tb.id,
                              no_of_trades,
                              "yCP" as yes_sell_price,
                              "nCP" as no_sell_price,
                              -1 * COALESCE (winnings, 0) as winnings,
                              COALESCE (c.total_matched_contract_yes, 0) * "yCP" +
                              COALESCE (c.total_matched_contract_no, 0) * "nCP" +
                              COALESCE (o.open_investment, 0) as current_value,
                              -1 * COALESCE (winnings, 0) + COALESCE (c.total_matched_contract_yes, 0) * "yCP" +
                              COALESCE (c.total_matched_contract_no, 0) * "nCP" + COALESCE (o.open_investment, 0) as profit
                          from
                              tb_breakup tb left outer join
                              closed_stats c using (userid, id) left outer join
                              open_stats o using (userid, id) left outer join
                              le cp using (id)
                          order by -1 * COALESCE (winnings, 0) + COALESCE (c.total_matched_contract_yes, 0) * "yCP" +
                              COALESCE (c.total_matched_contract_no, 0) * "nCP" desc
                              )
            select left(mobile, 2) || 'XXXXXX' || right(mobile, 2) as mobile, results.*
            from
                results inner join users
            on results.userid = users.id where users.id != 89 
            order by profit desc`;
            const resp = await knexReadOnly.raw(sqlIM, {
                probeId: probeId
            })
            return resp.rows;
        } catch (e) {
            console.log("ERROR IN MYBETS V3", e)
            throw e;
        }
    },
    getMyBetsV3: async (userId, schema = 'public', probes = [], comment = '/*user query*/') => {

        try {
            let probesIn = '';
            if (probes && Array.isArray(probes) && probes.length > 0) {
                probesIn = [
                    'p.id IN (',
                    probes.join(','),
                    ') AND'
                ].join(' ')
            }
            const sql = `${comment}
            with closed_trades as (
                select 
                    p.id,
                    n.id as trade_id,
                    0 as rank,
                    n.callvalue,
                    n.noofcontracts,
                    n.userid,
                    n.orderid,
                    n.lastprice,
                    n.createdat,
                    CASE WHEN n.status = 'H' THEN n.lastprice ELSE n.coins END as coins, 
                    CASE WHEN n.status = 'H' THEN 'A' ELSE n.status END as status 
                from :schema:.probes p
                left join :schema:.probecalls n on p.id = n.probeid
                where 
                ${probesIn}
                p.status IN ('A', 'F', 'H')
                and	n.status in ('A', 'H') and
                n.rank <> -1 and
                p.type = 'Bet' and n.userid = :userId
            ), open_trades as (
                select 
                    p.id,
                    n.id as trade_id,
                    -1 as rank,
                    n.callvalue,
                    n.noofcontracts,
                    n.userid,
                    n.orderid,
                    n.lastprice,
                    n.createdat,	
                    n.coins, 
                    n.status
                from :schema:.probes p
                left join :schema:.probecallsopen n on p.id = n.probeid
                where 
                ${probesIn}
                p.status IN ('A','H') and
                n.status in ('A', 'H') and
                p.type = 'Bet' and n.userid = :userId
            ), trades as (
                select * from open_trades
                UNION ALL
                select * from closed_trades
            ), closed_stats as (
                select 
                 id,
                 sum(noofcontracts * coins) as closed_investment,
                 sum( case when callvalue = 'Y' then noofcontracts * coins else 0 end ) /
                   COALESCE(NULLIF(
                     sum( case when callvalue = 'Y' then noofcontracts else 0 end ), 0 ), 1) as 
                 avg_price_matched_contract_yes,
                 sum( case when callvalue = 'N' then noofcontracts * coins else 0 end ) /
                   COALESCE(NULLIF(
                     sum( case when callvalue = 'N' then noofcontracts else 0 end ), 0 ), 1) as 
                 avg_price_matched_contract_no,
                 sum( case when callvalue = 'Y' then noofcontracts else 0 end ) as total_matched_contract_yes,
                 sum( case when callvalue = 'N' then noofcontracts else 0 end ) as total_matched_contract_no
                from closed_trades group by id
            ), open_stats as (
                select 
                    id,
                    sum(noofcontracts * coins) as open_investment
                from open_trades
                group by id
            ), trade_stats as (
                select id, json_agg(
                    json_build_object(
                  'rank', "rank",
                  'coins', "coins",
                  'callvalue', "callvalue",
                  'userid', "userid",
                  'noofcontracts', "noofcontracts",
                  'orderid', "orderid",
                  'status', "status",
                  'createdat', "createdat",
                  'lastprice', "lastprice"
                    )
                ) as calls from trades
                group by id
            ) 
            select 
                    p.id,
                    p.probe_type,
                    p.createdat,
                    p.start_date,
                    p.settledate,
                    p.endsat,
                    p.totalamount,
                    p.is_price_editable,
                    p.type,
                    p.imageurl,
                    p.title,
                    p.subtitle,
                    p.alternate_title,
                    p.resolution,
                    p.source,
                    p.range,
                    p.liquidity_fee_factor,
                    p.is_variable_liquidity_pool,
                    p.max_allowed_position,
                    c.avg_price_matched_contract_yes,
                    c.avg_price_matched_contract_no,
                    c.total_matched_contract_yes,
                    c.total_matched_contract_no,
                    t.calls,
                    COALESCE(o.open_investment, 0) + COALESCE(c.closed_investment) as "total_investment",
                    COALESCE(o.open_investment, 0) + COALESCE(c.closed_investment) as "current_value"
            from 
                trade_stats t left outer join
                closed_stats c using (id) left outer join
                open_stats o using (id) left outer join
                :schema:.probes  p using (id) WHERE
                (
                    (p.is_price_editable) OR (
                            c.total_matched_contract_yes >= 0.1 OR
                            c.total_matched_contract_no >= 0.1 
                        )
                )
                order by p.id desc`
            const resp = await knexReadOnly.raw(sql, {
                userId,
                schema,
            })
            return resp.rows;
        } catch (e) {
            console.log("ERROR IN MYBETS V3", e)
            throw e;
        }
    },
    getRevenueNPnL: (userId, eventId) => {
        let sqlParams = [eventId, userId];
        let sqlQuery = `with markets_df as
        (
        select id as probeid
        from probes  where id = ?
        ),
        marketmakers as
        (select id as userid from users where id in (?) )
        select *,
        revenue + pnl_y_settled as gross_pnl_y_settled,
        revenue + pnl_n_settled as gross_pnl_n_settled
        from 
        (
        select a2.title,a1.probeid,
        sum(revenue) revenue,
        sum(case when userid in (select userid from marketmakers) then a1.pnl_y_settled else 0 end) as pnl_y_settled,
        sum(case when userid in (select userid from marketmakers) then a1.pnl_n_settled else 0 end) as pnl_n_settled
        from 
        (
        select a1.userid,
        a1.probeid,
        a1.revenue,
        a1.net_debit_credit + 100*(coalesce(a2.cntrct_y_matched_probecall, 0) + coalesce(a3.cntrct_y_matched_probecallopen,0)) + coalesce(a3.amt_unmatched_buy_probecallsopen, 0) as pnl_y_settled,
        a1.net_debit_credit + 100*(coalesce(a2.cntrct_n_matched_probecall, 0) + coalesce(a3.cntrct_n_matched_probecallopen,0)) + coalesce(a3.amt_unmatched_buy_probecallsopen, 0) as pnl_n_settled
        from 
        (
        select a1.userid, a1.probeid,
        (sum(a1.coinsd) + sum(a1.coinsb) + sum(a1.coinsw))*-1 as net_debit_credit,
        sum(a2.surcharge)*2 as revenue
        from
        (
        select * from transaction_breakup tb where probeid in (select probeid from markets_df)
        ) as a1
        inner join transactions as a2 on a1.id = a2.id
        group by  a1.userid, a1.probeid
        ) as a1
        left join 
        (
        select userid, probeid,
        sum(case when callvalue = 'Y' then noofcontracts else 0 end) as cntrct_y_matched_probecall,
        sum(case when callvalue = 'N' then noofcontracts else 0 end) as cntrct_n_matched_probecall
        from  probecalls p 
        where status in ('A') and probeid in (select probeid from markets_df) and rank <> -1
        and userid in (select userid from marketmakers )
        group by userid, probeid
        ) as a2
        on a1.userid = a2.userid and a1.probeid = a2.probeid
        left join 
        (
        select userid, probeid,
        sum(case when status = 'A' then coins*noofcontracts else 0 end) as amt_unmatched_buy_probecallsopen,
        sum(case when status = 'H' and callvalue = 'Y' then noofcontracts else 0 end) as cntrct_y_matched_probecallopen,
        sum(case when status = 'H' and callvalue = 'N' then noofcontracts else 0 end) as cntrct_n_matched_probecallopen
        from probecallsopen p 
        where probeid in (select probeid from markets_df)
        and userid in (select userid from marketmakers )
        group by userid, probeid
        ) as a3
        on a1.userid = a3.userid and a1.probeid = a3.probeid
        ) as a1 left join probes as a2 on a1.probeid = a2.id
        group by a2.title,a1.probeid
        ) as final_t`;
        return knexReadOnly.raw(sqlQuery, sqlParams).then((res) => {
            let dataSet = res.rows[0];
            return dataSet || {};
        }).catch((err) => {
            throw err;
        });
    }
}

const modifyTournamentRows = async (dataObj) => {
    try {
        for (let i = 0; i < dataObj.length; i++) {
            if (dataObj[i].type === 'Competition') {
                const participationCount = await Probe.getParticipationCountOnTournament(dataObj[i].id);
                dataObj[i]['participationcount'] = parseInt(participationCount, 10);

                const tournamentSpecificInfo = await Probe.getTournamentSpecificInfo(dataObj[i].id);
                if (tournamentSpecificInfo) {
                    dataObj[i]['prizemoney'] = tournamentSpecificInfo.max_pool;
                    dataObj[i]['maxplayers'] = tournamentSpecificInfo.max_players;
                    switch (tournamentSpecificInfo.max_players) {
                        case 2:
                            dataObj[i]['winningdistribution'] = TournamentInfo[0].tournamentinfo;
                            break;
                        case 3:
                            dataObj[i]['winningdistribution'] = TournamentInfo[1].tournamentinfo;
                            break;
                        case 4:
                            dataObj[i]['winningdistribution'] = TournamentInfo[2].tournamentinfo;
                            break;
                        case 5:
                            dataObj[i]['winningdistribution'] = TournamentInfo[3].tournamentinfo;
                            break;
                        case 10:
                            dataObj[i]['winningdistribution'] = TournamentInfo[4].tournamentinfo;
                            break;
                        case 20:
                            dataObj[i]['winningdistribution'] = TournamentInfo[5].tournamentinfo;
                            break;
                        case 50:
                            dataObj[i]['winningdistribution'] = TournamentInfo[6].tournamentinfo;
                            break;
                        case 100:
                            dataObj[i]['winningdistribution'] = TournamentInfo[7].tournamentinfo;
                            break;
                        case 200:
                            dataObj[i]['winningdistribution'] = TournamentInfo[8].tournamentinfo;
                            break;
                        case 500:
                            dataObj[i]['winningdistribution'] = TournamentInfo[9].tournamentinfo;
                            break;
                        case 1000:
                            dataObj[i]['winningdistribution'] = TournamentInfo[10].tournamentinfo;
                            break;
                        default:
                            dataObj[i]['winningdistribution'] = TournamentInfo[10].tournamentinfo;
                            break;
                    }
                }
            }
        }
        return dataObj;
    } catch (err) {

        throw err;
    }
}

module.exports = ProbeV2;
