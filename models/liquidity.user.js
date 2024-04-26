'use strict';

const knex = require( '../knex/knex' );
const knexReadOnly = require( '../knex/knex_readonly' );

const tableName = 'liquidity_users';

const LiquidityUsers = {
  addLiquidityUserData: function (data, schema = 'public') {
    return knex
      .withSchema(schema)
      .insert(data, "id")
      .into(tableName)
      .then((id) => {
        return id[0];
      })
      .catch((err) => {
        throw err;
      });
  },
  getUserCurrentLiquidityForProbe: function (userId, probeId, schema = 'public') {
    const resultSet = knex
      .withSchema(schema)
      .select()
      .from(tableName)
      .where({ probe_id: probeId, user_id: userId })
      .orderBy("id", "desc")
      .limit(1);
    return resultSet;
  },
  getAllUsersLiquidityForProbe: function (probeId, schema='public') {
    return knex.withSchema(schema)
      .select(knex.raw('distinct on ("user_id") *'))
      .from(tableName)
      .where({ probe_id: probeId })
      .orderBy([
        { column: "user_id", order: "desc" },
        { column: "id", order: "desc" },
      ]);
  },
  markUserProbeLiqInactive: function (id) {
    return knex(tableName)
      .update({ status: "I" })
      .where({ id })
      .then(
        (rs) => {
          return rs;
        },
        (err) => {
          throw err;
        }
      );
  },
  getPortfolioDisplayLiqDetails: function (userId) {
    const sql = `SELECT a.probe_id,
                            SUM(CASE
                                    WHEN a.action = 'added'
                                        THEN a.liquidity_tokens_count
                                    ELSE 0 END) as added_token_count,
                            SUM(CASE
                                    WHEN a.action = 'removed'
                                        THEN a.liquidity_tokens_count
                                    ELSE 0 END) as removed_token_count,
                            SUM(CASE
                                    WHEN a.action = 'added'
                                        THEN a.liquidity_tokens_count * a.liquidity_tokens_issue_price
                                    ELSE 0 END) as added_amount,
                            SUM(CASE
                                    WHEN a.action = 'removed'
                                        THEN a.liquidity_tokens_count * a.liquidity_tokens_issue_price
                                    ELSE 0 END) as removed_amount,
                            b.*
                     FROM liquidity_users a
                              LEFT JOIN probes b on b.id = a.probe_id
                     WHERE a.user_id = ${userId}
                       and b.status in ('A', 'F')
                       and b.is_price_editable = false
                       and is_variable_liquidity_pool = true
                     GROUP BY a.probe_id, b.id`;

    return knex.raw(sql).then((res) => {
      return res.rows.length > 0 ? res.rows : [];
    });
  },
  getAllEventLiquidity: function (probeId, schema = 'public') {
    const sqlParams = [probeId, "added_trading_fee"];
    const sql = `select * ${knex.raw('FROM :schema:.liquidity_users', {schema}).toSQL().sql} where probe_id = ? and action <> ? order by id`;
    return knex.raw(sql, sqlParams).then((res) => {
      return res.rows.length > 0 ? res.rows : [];
    });
  },
  setUserLiqCancelEvent: function (probeId) {
    return knex(tableName)
      .update({ status: "CN" })
      .where({ probe_id: probeId, status: "A" })
      .then(
        (rs) => {
          return rs;
        },
        (err) => {
          throw err;
        }
      );
  },
  getEventCancelRefund: function (probeId, schema='public') {
    const sql = `with q as (
            select 
                user_id,
                rank() over (partition by user_id order by id desc),
                total_liquidity_tokens_count,
                probe_id
            from :schema:.liquidity_users
            where probe_id = :probeId and action <> 'added_trading_fee'
    ) 
    select 
        q.user_id as "userId", 
        round(total_liquidity_tokens_count::numeric, 2) as "tokens",
        round(liquidity_token_price::numeric, 2) as "price",
        round((liquidity_token_price * total_liquidity_tokens_count)::numeric, 2) as "totalRefund"
    from q inner join 
        (select * from :schema:.liquidity_events where probe_id = :probeId order by id desc limit 1) p
     on p.probe_id = q.probe_id
    where rank = 1 and liquidity_token_price * total_liquidity_tokens_count > 0`;
    return knex
      .raw(sql, { probeId, schema })
      .then((res) => {
        return res?.rows?.length > 0 ? res.rows : [];
      })
      .catch((e) => {
        console.log("ERROR IN getEventCancelRefund", e);
        throw e;
      });
  },
  getUserLiquidityPortfolio: async (userId) => {
    try {
      console.log(`Liquidity Query user ID ${userId}`)
      const sql = `with lu_stats as (
        select 
            probe_id,
            sum(
              (case when action = 'added' then 
                liquidity_tokens_issue_price * liquidity_tokens_count
              else 0 end)
               ) as "totalAddedLiquidity",
             sum(( case when action ='added' then liquidity_tokens_count else 0 end )) as "totalAddedTokens",
              sum(( case when action ='removed' then liquidity_tokens_count else 0 end )) as "totalRemovedTokens",
            (array_agg(total_liquidity_tokens_count ORDER BY lu.id DESC))[1] as "investedLiqTokenCount"
          from liquidity_users lu 
          inner join probes p on lu.probe_id = p.id
          where 
            user_id = :userId and 
            p.status IN ('A', 'F') and 
            p.is_price_editable = false and
            p.is_variable_liquidity_pool = true
          group by probe_id
        ),
        max_le as (
          select 
            probe_id,
            max(id) AS id
            from liquidity_events inner join lu_stats using (probe_id)
          group by probe_id
        ), le as (
          select 
            max_le.probe_id,
            price_per_contract_yes as "yCP",
            price_per_contract_no as "nCP" ,
            liquidity_token_price as "currLiqPrice"
          from liquidity_events inner join max_le using(id) 
        )
        select 
           probe_id as "probeId",
           "investedLiqTokenCount" as "currentTotalLiqToken",
           ("totalAddedLiquidity"/COALESCE(NULLIF("totalAddedTokens", 0), 1)) as "investedLiqTokenPrice",
           ("totalAddedLiquidity"/
           COALESCE(NULLIF("totalAddedTokens", 0), 1) * "investedLiqTokenCount") as "investedTotalAmount",
           "investedLiqTokenCount",
           "yCP",
           "nCP",
           "currLiqPrice",
           "currLiqPrice" * "investedLiqTokenCount" as "currentTotalAmount",
           (
             "currLiqPrice" * "investedLiqTokenCount" -  
             ("totalAddedLiquidity"/COALESCE(NULLIF("totalAddedTokens", 0), 1) * "investedLiqTokenCount")
           ) / 
           COALESCE( NULLIF ((
             "totalAddedLiquidity"/COALESCE(NULLIF("totalAddedTokens", 0), 1) * "investedLiqTokenCount"
           ), 0), 1 ) * 100 as "profitOrLoss",
           "totalRemovedTokens" as "removedTokenCount",
           "id",
           "createdat",
           "start_date",
           "settledate",
           "endsat",
           "totalamount",
           "is_price_editable",
           "type",
           "imageurl",
           "title",
           "resolution",
           "source",
           "is_variable_liquidity_pool"
        from lu_stats 
        inner join le using(probe_id)
        inner join probes p on le.probe_id = p.id
        WHERE round(
          "investedLiqTokenCount"::numeric, 
        2) > 0`
        const resp = await knexReadOnly.raw(sql, {
          userId
        })
        const tradingFeesSql = `
          SELECT 
            probe_id,
            sum(provider_trading_fee) as "tradingFeeLiquidityTokens"
          FROM liquidity_provider_trading_fee_earning
          WHERE provider_id = :userId
          and probe_id IN (select id from probes where status = 'A')
          GROUP BY probe_id
        `
        let tradingFeesResp = await knexReadOnly.raw(tradingFeesSql, {
          userId
        })
        
        tradingFeesResp = tradingFeesResp?.rows ?? [];

        let result = resp?.rows ?? [];
        result = result.map( i => {
          const tradingFee = tradingFeesResp.find( t => t.probe_id == i.probeId )
          let tradingFeeLiquidityTokens = 0
          if(tradingFee) {
            tradingFeeLiquidityTokens = tradingFee.tradingFeeLiquidityTokens
          }
          return {
            ...i,
            tradingFeeLiquidityTokens,
          }
        })
        return result
    } catch(e) {
      console.log(e)
      throw e;
    }
  }
};

module.exports = LiquidityUsers;
