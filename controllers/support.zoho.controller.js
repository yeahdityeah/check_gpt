const CONFIG = require( '../config/config' );
const{ to, ReE, ReS, waitTimer } = require( '../services/util.service' );
const ProbeCallsOpen = require( '../models/probecallsopen' );
const _ = require( 'lodash' );
const logger = require( '../services/logger.service' );
const{ User, Probe } = require( '../models' );
const axios = require( 'axios' );
const{ messages } = require( '../messages/messages' );
const{ isDashboardUser } = require( '../middleware/dashboard.user' );
const redisClient = require( 'redis' ).createClient( CONFIG.redis );
const{ fetchHistAndReply, getResponse } = require( '../recurring_tasks/zoho_tkts' );
let eventData = {};
const runningEvents = {};


const zohoWebhook = async function( req, res, next ) {
    logger.info( 'zohoWebhook' );
    logger.info( `zohoWebhook: ${JSON.stringify( req.body )}` );
    try {
        let requestPayload = Object.assign({}, req.body);
        // let customerInfo = requestPayload.entity.customer_info;

        logger.info( `zohoWebhook entity id: ${requestPayload.entity_id}` );

        // let resp = await fetchHistAndReply( requestPayload.entity_id, customerInfo );
        getResponse( requestPayload );

        return ReS( res, {
            success: 'true'
        });

    } catch( e ) {
        console.error( e );
    }
    return ReS( res, { success: 'true' });
};

module.exports.zohoWebhook = zohoWebhook;
