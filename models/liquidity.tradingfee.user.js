'use strict';

const knex = require( '../knex/knex' );

const tableName = 'liquidity_users_trading_fee';

const LiquidityUsersTradingFee = {
    addBatchUserLiqTradingFee: function( liqTradingData ) {
        return knex.batchInsert( tableName, liqTradingData, liqTradingData.length )
        .returning( '*' )
        .then( function( resp ) { return resp; })
        .catch( function( error ) { throw error; });
    }
};

module.exports = LiquidityUsersTradingFee;
