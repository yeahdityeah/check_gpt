'use strict';
const knex = require('../knex/knex.js');
const knexReadOnly = require('../knex/knex_readonly.js');
const CONFIG = require('../config/config');

const log = (...args) => console.log('[REWARDS MODEL]', ...args);

const Rewards = {
    get: async (userId, flowId, isProfileComplete = true) => {
        try {
            const sql = `
            SELECT
            rfu.flow_complete,
            NOT rfu.flow_complete as "active",
            r.id as level,
            r.cta as cta,
            r.icon as icon,
            r.bg_color as "bgColor",
            r.text_color as "textColor",
            rfu.step as progress,
            (r.meta ->> 'count')::int as total,
            CASE
                WHEN r.task_type = 'trade' AND rfu.ref_ts + r.expiry >= now()
                    THEN 'Reward ' || r.reward || ' token points'
                WHEN r.task_type = 'profile' AND :isProfileComplete = true
                    THEN 'Reward ' || r.reward || ' token point
                    s'
                ELSE 'Reward ' || r.reward_after_expiry || ' token points'
            END as title,
            r.info,
            EXTRACT('epoch' from expiry) as "expirySeconds",
            rfu.ref_ts as "refTime",
            (rfu.ref_ts + (EXTRACT('epoch' from r.expiry) * interval '1 second')) as expTime,
            rfu.status,
            r.img,
            CASE
                WHEN (r.task_type = 'trade' AND status = 'complete') OR (r.task_type = 'profile' AND :isProfileComplete = true)
                    THEN '{
                        "title": "Task Completed",
                        "info": "Claim your reward",
                        "action": "Claim",
                        "img": "images/levelcomplete.webp",
                        "actionUrl": "/v2/reward/claim",
                        "bgColor": "#00AA51"
                    }'::json
                ELSE null
            END as completion
        FROM reward_flow_user rfu
        INNER JOIN reward r on rfu.reward = r.id
        WHERE rfu.userid = :userId and rfu.flow_id = :flowId
            `;
            const res = await knex.raw(sql, {userId, flowId, isProfileComplete});
            return res?.rows?.[0] ?? {
                active: false,
                flowComplete : true
            }
            
        } catch(e) {
            log("ERROR", e.message);
            return {
                active: false
            }
        }
    },
    getClaimData: async (userId, flowId) => {
        const sql = `
        with q as (
	
            SELECT 
                :flowId as flow_id,
                    
                    now() as current_ts,
                    rfu.reward as cur_level,
                    rf.nxt as nxt_level,
                    case when updatedat - ref_ts < expiry then r.reward else r.reward_after_expiry  end as tokens,
                    row_to_json(r.*) as cur_level_meta,
                    rfu.completion::jsonb
            
                from reward_flow_user rfu 
                inner join reward r on rfu.reward = r.id
                inner join reward_flow rf on rfu.flow_id = rf.id and rf.cur = rfu.reward
                where userid = :userId and flow_id = :flowId
            
       )  select 
               json_build_object(
                'ref_ts', current_ts ,
                'reward', nxt_level,
                'step', 0, 
                'status',  'active',
                'flow_complete', nxt_level is null,
                 'completion', completion || jsonb_build_object(
                    'ts', current_ts,
                    'level', cur_level,
                    'claimed', tokens
                )) as reward_flow_user,
            json_build_object(
                'userid', :userId::bigint,
                'amount', tokens,
                'action', '{"type": "funds", "operation": "coupon"}'::json,
                'wallettype', 'P',
                'txnid', 'REWARD'|| LPAD(flow_id::text, 3, '0') || LPAD(cur_level::text, 3, '0'),
                'message', 'Reward for completing - ' ||( cur_level_meta ->> 'info'),
                'type', 'CREDIT'
            ) as tx
            
        FROM q
            
        `
        const res = await knex.raw(sql, {userId, flowId});
        return res?.rows?.[0] ?? {
                active: false
        };
    },
    upgradeLevel: async (data, userid, flow_id, trx) => {
        const client = trx ?? knex;
        const res = await client('reward_flow_user').update(data).where({
            userid,
            flow_id
        }).returning(['userid'])
        return res;
    },
    addToRewardFlowUser: async (dataObj) => {
        const insertedRewardFlowUser = await knex('reward_flow_user').insert(dataObj).returning('*');
        return insertedRewardFlowUser;
    },
    isUserActive: async (userid) => {
        try {
            if (!userid) {
                return false;
            }
            const knexClient = knexReadOnly;
            const sqlQuery = `SELECT * FROM reward_flow_user where userid = ? and status = 'active' and flow_complete = false`;
            const res = await knexClient.raw(sqlQuery, [userid]);
            return res.rows.length > 0 ? res.rows[0] : false;
        } catch (e) {
            throw e;
        }
    },
    getRewardData: async (reward_id) => {
        try {
            const knexClient = knexReadOnly;
            const sqlQuery = `SELECT * FROM reward where id = ?`;
            const res = await knexClient.raw(sqlQuery, [reward_id]);
            return res.rows.length > 0 ? res.rows[0] : false;
        } catch (e) {
            throw e;
        }
    },
    getTradeStats: async (meta, ref_ts, completion, userid) => {
        try {
            const knexClient =  knexReadOnly ;

            let sqlBase = `
                SELECT ${meta.is_distinct ? 'COUNT(DISTINCT tb.probeid)' : 'COUNT(DISTINCT pc.orderid)'}, max(t.createdat) as ts
                FROM transactions t
                JOIN probecalls pc ON t.refid = pc.orderid
                JOIN transaction_breakup tb ON t.id = tb.id
                WHERE t.createdat >= ? AND t.txnid ~* ? AND t.userid = ?
                AND pc.status IN ${meta.all_trades ? "('A', 'EX', 'O')" : "('A', 'EX')"}
            `;
            let queryParams = [ref_ts.toISOString(), meta.txnid_regex, userid];

            if (completion && completion.length > 0) {
                const greatestTransactionId = completion.reduce((max, item) => item.transaction_id > max ? item.transaction_id : max, completion[0].transaction_id);
                sqlBase += " AND t.id >= ?";
                queryParams.push(greatestTransactionId);
            }

            const res = await knexClient.raw(sqlBase, queryParams);
            return res.rows.length > 0 ? {
                trade_count: res?.rows?.[0]?.count,
                ts: res?.rows?.[0]?.ts,
            } : {
                trade_count: 0,
                ts: null,
            };
        } catch (e) {
            console.error('Error executing getTradeCount', e);
            throw e;
        }
    },
    updateProgress: async (userid, step, status, updatedat) => {
        try {
            const knexClient = knex;

            const sqlQuery = `
                UPDATE public.reward_flow_user
                SET step = ?, status = ?, updatedat = ?
                WHERE userid = ?
            `;

            const res = await knexClient.raw(sqlQuery, [step, status, updatedat, userid]);

            if (res.rowCount > 0) {
                console.log('Update successful');
                return true;
            } else {
                console.log('Update failed or no rows affected');
                return false;
            }
        } catch (e) {
            console.error('Error updating step and status', e);
            throw e;
        }
    },
    calculateTotalTokens: async (limit, offset) => {
        const sql = `select COALESCE(sum(coinsp), 0) as total_tokens, count(distinct userid) as token_holders from wallet_new inner join
        (
            SELECT max(id) id from wallet_new group by userid order by userid 
        ) ids using(id) where coinsp > 0 AND userid NOT IN (${CONFIG.EXCLUDE_USERIDS_COINSP_CALC.join(',')}) `
        const res = await knexReadOnly.raw(sql);
        return res?.rows?.[0];
    },
    getDistinctUsers: async () => {
        const sql = `select count(distinct userid) as users_count from wallet_new where coinsp > 0`;
        const res = await knexReadOnly.raw(sql);
        return res?.rows?.[0]?.users_count;
    },
    getPromoCoins: async (userId) => {
        const sql = `select coinsp from wallet_new where userid = :userId order by id desc limit 1`;
        const res = await knexReadOnly.raw(sql, { userId });
        return res?.rows?.[0]?.coinsp;
    },
    getPreviousEarnings: async (userId, limit = 6) => {
        const sql = `with months as (
            select * from generate_series('2024-03-01', date_trunc('month', now()) - '1 day'::interval, '1 month'::interval) date order by date desc limit :limit
        )
        select to_char(COALESCE(utr.date, months.date),  'Mon YYYY') as month, round(
            floor ( COALESCE(amount *  100, 0)::numeric ) / 100, 2
        ) as amount from months left join user_token_reward utr on utr.date = months.date and userid = :userId
		order by months.date desc limit 6`;
        const res = await knexReadOnly.raw(sql, { userId, limit });
        return res?.rows ?? [];
    },
    canCreateEvent: async (userId) => {
        const sql = `SELECT userid, flow_complete FROM reward_flow_user WHERE userid = :userId`;
        const res = await knexReadOnly.raw(sql, { userId });
        return (res?.rows ?? []).length === 0 ? true : res?.rows?.[0]?.flow_complete
        
    },
    getEndTimeFromConfig: async (interval) => {
        const sql = `SELECT date_trunc(?, now() + '05:30:00'::interval) + INTERVAL '1 week'  AS endTime;`;
        const res = await knexReadOnly.raw(sql,[interval]);
        return res?.rows?.[0]?.endtime ?? null;
    },
    getUserFlowId: async(userid) => {
        try {
            if (!userid) {
                return false;
            }
            const knexClient = knexReadOnly;
            const sqlQuery = `SELECT flow_id FROM reward_flow_user where userid = ?`;
            const res = await knexClient.raw(sqlQuery, [userid]);
            return res.rows.length > 0 ? res.rows[0].flow_id : false;
        } catch (e) {
            throw e;
        }
    },
    getStartingRewardForFlowId: async(flow_id) => {
        try {
            const knexClient = knexReadOnly;
            const sqlQuery = `select cur from reward_flow where prv is null and id = ?`;
            const res = await knexClient.raw(sqlQuery, [flow_id]);
            return res.rows.length > 0 ? res.rows[0].cur : false;
        } catch (e) {
            throw e;
        }
    }

}

module.exports = Rewards;