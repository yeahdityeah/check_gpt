'use strict';

const lodash = require('lodash');
const knex = require('../knex/knex.js');
const knexReadOnly = require('../knex/knex_readonly.js');
const { to } = require('../services/util.service');
const { sortTypeList } = require('../utils/sort.list.util.js');
const { TournamentInfo } = require('../utils/tournament.info.util');
const { redisCaching } = require('../services/cache.service');
const { isDashboardUser } = require('../middleware/dashboard.user.js');
const crypto = require('crypto');
const { get } = require('lodash');
const Probe = {
    create: function (dataObj, schema = 'public') {
        // if (dataObj['endsat']) {
        //     dataObj['endsat'] = knex.raw(dataObj['endsat'])
        // }
        // if (dataObj['settledate']) {
        //     dataObj['settledate'] = knex.raw(dataObj['settledate'])
        // }
        // if (dataObj['start_date']) {
        //     dataObj['start_date'] = knex.raw(dataObj['start_date'])
        // }
        if (dataObj['tips']) {
            if (Array.isArray(dataObj.tips) && dataObj.tips.length > 0) {
                dataObj.tips = dataObj.tips.filter((tip) => {
                    if ((!tip.title && !tip.text && !tip.youtube_link && !tip.url) || (tip.title.length === 0 && tip.text.length === 0 && tip.youtube_link.length === 0 && tip.url.length === 0)) {
                        return;
                    }
                    if (!tip.title || tip.title.length === 0) {
                        delete tip.title
                    }
                    if (!tip.text || tip.text.length === 0) {
                        delete tip.text
                    }
                    if (!tip.youtube_link || tip.youtube_link.length === 0) {
                        delete tip.youtube_link
                    }
                    if (!tip.url || tip.url.length === 0) {
                        delete tip.url
                    }
                    return tip;
                });
            }
            dataObj['tips'] = JSON.stringify(dataObj['tips']);
        }
        delete dataObj.regions;
        delete dataObj.partners;
        /** Set liquidity_fee_factor as null for CDA */
        if (dataObj.isPriceEditable) {
            dataObj.liquidity_fee_factor = null
        }
        if (typeof dataObj.live_stats_props === 'string') {
            dataObj.live_stats_props = `"${dataObj.live_stats_props}"`
        }
        if (!('probe_type' in dataObj)) {
            dataObj['probe_type'] = 'normal'
        }
        if (typeof dataObj.probe_type_props === 'string') {
            dataObj.probe_type_props = `"${dataObj.probe_type_props}"`
        }
        return knex.withSchema(schema).insert(dataObj, 'id').into('probes').then((id) => {
            return id;
        }).catch(err => {
            throw err;
        });
    },
    update: function (dataObj, schema = 'public') {
        try {
            var updateObj = {};
            if (dataObj['tips'] && Array.isArray(dataObj.tips) && dataObj.tips.length > 0) {
                dataObj.tips = dataObj.tips.filter((tip) => {
                    if (!tip.title || tip.title.length === 0) {
                        delete tip.title
                    }
                    if (!tip.text || tip.text.length === 0) {
                        delete tip.text
                    }
                    if (!tip.youtube_link || tip.youtube_link.length === 0) {
                        delete tip.youtube_link
                    }
                    if (!tip.url || tip.url.length === 0) {
                        delete tip.url
                    }
                    return tip;
                });
                dataObj['tips'] = JSON.stringify(dataObj['tips']);
            } else {
                delete dataObj['tips'];
            }
            const colsArray = ['correctproptionid', 'status', 'sharelink', 'entryfee',
                'title', 'imageurl', 'resolution', 'correctvalue',
                'source', 'category', 'subcategory', 'endsat', 'settledate', 'description', 'type',
                'start_date', 'auto_match', 'settlement_proof', 'live_stats_props', 'live_stats_type',
                'probe_type', 'probe_type_props', 'settlement_description', 'range',
                'alternate_title', 'parent_id', 'tips', 'marketresolutionguidelines', 'marketresolutionyes',
                'marketresolutionno', 'marketresolutionnotes', 'marketresolutionopeningline', 'tooltip', 'liquidity_fee_factor', 'hashtags', 'subsubcat', 'subtitle', 'full_rules', 'max_trade_amount'];

            if (typeof dataObj.live_stats_props === 'string') {
                dataObj.live_stats_props = `"${dataObj.live_stats_props}"`
            }
            if (dataObj.live_stats_props != null && typeof dataObj.live_stats_props === 'object') {
                if (Object.keys(dataObj.live_stats_props).length == 0) {
                    delete dataObj['live_stats_props'];
                }
            }
            if (dataObj.max_trade_amount === null || parseInt(dataObj.max_trade_amount, 10) <= 0) {
                dataObj.max_trade_amount = null;
            } else if (isNaN(parseInt(dataObj.max_trade_amount, 10))) {
                delete dataObj.max_trade_amount;
            }

            for (let col of colsArray) {

                if (dataObj[col] || dataObj[col] === false || dataObj[col] === 0 ||
                    (typeof dataObj[col] === 'string' && dataObj[col].length === 0)) {
                    updateObj[col] = knex.raw('?', [dataObj[col]])
                }
                if (col === 'max_trade_amount' && (dataObj[col] === null || dataObj[col])) {
                    updateObj[col] = dataObj[col];
                }

            }

            /** Set liquidity_fee_factor as null for CDA */
            if (dataObj.isPriceEditable) {
                updateObj['liquidity_fee_factor'] = knex.raw('?', [null])
            }

            /** Set Hashtags to null if empty */
            if (dataObj.hashtags === '') {
                updateObj['hashtags'] = knex.raw('?', [null])
            }
            // if (dataObj.liveYTLinkID) {
            //     // updateObj['live_stats_props'] = knex.raw(`jsonb_set(live_stats_props, '{live_yt_link}', '"${dataObj.liveYTLinkID}"')`)                
            //     updateObj['live_stats_props'] = `{"live_yt_link": "${dataObj.liveYTLinkID}"}`
            // }


            return knex.withSchema(schema).table('probes').update(updateObj).where('id', dataObj['id']).returning(['id'].concat(colsArray));
        } catch (e) {
            throw e;
        }
    },
    createProbeOtion: function (dataObj) {
        return knex.insert(dataObj, 'id').into('proptions').then((id) => {
            return id;
        }).catch(err => {
            throw err;
        });
    },
    getLastTrades: function (probeid) {
        let sqlQuery = `(SELECT a.coins, a.noofcontracts, a.callvalue, a.status, a.updatedat FROM probecalls a 
                            WHERE a.probeid = ${probeid} and 
                                a.status in ('A') 
                        ORDER BY a.id DESC LIMIT 10 )
                    UNION ALL
                        (SELECT a.coins, a.noofcontracts, a.callvalue, a.status, a.updatedat FROM probecalls a 
                        WHERE a.probeid = ${probeid} and 
                            a.status in ('EX') 
                        ORDER BY a.id DESC LIMIT 10 )`;
        return knex.raw(sqlQuery)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getDeduectedAmount: async function (qData) {
        const { userId, eventId } = qData;
        let sql = `SELECT a.* FROM  transactions a WHERE txnid LIKE 'P1%${eventId}' AND userid = ${userId} limit 3`;
        return knex.raw(sql).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    getTransactionSettlements: function (eventId, schema = 'public') {
        let sql = `select a.*
        FROM  :schema:.transactions a where (txnid like 'S1%0${eventId}'  OR  txnid like 'SPTD%0${eventId}')
        UNION
        select b.*
        FROM  :schema:.transactions b where txnid like 'U1%0${eventId}'`;
        return knexReadOnly.raw(sql, { schema }).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    resetCallsRank: async (eventId, schema = 'public') => {
        try {
            let sql1 = `update ??.probecalls set rank = 0 where probeid = ${eventId} and rank = 1`;
            var res1 = await knex.raw(sql1, schema);
            // let sql2 = `update probecalls set rank = 0 where probeid = ${eventId} and rank = -1 and execid is not null`;
            // var res2 = await knex.raw(sql2);
            // let sql3 = `update probecalls set status = 'A' where probeid = ${eventId} and status = 'CN' and rank = 0 and execid is not null`;
            // var res3 = await knex.raw(sql3);
            return true;
        } catch (e) {
            throw e;
        }

    },
    resetProbeCallsForTournament: async (eventId) => {
        try {
            const sql1 = `update probecalls set rank = 0, returns = 0, tournament_rank = 0 where probeid = ${eventId} and rank = 1`;
            const _ = await knex.raw(sql1);
            return true;
        } catch (err) {
            throw err;
        }
    },
    deleteTransaction: function (eventId) {
        let sql = `select a.*
        FROM  transactions a where txnid like 'S1%${eventId}' 
        UNION
        select b.*
        FROM  transactions b where txnid like 'U1%${eventId}`;
        return knex.raw(sql, sqlParams).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },

    getProbesById: function (pbId, schema = 'public') {
        return knexReadOnly.withSchema(schema).table('probes')
            .select()
            .where({ id: pbId })
            .then((res) => {
                return res;
            }).catch((e) => {
                throw e;
            });
    },
    getProbes: async (data, limit, schema = 'public', userid = -1) => {
        const region = data['region'] ? data['region'] : null;
        const partner = data['partnerId'];
        const pageNo = data['page'];
        let whereClause = ` where 1=1 `;
        let query = knexReadOnly.withSchema(schema).table('probes');
        const noOfResults = data['isDashboardUser'] !== true ? 1000 : limit || 100;
        const offSet = ((pageNo || 1) - 1) * noOfResults;
        /** Common Functions */
        const addInCondition = (q, dataKey, columnKey, defaultValues) => {
            let filter = [];
            const val = get(data, dataKey, defaultValues);
            if(!val) {
                return q;
            }
            if(Array.isArray(val)) {
                filter = val;
            } else {
                filter =  String(val ?? '').split(',').map(i => i.trim().replace(/(^\')|(\'$)/gi, ''));
            }
            if(filter.length) {
                if(filter.length === 1) {
                    return q.where(columnKey, filter[0]);
                }
                return q.whereIn(columnKey, filter);
            }
            return q;
        }
        const addLikeCondition = (q, dataKey, columnKey) => {
            if(!data[dataKey]) {
                return q;
            }
            const val = ['%', String(data[dataKey]).toLowerCase(), '%'].join('');
            return q.whereRaw(`lower(:columnKey:) LIKE :val`, { columnKey, val });
        }

        query.select('probes.id');
        query = addInCondition(query, 'status', 'probes.status', 'A,H');
        
        query = addInCondition(query, 'category', 'category');
        query = addInCondition(query, 'hashtags', 'hashtags');

        if (schema === 'fantasy' && data['fantasy'] && data?.fantasy?.fantasy_type && data?.fantasy?.fantasy_id) {
            query = addInCondition(query, 'fantasy.fantasy_type', 'fantasy_type');
            query = addInCondition(query, 'fantasy.fantasy_id', 'fantasy_id');
        }
        if (data['probeid']) {
            query = addInCondition(query, 'probeid', 'probes.id');
        }

        if (!data['isDashboardUser']) {
            query = query.where(knex.raw(' endsat > now() '));
            query.where('type', 'Bet');
            query.where('is_internal', false);
            
            whereClause += `and a.type = 'Bet'`;
            query = query.where(knex.raw(" start_date <= now() - interval '30 sec' "));
            if(parseInt(partner) !== 1) {
                data['probe_type'] = (data['probe_type'] ?? '').replace(/promo\,?/g, '');                
            }
            if(!data['probeid'] && schema === 'public') {
                query = query.where(function() {
                    return addInCondition(this, 'probe_type', 'probe_type', 'exclude,normal')   ;
                });
            }

            if(data['isHashtagsNull']) {
                query.where(function() {
                    return this.whereNull('hashtags').orWhereRaw('length(hashtags) = 0')
                })
            }
            

            query.innerJoin('probes_partner', 'probes.id', 'probes_partner.probeid');
            query.leftJoin('probes_region', 'probes.id', 'probes_region.probeid');
            query.where('probes_partner.partner', partner);
            query.where(function() {
                return this.where('probes_region.region', region).orWhereNull('region');
            });
            query.select(knex.raw('array_remove(array_agg(distinct region), null) as regions'));
            query.select(knex.raw('array_remove(array_agg(distinct partner), null) as partners'));
            query.groupBy('probes.id'); 
            
        }

        if (data['isDashboardUser']) {
            if (data['term']) {            
                if (data['term'] == 'short') {
                    query = query.whereRaw("endsat < now() + interval '7 days'");
                } else if (data['term'] == 'long') {
                    query = query.whereRaw("endsat > now() + interval '7 days'");
                }
            }
            if(!data['probeid'] && schema === 'public') {
                query = query.where(function() {
                    return addInCondition(this, 'probe_type', 'probe_type', 'exclude,normal,promo')   ;
                });
            }
            query = addInCondition(query, 'tag', 'hashtags');
            query = addInCondition(query, 'subcat', 'subcategory');
            query = addLikeCondition(query, 'title', 'title');
            query = addLikeCondition(query, 'description', 'description');
            query.leftJoin('probes_partner', 'probes.id', 'probes_partner.probeid');
            query.leftJoin('probes_region', 'probes.id', 'probes_region.probeid');
            query.groupBy('probes.id'); 
            query.select(knex.raw('array_remove(array_agg(distinct region), null) as regions'));
            query.select(knex.raw('array_remove(array_agg(distinct partner), null) as partners'));
            
            if (data['datetype'] && data['filterstartdate'] && data['filterenddate']) {
                const dateCols = {
                    'Created': 'probes.createdat',
                    'Close': 'probes.endsat',
                    'Settle': 'probes.settledate',
                    'Start': 'probes.start_date'
                }
                if(dateCols[data['datetype']]) {
                    query = query.whereBetween(dateCols[data['datetype']], [data['filterstartdate'], data['filterenddate']])
                }
            }     
            if (data['isDashboardInternaluser'] === false) {
                query.where('createdby', data['dashboardUserId']);
            } 
            if (data['mmUser']) {
                query.leftJoin('mm_data', 'probes.id', 'mm_data.probeid');
                query.select('mm_data.probeid', 'mm_data.strategy1', 'mm_data.status as script_status', 'mm_data.marketid');
                
                query = query.where(function() {
                    return addInCondition(this, 'category', 'probes.category', 'Sports,Finance,News').orWhere('probes.probe_type', 'promo');
                });
                query.groupBy('mm_data.probeid', 'mm_data.strategy1', 'mm_data.status', 'mm_data.marketid');
            } else {
                query.limit(noOfResults).offset(offSet).orderBy('probes.id', 'desc');
            }
            
        }
        
       

        if (data['probeid'] && !data.isDashboardUser) {
            
            query.joinRaw(` LEFT JOIN (
                SELECT probeid, CAST(COUNT(DISTINCT userid) AS INTEGER) AS number_of_traders 
                FROM (
                    SELECT userid, probeid FROM ${schema}.probecalls
                    UNION
                    SELECT userid, probeid FROM ${schema}.probecallsopen
                ) AS combined
                GROUP BY probeid
            ) t ON probes.id = t.probeid `)
            query.select(knex.raw('sum( COALESCE(t.number_of_traders, 0) ) AS number_of_traders'));

        }


        
        
        
        let ordering = ` ORDER BY a.id desc `, sortByVolume = false;
        if (data['isDashboardUser'] === undefined || data['isDashboardUser'] === false) {
            if (data['sortingType']) {
                if (data['sortingType'] === sortTypeList[1].Id)
                    ordering = ` ORDER BY expiry_seconds `;
                else if (data['sortingType'] === sortTypeList[3].Id)
                    sortByVolume = true;
            }
            whereClause += `and a.type = 'Bet'`;
        } else {
            if (data['isDashboardInternaluser'] === false) {
                whereClause += ` and a.createdby = ${data['dashboardUserId']} `;
            }
        }

        let probesQuery = knexReadOnly.with('ids', query).select('*', knex.raw(`true as news_available,
        EXTRACT(EPOCH FROM (endsat - now())) as expiry_seconds,
        false AS trending, 
        CASE
            when a.category = 'Live' then false
            else true
        END as show_in_all,
        null as keywords, '[{"text": "YES", "id": 1}, {"text": "NO", "id": 2}]'::json as options, 
        0 as rank,
        string_to_array(hashtags, ',') as hashtags,
        string_to_array(subsubcat, ',') as subsubcat,
        string_to_array(subcat, ',') as tags`)).from('ids').joinRaw(' inner join :schema:.probes as a on ids.id = a.id', { schema })
        .whereRaw('a.id IN (SELECT id from ids)')
        .orderByRaw(ordering.replace(/ORDER BY/, '' ));
        
        
        
        let hashData = `${probesQuery.toSQL().toNative().sql}, ${probesQuery.toSQL().toNative().bindings.join('')}`;
        let hash = crypto.createHash('sha256', { defaultEncoding: "hex" });
        hash.update(hashData);        
        const newCacheKey =  `EVENT_${hash.digest('hex')}`;
        console.log("[QUERY]", newCacheKey, probesQuery.toSQL().toNative().sql, probesQuery.toSQL().toNative().bindings.join(''));  

        let unsettledEventQuerryWhereClause = '';
        if (data['isDashboardInternaluser'] === false) {
            unsettledEventQuerryWhereClause += ` and a.createdby = ${data['dashboardUserId']} `;
        }
        let unsettledEventQuerry = knex.raw(`SELECT a.* from :schema:.probes a WHERE a.settledate < now() AND status NOT IN ('C', 'CAN') ${unsettledEventQuerryWhereClause};`, { schema }).toSQL().sql
        let uEventsKey = `liveevents_unsettled_${data['dashboardUserId']}`;
        let probesObj = [], unsettledEvents = [], unsettledEventsCount = 0;

        if (data['isDashboardUser'] || data['isInternalTestUser'] || data['probeid']) {


            let xres = await probesQuery
            probesObj = xres;
        } else {
            const queryKey = `[GET PROBES] query user: ${userid}:  ${new Date().valueOf()}`;
            const queryKeyNew = `[GET PROBES] query new user: ${userid}:  ${new Date().valueOf()}`;
            
            var allEvents = await redisCaching.getKey(newCacheKey)
            // console.log(paramsArray, sql)
            if (!allEvents) {
                console.log(queryKey, 'CACHE MISS', newCacheKey);                
                console.time(queryKeyNew);
                let xres = await probesQuery;
                console.timeEnd(queryKeyNew);
                redisCaching.setKey(newCacheKey, JSON.stringify(xres), 30);
                probesObj = xres;
            } else {
                console.log(queryKey, 'CACHE HIT', newCacheKey);
                probesObj = JSON.parse(allEvents)
            }
            
        }
        probesObj = probesObj.map(p => ({
            ...p,
            id: Number(p.id)
        }))
        const queryKey2 = `[GET PROBES] modifyProbesObject user: ${userid}:  ${new Date().valueOf()}`;
        console.time(queryKey2);
        if (data?.probeid)
            probesObj = await modifyProbesObject(probesObj, schema);
        console.timeEnd(queryKey2);
        if (sortByVolume)
            probesObj = lodash.reverse(lodash.orderBy(probesObj, ['volume'], ['asc']));
        // if (data['probeid']) {
        //     probesObj = lodash.filter(
        //         probesObj, function (o) {
        //             return o.id == data['probeid'];
        //         }
        //     );
        // }
        let totalCount = probesObj.length;
        if (data['isDashboardUser']) {
            var allUnsettledEvents = await redisCaching.getKey(uEventsKey)
            if (!allUnsettledEvents) {
                let xres = await knex.raw(unsettledEventQuerry);
                redisCaching.setKey(uEventsKey, JSON.stringify(xres.rows), 30)
                unsettledEvents = xres.rows
            } else {
                unsettledEvents = JSON.parse(allUnsettledEvents)
            }
            unsettledEventsCount = unsettledEvents.length;
        }

        return { total: totalCount, rows: probesObj, unsettledEventCount: unsettledEventsCount, unsettledEvents: unsettledEvents };


    },
    getProbesMM: async (data, limit) => {
        const pageNo = data['page'];
        let whereClause = ` where 1=1`;
        const noOfResults = 100;
        const offSet = ((pageNo || 1) - 1) * noOfResults;
        let paramsArray = [noOfResults, offSet]
        if (data['category']) {
            let insertIndex = paramsArray.length - 2;
            whereClause += ' and lower(category) = ? ';
            paramsArray.splice(insertIndex, 0, data['category'].toLowerCase());
        }
        if (data['probeid']) {
            if (Array.isArray(data['probeid'])) {
                whereClause += ` AND a.id in (${data['probeid'].join(',')}) `;
            } else {
                whereClause += ' and a.id = ? ';
                let insertIndex = paramsArray.length - 2;
                paramsArray.splice(insertIndex, 0, data['probeid']);
            }

        }
        if (data['title']) {
            let insertIndex = paramsArray.length - 2;
            whereClause += ` and lower(a.title) LIKE '%?%' `;
            paramsArray.splice(insertIndex, 0, knex.raw(data['title'].toLowerCase()));
        }
        if (data['description']) {
            let insertIndex = paramsArray.length - 2;
            whereClause += ` and lower(a.description) LIKE '%?%' `;
            paramsArray.splice(insertIndex, 0, knex.raw(data['description'].toLowerCase()));
        }

        let ordering = ` ORDER BY a.id desc `, sortByVolume = false;

        const columns = ` a.id, a.totalamount, a.title, a.category, a.status, a.endsat , a.source, a.settledate, a.resolution, a.start_date , a.is_price_editable, a.max_allowed_position, a.subcategory, a.range, 
                    EXTRACT(EPOCH FROM (endsat - now())) as expiry_seconds,
                    b.keywords, 
                    string_to_array(a.hashtags, ',') as hashtags,
                    string_to_array(a.subsubcat, ',') as subsubcat,
                    string_to_array(a.subcat, ',') as tags`;
        const joins = ` LEFT JOIN 
                        (SELECT a.id, STRING_AGG(b.tag, ',') AS keywords 
                            FROM probes a LEFT JOIN tags b ON b.probeid = a.id 
                            where status = 'A' 
                            GROUP BY a.id ) b ON a.id = b.id `;
        const limitOffSet = ` LIMIT ? OFFSET ? `;
        const sql = `SELECT ${columns}
	                FROM probes a 
	                ${joins}
                    ${whereClause}
                    ${ordering}
                    ${limitOffSet}
                    `;
        let probesObj = [], unsettledEvents = [];
        let xres = await knex.raw(sql, paramsArray);
        probesObj = xres.rows
        probesObj = await modifyProbesObject(probesObj);
        return { rows: probesObj };
    },
    getTournaments: function (data) {
        let whereClause = `a.type = 'Competition' and a.status = 'A' and a.endsat > now() and a.start_date < now()`;
        if (!data['isInternalTestUser'] && !data['isDashboardUser']) {
            whereClause += ' and a.is_internal = false ';
        }
        let param = [];
        let orderByClause = ' order by a.id desc';
        if (data['probeid']) {
            if (isNaN(parseInt(data['probeid']))) {
                throw new Error(`Invalid Request parameter`);
            }
            whereClause += ` and a.id = ?`;
            param.push(data['probeid']);
        }
        let sql = `select a.*, c.options from probes a 
        left join (select a.id, COALESCE(json_agg(json_build_object('text', c.text, 'id', c.id, 'odds', c.odds )) 
        filter (where c.id is not null), '[]') as options from probes a left join proptions c ON c.probeid = a.id  
        group by a.id) c ON a.id = c.id where
        ${whereClause}${orderByClause}`;
        return knex.raw(sql, param).then(async (res) => {
            const tournamentRows = await modifyTournamentRows(res.rows);
            return tournamentRows;
        }).catch((err) => {
            throw err;
        })
    },
    getLeaderboard: function (data) {
        const eventId = data['probeid'];
        const sql = `Select a.*, b.displayname, b.avatar from 
        probecalls a 
        left join users b 
        on b.id = a.userid 
        where a.probeid = ${eventId} and a.returns != 0 order by tournament_rank limit 100`;
        return knex.raw(sql).then(async (res) => {
            return res.rows;
        }).catch((err) => {
            throw err;
        })
    },
    updateCall: function (data, schema = 'public') {
        return knex.withSchema(schema).table('probecalls')
            .where('id', '=', data.id)
            .update({
                rank: data.rank,
                returns: data.returns,
                updatedat: 'now()'
            });
    },
    updateCallTournamentRank: function (data) {
        return knex('probecalls')
            .where('id', '=', data.id)
            .update({
                tournament_rank: data.tournament_rank
            });
    },
    putCall: function (dataObj) {
        delete dataObj['fcmtoken'];
        delete dataObj['open'];
        return knex('probecalls').insert(dataObj).returning(['id', 'coins', 'userid', 'returns', 'proptionid', 'odds', 'callvalue', 'rank']);
    },
    putCallOpen: function (dataObj) {
        delete dataObj['fcmtoken'];
        return knex('probecallsopen').insert(dataObj).returning(['id', 'coins', 'userid', 'returns', 'proptionid', 'odds', 'callvalue']);
    },
    deleteCallOpen: function (dataObj, schema = 'public') {
        delete dataObj['rank'];
        delete dataObj['usersname'];
        delete dataObj['usersavatar'];
        delete dataObj['fcmtoken'];
        return knex.withSchema(schema).table('probecallsopen').where(dataObj).del().returning(['id', 'coins', 'userid', 'returns', 'proptionid', 'odds', 'callvalue']);
    },
    getProbeCalls: function (dataObj) {
        var pageNo = dataObj['page'];
        let noOfResults = 100;
        let offSet = ((pageNo || 1) - 1) * noOfResults;
        let sqlParams = [dataObj['probeid']];
        let whereClause = ` where 1 = 1 and a.probeid = ? `;
        if (dataObj['userid']) {
            whereClause += ` and a.userid = ? `;
            sqlParams.push(dataObj['userid']);
        }
        let sql = `select a.*
                    FROM  probecalls a 
                    ${whereClause}
                    order by id desc`;
        return knex.raw(sql, sqlParams).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    getUserProbeCalls: async function (probeIds, userId) {
        let whereClause = ` where 1 = 1 and a.probeid in (${probeIds.join(',')}) and a.userid = ${userId}`;
        let sql = `select distinct(a.probeid)
                    FROM  probecalls a
                    ${whereClause}`;
        return knex.raw(sql).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    getUserPrivateEventProbeCalls: async function (userId, schema = 'public') {
        let _query = `
        SELECT distinct (a.probeid) from
        (SELECT pc.probeid
                FROM  :schema:.probecalls pc
                JOIN :schema:.probes p ON pc.probeid = p.id
                WHERE p.is_private = true and pc.userid = :userId and pc.status <> 'CN'
        UNION
        SELECT pco.probeid
                FROM  :schema:.probecallsopen pco
                JOIN :schema:.probes p ON pco.probeid = p.id
                WHERE p.is_private = true and pco.userid = :userId and pco.status <> 'CN')a`
        return knex.raw(_query, { schema, userId }).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });

    },
    getUserCustomPrivateEvents: async function (userId) {
        let sql = `select a.probeid
                    FROM  custom_private_event_users a
                    where a.userid = ${userId}`;
        return knex.raw(sql).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    getUserCustomPrivateEventTradeCount: async function (userId, probeid, schema = 'public') {
        let _query = `
        select
        (SELECT count(*) FROM  :schema:.transactions a where userid = :userId and txnid LIKE 'P1%' || :probeid ) -
        (SELECT count(*) as trade_count FROM  :schema:.transactions a where userid = :userId and txnid LIKE 'CN%' || :probeid)
        as trade_count;
        `
        return knex.raw(_query, { schema, userId, probeid }).then((res) => {
            return res.rows.length ? res.rows[0].trade_count : 0
        }).catch((e) => {
            throw e;
        });
    },
    getCustomPrivateEvents: async function (activePrivateEvents) {
        let activeIds = activePrivateEvents.map(({ id }) => id)
        if (activeIds.length === 0) {
            return []
        }
        let sql = `select distinct(a.probeid)
                    FROM  custom_private_event_users a
                    WHERE a.probeid IN (${activeIds.join(',')})`;
        return knexReadOnly.raw(sql).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    isUserExistInPrivateEventUsers: async function (userId) {
        let _query = `
        SELECT distinct (a.userid) from
        (select pe.userid
                    FROM  private_event_users pe
                    where pe.userid = ${userId}
        UNION
        select cpe.userid
                    FROM  custom_private_event_users cpe
                    where cpe.userid = ${userId}) a`
        return knex.raw(_query).then((res) => {
            return res.rows.length ? true : false;
        }).catch((e) => {
            throw e;
        });
    },

    isUserExistInCustomPrivateEventUsers: async function (userId, probeId) {
        let sqlParams = [userId, userId, probeId];
        let whereClause1 = ` where 1 = 1 and pe.userid = ? `;
        let whereClause2 = ` where 1 = 1 and cpe.userid = ? and cpe.probeid = ? `;
        let _query = `
        SELECT distinct (a.userid) from
        (select pe.userid
                    FROM  private_event_users pe
                    ${whereClause1}
        UNION
        select cpe.userid
                    FROM  custom_private_event_users cpe
                    ${whereClause2}) a
        `
        return knex.raw(_query, sqlParams).then((res) => {
            return res.rows.length ? true : false;
        }).catch((e) => {
            throw e;
        });
    },
    addBatchUsersToPrivateEvent: async function (userList) {
        try {
            let chunksize = 1000;
            return knex.batchInsert('custom_private_event_users', userList, chunksize)
                .catch(function (error) { throw error; });
        } catch (err) {
            throw err;
        }
    },
    getProbeCallsWithUsers: function (dataObj) {
        var pageNo = dataObj['page'];
        let noOfResults = 100;
        let offSet = ((pageNo || 1) - 1) * noOfResults;
        let sqlParams = [dataObj['probeid']];
        let whereClause = ` where 1 = 1 and a.probeid = ? `;
        let orderByClause = `ORDER BY id desc`;
        if (dataObj['userid']) {
            whereClause += ` and a.userid = ? `;
            sqlParams.push(dataObj['userid']);
        }
        if (dataObj['rank']) {
            whereClause += ` and a.rank = ? `;
            sqlParams.push(dataObj['rank']);
        }
        if (dataObj['tournament'] && dataObj['tournament'] === true) {
            orderByClause = `ORDER BY id asc`;
        }
        let sql = `SELECT a.*, b.id as userid, b.fcmtoken
                    FROM  probecalls a 
                    JOIN users b ON a.userid = b.id
                    ${whereClause}
                    ${orderByClause}`;
        return knex.raw(sql, sqlParams).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    getPositions: function (dataObj) {
        let _query = `SELECT userid, probeid FROM probecallsopen 
        WHERE userid = ? and probeid = ?
        UNION SELECT userid, probeid FROM probecalls WHERE userid = ? and probeid = ? 
        limit 1`;
        let _paramsList = [dataObj['userid'], dataObj['probeid'], dataObj['userid'], dataObj['probeid']];
        return knex.raw(_query, _paramsList).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    getProbeCallsOpen: function (dataObj, schema = 'public') {
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
        let _query = `SELECT a.*, -1 as rank, b.id as userid, b.fcmtoken
                        ${knex.raw('FROM  :schema:.probecallsopen a', { schema }).toSQL().sql} 
                        JOIN users b ON a.userid = b.id
                        WHERE ${_whereStr}
                        ORDER BY id DESC`;
        return knex.raw(_query, _paramsList).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    getEventDeductions: function (qData) {
        const { userId, eventId } = qData;
        let sqlQuery = `select * from transactions where userid = ? and txnid like ?`;
        let sqlParams = [userId, `P1%${eventId}`]
        return knex.raw(sqlQuery, sqlParams)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getEventNews: function (qData) {
        const { probeid, limit, offset } = qData;
        let sqlQuery = `select data from infosource where probeid = ? limit ? offset ?`;
        return knex.raw(sqlQuery, [probeid, limit, offset])
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getCategoryNews: function (category) {

        let sqlQuery = `SELECT n.data, p.category FROM infosource n 
                            LEFT JOIN probes p on p.id = n.probeid
                        WHERE p.status IN ('A', 'F')
                            AND p.endsat > now()
                            AND p.start_date <= now()
                            AND p.category = ?
                        GROUP BY p.category, n.data`;
        return knex.raw(sqlQuery, [category])
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getTopNewsDB: function (eventId) {

        let sqlQuery = `SELECT data FROM infosource 
                        WHERE probeid = ${eventId}
                        ORDER BY id DESC LIMIT 3`;
        return knex.raw(sqlQuery)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    updateNewsKeyword: function (probeId, keywords) {
        var chunkSize = probeOtions.length;
        return knex.batchInsert('proptions', probeOtions, chunkSize)
            .returning(['id'])
            .then(function (tags) { return tags; })
            .catch(function (error) { throw error });
    },
    addProbeOtions: function (probeOtions, schema = "public") {
        return knex.withSchema(schema).table('proptions').insert(probeOtions)
            .returning(['id'])
            .then(function (tags) { return tags; })
            .catch(function (error) { throw error });
    },
    putCalls: function (calls, schema = 'public') {
        // var chunkSize = calls.length;
        var chunkSize = 1000;
        return knex.batchInsert(`${schema || "public"}.probecalls`, calls, chunkSize)
            .returning(['id', 'callvalue', 'noofcontracts', 'coins'])
            .then(function (tags) { return tags; })
            .catch(function (error) { throw error });
    },
    deleteCallsOpen: function (ids) {
        let _query = `delete from probecallsopen where id in (${ids.join(',')})`;
        return knex.raw(_query).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    putCallsOpen: function (callsOpen) {
        // var chunkSize = callsOpen.length;
        var chunkSize = 1000;
        return knex.batchInsert('probecallsopen', callsOpen, chunkSize)
            .returning(['id', 'callvalue', 'noofcontracts', 'coins'])
            .then(function (tags) { return tags; })
            .catch(function (error) { throw error });
    },
    addTags: async function (tagsData, probeId, schema = "public") {

        if (probeId) {
            try {
                await knex.withSchema(schema).table('tags').del().where('probeid', probeId);
            } catch (e) {
                throw e;
            }
        }
        return knex.withSchema(schema).table('tags').insert(tagsData)
            .returning('tag')
            .then(function (tags) { return tags; })
            .catch(function (error) { throw error });
    },
    addRegions: async function (regionsData, probeId, schema = 'public') {

        if (probeId) {
            try {
                await knex.withSchema(schema).table('probes_region').del().where('probeid', probeId);
            } catch (e) {
                throw e;
            }
        }
        if (!regionsData.length) {
            return [];
        }
        return knex.withSchema(schema).table('probes_region').insert(regionsData)
            .returning('id')
            .then(function (ids) { return ids; })
            .catch(function (error) { throw error });
        return []
    },
    getTags: function (eventId) {
        const _query = `select probeid, string_agg(a.tag, ', ') as keywords
                    from tags a 
                    inner join probes b on a.probeid = b.id
                    where 
                        b.endsat > now() AND
                        b.start_date <= now() AND
                        b.status in ('A','F')
                        ${eventId ? ' AND a.probeid = ? ' : ''}
                    group by probeid;`
        const bindings = eventId ? [eventId] : [];
        return knex.raw(_query, bindings).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    putInfoRequests: function (data) {
        var chunkSize = data.length;
        return knex.batchInsert('infosource', data, chunkSize)
            .returning(['probeid', 'data'])
            .then(function (content) { return content; })
            .catch(function (error) { throw error });
    },
    deleteInfoRequests: function (id) {
        return knex('infosource')
            .where('probeid', id)
            .del()
            .catch((e) => {
                throw e;
            });
    },
    addBookiePosition: function (dataObj) {
        let _paramsList = [dataObj['userid'], dataObj['probeid'], dataObj['coins'], dataObj['callvalue'], dataObj['probeid'], dataObj['callvalue']];
        let _query = `insert into probecallsopen (userid, probeid, coins, callvalue)
                    select ?, ?, ?, ?
                    where not exists (
                        select 1 from probecallsopen where probeid = ? and callvalue = ?
                    )`;
        return knex.raw(_query, _paramsList).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    addToTrending: async function (eventId) {
        if (!eventId) {
            throw new Error("event id must not be a falsy value")
        }
        let sqlQuery = `select eventid from trending where eventid = ?`;

        return knex.raw(sqlQuery, [eventId])
            .then((res) => {
                if (res['rows'].length > 0) {
                    return eventId;
                }
                return knex.insert({ eventid: eventId, rank: 32767 }, 'eventid').into('trending').then((id) => {
                    this.setTrendingEventRank({ id: eventId, rank: 0, old_rank: 32767 });
                    return id;
                }).catch(err => {
                    throw err;
                });


            }).catch((err) => {
                throw err;
            });
    },
    setTrendingEventRank: async function (data) {
        if (!data['id'] || (!data['rank'] && data['rank'] !== 0) || (!data['old_rank'] && data['old_rank'] !== 0)) {
            throw new Error("invalid data");
        }
        const updateNewRankQuery = `update trending set rank = ? where eventid = ?`;
        let updateSqlQuery = '';
        let whereBindings = [];
        if (data['rank'] < data['old_rank']) {
            updateSqlQuery = `update trending set rank = rank + 1 where rank >= ? AND rank < ? `;
            whereBindings = [data['rank'], data['old_rank']];
        } else {
            updateSqlQuery = `update trending set rank = rank - 1 where rank > ? AND rank <= ? `;
            whereBindings = [data['old_rank'], data['rank']];
        }

        knex.transaction(function (trx) {
            return trx
                .raw(updateSqlQuery, whereBindings)
                .then(async function () {
                    try {
                        await trx.raw(updateNewRankQuery, [data['rank'], data['id']]);
                        trx.commit;
                    } catch (e) {
                        trx.rollback;
                        throw e;
                    }
                });
        })
            .then(function () {
                return [];
            })
            .catch(function (error) {
                throw error;
            });


    },
    markEventsAsPrivate: async function (probeid) {
        try {
            const sql1 = `update probes set is_private = true where id = ${probeid} and is_private = false`;
            const _ = await knex.raw(sql1);
            return true;
        } catch (err) {
            throw err;
        }
    },
    markEventsAsPublic: async function (probeid) {
        try {
            const sql1 = `update probes set is_private = false where id = ${probeid} and is_private = true`;
            const _ = await knex.raw(sql1);
            return true;
        } catch (err) {
            throw err;
        }
    },
    getProbesByMatchKey: async function (matchkey) {
        try {
            let sql = `select * from probes where description like '%${matchkey}%'  and status in ('A', 'H')`
            return knex.raw(sql).then((res) => {
                return res.rows;
            }).catch((e) => {
                throw e;
            });
        } catch (err) {
            throw err;
        }
    },
    haltProbes: async function (probeids) {
        try {
            const sql1 = `update probes set status = 'H' where id in (${probeids.join(',')}) and status = 'A'`;
            const _ = await knex.raw(sql1);
            return true;
        } catch (err) {
            throw err;
        }
    },
    unhaltProbes: async function (probeids) {
        try {
            const sql1 = `update probes set status = 'A' where id in (${probeids.join(',')}) and status = 'H'`;
            const _ = await knex.raw(sql1);
            return true;
        } catch (err) {
            throw err;
        }
    },
    updateEventsStatus: async function (eventids, status) {
        try {
            const sql = `update probes set status = ? where id in (${eventids.join(',')})`;
            const _ = await knex.raw(sql, [status]);
            return true;
        } catch (err) {
            throw err;
        }
    },
    deleteFromTrending: async function (data) {
        if (!data.id || (!data.rank && data.rank !== 0)) {
            throw new Error("event id must not be a falsy value")
        }
        const [_err] = await to(this.setTrendingEventRank({ id: data.id, rank: 32767, old_rank: data.rank }));
        if (_err) throw err;
        return knex('trending')
            .where({ eventid: data.id })
            .del()
            .then((res) => {
                return res
            }, (err => { throw err }));
    },
    getInternalTestUser: async function (userIds) {
        if (!userIds) return false;

        if (Array.isArray(userIds)) {
            return knex.raw(`select userid from internal_test_users where userid in( ${userIds.map(_ => '?').join(',')} ) `, userIds)
                .then((res) => {
                    return res.rows;
                })
                .catch((err) => { throw err; })
        } else {
            return knex('internal_test_users').where({ userid: userIds })
                .then((rows) => {
                    return !!(rows[0] && rows[0].userid);
                })
                .catch((err) => { throw err; })
        }

    },
    getVolumeByEventId: async function (eventId, schema = 'public') {
        const query = `SELECT sum(volume) as volume FROM 
                        (SELECT sum(noofcontracts*coins) as volume FROM :schema:.probecalls where probeid = :eventId AND status != 'O'
                        UNION
                        SELECT sum(noofcontracts*coins) as volume FROM :schema:.probecallsopen where probeid = :eventId)a`;
        return knexReadOnly.raw(query, { schema, eventId }).then((res) => {
            return res.rows[0].volume !== null ? res.rows[0].volume : 0;
        }).catch((e) => {
            throw e;
        });
    },
    getLastCallValueByEventId: async function (eventId, maxReturn, schema = 'public') {
        const query = `SELECT json_build_object('coins', a.coins, 'callvalue', a.callvalue) as lastcall 
                        from probecalls a 
                        WHERE a.id IN (SELECT max(id) FROM probecalls where probeid = ${eventId} and status <> 'CAN')`;
        return knex.raw(query).then((res) => {
            return res.rows.length == 1 ? res.rows[0].lastcall : { 'coins': maxReturn / 2, 'callvalue': 'Y' };
        }).catch((e) => {
            throw e;
        });
    },
    getTimeElapsedByEventId: async function (eventId, schema = 'public') {
        const query = `SELECT EXTRACT(EPOCH FROM (now()-createdat)) as time_elapsed from :schema:.probes WHERE id = :eventId`;
        return knexReadOnly.raw(query, {
            eventId, schema
        }).then((res) => {
            return res.rows.length == 1 ? res.rows[0].time_elapsed * 1000 : 0;
        }).catch((e) => {
            throw e;
        });
    },

    openOrdersStatistics: async (probeId) => {
        const query = `
                    SELECT
                           coalesce(min_price_yes::int, 0) as min_price_yes,
                           coalesce(max_price_yes::int, 0) as max_price_yes,
                           CASE
                               WHEN total_contracts_yes > 0 THEN (volume_yes/total_contracts_yes)::float
                               ELSE 0
                           END AS avg_price_yes,
                           coalesce(min_price_no::int, 0) as min_price_no,
                           coalesce(max_price_no::int, 0) as max_price_no,
                           CASE
                               WHEN total_contracts_no > 0 THEN (volume_no/total_contracts_no)::float
                               ELSE 0
                           END AS avg_price_no
                    FROM
                      (SELECT sum(min_price_yes) AS min_price_yes,
                              sum(max_price_yes) AS max_price_yes,
                              sum(total_contracts_yes) AS total_contracts_yes,
                              sum(volume_yes) AS volume_yes,
                              sum(min_price_no) AS min_price_no,
                              sum(max_price_no) AS max_price_no,
                              sum(total_contracts_no) AS total_contracts_no,
                              sum(volume_no) AS volume_no
                       FROM
                         (SELECT coalesce(min(a.coins), 0) AS min_price_yes,
                                 coalesce(max(a.coins), 0) AS max_price_yes,
                                 coalesce(sum(a.noofcontracts), 0) AS total_contracts_yes,
                                 coalesce(sum(a.noofcontracts * a.coins), 0) AS volume_yes,
                                 0 AS min_price_no,
                                 0 AS max_price_no,
                                 0 AS total_contracts_no,
                                 0 AS volume_no
                          FROM probecallsopen a
                          WHERE a.probeid = ${probeId}
                            AND a.callvalue = 'Y'
                          GROUP BY a.probeid
                          UNION SELECT 0 AS min_price_yes,
                                       0 AS max_price_yes,
                                       0 AS total_contracts_yes,
                                       0 AS volume_yes,
                                       coalesce(min(b.coins), 0) AS min_price_no,
                                       coalesce(max(b.coins), 0) AS max_price_no,
                                       coalesce(sum(b.noofcontracts), 0) AS total_contracts_no,
                                       coalesce(sum(b.noofcontracts * b.coins), 0) AS volume_no
                          FROM probecallsopen b
                          WHERE b.probeid = ${probeId}
                            AND b.callvalue = 'N'
                          GROUP BY b.probeid) AS K) AS M;       
        `;
        return knex.raw(query)
            .then((res) => {
                return res.rows[0];
            })
            .catch((e) => {
                throw e;
            });
    },

    matchedOrdersStatistics: async (probeId) => {
        const query = `
                        SELECT probeid,
                               sum(matched_volume_yes)::int AS matched_volume_yes,
                               sum(matched_volume_no)::int AS matched_volume_no,
                               sum(matched_average_volume_yes)::float AS matched_average_volume_yes,
                               sum(matched_average_volume_no)::float AS matched_average_volume_no,
                               sum(total_contracts_yes)::int AS total_contracts_yes,
                               sum(total_contracts_no)::int AS total_contracts_no
                        FROM
                          (SELECT coalesce(y.probeid, z.probeid) AS probeid,
                                  y.volume_yes AS matched_volume_yes,
                                  z.volume_no AS matched_volume_no,
                                  y.volume_yes/y.total_contracts_yes AS matched_average_volume_yes,
                                  z.volume_no/z.total_contracts_no AS matched_average_volume_no,
                                  y.total_contracts_yes,
                                  z.total_contracts_no
                           FROM
                             (SELECT c.probeid,
                                     sum(c.noofcontracts) AS total_contracts_yes,
                                     sum(c.noofcontracts * c.coins) AS volume_yes
                              FROM probecalls c
                              WHERE c.probeid = ${probeId}
                                AND c.callvalue = 'Y'
                                AND c.status in ('A')
                                AND c.rank <> -1
                              GROUP BY c.probeid) AS y,
                        
                             (SELECT d.probeid,
                                     sum(d.noofcontracts) AS total_contracts_no,
                                     sum(d.noofcontracts * d.coins) AS volume_no
                              FROM probecalls d
                              WHERE d.probeid = ${probeId}
                                AND d.callvalue = 'N'
                                AND d.status in ('A')
                                AND d.rank <> -1
                              GROUP BY d.probeid) AS z
                           UNION SELECT zu.probeid,
                                        0 AS matched_volume_yes,
                                        zu.volume_no AS matched_volume_no,
                                        0 AS matched_average_volume_yes,
                                        zu.volume_no/zu.total_contracts_no AS matched_average_volume_no,
                                        0 AS total_contracts_yes,
                                        zu.total_contracts_no
                           FROM
                             (SELECT d.probeid,
                                     sum(d.noofcontracts) AS total_contracts_no,
                                     sum(d.noofcontracts * d.coins) AS volume_no
                              FROM probecallsopen d
                              WHERE d.probeid = ${probeId}
                                AND d.callvalue = 'N'
                                AND d.status = 'H'
                              GROUP BY d.probeid) AS zu
                           UNION SELECT yu.probeid,
                                        yu.volume_yes AS matched_volume_yes,
                                        0 AS matched_volume_no,
                                        yu.volume_yes/yu.total_contracts_yes AS matched_average_volume_yes,
                                        0 AS matched_average_volume_no,
                                        yu.total_contracts_yes,
                                        0 AS total_contracts_no
                           FROM
                             (SELECT d.probeid,
                                     sum(d.noofcontracts) AS total_contracts_yes,
                                     sum(d.noofcontracts * d.coins) AS volume_yes
                              FROM probecallsopen d
                              WHERE d.probeid = ${probeId}
                                AND d.callvalue = 'Y'
                                AND d.status = 'H'
                              GROUP BY d.probeid) AS yu) AS allunion
                        GROUP BY probeid`;
        return knex.raw(query)
            .then((res) => {
                return res.rows[0];
            })
            .catch((e) => {
                throw e;
            });
    },
    getProbeById: async (probeId, columns, useReadOnly, schema = 'public') => {
        if (!probeId) {
            throw new Error("ProbeId must not be a falsy value");
        }
        if (!Array.isArray(columns) || columns.length <= 0) {
            throw new Error("Column list is empty");
        }
        const knexClient = useReadOnly === true ? knexReadOnly : knex;
        const resultSet = await knexClient.withSchema(schema)
            .select(columns)
            .from('probes')
            .where({ id: probeId });
        return resultSet[0];
    },
    getActiveProbes: async (columns) => {
        if (!Array.isArray(columns) || columns.length <= 0) {
            throw new Error("Column list is empty");
        }
        const whereCondition = `status = 'A' and endsat > now()  and endsat > now() and start_date <= now() and type = 'Bet'`;
        const resultSet = await knex
            .select(columns)
            .from('probes')
            .whereRaw(whereCondition);
        return resultSet || [];
    },
    addProbeCallsOpenEntry: async (data) => {
        return knex.insert(data, 'id').into('probecallsopen').then((id) => {
            return id;
        }).catch(err => {
            throw err;
        });
    },

    addTournamentSpecificInfo: async (data) => {
        return knex.insert(data, 'id').into('tournament_info').then((id) => {
            return id;
        }).catch((err) => {
            throw err;
        })
    },

    getTournamentSpecificInfo: async (eventId) => {
        const sql = `select * from tournament_info where probe_id = ?`;
        const param = [eventId]
        return knex.raw(sql, param).then((res) => {
            return res.rows[0];
        }).catch((err) => {
            throw err;
        })
    },

    getParticipationCount: async (eventId, userId) => {
        const sql = `select count(*) from probecalls where probeid = ? and userid = ?`;
        const param = [eventId, userId]
        return knex.raw(sql, param).then((res) => {
            return res.rows[0].count;
        }).catch((err) => {
            throw err;
        })
    },

    getParticipationCountOnTournament: async (eventId) => {
        const sql = `select * from probecalls where probeid = ?`;
        const param = [eventId];
        return knex.raw(sql, param).then((res) => {
            return res.rows.length;
        }).catch((err) => {
            throw err;
        })
    },

    getChildren: async (eventId, schema = 'public') => {
        const sql = `select id, alternate_title, createdat from :schema:.probes where parent_id = :eventId and status='A' and is_private=false and endsat>now() order by createdat desc`;
        return knexReadOnly.raw(sql, { schema, eventId }).then((res) => {
            return res.rows.length > 0 ? res.rows : [];
        }).catch((err) => {
            throw err;
        })
    },
    getLatestTradedChildEvent: async (childrenIdArray) => {
        let sqlQuery = `with closed as (
            SELECT a.probeid, a.id, a.createdat 
            FROM probecalls a  
            WHERE a.probeid in (${childrenIdArray.join(',')})
        ORDER BY a.id DESC LIMIT 1 ), open as (
            SELECT a.probeid, a.id , a.createdat
            FROM probecallsopen a  
            WHERE a.probeid in (${childrenIdArray.join(',')})
        ORDER BY a.id DESC LIMIT 1
        ) select probeid, id FROM (
            select * from closed union all select * from open
        ) k order by k.createdat desc limit 1`;
        return knex.raw(sqlQuery)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getDistinctUsersCountInEvent: async (probeid, schema = 'public') => {
        try {
            let resp = {};
            const sqlQuery = `select distinct(userid) from :schema:.probecallsopen 
                                where probeid = :probeid and status in ('A', 'H') group by userid
                                union
                              select distinct(userid) from :schema:.probecalls
                                where probeid = :probeid and status in ('A') group by userid`;
            let res = await knex.raw(sqlQuery, {
                probeid, schema
            });
            return res.rows;
        } catch (err) {
            throw err;
        }
    },
    getAllActiveProbeCallsForUser: async (probeId, userId, schema = 'public') => {
        try {
            let userPositions = {};
            const sqlProbeOpen = `select * from :schema:.probecallsopen where probeid = :probeId
                               and userid = :userId and status in ('A', 'H')`;
            let res1 = await knex.raw(sqlProbeOpen, { schema, userId, probeId });
            userPositions['userProbeCallsOpen'] = res1.rows;

            const sqlProbe = `select * from :schema:.probecalls where probeid = :probeId
                              and userid = :userId and status in ('A')`;
            let res2 = await knex.raw(sqlProbe, { schema, userId, probeId });
            userPositions['userProbeCalls'] = res2.rows;
            return userPositions;
        } catch (err) {
            throw err;
        }
    },
    getactivetraders: async (schema = 'public') => {
        try {
            let resp = {};
            const sqlQuery = `select count(*) from (SELECT distinct(userid) from :schema:.probecalls where createdat > now() - interval '7' day union distinct select distinct(userid) from :schema:.probecallsopen where createdat > now() - interval '7' day) a LEFT JOIN (select id, displayname, email, mobile from users ) b ON a.userid = b.id where b.email is not null`;
            let res = await knex.raw(sqlQuery, { schema });
            return res.rows;
        } catch (err) {
            throw err;
        }
    },
    activeTradersInfo: async (offset, schema = 'public') => {
        try {
            let resp = {};
            const sqlQuery = `select * from (SELECT distinct(userid) from :schema:.probecalls where createdat > now() - interval '7' day union distinct select distinct(userid) from :schema:.probecallsopen where createdat > now() - interval '7' day) a LEFT JOIN (select id, displayname, email, mobile from users ) b ON a.userid = b.id where b.email is not null order by a.userid limit 500 offset ${offset}`;
            let res = await knex.raw(sqlQuery, { schema });
            return res.rows;
        } catch (err) {
            throw err;
        }
    },
    get24probeCalls: async (userId) => {

        let resp = {};
        const sqlQuery = `SELECT a.id, a.totalamount, a.is_price_editable, a.type, a.title, a.resolution, a.source, a.is_variable_liquidity_pool, b.* FROM  probes a LEFT  JOIN ( select 'probecalls' as table, probeid, userid, coins, callvalue, noofcontracts, status, createdat, lastprice from probecalls where userid = ${userId} and createdat > now() - interval '24 hours' UNION select 'probecallsopen', probeid, userid, coins, callvalue, noofcontracts, status, createdat, lastprice from probecallsopen where userid = ${userId} and createdat > now() - interval '24 hours') b on b.probeid = a.id where b.probeid is not null and a.status <>'C' order by b.createdat desc`;
        return knexReadOnly.raw(sqlQuery).then(async (res) => {
            const response = res.rows;
            // const response = await modifyTournamentRows(res.rows);
            return response;
        }).catch((e) => {
            throw e;
        })
    },
    getProbeForLiveStats: async (userId) => {
        
    },
    getLatestLiveStats: async (id) => {
        try {
            let sqlQuery = `select json_build_object(
                'text', stat_text,
                'time', currenttime
            ) live from live_stats_5mins
            where probeid::integer = ?
            order by currenttime desc limit 1`;
            const res = await knexReadOnly.raw(sqlQuery, [id])
            return res?.rows?.[0]?.live ?? false
        } catch (e) {
            console.log(`ERROR in fetching live stats for probe Id ${id}: `, e)
            return false;
        }
    },
    getLatestLiveStatsNew: async (id) => {
        try {
            let sqlQuery = `select json_build_object(
                'text', stat_text,
                'time', currenttime
            ) livecard from live_stats_new_5mins
            where probeid::integer = ?
            order by currenttime desc limit 1`;
            const res = await knexReadOnly.raw(sqlQuery, [id])
            return res?.rows?.[0]?.livecard ?? false
        } catch (e) {
            console.log(`ERROR in fetching live stats for probe Id ${id}: `, e)
            return false;
        }
    },
    getIsLiveStatsEvent: async (id) => {
        try {
            let sqlQuery = `select 
                count(id) >= 1 as "isLiveStatsEvent"
            from probes
            where id = ? and
            (
                (
                    settlement_description ~* '_' and
                    settlement_description !~* 'Kabaddi'
                ) or 
                subcategory = 'YouTube'
                or hashtags ='#YouTube'
            )`;
            const res = await knexReadOnly.raw(sqlQuery, [id])
            return res?.rows?.[0]?.isLiveStatsEvent ?? false
        } catch (e) {
            console.log(`ERROR in fetching live stats for probe Id ${id}: `, e)
            return false;
        }
    },
    getProbeIdFromDesc: async function (dataObj) {
        let whereClause = '';
        if (dataObj['parent_id'] == true) {
            whereClause = ' and parent_id < 0 ';
        }
        let sql = `with q as (
             select 
                 id
             from probes where status = '${dataObj['status']}' and category = '${dataObj['category']}' and 
             description = '${dataObj['description']}' ${whereClause} order by id desc
         ) select ARRAY(select id from q) `;
        return knex.raw(sql).then((res) => {
            return res.rows[0];
        }).catch((e) => {
            throw e;
        });
    },
    insertMMdata: function (dataObj) {
        return knex('mm_data').insert(dataObj).returning(['id', 'probeid', 'status', ' mm_script_metadata', 'subcategory', 'strategy1', 'exposure',
            'sport_id', 'apitype', 'userid', 'parent_title', 'marketid', 'teama', 'teama_selection_id', 'teamb', 'teamb_selection_id', 'draw_selection_id',
            'parent_id', 'is_mm', 'is_mm_started', 'pids', 'op_value1', 'op_value2', 'metadata', 'createdat']);
    },
    getMMdata: async (probeid) => {
        try {
            let sqlQuery;
            if (probeid) {
                sqlQuery = `SELECT *  FROM public.mm_data where probeid = ${probeid}`
            } else {
                sqlQuery = `SELECT *
                FROM public.mm_data
                WHERE createdat BETWEEN (CURRENT_DATE - INTERVAL '30 days') AND NOW()
                ORDER by id DESC`;
            }
            const res = await knexReadOnly.raw(sqlQuery)
            return res?.rows ?? false
        } catch (e) {
            console.log(`ERROR in fetching market making data`, e)
            return false;
        }
    },
    updateMMdata: function (probeid, updateObj) {
        return knex('mm_data')
            .where('probeid', '=', probeid)
            .update(updateObj).returning(['probeid', 'status', 'marketid', 'is_mm_started', 'pids', 'is_mm', 'ifyes', 'ifno', 'oddsyes', 'oddsno', 'process']);
    },
    getHashtags: async (region, partner = 1) => {
        try {

            let sqlQuery = `	   SELECT 
            p.category, 
            p.subcategory,
            p.hashtags,
            string_agg(distinct (CASE
                WHEN (p.live_stats_props ->> 'tournament_name') is not null THEN (p.live_stats_props ->> 'tournament_name')
                    ELSE NULL
                END), '') as tournament_name,
            MIN(CASE 
                    WHEN is_date(p.live_stats_props ->> 'match_start') THEN (p.live_stats_props ->> 'match_start')::timestamptz 
                    ELSE NULL 
                END) AS match_start,
            COUNT(DISTINCT p.id) AS events 
        FROM 
            probes p
        inner join probes_partner pp on pp.probeid = p.id
        LEFT JOIN 
            probes_region pr ON p.id = pr.probeid
        WHERE 
            p.status IN ('A', 'H') 
            AND (
                (:partner <> 6 AND :partner <> 10) OR
                ( NOT ( p.category = 'Sports' AND NOT p.is_price_editable ) )   
            )
            AND p.hashtags IS NOT NULL 
            AND p.endsat > NOW() 
            AND p.start_date <= NOW() - INTERVAL '30 sec'
            AND TRIM(p.hashtags) <> '' 
            AND p.parent_id <= 0
            AND (pr.region = :region OR pr.region IS NULL)
            AND pp.partner = :partner
        GROUP BY
            GROUPING SETS (
				( p.category, p.hashtags ),
	            ( p.category, p.subcategory, p.hashtags )
			)
        ORDER BY 
            p.category, p.subcategory, events DESC;
        `;

            const res = await knexReadOnly.raw(sqlQuery, { region, partner })
            return res?.rows ?? false
        } catch (e) {
            console.log(`ERROR in fetching Hashtags`, e)
            return false;
        }
    },
    getFantasyTypeByProbeId: async (id) => {
        const key = `fantasy_probe_${id}`;
        let data = await redisCaching.getKey(key);
        if (data) {
            return JSON.parse(data);
        }
        const sql = 'SELECT fantasy_type, fantasy_id from fantasy.probes where id = :id';
        const res = await knexReadOnly.raw(sql, { id });
        data = res?.rows?.[0] || false;
        if (data) {
            await redisCaching.setKey(key, JSON.stringify(data));
        }
        return data;
    },
    addProbesPartner: async (id, partners, schema = "public") => {
        try {

            const sql = `INSERT INTO :schema:.probes_partner (probeid, partner) 
            with params as (
                select :id::bigint as probeid, :partners as partners
            ), q as (
                select params.probeid, p.id as partner from params, regexp_split_to_table(params.partners, ',') v inner join partners p on p.id::text = v
                where p.is_active
            )
            select * from q`;
            await knex.raw(sql, { id, partners, schema });
            return true;
        } catch (e) {
            console.log('[ADD PROBE PARTNER ERROR]', e.message);
            throw e;
        }
    },
    updateProbesPartner: async (id, partners, schema = "public") => {
        try {

            const insertSql = `INSERT INTO :schema:.probes_partner (probeid, partner) 
            with params as (
                select :id::bigint as probeid, :partners as partners
            ), q as (
                select params.probeid, p.id as partner from params, regexp_split_to_table(params.partners, ',') v inner join partners p on p.id::text = v
                where p.is_active
            ), existing as (
                select pp.probeid, pp.partner from params, :schema:.probes_partner pp where pp.probeid = params.probeid
            ), added as (
                select q.* from q left join existing using (partner) where existing.partner is null
            )
            select * from added`;

            const removeSql = `DELETE FROM :schema:.probes_partner
            WHERE id IN (
            with params as (
                select :id::bigint as probeid, :partners as partners
            ), q as (
                select params.probeid, p.id as partner from params, regexp_split_to_table(params.partners, ',') v inner join partners p on p.id::text = v
                where p.is_active
            ), existing as (
                select pp.id, pp.probeid, pp.partner from params, :schema:.probes_partner pp where pp.probeid = params.probeid
            ), remove as (
                select existing.* from existing left join q using (partner) where q.partner is null
            )
            select id from remove)`;
            await knex.raw(removeSql, { id, partners, schema });
            await knex.raw(insertSql, { id, partners, schema });

        } catch (e) {
            console.log('[UPDATE PROBE PARTNER ERROR]', e.message);
            throw e;
        }
    },
    getTotalBuy: async (userid, probeid, is_price_editable) => {
        try {
            let totalBuy = 0;
            let sql = ``;
            if (is_price_editable) {
                // Calculate total buy when price is editable
                sql = `SELECT COALESCE(
                            (SELECT SUM(coins * noofcontracts) 
                            FROM probecalls 
                            WHERE userid = ${userid} AND probeid = ${probeid} AND status = 'O'), 0) 
                         - COALESCE(
                            (SELECT SUM(coins * noofcontracts) 
                            FROM probecalls 
                            WHERE userid = ${userid} AND probeid = ${probeid} AND status = 'CN'), 0) 
                         AS totalCoins`;
            } else {
                // Calculate total buy when price is not editable
                sql = `SELECT COALESCE(SUM(
                                CASE 
                                    WHEN status = 'A' THEN coins * noofcontracts
                                    WHEN status = 'EX' THEN lastprice * noofcontracts
                                    WHEN status = 'MG' THEN lastprice * noofcontracts
                                    ELSE 0
                                END), 0) AS totalCoins
                         FROM probecalls
                         WHERE userid = ${userid} AND probeid = ${probeid}`;
            }
            const res = await knex.raw(sql);
            return res?.rows?.[0]?.totalcoins ?? 0;
        } catch (e) {
            console.log('[GET TOTAL BUY ERROR]', e.message);
            throw e;
        }
    },
    getUnapprovedCommunityEvents: async () => {
        const sql = `SELECT p.id, title, probe_type as type, 
        u.id || '\n' || COALESCE(u.displayname, u.mobile, u.email) as createdby
         FROM probes p inner join users u on p.createdby = u.id
        WHERE status = 'F' and category = 'Community Events'`;
        const res = await knexReadOnly.raw(sql);
        return res?.rows ?? [];
    },
    getApprovedCommunityEvents: async () => {
        const sql = `SELECT p.id, title, probe_type as type, range
        FROM probes p inner join users u on p.createdby = u.id
        WHERE status = 'A' and category = 'Community Events' and endsat > now()`;
        const res = await knexReadOnly.raw(sql);
        return res?.rows ?? [];
    },
    getNoOfTraders: async (eventId) => {
        const sql = `SELECT CAST(COUNT(DISTINCT userid) AS INTEGER) AS number_of_traders 
        FROM (
            SELECT distinct userid FROM probecalls WHERE probeid = :eventId
            UNION
            SELECT distinct userid  FROM probecallsopen WHERE probeid = :eventId
        ) AS combined`;
        const res = await knexReadOnly.raw(sql, {eventId});
        return res?.rows?.[0]?.number_of_traders ?? 0;
    },
    approveCommunityEvent: async (data) => {
        if (!data?.probeId) {
            throw new Error("Cannot approve community event");
        }
        const { status, description, probeId } = data;
        const res = await knex('probes').update({
            status,
            description
        }).where({
            category: 'Community Events',
            id: probeId,
        }).returning(['id', 'createdby', 'settlement_description']);
        return res?.[0];
    },
    getDetailsOrderId: async (orderidarray) => {
        try {
            const placeholders = orderidarray.map(() => '?').join(',');
            const sql = ` SELECT *
            FROM (
                SELECT pc.id, userid, probeid, proptionid, coins, returns, pc.createdat, pc.updatedat, odds, rank, callvalue, orderid, noofcontracts, execid, pc.status, lastexecid, lastprice, lastorderid, tournament_rank, useraction, originaltimestamp, 'probecalls' AS type, 
                p.is_price_editable, p.totalamount, p.is_variable_liquidity_pool
                FROM probecalls pc inner join probes p on pc.probeid = p.id
                WHERE orderid IN (${placeholders}) AND pc.status <> 'O'
                UNION ALL
                SELECT pco.id, userid, probeid, proptionid, coins, returns, pco.createdat, pco.updatedat, odds, null as rank, callvalue, orderid, noofcontracts, execid, pco.status, lastexecid, lastprice, lastorderid, null as tournament_rank, useraction, originaltimestamp, 'probecallsopen' AS type, 
                p.is_price_editable, p.totalamount, p.is_variable_liquidity_pool
                FROM probecallsopen pco inner join probes p on pco.probeid = p.id
                WHERE orderid IN (${placeholders})
            ) AS combined
            ORDER BY createdat DESC;`;

            const res = await knexReadOnly.raw(sql, [...orderidarray, ...orderidarray]);
            const data_array = {};
            res.rows.forEach(row => {
                const orderId = row.orderid;
                if (!data_array[orderId]) {
                    data_array[orderId] = [];
                }
                data_array[orderId].push(row);
            });

            return {
                rows: res.rows,
                detailsArray: data_array,
            };

        } catch (e) {
            console.log('[GET DETAILSORDERID ERROR]', e.message);
            throw e;
        }
    },
    getTradeDetails: async (schema, orderId, userId, probeId, status) => {
        try {            
            const sql = ` SELECT *
            FROM (
                SELECT pc.id, userid, probeid, proptionid, coins, returns, pc.createdat, pc.updatedat, odds, rank, callvalue, orderid, noofcontracts, execid, pc.status, lastexecid, lastprice, lastorderid, tournament_rank, useraction, originaltimestamp, 'probecalls' AS type, 
                p.is_price_editable, p.totalamount, p.is_variable_liquidity_pool
                FROM :schema:.probecalls pc inner join :schema:.probes p on pc.probeid = p.id
                WHERE userid = :userId and probeid = :probeId and orderid = :orderId AND pc.status <> 'O' 
                UNION ALL
                SELECT pco.id, userid, probeid, proptionid, coins, returns, pco.createdat, pco.updatedat, odds, null as rank, callvalue, orderid, noofcontracts, execid, pco.status, lastexecid, lastprice, lastorderid, null as tournament_rank, useraction, originaltimestamp, 'probecallsopen' AS type, 
                p.is_price_editable, p.totalamount, p.is_variable_liquidity_pool
                FROM :schema:.probecallsopen pco inner join :schema:.probes p on pco.probeid = p.id
                WHERE  userid = :userId and probeid = :probeId and orderid = :orderId 
            ) AS combined
            ORDER BY createdat DESC`;
            
            if(status) {    
              let query = knex.raw(sql, { orderId, userId, probeId, schema });
              const statusQuery = knex.with('q', query).from('q').whereIn('status', status);  
              const res = await statusQuery;
              return res ?? [];
            } 
            const res = await knex.raw(sql, { orderId, userId, probeId, schema });
            return res?.rows ?? [];

        } catch (e) {
            console.log('[getTradeDetails ERROR]', e.message);
            throw e;
        }
    },
    resultByProbeId: async (probeid) => {
        try {

            const sql = `SELECT
            id AS probeid,
            status,
            CASE
                WHEN status = 'A' THEN json_build_object('status', 'A', 'message', 'This probe is currently active')
                WHEN status = 'F' THEN json_build_object('status', 'F', 'message', 'This probe is in Freeze state')
                WHEN status = 'CAN' THEN json_build_object('status', 'CAN', 'message', 'This probe has been cancelled')
                WHEN status = 'C' THEN json_build_object('status', 'C', 'message', 'This probe is Complete', 'correctvalue', correctvalue)
            END AS result
        FROM
            probes
        WHERE
            id = :probeid`;
            const res = await knexReadOnly.raw(sql, { probeid });
            return res?.rows?.[0]?.result ?? false;

        } catch (e) {
            console.log('[RESULT BY PROBEID ERROR]', e.message);
            throw e;
        }
    },
    getMarketMakingRewardsProbes: async (data) => {
        try {

            const sql = `select p.id, p.category, p.totalamount, p.is_price_editable, p.is_variable_liquidity_pool, p.subcat, title, subtitle, range, hashtags, endsat, '-' AS number_of_traders from probes p 
            left join probes_partner pp on p.id = pp.probeid  
            WHERE pp.partner = 1 AND pp.probeid = p.id
            and p.status = 'A' and p.endsat > now() and p.start_date < now() and p.range in (1,5,10) and p.is_price_editable = true and p.parent_id = 0;`;
            const res = await knexReadOnly.raw(sql, { });
            return res?.rows;

        } catch (e) {
            console.log('[getMarketMakingRewardsProbes ERROR]', e.message);
            throw e;
        }
    },
    getEligibleMatchedContractsMarketRewards: async (userid) => {
        try {

            const sql = `--  SELECT * from pro_trader_incentive order by date desc limit 3
			-- Setup date for execution current date - in IST
				with dates as (
					select date_trunc('week', now())::date d, CAST(:userid AS BIGINT) as user_id
				) 
				-- Probes for which we need to execute the procedure
				, q as (
					select 
						id, title, subcat, subsubcat, hashtags, category
					from probes, dates where 
						endsat >= d  and 
						is_price_editable and 
						range IN (1,5,10) and
						probe_type <> 'promo'
				)

				-- Get all matched shares for given date where price is between 10 and 90 for status 'A' and 'EX'
				, closed_trades as (
					select 
						pc.userid, 
						date_trunc( 'week', (createdat) )::date as date,
						sum(COALESCE(noofcontracts)) as noofcontracts
					from 
						probecalls pc, dates 
					where probeid in (select id from q)
					and userid = dates.user_id
					and pc.status  IN ('A', 'H')
					and pc.rank <> -1
					and (
						(status = 'A' AND coins BETWEEN 10 and 90) OR
						(status = 'H' AND lastprice BETWEEN 10 and 90) 
					)
					and date_trunc( 'week', (createdat) ) = d
					group by pc.userid,  date_trunc( 'week', (createdat) )
				)

				-- Get all open sell order shares for given date where price is between 10 and 90 for status 'H'
				, open_trades as (
					select 
						pco.userid, 
						date_trunc( 'week', (createdat) ) as date,
						sum(COALESCE(noofcontracts)) as noofcontracts
					from 
						probecallsopen pco, dates 
					where probeid in (select id from q)
					and userid = dates.user_id
					and pco.status  IN ('H')
					and lastprice BETWEEN 10 and 90
					and date_trunc( 'week', (createdat) ) = d
					group by pco.userid,  date_trunc( 'week', (createdat) )
				)
			
				-- Add Sell Trades as additional Matched Order
				, sell_trades_details as (
					select 
						pc.userid, 
						date_trunc( 'week', (pc.createdat) )::date as date,
						pc.id,
						pc.execid,
						(case 
							when pc.lastprice between 10 and 90 and pc.coins between 10 and 90 then 2
							when (pc.lastprice between 10 and 90 or pc.coins between 10 and 90) then 1
							else 0
						end) * pc.noofcontracts as noofcontracts
					 from dates, probecalls pc
					 inner join probecalls pcm on
							pcm.execid = pc.execid and 
							pcm.id <> pc.id and 
							pc.userid <> pcm.userid and
							pcm.orderid <> pc.orderid and
							pc.createdat = pcm.createdat and
							pc.coins <> pc.lastprice and
							(
								pcm.status <> 'EX' OR 
								(pcm.status = 'EX' and pc.callvalue <> pcm.callvalue)
							)
					where pc.probeid in (select id from q)
					and pc.userid = dates.user_id
					and pc.status  IN ('EX')
					and pc.coins <> pc.lastprice
					and date_trunc( 'week', (pc.createdat) ) = dates.d
					group by pc.id, pc.userid, ( date_trunc( 'week', (pc.createdat) ), pc.execid, pc.noofcontracts, pc.lastprice, pc.coins
				))
				
				-- Group Sell Trades of users 
				, sell_trades as (
					select userid, date, sum(noofcontracts) as noofcontracts from sell_trades_details
					group by userid, date
 				) 

				-- Combine matched shares from probecalls and probecallsopen and sum per user - date
				, stats as (
					select 
							userid as user_id, 
							date,
							sum(noofcontracts) as qualifying_shares
					from (
						select * from closed_trades
						UNION ALL 
						select * from open_trades
						UNION ALL
						select * from sell_trades
					) k
					group by userid, date order by "qualifying_shares" desc
				)

				-- Format as required for insert into pro_trader_incentive with conflict hanlding to avoid duplciates
				select 
					dates.user_id, 
					dates.d, 
					COALESCE(stats.qualifying_shares, 0) as qualifying_shares
				from dates, stats`;
            const res = await knexReadOnly.raw(sql, { userid });
            return res?.rows?.[0]?.qualifying_shares ?? 0;

        } catch (e) {
            console.log('[getMarketMakingRewardsProbes ERROR]', e.message);
            throw e;
        }
    },
}

const modifyTournamentRows = async (dataObj) => {
    try {
        for (let i = 0; i < dataObj.length; i++) {
            const tournamentSpecificInfo = await Probe.getTournamentSpecificInfo(dataObj[i].id);
            if (tournamentSpecificInfo) {
                dataObj[i]['prizemoney'] = tournamentSpecificInfo.max_pool;
                dataObj[i]['maxplayers'] = tournamentSpecificInfo.max_players;
            }
            const participationCount = await Probe.getParticipationCountOnTournament(dataObj[i].id);
            dataObj[i]['participationcount'] = parseInt(participationCount, 10);
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
        return dataObj;
    } catch (err) {
        throw err;
    }
}
const modifyProbesObject = async (probesObj, schema = 'public') => {
    try {
        for (let i = 0; i < probesObj.length; i++) {
            /* Add volume and sub-events for clubbed-event */
            if (probesObj[i]['parent_id'] === -1) {
                const idAltTitleArray = await Probe.getChildren(probesObj[i]['id'], schema);
                let volume = 0;
                let alternate_titles = [];
                let childrenIdArray = [];
                for (let j = 0; j < idAltTitleArray.length; j++) {
                    volume += await Probe.getVolumeByEventId(idAltTitleArray[j]['id'], schema);
                }


                if (idAltTitleArray.length > 0) {
                    //sorting according to created_at
                    idAltTitleArray.sort((a, b) => b.created_at - a.created_at);

                    alternate_titles = idAltTitleArray.map(i => i.alternate_title);

                    /* moving latest traded event to 0th index */
                    childrenIdArray = idAltTitleArray.map(i => i.id);
                    let latestTradedChildEvent;

                    // const latestTradedChildEventArray = await Probe.getLatestTradedChildEvent(childrenIdArray);

                    // if (latestTradedChildEventArray.length > 0){
                    //     latestTradedChildEvent = latestTradedChildEventArray[0]['probeid'];
                    //     let index = childrenIdArray.indexOf(latestTradedChildEvent);
                    //     if ( index >= 0 ){
                    //         alternate_titles.unshift(alternate_titles.splice(index, 1)[0]);
                    //         childrenIdArray.unshift(childrenIdArray.splice(index, 1)[0]);
                    //     }
                    // }
                }
                /* moved to first position */


                probesObj[i]['sub_events'] = idAltTitleArray.length;
                probesObj[i]['sub_events_titles'] = alternate_titles;
                probesObj[i]['sub_events_ids'] = childrenIdArray;
                probesObj[i]['volume'] = volume;
                if (idAltTitleArray.length == 0) probesObj[i]['parent_id'] = -2;
                continue;
            }
            const maxReturn = probesObj[i]['totalamount'];
            const probeExistsInCache = await redisCaching.doesKeyExistinHM(probesObj[i]['id'], 'eventInfoMap');
            /* If the event exists in eventInfoMap then all three properties of the object will definitely be present! */
            if (probeExistsInCache) {
                let cachedProbeObj = await redisCaching.getHMKey(probesObj[i]['id'], 'eventInfoMap');
                cachedProbeObj = JSON.parse(cachedProbeObj);
                if (cachedProbeObj == null || typeof cachedProbeObj === 'undefined') {
                    // probesObj[i]['volume'] = 0;
                    probesObj[i]['volume'] = await Probe.getVolumeByEventId(probesObj[i]['id'], schema);
                    probesObj[i]['volume'] = parseFloat(parseFloat(probesObj[i]['volume'].toString()).toFixed(2));
                    const timeDiff = await Probe.getTimeElapsedByEventId(probesObj[i]['id']);
                    const eventInfoEntry = Object.assign({}, { volume: probesObj[i]['volume'], created_at: Date.now() - timeDiff });
                    redisCaching.setHMKey(probesObj[i]['id'], 'eventInfoMap', JSON.stringify(eventInfoEntry));
                } else {
                    probesObj[i]['volume'] = cachedProbeObj.volume;
                    if (!probesObj[i]['volume']) {
                        probesObj[i]['volume'] = await Probe.getVolumeByEventId(probesObj[i]['id'], schema);
                    }
                    probesObj[i]['volume'] = parseFloat((probesObj[i]['volume']).toFixed(2));
                }

            } else {
                probesObj[i]['volume'] = await Probe.getVolumeByEventId(probesObj[i]['id'], schema);
                probesObj[i]['volume'] = parseFloat(parseFloat(probesObj[i]['volume'].toString()).toFixed(2));
                const timeDiff = await Probe.getTimeElapsedByEventId(probesObj[i]['id']);
                const eventInfoEntry = Object.assign({}, { volume: probesObj[i]['volume'], created_at: Date.now() - timeDiff });
                redisCaching.setHMKey(probesObj[i]['id'], 'eventInfoMap', JSON.stringify(eventInfoEntry));
            }
        }
        return probesObj;
    } catch (err) {
        throw err;
    }
}


module.exports = Probe;
