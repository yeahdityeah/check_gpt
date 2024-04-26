'use strict';

const knex = require( '../knex/knex' );

const tableName = 'liquidity_provider_trading_fee_earning';

const LiquidityProviderTradingFee = {
    addBatchUserLiqTradingFee: function( liqTradingData ) {
        return knex.batchInsert( tableName, liqTradingData, liqTradingData.length )
        .returning( '*' )
        .then( function( resp ) {
            return resp;
        })
        .catch( function( error ) {
            throw error;
        });
    },
    getProviderTotalTradingFeeForEvent: function( providerId, probeId ) {
        return knex
        .select( knex.raw( 'sum(provider_trading_fee) as liquidity_fee' ) )
        .from( tableName )
        .where({ probe_id: probeId, provider_id: providerId })
        .then( function( resp ) {
            return resp[0];
        })
        .catch( function( error ) {
            throw error;
        });
    },
    getAllEventsWithPendingLiquidityFee: function() {
        return knex
        .select( knex.raw( 'distinct on(probe_id) probe_id' ) )
        .from( tableName )
        .where({ is_processed: false })
        .then( function( resp ) {
            return resp;
        })
        .catch( function( error ) {
            throw error;
        });
    },
    getMaxIdForEventsWithPendingLiquidityFee: function( eventId ) {
        return knex
        .select( knex.raw( 'max(id) as max_id' ) )
        .from( tableName )
        .where({ is_processed: false, probe_id: eventId })
        .then( function( resp ) {
            return resp[0];
        })
        .catch( function( error ) {
            throw error;
        });
    },
    getAllUsersAmountForEventsWithPendingLiquidityFee: function( eventId, maxId ) {
        return knex
        .select( knex.raw( 'distinct on(provider_id) sum(provider_trading_fee) as provider_sum, provider_id' ) )
        .from( tableName )
        .where({ is_processed: false, probe_id: eventId })
        .where( 'id', '<=', maxId )
        .groupBy( 'provider_id' )
        .then( function( resp ) {
            return resp;
        })
        .catch( function( error ) {
            throw error;
        });
    },
    updateProcessedProviders: function( eventId, maxId ) {
        return knex( tableName )
        .update({ is_processed: true })
        .where({ is_processed: false, probe_id: eventId })
        .where( 'id', '<=', maxId )
        .then( ( rs ) => {
            return rs;
        }, ( err ) => { throw err; });
    },
    deleteUnprocessedProvidersEventCancellation: function( probeId, schema='public' ) {
        if(!probeId || String(probeId).trim() === '') {
            console.log("DELETE liquidity_provider_trading_fee_earning Recieved empty / Undefined Probe ID")
            return []
        }
        return knex.withSchema(schema).table( tableName )
        .where({ is_processed: false, probe_id: probeId})
        .del()
        .then( function( resp ) {
            return resp;
        })
        .catch( function( error ) {
            throw error;
        });
    },
    getDistinctProvider: function( probeId, schema='public' ) {
        return knex.withSchema(schema)
        .select( knex.raw( 'provider_id, sum(provider_trading_fee) as provider_sum' ) )
        .from( tableName )
        .where({ probe_id: probeId })
        .groupBy( 'provider_id' )
        .then( function( resp ) {
            return resp;
        })
        .catch( function( error ) {
            throw error;
        });
    }
};

module.exports = LiquidityProviderTradingFee;
