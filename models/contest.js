const CONFIG = require('../config/config.js');
const knex = require('../knex/knex.js');
const knexReadOnly = require('../knex/knex_readonly.js');


const log = (...args) => console.log('[Contest Model]', ...args);

const Contest = {
    getLiveContests: async (userId, limit = 1000, page = 0, contest_id = null, contest_format = null) => {

        const offset = page * limit;
        let sql = `
        SELECT 
            c.id,
            c.title, 
            c.description, 
            c.entry_fee,
            c.virtual_credits,
            c.winner_percentage,
            c.start_time,
            c.end_time,
            c.sharelink,
            c.disablesell,
            c.contest_format,
            c.room_id,
            case when c.is_fixed_pool then 'Guaranteed' else 'Flexible' end as contest_type,
            c.is_fixed_pool,
            cu.contest_id is not null as is_participant,
            cu.islivechatenabled as "isLiveChatEnabled",
            (SELECT COUNT(*) FROM fantasy.contest_user cu2 WHERE cu2.contest_id = c.id) as number_of_participants,
            CASE WHEN now() < c.start_time THEN c.default_prize_pool ELSE c.prize_pool  * c.prize_pool_percent/100 END as prize_pool
        FROM fantasy.contest c 
        LEFT JOIN fantasy.contest_user cu on c.id = cu.contest_id and cu.user_id = :userId
        WHERE 
            c.status = 'A' and (cu.contest_id is not null or c.end_time > now())
        `;
        const params = {
            userId,
            limit,
            offset
        };
        if (contest_id) {
            sql = [sql, knexReadOnly.raw(' AND c.id = :contest_id')].join('\n')
            params.contest_id = contest_id
        }

        if (contest_format && contest_format.length > 0) {
            sql = [sql, knexReadOnly.raw(` AND c.contest_format IN (${contest_format.map(() => '?').join(',')})`, contest_format)].join('\n');
        }

        sql = [sql, 'ORDER BY cu.contest_id is not null desc, c.entry_fee = 0 desc, c.end_time ASC LIMIT :limit offset :offset'].join('\n');
        const res = await knexReadOnly.raw(sql, params)
        return res?.rows ?? [];
    },

    getClosedContests: async (userId, limit = 1000, page = 0, contest_format = null) => {

        const offset = page * limit;
        let sql = `
        SELECT 
        c.id,
        c.title, 
        c.description, 
        c.entry_fee,
        c.virtual_credits,
        c.start_time,
        c.end_time,
        c.sharelink,
        c.contest_format,
        c.winner_percentage,
        c.room_id,
        case when c.is_fixed_pool then 'Guaranteed' else 'Flexible' end as contest_type,
        c.is_fixed_pool,
        cu.contest_id is not null as is_participant,
        CASE WHEN now() < c.start_time THEN c.default_prize_pool ELSE c.prize_pool  * c.prize_pool_percent/100 END as prize_pool,
        ch.invest,
        ch.earnings,
        ch.returns,
        ch.rank,
        ch.final_wallet_amount,
        ch.prize
    FROM fantasy.contest c 
    INNER JOIN fantasy.contest_user cu on c.id = cu.contest_id  and cu.user_id = :userId
    LEFT JOIN fantasy.contest_history ch on c.id = ch.contest_id and ch.user_id = :userId
    WHERE 
        ( c.status = 'C' )
        `;

        const params = {
            userId,
            limit,
            offset,
        };

        if (contest_format && contest_format.length > 0) {
            sql = [sql, knexReadOnly.raw(` AND c.contest_format IN (${contest_format.map(() => '?').join(',')})`, contest_format)].join('\n');
        }

        sql = [sql, 'ORDER BY c.end_time DESC LIMIT :limit offset :offset'].join('\n');

        const res = await knexReadOnly.raw(sql, params);
        return res?.rows ?? [];
    },
    getContests: async function (whereObj, schema = 'fantasy') {
        try {
            let { limit, offset, search, status } = whereObj;
            let clauses = [];

            if (!limit) {
                limit = 100;
            }

            if (!offset) {
                offset = 0;
            }

            switch ((status || '').toLowerCase()) {
                case 'live':
                    clauses.push({
                        method: 'whereIn', args: ['status', ['A']]
                    });
                    break;
                case 'closed':
                    clauses.push({
                        method: 'whereIn', args: ['status', ['C', 'CAN']]
                    });
                    break;
                default:
                    clauses.push({
                        method: 'whereIn', args: ['status', ['A', 'C', 'F', 'CAN']]
                    });
                    break;
            }

            const client = knexReadOnly;

            if (search) {
                clauses.push({
                    method: 'where',
                    args: [function () {
                        this.where('title', 'ilike', `%${search.toLowerCase()}%`).orWhere('description', 'ilike', `%${search.toLowerCase()}%`)
                    }]
                });
            }
            let builder = client.withSchema(schema).table('contest')
            clauses.forEach(clause => {
                console.log(clause.method, ...clause.args)
                builder = builder[clause.method](...clause.args)
            });


            const res = await builder.select().limit(limit).offset(offset).orderBy('id', 'desc');

            return res || [];

        } catch (e) {
            log("ERROR", e.message)
            throw e;
        }
    },
    createContest: function (dataObj, schema = 'fantasy') {
        return knex.withSchema(schema).insert(dataObj, 'id').into('contest').then((id) => {
            return id;
        }).catch(err => {
            throw err;
        });
    },
    getContestById: function (contest_id, schema = 'fantasy', trx) {
        const client = trx || knex;
        return client.table('fantasy.contest')
            .select(knex.raw('*, CASE WHEN now() < start_time THEN default_prize_pool ELSE prize_pool * prize_pool_percent/100 END as calculated_prize_pool, now() < start_time as is_started'))
            .where({ id: contest_id })
            .then((res) => {
                return res;
            }).catch((e) => {
                throw e;
            });
    },
    addUserToContest: function (dataObj, schema = 'fantasy', trx = null) {
        const client = trx || knex;
        return client.withSchema(schema).insert(dataObj).into('contest_user').then((user_id) => {
            return user_id;
        }).catch(err => {
            throw err;
        });
    },
    updatePrizePool: async (contest_id, trx) => {

        const client = trx || knex;
        const sql = `UPDATE fantasy.contest set prize_pool = COALESCE(prize_pool, 0) + entry_fee  where id = :contest_id`;

        const res = await client.raw(sql, {
            contest_id
        });
        return res?.rows ?? [];
    },
    updateContestStatus: async (contest_id, status, trx) => {

        const client = trx || knex;
        const sql = `UPDATE fantasy.contest set status = :status where id = :contest_id`;

        const res = await client.raw(sql, {
            status, contest_id
        });
        return res?.rows ?? [];
    },
    updateContest: async (id, updateObj, trx) => {

        const client = trx || knex;

        if (!id || isNaN(id)) {
            throw new Error('Calling update with invalid contest ID');
        }
        const validColumns = ['default_prize_pool', 'title', 'start_time', 'end_time', 'description', 'disablesell', 'status'];
        const data = Object.keys(updateObj).reduce((agg, k) => {
            const isValidKey = validColumns.findIndex(c => c === k) > -1;
            console.log(isValidKey, k);
            if (isValidKey) {
                agg[k] = updateObj[k];
            }
            return agg;
        }, {});
        const res = await client('fantasy.contest').update(data).where({ id }).returning('id');
        return res?.rows ?? [];
    },
    getContestUserBalance: async (contest_id, user_id, schema, useReadOnly) => {
        try {
            if (!user_id) {
                throw new Error('user_id must not be a falsy value');
            }
            const knexClient = useReadOnly === true ? knexReadOnly : knex;
            const sqlQuery = `SELECT * FROM :schema:.wallet WHERE userid = :user_id and fantasy_type = 'contest'
                              and fantasy_id = :contest_id ORDER BY id DESC limit 1`;
            const res = await knexClient.raw(sqlQuery, { schema, user_id, contest_id });
            return res.rows.length > 0 ? res.rows[0] : false;
        } catch (e) {
            throw e;
        }
    },
    getAllContestUsers: async (contest_id, schema, useReadOnly) => {
        try {
            const knexClient = useReadOnly === true ? knexReadOnly : knex;
            const sqlQuery = `SELECT user_id FROM :schema:.contest_user WHERE contest_id = :contest_id `;
            const res = await knexClient.raw(sqlQuery, { schema, contest_id });
            return res.rows.length > 0 ? res.rows : [];
        } catch (e) {
            throw e;
        }
    },
    getAllContestEvents: async (contest_id, schema, useReadOnly) => {
        try {
            const knexClient = useReadOnly === true ? knexReadOnly : knex;
            const sqlQuery = `SELECT * FROM :schema:.probes WHERE fantasy_type = 'contest'
                              and fantasy_id = :contest_id ORDER BY id`;
            const res = await knexClient.raw(sqlQuery, { schema, contest_id });
            return res.rows.length > 0 ? res.rows : [];
        } catch (e) {
            throw e;
        }
    },
    getAllContestUserBalance: async (contest_id, schema, useReadOnly) => {
        try {
            const knexClient = useReadOnly === true ? knexReadOnly : knex;
            const sqlQuery = `SELECT distinct on (userid) userid, coins FROM :schema:.wallet WHERE fantasy_type = 'contest'
                              and fantasy_id = :contest_id order by userid, createdat desc`;
            const res = await knexClient.raw(sqlQuery, { schema, contest_id });
            return res.rows.length > 0 ? res.rows : false;
        } catch (e) {
            throw e;
        }
    },
    getAllContestUserHistory: async (userids, probeids, schema, useReadOnly) => {
        try {
            const knexClient = useReadOnly === true ? knexReadOnly : knex;
            const sqlQuery = `SELECT * FROM :schema:.history WHERE userid in (${userids}) and probeid in (${probeids})`;
            const res = await knexClient.raw(sqlQuery, { schema });
            return res.rows.length > 0 ? res.rows : [];
        } catch (e) {
            throw e;
        }
    },
    addContestHistory: async (dataObj, schema, useReadOnly) => {
        return knex.withSchema(schema).insert(dataObj, 'user_id').into('contest_history').then((user_id) => {
            return user_id;
        }).catch(err => {
            throw err;
        });
    },
    getLeaderboard: async (userId, contestId) => {
        try {
            const sql = `
            /** Select probes */
with p as (
	select id, is_price_editable, status as stat, correctvalue from fantasy.probes where fantasy_id = :contestId
),
/** Liquidity Events Table */
le as (
	select 
		probe_id as id,
		price_per_contract_yes as "yCP",
		price_per_contract_no  as "nCP"
  	from fantasy.liquidity_events where id IN (
		select max(le.id) from fantasy.liquidity_events le inner join p on p.id = le.probe_id and not p.is_price_editable
		group by probe_id
	)
), 

open_values as (
	 SELECT case when status = 'H' then 100 - COALESCE(coins, 0) else coins end as coins,
                                             case
                                                 when status = 'H' then
                                                     case when callvalue = 'Y' THEN 'N' ELSE 'Y' END
                                                 else
                                                     callvalue end as callvalue,
                                             probeid
	  from fantasy.probecallsopen,
		   p
	  where probeid = p.id
),
current_price as (select (select p.id) as id,
							case 
				  				when stat = 'A' then 
				  				(select COALESCE(100 - max(coins), 50) from open_values where callvalue = 'Y' and probeid = p.id) 
				  				when stat = 'C' and correctvalue = 'Y' then 100
				  				else 100
				  			end as "yCP",
				  			case
				  				when stat = 'A' then (select COALESCE(100 - max(coins), 50) from open_values where callvalue = 'N' and probeid = p.id) 
								when stat = 'C' and correctvalue = 'N' then 100
				  				else 100
		
					  		end as "nCP"
				from p),
				
open_stats as (select userid,
                    p.id,
                       sum(case when status = 'H' then 
                           noofcontracts * (
                            case when callvalue = 'Y' then 100 - cp."yCP" else 100 - cp."nCP" end
                        )
                       else  noofcontracts * coins end)
             as open_investment
             from fantasy.probecallsopen n,
                       current_price cp, 
                  p
             where n.status in ('A', 'H')
               and n.probeid = p.id and cp.id = p.id 
group by userid, p.id)		,				

/** Closed Investement Table */
closed_stats as (
	  select
		  userid,
		  p.id,
		  sum ( case when callvalue = 'Y' then noofcontracts else 0 end ) as total_matched_contract_yes,
		  sum ( case when callvalue = 'N' then noofcontracts else 0 end ) as total_matched_contract_no
	  from fantasy.probecalls n, p
	  where
		  n.status in ('A'
		  , 'H')
		and
		  n.rank <> -1
		and
		  n.probeid = p.id
	  group by userid, p.id
)

/** Transaction Breakup Sum */
, tb_breakup as (
	  select
		  userid, probeid as id,
		  sum (coins) as winnings
	  from fantasy.transaction_breakup tb, p
	  where probeid = p.id
	  group by userid, probeid
), 

/** Final Profit per user per event */
results as (
	  (select
		  tb.userid,
		  tb.id,
		  -1 * COALESCE (winnings, 0) + COALESCE (c.total_matched_contract_yes, 0) * "yCP" +
		  COALESCE (c.total_matched_contract_no, 0) * "nCP"  as profit
	  from
		  tb_breakup tb left outer join
		  closed_stats c using (userid, id) left outer join
		  le cp using (id)
      WHERE tb.id In (SELECT p.id from p where not is_price_editable)
	  order by -1 * COALESCE (winnings, 0) + COALESCE (c.total_matched_contract_yes, 0) * "yCP" +
		  COALESCE (c.total_matched_contract_no, 0) * "nCP" desc)
	
	UNION ALL
	
	(
					select tb.userid,
							 tb.id,
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
		      WHERE tb.id In (SELECT p.id from p where  is_price_editable)
					  order by -1 * COALESCE(winnings, 0) +
							   COALESCE(c.total_matched_contract_yes, 0) * (100 - "yCP") +
							   COALESCE(c.total_matched_contract_no, 0) * (100 - "nCP") desc)
), 

/** Agrregate per User */
combined as (
		select 
		COALESCE(
			displayname,
			left(mobile, 2) || 'XXXXXX' || right(mobile, 2)
		) as user, 
		sum(profit) as profit, sum(profit) as trading_profit,
		:userId = users.id as is_current_user
	from
		results inner join public.users
	on  results.userid = users.id where users.id != 89 
	group by users.id, COALESCE(
			displayname,
			left(mobile, 2) || 'XXXXXX' || right(mobile, 2)
		) 
	order by sum(profit)  desc
)
select *, rank() over (order by profit desc) from combined
order by is_current_user desc, rank() over (order by profit desc) 

            `;
            const res = await knex.raw(sql, { userId, contestId })
            return res?.rows ?? [];
        } catch (e) {
            log('ERROR', e.message)
            throw e;
        }
    },
    getContestTraders: async (contestId) => {

        try {
            const sql = `select count(*) from 
            (select distinct userid from fantasy.probecalls where probeid In (
                select id from fantasy.probes where fantasy_id  = :contestId
            )
            
            UNION
            
            select distinct userid from fantasy.probecallsopen where probeid In (
                select id from fantasy.probes where fantasy_id  = :contestId 
            )) k`;

            const res = await knex.raw(sql, { contestId })
            return res?.rows?.[0].count ?? 0;
        } catch (e) {
            log('ERROR', e.message)
            throw e;
        }

    },
    getContestWinners: async (userId, contestId) => {
        try {
            const sql = `
            WITH q AS (
                SELECT
                    COALESCE(displayname, LEFT(mobile, 2) || 'XXXXXX' || RIGHT(mobile, 2)) AS user,
                    user_id AS userid,
                    prize AS profit,
                    rank,
                    :userId = user_id AS is_current_user,
                    earnings AS trading_profit,
                    history_ids,
                    contest_id AS id
                FROM fantasy.contest_history
                INNER JOIN public.users ON contest_history.user_id = users.id
                WHERE contest_id = :contestId
                ORDER BY is_current_user DESC, rank ASC
            ), stats AS (
                SELECT
                    q.id,
                    q.userid,
                    COUNT(h.id) AS nooftrades,
                    SUM(
                        CASE
                            WHEN trade ->> 'orderStatus' = 'Won' OR trade ->> 'orderStatus' = 'Lost' THEN
                                trade['invest']::double precision
                            ELSE
                                trade['invest']::double precision + trade['returns']::double precision
                        END
                    ) AS volume
                FROM q, UNNEST(history_ids) AS hid
                INNER JOIN (
                    SELECT h.id, trade
                    FROM fantasy.history h, JSONB_ARRAY_ELEMENTS(orders) trade
                    WHERE probeid IN (SELECT id FROM fantasy.probes WHERE fantasy_id = :contestId)
                        AND trade ->> 'orderStatus' <> 'Cancelled' AND trade ->> 'orderStatus' <> 'Refunded'
                ) h ON h.id = hid::BIGINT
                GROUP BY q.id, q.userid
            ), wallet_info AS (
                SELECT DISTINCT ON (userid)
                    id AS wallet_id,
                    fantasy_id,
                    userid,
                    coins AS final_wallet_amount
                FROM fantasy.wallet
                WHERE fantasy_id = :contestId
                ORDER BY userid, id DESC
            )
            SELECT
                q.id,
                q.user,
                q.userid,
                q.profit,
                q.userid AS userid,
                q.rank,
                q.is_current_user,
                q.trading_profit,
                s.nooftrades,
                s.volume,
                w.final_wallet_amount
            FROM q
            INNER JOIN stats s USING (id, userid)
            LEFT JOIN wallet_info w ON q.id = w.fantasy_id AND q.userid = w.userid
            ORDER BY q.is_current_user DESC, q.rank ASC;                       
            `;
            const res = await knex.raw(sql, { userId, contestId })
            return res?.rows ?? [];
        } catch (e) {
            log(e.message);
            throw e;
        }
    },
    getContestsForStartNotif: () => {
        const sqlQuery = `SELECT id, start_time, title FROM fantasy.contest WHERE start_time >= NOW() + INTERVAL '10 minutes' and start_time < NOW() + INTERVAL '15 minutes'`;
        return knex.raw(sqlQuery)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    update: function (dataObj, schema = 'fantasy') {
        try {
            var updateObj = {};
            const colsArray = ['title',
                'description',
                'sharelink', 'room_id'];

            for (let col of colsArray) {
                if (dataObj[col] || dataObj[col] === false || dataObj === 0 ||
                    (typeof dataObj[col] === 'string' && dataObj[col].length === 0)) {

                    updateObj[col] = knex.raw('?', [dataObj[col]])
                }
            }

            return knex.withSchema(schema).table('contest').update(updateObj).where('id', dataObj['id']).returning(['id'].concat(colsArray));
        } catch (e) {
            throw e;
        }
    },
    getEventOutcomes: async function (userId, contestId) {
        const sql = `with q as (
            select 
                p.id,
                p.title,
                p.correctvalue as outcome,
                h.totalinvested,
                h.totalreturn,
                h.totalrefund,
                json_build_object(
                    'selection', case when o ->> 'callvalue' = 'Y' then 'Yes' else 'No' end,
                    'totalinvested', COALESCE(sum( (o ->> 'invest')::double precision ), 0),
                    'totalreturn', COALESCE(sum( (o ->> 'returns')::double precision ), 0),
                    'totalrefund', COALESCE(sum( (o ->> 'refund')::double precision ), 0)
                ) as details
            from fantasy.probes p 
            inner join fantasy.history h on h.probeid = p.id, jsonb_array_elements(orders) o
            where fantasy_type = 'contest' and fantasy_id = :contestId and h.userid = :userId
            group by 
                p.id,
                p.title,
                p.correctvalue,
                h.totalinvested,
                h.totalreturn,
                h.totalrefund,
                o ->> 'callvalue'
            )
            SELECT id, title, outcome, totalinvested, totalreturn, totalrefund, json_agg(details) as details
            FROM q 
            GROUP BY id, title, outcome, totalinvested, totalreturn, totalrefund`;

        const res = await knex.raw(sql, { userId, contestId });
        return res?.rows || [];

    },
    getContestUser: async (contest_id, user_id, schema, useReadOnly) => {
        try {
            const knexClient = useReadOnly === true ? knexReadOnly : knex;
            const sqlQuery = `SELECT * FROM :schema:.contest_user WHERE contest_id = :contest_id and user_id = :user_id`;
            const res = await knexClient.raw(sqlQuery, { schema, contest_id, user_id });
            return res.rows.length > 0 ? res.rows[0] : null;
        } catch (e) {
            throw e;
        }
    },
    updateContestUser: function (dataObj, schema = 'fantasy') {
        try {
            var updateObj = {};
            const colsArray = ['islivechatenabled'];

            for (let col of colsArray) {
                if (dataObj[col] || dataObj[col] === false || dataObj === 0 ||
                    (typeof dataObj[col] === 'string' && dataObj[col].length === 0)) {

                    updateObj[col] = knex.raw('?', [dataObj[col]])
                }
            }

            return knex.withSchema(schema).table('contest_user').update(updateObj).where({'contest_id': dataObj['contest_id'],
            'user_id': dataObj['user_id']}).returning(['contest_id'].concat(colsArray));
        } catch (e) {
            throw e;
        }
    },
}

module.exports = Contest;