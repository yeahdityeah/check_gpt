
const knex = require('../knex/knex_readonly.js');
const luxon = require('luxon');
const log = (...args) => console.log('[PRO TRADER INCENTIVE MODEL]', ...args);




const ProTraderIncentive = {

    getIncentiveConfig: async () => {
        try {
            const sql = `select  
                level, label,
                qualifying_shares as "qualifyingShares",
                rewards
                from pro_trader_config order by level`;

        const res = await knex.raw(sql);
        return res?.rows ?? [];
        } catch(e) {
            throw e;
        }
    },
    
    getIncentiveByUser: async (ts, userId, config) => {
        try {
            const incentiveConfig = JSON.stringify(config)
            const sql = `with dates as (
                select cast( :ts as date ) as d
            ), q as (
                select 
                    id, title, subcat, subsubcat, hashtags, category
                from probes, dates where
                endsat >= d and is_price_editable and probe_type <> 'promo'
            ), config as (
                select  
                level, label,
                qualifying_shares as "qualifyingShares",
            rewards
            from pro_trader_config order by level
            ), closed_trades as (
                select 
                    pc.userid, 
                    sum(COALESCE(noofcontracts)) as noofcontracts
                from 
                    probecalls pc, dates 
                where probeid in (select id from q)
                and userid = :userId
                and pc.status  IN ('A', 'H')
                and pc.rank <> -1
                and (
                    (status = 'A' AND coins BETWEEN 10 and 90) OR
                    (status = 'H' AND lastprice BETWEEN 10 and 90) 
                )
                and (createdat + '05:30:00'::interval)::date = d
                group by pc.userid
            ), open_trades as (
                select 
                    pco.userid, 
                    sum(COALESCE(noofcontracts)) as noofcontracts
                from 
                    probecallsopen pco, dates 
                where probeid in (select id from q)
                and userid = :userId
                and pco.status  IN ('H')
                and lastprice between 10 and 90
                and (createdat + '05:30:00'::interval)::date = d
                group by pco.userid
            )
            
            -- Add Sell Trades as additional Matched Order
            , sell_trades_details as (
                select 
                    pc.userid, 
                    (pc.createdat + '05:30:00'::interval)::date as date,
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
                and pc.userid = :userId
                and pc.status  IN ('EX')
                and pc.coins <> pc.lastprice
                and (pc.createdat + '05:30:00'::interval)::date = d
                group by pc.id, pc.userid, (pc.createdat + '05:30:00'::interval)::date, pc.execid, pc.noofcontracts, pc.lastprice, pc.coins
            )
            
            -- Group Sell Trades of users 
            , sell_trades as (
                select userid, sum(noofcontracts) as noofcontracts from sell_trades_details
                group by userid
             )
             , stats as (
                select 
                        userid, 
                        sum(noofcontracts) as "curShares", 
                        width_bucket(sum(noofcontracts), (select array_agg("qualifyingShares") from config)) as level from 
                (
                    select * from closed_trades
                    UNION ALL 
                    select * from open_trades
                    UNION ALL
                    select * from sell_trades
                ) k
                group by userid order by "curShares" desc
            ), earned as (
				select :userId::bigint as userid, (select sum(rewards) cummulative
				FROM pro_trader_incentive  where user_id = :userId
				and date <> (select d from dates)
				group by user_id)
			) 
            
            select 
                  COALESCE(config.label, 'Level 0') as "curLevel",
                  COALESCE(config.rewards, 0)  as "curLevelReward",
                  LEAST(
                    COALESCE("curShares", 0),
                    (SELECT max("qualifyingShares") from config)
                  ) as "curShares",
                  COALESCE(
					  'Unlock ' || (SELECT label from config where level = stats.level + 1),
					  (CASE 
                        WHEN stats.level = (SELECT max(level) from config) THEN null
                        ELSE 'Unlock level 1' 
                      END)
				  ) as "nextLevel",
                  COALESCE(
                     (SELECT "qualifyingShares" from config WHERE level = COALESCE(stats.level, 0) + 1),
                     (SELECT max("qualifyingShares") from config)
                  ) as "nextLevelShares",
                  (d - '05:30:00'::interval + '1 day')::timestamptz as "levelResetTime",
                  COALESCE(config.rewards, 0) 
				  + COALESCE(earned.cummulative, 0)  as "totalRewardsEarned" 
            from dates, earned left join stats  using (userid)  left join config using(level) `;

            // knex.raw(sql, {
            //     userId, incentiveConfig, ts
            // })
            
            // console.log(knex.raw(sql, {
            //     userId, incentiveConfig, ts
            // }).toSQL().toNative().sql, knex.raw(sql, {
            //     userId, incentiveConfig, ts
            // }).toSQL().toNative().bindings)
            const res = await knex.raw(sql, {
                userId, ts
            })
            return res?.rows?.[0] ?? {
                curLevel: 'Level 0',
                curLevelReward: 0,
                curShares: 0,
                nextLevel: config[0]?.label,
                nextLevelShares: config[0]?.qualifyingShares,
                levelResetTime: luxon.DateTime.now().setZone('gmt').startOf('day').plus({days: 1, hours: -5, minutes: -30}).toISO(),
            };
        } catch(e) {
            log("ERROR", e.message);
            throw(e);
        }
    }
}


module.exports = ProTraderIncentive