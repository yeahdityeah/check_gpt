'use strict';

const lodash = require('lodash');
const knex = require('../knex/knex.js');
const knexReadOnly = require('../knex/knex_readonly.js');
const { to } = require('../services/util.service');

const oldClubEventThreshold = 20

const ClubEvents = {
    create: function (dataObj) {
        return knex.insert(dataObj, 'id').into('social.club_event').then((id) => {
            return id;
        }).catch(err => {
            console.log(err)
            throw err;
        });
    },
    createEventOptions: function (dataObj) {
        return knex.insert(dataObj, 'id').into('social.club_event_option').then((id) => {
            return id;
        }).catch(err => {
            throw err;
        });
    },
    update: function (dataObj) {
        if(!dataObj?.id || isNaN(dataObj?.id)) {
            throw new Error(`Invalid ID in update event ${dataObj.id}`)
        }
        return knex('social.club_event')
        .where({ id: dataObj.id })
        .update(dataObj, [Object.keys(dataObj)]).returning(Object.keys(dataObj))
    },
    getClubEvents: function (clubId) {
        let sqlParams = [clubId];
        const sql = `
            select 
                e.id,
                title, 
                image_url, COALESCE(sum(coins), 0) as volume, count(distinct eo.id) as options_count
            from social.club_event e inner join
                social.club_event_option eo on e.id = eo.event_id left join
                social.club_event_bet bets on bets.event_id = e.id and bets.option = eo.id
            Where e.status = 'A' and e.starts_at <= now() and e.ends_at > now() and e.club_id = ?
            GROUP by 
                e.id,
                title,
                image_url
            order by id desc	
        `
        return knex.raw(sql, sqlParams).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    getClubEventsOwner: function (clubId) {
        let sqlParams = [clubId];
        const sql = `
            select 
                e.id,
                title, 
                image_url, COALESCE(sum(coins), 0) as volume, count(distinct eo.id) as options_count
            from social.club_event e inner join
                social.club_event_option eo on e.id = eo.event_id left join
                social.club_event_bet bets on bets.event_id = e.id and bets.option = eo.id
            Where e.status = 'A' and e.starts_at <= now() and e.club_id = ?
            GROUP by 
                e.id,
                title,
                image_url
            order by id desc	
        `
        return knex.raw(sql, sqlParams).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    getUserLiveClubEvents: function (userId, clubId) {
        let sqlParams = [userId, clubId, clubId];
        const sql = `
        with bets as (
            select id, user_id, event_id, club_id, coins, option, risk_factor, created_at
            from social.club_event_bet where user_id = ? and club_id = ?
            and status = 'open'
        ), latest_ids as (
            select max(id) id from social.club_event_bet
            where event_id In (select distinct event_id from bets)
            group by event_id
        ), latest as (
            select
                event_id,
                (k ->> 'id')::bigint option_id, 
                (k ->> 'pool_sum')::numeric option_pool,
                (k ->> 'rf_sum')::numeric option_rf
            from social.club_event_bet, json_array_elements(odds_meta) k
            where id in (select id from latest_ids)
            and club_id = ?
        ), stats as (
            select 
                event_id,
                sum(option_pool) as total_pool
            from latest
            group by event_id
        ), events as (
            select 
                e.id, e.title, e.image_url, e.risk_weightage
            from social.club_event e 
            where id in (select event_id from bets)
        ),
        profile as (
            select 
            bets.id, 
            bets.event_id, 
            eo.created_at,
            eo.label as label, 
            coins as investment, 
            (risk_factor * e.risk_weightage + coins /COALESCE(option_pool, 1))
            / (option_rf * e.risk_weightage + 1 ) * 
            (stats.total_pool - option_pool) + coins as returns,
           round( (	(risk_factor * e.risk_weightage + coins /COALESCE(option_pool, 1) )
            / (option_rf * e.risk_weightage + 1 ) * 
            (stats.total_pool - option_pool) + coins) / coins, 2 ) as roi
        from  bets, latest, stats, social.club_event_option eo, events e where 
            eo.event_id = bets.event_id and
            eo.id = bets.option and
            bets.option = option_id and 
            bets.event_id = latest.event_id and
            bets.option = latest.option_id and
            stats.event_id = latest.event_id and
            eo.event_id = e.id and
            stats.event_id = e.id and
            bets.event_id = e.id and
            latest.event_id  = e.id
        ) 
        select 
            e.id,
            e.title,
            e.image_url,
            json_agg(profile.* order by profile.id desc)  as bets
        from profile inner join social.club_event e 
        on profile.event_id = e.id
        group by
            e.id,
            e.title,
            e.image_url
        order by e.id desc        
        `
        return knex.raw(sql, sqlParams).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    getUserSettledClubEvents: function (userId, clubId) {
        let sqlParams = [userId, clubId];
        const sql = `
        with closed_bets as (
            select 
                bets.id, bets.event_id, bets.option, 
                eo.label, coins as investment, 
                COALESCE(
                    round(winnings, 2), 0
                ) as returns, 
            case when bets.rank = 0 then 'Lost' else 'Won' END as status
            from social.club_event_bet bets inner join social.club_event_option eo on
             bets.event_id = eo.event_id and bets.option = eo.id
            where user_id = ? and status = 'closed' and bets.club_id = ?
        ) 
        SELECT 
            e.id, title, image_url,
             json_agg(bets.* order by bets.id desc) as bets
        FROm closed_bets bets inner join social.club_event  e inner join
        social.club_event_option eo on eo.event_id = e.id
        on bets.event_id = e.id and bets.option = eo.id
        group by e.id, title, image_url, correct_value  
        `
        return knex.raw(sql, sqlParams).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    getUserClubEventDetails: function (userId, eventId) {
        let sqlParams = [userId, eventId];
        const sql = `
        select sum(coins) as invested_amount from social.club_event_bet where user_id = ? and event_id = ?
        `
        return knex.raw(sql, sqlParams).then((res) => {
            return res.rows.length?res.rows[0]['invested_amount']:0;
        }).catch((e) => {
            throw e;
        });

    },
    getClubEventById: function (eventId) {
        let sqlParams = [eventId];
        let whereClause = ` where a.id = ? `;
        const sql = `SELECT * FROM social.club_event a ${whereClause}`;
        return knex.raw(sql, sqlParams).then((res) => {
            return res.rows.length ? res.rows[0]: null;
        }).catch((e) => {
            throw e;
        });
    },
    getClubEventDetails: function (eventId) {
        let sqlParams = [eventId, eventId, eventId];
        let sql = `
            with event_details as (
                select 
                    id, 
                    title, 
                    club_id,
                    shareable_url,
                    description,
                    risk_weightage,
                    image_url, default_amount, starts_at as start_time ,
                    ends_at as end_time, rules, max_bet as max_amount
                from social.club_event 
                where id = ?
        ), stats as (
            select 
                e.id, COALESCE( sum(coins), 0 ) as volume,
                COALESCE( count(distinct user_id), 0 ) as total_participation
            from event_details e
            left join social.club_event_bet bets on bets.event_id = e.id
            group by e.id
        ), 
        amount as ( select default_amount as val from event_details ),  latest as (
            select
                event_id,
                (k ->> 'id')::bigint option_id, 
                COALESCE( (k ->> 'pool_sum')::numeric, 0 ) option_pool,
                COALESCE( (k ->> 'pool_sum')::numeric, 0 ) + amount.val as new_option_pool,
                COALESCE( (k ->> 'rf_sum')::numeric, 0) option_rf,
                amount.val as amount
            from amount ,(
                select event_id, odds_meta from social.club_event_bet
                where event_id = ?
                order by id desc limit 1
            )  bets, json_array_elements(odds_meta) k 
    ), total_pool as (
        select 
            COALESCE((select sum(option_pool) from latest), 0) as val,
            COALESCE((select sum(option_pool) from latest), 0) + amount.val as new_val
                      from amount  ),
        calculated as (
            SELECT
            eo.event_id, 
            eo.id, 
            eo.label, 
            COALESCE( option_pool, 0 ) as option_pool, 
            COALESCE(option_rf, 0) as option_sum, 
            total_pool.val as total_pool,
            option_pool / COALESCE(total_pool.val, 1) as poll_percent,
            amount.val as amount,
            (
                (( 1 -  option_pool / total_pool.val ) * e.risk_weightage) + amount / new_option_pool 
             ) / (
                 (option_rf  + ( 1 -  option_pool / total_pool.val )) * e.risk_weightage + 1
             )  * (
                     total_pool.new_val - new_option_pool 
             ) + amount as returns
        
        FROM amount, total_pool, event_details e inner join social.club_event_option eo 
        on e.id = eo.event_id
        LEFT JOIN latest l
        ON eo.event_id = l.event_id and eo.id = l.option_id
        WHERE eo.event_id = ?
        ), event_options as (
            select 
            event_id,
            json_agg(
                json_build_object(
                    'id', calculated.id,
                    'label', label,
                    'amount', amount,
                    'option_pool', option_pool,
                    'poll_percent', 
                        round((case 
                            when stats.volume = 0 then 1::numeric/COALESCE(
                                NULLIF((select count(distinct id) from calculated), 0), 1
                            )
                            else COALESCE(poll_percent, 0)
                        end), 4)
                    ,
                    'roi', (COALESCE(returns, amount)/COALESCE(amount, 1))
                )
            ) as options
        FROM calculated inner join stats on calculated.event_id = stats.id group by event_id, stats.volume
        
        ) 
        select e.*, eo.options, stats.volume, stats.total_participation  from event_details e
        inner join event_options eo on e.id = eo.event_id
        inner join stats on e.id = stats.id
        `

        if(eventId <= oldClubEventThreshold) {
            sql = `with event_details as (
                    select 
                        id, 
                        title, 
                        club_id,
                        shareable_url,
                        description,
                        image_url, default_amount, starts_at as start_time ,
                        ends_at as end_time, rules, max_bet as max_amount
                    from social.club_event 
                    where id = ?
            ), stats as (
                select 
                    e.id, COALESCE( sum(coins), 0 ) as volume,
                    COALESCE( count(distinct user_id), 0 ) as total_participation
                from event_details e
                left join social.club_event_bet bets on bets.event_id = e.id
                group by e.id
            ), 
            amount as ( select default_amount as val from event_details ),  latest as (
                select
                    event_id,
                    (k ->> 'id')::bigint option_id, 
                    COALESCE( (k ->> 'pool_sum')::numeric, 0 ) option_pool,
                    COALESCE( (k ->> 'pool_sum')::numeric, 0 ) + amount.val as new_option_pool,
                    COALESCE( (k ->> 'rf_sum')::numeric, 0) option_rf,
                    amount.val as amount
                from amount ,(
                    select event_id, odds_meta from social.club_event_bet
                    where event_id = ?
                    order by id desc limit 1
                )  bets, json_array_elements(odds_meta) k 
        ), total_pool as (
            select 
                COALESCE((select sum(option_pool) from latest), 0) as val,
                COALESCE((select sum(option_pool) from latest), 0) + amount.val as new_val
                        from amount  ),
            calculated as (
                SELECT
                eo.event_id, 
                eo.id, 
                eo.label, 
                COALESCE( option_pool, 0 ) as option_pool, 
                COALESCE(option_rf, 0) as option_sum, 
                total_pool.val as total_pool,
                option_pool / COALESCE(total_pool.val, 1) as poll_percent,
                amount.val as amount,
                (
                    ( 1 -  new_option_pool / total_pool.new_val ) + amount / new_option_pool 
                ) / (
                    option_rf + ( 1 -  new_option_pool / total_pool.new_val ) + 1
                )  * (
                        total_pool.new_val - new_option_pool 
                ) + amount as returns
            
            FROM amount, total_pool, social.club_event_option eo LEFT JOIN latest l
            ON eo.event_id = l.event_id and eo.id = l.option_id
            WHERE eo.event_id = ?
            ), event_options as (
                select 
                event_id,
                json_agg(
                    json_build_object(
                        'id', calculated.id,
                        'label', label,
                        'amount', amount,
                        'option_pool', option_pool,
                        'poll_percent', 
                        round((case 
                            when stats.volume = 0 then 1::numeric/COALESCE(
                                NULLIF((select count(distinct id) from calculated), 0), 1
                            )
                            else COALESCE(poll_percent, 0)
                        end), 4),
                        'roi', (COALESCE(returns, amount)/COALESCE(amount, 1))
                    )
                ) as options
                FROM calculated inner join stats on calculated.event_id = stats.id group by event_id, stats.volume
            
            ) 
            select e.*, eo.options, stats.volume, stats.total_participation  from event_details e
            inner join event_options eo on e.id = eo.event_id
            inner join stats on e.id = stats.id`
        }
        return knex.raw(sql, sqlParams).then((res) => {
            return res.rows
        }).catch((e) => {
            throw e;
        });
    },
    getClubEventOdds: function (eventId, amount) {
        let sqlParams = [amount, eventId, eventId, eventId];
        let sql = `
        with amount as ( select ?::numeric as val ),  latest as (
            select
                event_id,
                (k ->> 'id')::bigint option_id, 
                COALESCE( (k ->> 'pool_sum')::numeric, 0 ) option_pool,
                COALESCE( (k ->> 'pool_sum')::numeric, 0 ) + amount.val as new_option_pool,
                COALESCE( (k ->> 'rf_sum')::numeric, 0) option_rf,
                amount.val as amount
            from amount ,(
                select event_id, odds_meta from social.club_event_bet
                where event_id = ?
                order by id desc limit 1
            )  bets, json_array_elements(odds_meta) k 
    ), total_pool as (
        select 
            COALESCE((select sum(option_pool) from latest), 0) as val,
            COALESCE((select sum(option_pool) from latest), 0) + amount.val as new_val
                      from amount  ),
    calculated as (
        SELECT
        eo.event_id, 
        eo.id, 
        eo.label, 
        COALESCE( option_pool, 0 ) + amount as option_pool, 
        COALESCE(option_rf, 0) as option_sum, 
        total_pool.val as total_pool,
        amount.val as amount,
        option_pool / COALESCE( NULLIF(total_pool.val, 0), 1 ) as poll_percent,
        ( 1 -  new_option_pool / total_pool.new_val ) as risk_factor,
        amount / new_option_pool  as pool_contribution,
         (
            (( 1 -  option_pool / total_pool.val ) * e.risk_weightage) + amount / new_option_pool 
         ) / (
             (option_rf  + ( 1 -  option_pool / total_pool.val )) * e.risk_weightage + 1
         )  * (
                 total_pool.new_val - new_option_pool 
         ) + amount as returns
    
    FROM amount, total_pool, social.club_event e inner join social.club_event_option eo on e.id = eo.event_id LEFT JOIN latest l
    ON eo.event_id = l.event_id and eo.id = l.option_id
    WHERE e.id = ? AND eo.event_id = ?
    )
    select  
         
        CAST(id AS integer),
        label,
        CAST(COALESCE(option_pool, amount) AS float ) as option_pool,
        cast(round((case 
            when total_pool.val = 0 then 1::numeric/COALESCE(
                NULLIF((select count(distinct id) from calculated), 0), 1
            )
            else COALESCE(poll_percent, 0)
        end), 4) as float) as poll_percent,
        CAST(COALESCE(returns, amount)/COALESCE(amount, 1) as float) as roi
    FROM calculated, total_pool
        `
        if(eventId <= oldClubEventThreshold) {
            sqlParams = [amount, eventId, eventId];
            sql = `
                with amount as ( select ?::numeric as val ),  latest as (
                    select
                        event_id,
                        (k ->> 'id')::bigint option_id, 
                        COALESCE( (k ->> 'pool_sum')::numeric, 0 ) option_pool,
                        COALESCE( (k ->> 'pool_sum')::numeric, 0 ) + amount.val as new_option_pool,
                        COALESCE( (k ->> 'rf_sum')::numeric, 0) option_rf,
                        amount.val as amount
                    from amount ,(
                        select event_id, odds_meta from social.club_event_bet
                        where event_id = ?
                        order by id desc limit 1
                    )  bets, json_array_elements(odds_meta) k 
            ), total_pool as (
                select 
                    COALESCE((select sum(option_pool) from latest), 0) as val,
                    COALESCE((select sum(option_pool) from latest), 0) + amount.val as new_val
                            from amount  ),
            calculated as (
                SELECT
                eo.event_id, 
                eo.id, 
                eo.label, 
                COALESCE( option_pool, 0 ) + amount as option_pool, 
                COALESCE(option_rf, 0) as option_sum, 
                total_pool.val as total_pool,
                amount.val as amount,
                option_pool / COALESCE( NULLIF(total_pool.val, 0), 1 ) as poll_percent,
                ( 1 -  new_option_pool / total_pool.new_val ) as risk_factor,
                amount / new_option_pool  as pool_contribution,
                (
                    ( 1 -  new_option_pool / total_pool.new_val ) + amount / new_option_pool 
                ) / (
                    option_rf + ( 1 -  new_option_pool / total_pool.new_val ) + 1
                )  * (
                        total_pool.new_val - new_option_pool 
                ) + amount as returns
            
            FROM amount, total_pool, social.club_event_option eo LEFT JOIN latest l
            ON eo.event_id = l.event_id and eo.id = l.option_id
            WHERE eo.event_id = ?
            )
            select  
                
                CAST(id AS integer),
                label,
                CAST(COALESCE(option_pool, amount) AS float ) as option_pool,
                cast(round((case 
                    when total_pool.val = 0 then 1::numeric/COALESCE(
                        NULLIF((select count(distinct id) from calculated), 0), 1
                    )
                    else COALESCE(poll_percent, 0)
                end), 4) as float) as poll_percent,
                CAST(COALESCE(returns, amount)/COALESCE(amount, 1) as float) as roi
            FROM calculated, total_pool
                `            
        }
        return knex.raw(sql, sqlParams).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });

    },
    checkOption: async (eventId, optionId) => {
        try {
            const checkOptionSql = `select count(id)  > 0 as valid
            from social.club_event_option where event_id = :eventId
            and id = :optionId`;
            const res = await knex.raw(checkOptionSql, {
                eventId,optionId
            })
            console.log(res?.rows?.[0] )
            return res?.rows?.[0]?.valid ?? false;
        } catch(e) {
            console.log(e.message, e)
            return false;
        }
    },
    settleEvent: async (eventId, optionId) => {
        const sql = `with correct as (
            select :optionId::bigint  as val, label as option_label from 
            social.club_event_option where id = :optionId
        ), 
        bets as (
            select * from social.club_event_bet
            where event_id = :eventId and status = 'open' 
        ), latest as (
            select (k ->> 'id')::bigint option_id, 
                (k ->> 'pool_sum')::numeric option_pool,
                (k ->> 'rf_sum')::numeric option_rf
            from (
                select odds_meta from bets order by id desc limit 1
            ) p, json_array_elements(odds_meta) k
        ) 
        , stats as (
            select 
                sum(option_pool) as total_pool,
                sum(case when option_id = correct.val then option_pool else 0 end)
                as winning_pool,
                sum(case when option_id = correct.val then option_rf else 0 end)
                as winning_rf,
                sum(case when option_id <> correct.val then option_pool else 0 end)
                as profit_pool
            from latest, correct
        ), winnings as (
            select 
            bets.id,
            event_id,
            option,
            correct.option_label,
            user_id, 
            order_id,
            coins, 
            risk_factor,

            (risk_factor * e.risk_weightage + coins / COALESCE(winning_pool, 1))
            / (winning_rf * e.risk_weightage + 1 ) * profit_pool + coins as returns

        from  social.club_event e inner join bets on e.id = bets.event_id, stats, correct where
            e.id = :eventId and
            option = correct.val
            
        ), details as (
        select 
            w.user_id as userid,
            coins as coins,
            returns as amount,
            'CREDIT' as type,
            now() as createdat,
            0 as surcharge,
            'D' as  wallettype,
            array_to_string(
                ARRAY[
                    'Settlement for club event:',
                    c.title,
                    'of event',
                    ce.title,
                    'with option',
                    option_label,
                    'for investment of',
                    '₹'
                ], E'\n'
            ) as message,
             'CLS1000' || event_id as txnid
        from winnings w inner join social.club_event ce
        on w.event_id = ce.id inner join social.club c
        on ce.club_id = c.id
        ) select userid, type, createdat, surcharge, message, txnid, 
        sum(coins) as coins, sum(amount) as amount from details
        group by userid, type, createdat, surcharge, message, txnid`

        return knex.raw(sql, {
            eventId,
            optionId
        }).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });

    },
    cancelEvent: function (eventId) {
        const sql = `select user_id as userid, sum(coins) as amount, 'D' as wallettype, 
        'CREDIT'  as type, now() as createdat, 
        format('Refund due to event cancellation
        %1$s 
        of club
        %2$s', e.title, c.title) as message,
        'RFCLB1000' || event_id as txnid,
        null as refid,
        0 as surcharge
        from social.club_event_bet bets 
        inner join social.club c on c.id = bets.club_id 
        inner join social.club_event e on e.id = bets.event_id 
        where event_id = :eventId and bets.status ='open'
        group by event_id, user_id, e.title, c.title`
        

        return knex.raw(sql, {
            eventId
        }).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });

    },
    resetEvent: function (eventId) {

        const sql = `with event_info as (
            select * from social.club_event where id = :eventId
        ),
        club_info as (
            select * from social.club where id = (select club_id from event_info)
        ),
        settlement_debit as (
        select userid, amount - surcharge as amount, 'D' as wallettype, 
                'DEBIT'  as type, now() as createdat, 
                format('Debited due to event reset
                %1$s 
                of club
                %2$s', (select title from event_info),(select title from club_info)) as message,
                'CLSRST1000' || :eventId as txnid,
                null as refid,
                0 as surcharge
                from transactions
                where txnid = 'CLS1000' || :eventId and ((createdat > (select last_reset from event_info)) or ((select last_reset from event_info) is null))
        ),
        clbrf_debit as (
        select userid, amount as amount, 'D' as wallettype, 
                'DEBIT'  as type, now() as createdat, 
                format('Debited due to event reset
                %1$s 
                of club
                %2$s', (select title from event_info),(select title from club_info)) as message,
                'CLBRFREV1000' || :eventId as txnid,
                null as refid,
                0 as surcharge
                from transactions
                where txnid = 'CLBRF1000' || :eventId and ((createdat > (select last_reset from event_info)) or ((select last_reset from event_info) is null))
        ),
        tds_credit as (
        select userid, amount as amount, 'D' as wallettype, 
                'CREDIT'  as type, now() as createdat, 
                format('TDS Credited due to event reset
                %1$s 
                of club
                %2$s', (select title from event_info),(select title from club_info)) as message,
                'TDSRF1000' || :eventId as txnid,
                null as refid,
                0 as surcharge
                from transactions
                where txnid = 'TDSCLB1000' || :eventId and ((createdat > (select last_reset from event_info)) or ((select last_reset from event_info) is null))
        ),
        tradingfee_credit as (
            select userid, amount as amount, 'D' as wallettype, 
                    'CREDIT'  as type, now() as createdat, 
                    format('Trading Fee Credited due to event reset
                    %1$s 
                    of club
                    %2$s', (select title from event_info),(select title from club_info)) as message,
                    'CLFREV1000' || :eventId as txnid,
                    null as refid,
                    0 as surcharge
                    from transactions
                    where txnid = 'CLF1000' || :eventId and ((createdat > (select last_reset from event_info)) or ((select last_reset from event_info) is null))
        )
          select * from settlement_debit UNION select * from clbrf_debit UNION select * from tds_credit UNION select * from tradingfee_credit`

        return knex.raw(sql, {
            eventId
        }).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });

    },
    updateBetWinStatus: (eventId, optionId) => {
        const sql = `UPDATE social.club_event_bet 
        SET 
            winnings = sq.returns,
            rank = 1,
            status = 'closed'
        FROM (	
        with correct as (
            select :optionId::bigint as val
        ), 
        bets as (
            select * from social.club_event_bet where event_id = :eventId and status = 'open'
        ), latest as (
            select (k ->> 'id')::bigint option_id, 
                (k ->> 'pool_sum')::numeric option_pool,
                (k ->> 'rf_sum')::numeric option_rf
            from (
                select odds_meta from bets order by id desc limit 1
            ) p, json_array_elements(odds_meta) k
        ) 
        , stats as (
            select 
                sum(option_pool) as total_pool,
                sum(case when option_id = correct.val then option_pool else 0 end)
                as winning_pool,
                sum(case when option_id = correct.val then option_rf else 0 end)
                as winning_rf,
                sum(case when option_id <> correct.val then option_pool else 0 end)
                as profit_pool
            from latest, correct
        ), winnings as (
            select 
            bets.id,
            option,
            user_id, 
            coins, 
            risk_factor,
            (risk_factor * e.risk_weightage + coins / ( COALESCE(winning_pool, 1) ))
            / (winning_rf * e.risk_weightage + 1 ) * profit_pool + coins as returns
        from  social.club_event e inner join bets on e.id = bets.event_id, stats, correct where
            e.id = :eventId and
            option = correct.val
            
            
        )
        select * from winnings ) sq
        WHERE club_event_bet.id = sq.id and sq.option = club_event_bet.option 
        RETURNING sociAl.club_event_bet.id`

        return knex.raw(sql, {
            eventId,
            optionId
        }).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    }, 
    updateBetLostStatus: (eventId, optionId) => {
        const sql = `UPDATE social.club_event_bet 
        SET 
            winnings = null,
            rank = 0,
            status = 'closed'
        FROM (	
        with bets as (
            select * from social.club_event_bet 
            where event_id = :eventId and status = 'open' and option <> :optionId
        ) select * from bets ) sq
        WHERE club_event_bet.id = sq.id and sq.option = club_event_bet.option 
        RETURNING club_event_bet.id`

        return knex.raw(sql, {
            eventId,
            optionId
        }).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    updateBetCancelStatus: (eventId) => {
        const sql = `UPDATE social.club_event_bet set status = 'cancelled' where event_id = :eventId RETURNING event_id`

        return knex.raw(sql, {
            eventId
        }).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    updateEventCancelStatus: (eventId) => {
        const sql = `UPDATE social.club_event set status ='CAN' where id = :eventId RETURNING id`

        return knex.raw(sql, {
            eventId
        }).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    updateBetResetStatus: (eventId) => {
        const sql = `update social.club_event_bet set status = 'open' where event_id = :eventId RETURNING event_id`

        return knex.raw(sql, {
            eventId
        }).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    updateEventResetStatus: (eventId) => {
        const sql = `update social.club_event set status = 'RST', last_reset = now() where id = :eventId RETURNING id`

        return knex.raw(sql, {
            eventId
        }).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    getOwnerCommission: (eventId) => {
        const sql = `
            SELECT c.owner_id as id, COALESCE(
                e.owner_commission, c.owner_commission
            ) as commission
            from social.club_event  e
            inner join social.club c on e.club_id = c.id
            where e.id = :eventId
        `
        return knex.raw(sql, {
            eventId
        }).then((res) => {
            return res?.rows?.[0]
        }).catch((e) => {
            throw e;
        });
    }
}

module.exports = ClubEvents;