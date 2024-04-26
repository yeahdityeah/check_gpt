const ProbeV2 = require('../models/probe.v2');
const History = require('../models/history');
const { to } = require('../services/util.service');
const { Probe } = require( '../models' );
const logger = require("../services/logger.service");
const LiquidityUser = require("../models/liquidity.user");
const LiquidityEvent = require("../models/liquidity.event");
const { handleNotification } = require('../services/notification.service');
const eventStatusEnum = require('../utils/eventStatusEnum.util');

/* Populate history for settled events for every user */
const toFloat = ( data ) => parseFloat( parseFloat(data.toString()).toFixed(2) );
var waitTimer = async (n) => {
    return new Promise((resolve, _) => {
        setTimeout(() => {
            resolve();
        }, n);
    })
}

const getClosedEventFromDB = async() =>
{
    let err, closedEvent;
    console.log(`starting processs of history generation`);
    [err, closedEvent] = await to(History.getClosedEvent());
    if (err) throw err;

    for (let i=0; i<closedEvent.length; i++)
        await populateHistoryBlob(closedEvent[i].id);
}
const populateHistoryBlob = async (eventId, eventStatus, schema = 'public') => {
    logger.info(`Update History ${eventId}, begins`);
    let [ er, maxReturn ] = await to( Probe.getProbeById( eventId, [ 'totalamount' ], true, schema ) );
    if(er) {
        throw er;
    }
    maxReturn = parseFloat( parseFloat((maxReturn.totalamount).toString()).toFixed(2) );
    logger.info(`Update History ${eventId}, maxReturn ${maxReturn}`);
    const pendinOrderRank = -1;
    const winRank = 1;
    const soldStatus = 'EX';
    const cancelStatus = 'CN';
    const holdStatus = 'H';
    const activeStatus = 'A';
    const inactiveStatus = 'I';
    const refundStatus = 'RF';
    const mergedStatus = 'MG';
    const inactiveMatched = 'IU';
    const inactivUnmatched = 'IM';
    const originalOrderStatus = 'O';
    let err, _probeCalls, correctvalue, userHistory = [];
    [ err, _probeCalls] = await to(ProbeV2.getEventCallsByEventId(eventId, schema));
    if(err) throw err;

    logger.info(`Update History ${eventId}, _probeCalls ${_probeCalls.length}`);

    let userData = {};
    for (let i=0; i<_probeCalls.length; i++){
        const probeCall = _probeCalls[i];
        const userid = probeCall['userid'];
        const callvalue = probeCall['callvalue'];
        const contracts = probeCall['noofcontracts'];
        const status = probeCall['status'];
        const type = probeCall['type'];
        let rank = probeCall['rank'], coins = probeCall['coins'];

        //Skip Inactive
        if(status == inactiveStatus || status == inactivUnmatched || status == inactiveMatched || status == originalOrderStatus){
            continue;
        }

        // skip if no. of contracts = 0
        if(contracts == 0){
            continue;
        }

        // if order of sell sold
        const soldPrice = coins;

        // In case of sell coins become lastprice
        if(status == soldStatus || status == holdStatus || status == mergedStatus){
            coins = probeCall['lastprice'];
        }

        //invest
        const invest = toFloat( coins * contracts );

        // order object
        const orderInfo = {callvalue: callvalue, contracts: contracts, coins: coins};

        //FirstTime for user
        if(!userData[userid]){
            userData[userid] = {totalInvest: 0, totalReturn: 0, totalRefund: 0, orders:[], proofOfSettlement: ''};
        }

        //totalInvest always add ups
        const order = {
            orderInfo: orderInfo,
            orderStatus: "",
            invest: invest,
            returns: 0,
            refund: 0,
            createdat: probeCall['createdat'],
            callvalue: probeCall['callvalue'],
            tournament_rank: probeCall['tournament_rank']
        };

        //pending order
        if(rank == pendinOrderRank){
            order['orderStatus'] = "Refunded";
            order['refund'] = invest;
        }

        //settled order
        else if(status == activeStatus || status == holdStatus){
            if(status == holdStatus)
            {
                [err, correctvalue] = await to(History.getProbeCorrectValue(eventId, schema));
                if(err) throw err;
                correctvalue = correctvalue.correctvalue;
                if(correctvalue == callvalue){
                    rank = 1;
                }
            }
            if(rank == winRank){
                if (type === 'Bet')
                    order['returns'] = contracts * ( maxReturn );
                else{
                    order['returns'] = parseFloat(probeCall['returns'].toFixed(2));
                }
                order['orderStatus'] = "Won";
            }
            else {
                order['orderStatus'] = "Lost";
            }
        }

        //cancelled
        else if(status == cancelStatus){
            order['orderStatus'] = "Cancelled";
            order['refund'] = invest;
        }
        //Refunded unmatched calls
        else if(status == refundStatus){
            order['orderStatus'] = "Refunded";
            order['refund'] = invest;
        }
        //sold
        else if(status == soldStatus){
            order['orderStatus'] = `Sold @ ${soldPrice}`;
            order['returns'] = toFloat( contracts*(soldPrice) );
        }
        //merged
        else if( status == mergedStatus ){
            order['orderStatus'] = `Merged`;
            order['returns'] = toFloat( contracts*( soldPrice ) );
        }

        userData[userid]['orders'].push(order);
        userData[userid]['totalInvest'] += toFloat( order['invest'] );
        userData[userid]['totalReturn'] += toFloat( order['returns'] );
        userData[userid]['totalRefund']  += toFloat( order['refund'] );
    }
    logger.info( `Update History ${eventId}, for loop completed` );

    let userDataLiq = await liquidityHistoryCalculation( eventId, schema );
    for( let user_id in userDataLiq ) {
        if( user_id in userData ) {
            userData[user_id]['totalInvest'] += userDataLiq[user_id]['totalInvest'];
            userData[user_id]['totalReturn'] += userDataLiq[user_id]['totalReturn'];
            userData[user_id]['totalRefund'] += userDataLiq[user_id]['totalRefund'];
        } else {
            userData[user_id] = userDataLiq[user_id];
        }
    }

    /* Update history blob in second iteration */
    await updateHistory( eventId, userData, eventStatus, schema );


    logger.info( `Update History ${eventId}, completed` );
};

const liquidityHistoryCalculation = async function( eventId, schema = 'public' ) {
    let userData = {};
    if(isNaN(eventId)){
        throw new Error('Invalid data received');
    }
    let[ err, liquidity ] = await to( LiquidityEvent.getLatestRow( Number(eventId), true, schema) );
    let allUserActiveLiquidity = await LiquidityUser.getAllEventLiquidity( eventId, schema );
    const userLiqMap = new Map();
    for( let userLiq of allUserActiveLiquidity ) {
        if( userLiqMap.get( userLiq['user_id'] ) === undefined ) {
            userLiqMap.set( userLiq['user_id'], [ userLiq ] );
        } else {
            userLiqMap.get( userLiq['user_id'] ).push( userLiq );
        }
    }
    for( let[ userId, liqList ] of userLiqMap ) {
        userData[userId] = { totalInvest: 0, totalReturn: 0, totalRefund: 0, orders: [], proofOfSettlement: '' };
        let resp = {
            orders: [],
            userid: userId,
            totalinvested: 0,
            totalreturn: 0,
            totalrefund: 0
        };
        for( let liq of liqList ) {
            const order = {
                orderInfo: {
                    'liquidity_tokens_count': liq[ 'liquidity_tokens_count' ],
                    'liquidity_tokens_issue_price': liq[ 'liquidity_tokens_issue_price' ]
                },
                invest: 0,
                returns: 0,
                refund: 0,
                createdat: liq['created_at']
            };
            if( liq['action'] === 'added' ) {
                resp.totalinvested += ( liq['liquidity_tokens_count'] * liq['liquidity_tokens_issue_price'] );
                order.invest = ( liq['liquidity_tokens_count'] * liq['liquidity_tokens_issue_price'] );
            } else if( liq['action'] === 'removed' ) {
                resp.totalinvested -= ( liq['liquidity_tokens_count'] * liq['liquidity_tokens_issue_price'] );
                order.returns = ( liq['liquidity_tokens_count'] * liq['liquidity_tokens_issue_price'] );
            }
            resp['orders'].push( order );
        }
        userData[userId]['orders'] = resp.orders;
        userData[userId]['totalInvest'] = resp.totalinvested;
        userData[userId]['totalReturn'] = resp.totalreturn;
    }
    let allUsersCurrentHolding = await LiquidityUser.getAllUsersLiquidityForProbe( eventId , schema);
    for( const liqUser of allUsersCurrentHolding ) {
        let userId = liqUser['user_id'];
        if( liqUser['status'] === 'A' ) {
            userData[userId]['totalReturn']  += liqUser['total_liquidity_tokens_count']
                * liquidity[0]['liquidity_token_price'];
        } else if( liqUser['status'] === 'CN' ) {
            userData[userId]['totalRefund']  = userData[userId]['totalInvest'] - userData[userId]['totalReturn'];
        }
    }
    return userData;
};

const updateHistory = async function( eventId, userData, eventStatus, schema = 'public' ) {
    let userHistory = [];
    let fillHistory;
    for( let user_id in userData ){
        fillHistory = {
            'userid': user_id,
            'probeid': eventId,
            'orders': userData[user_id]['orders'],
            'totalinvested': userData[user_id]['totalInvest'],
            'totalreturn': userData[user_id]['totalReturn'],
            'totalrefund': userData[user_id]['totalRefund'],
            'proofofsettlement': userData[user_id]['proofOfSettlement']
        };
        userHistory.push( fillHistory );
    }
    logger.info( `Update History ${eventId}, userHistory.length ${userHistory.length}` );
    
    console.log('[Event Status on Settlement]', eventId, eventStatus)
    
    if( userHistory.length > 0 ) {
        for( let i = 0; i < userHistory.length; i++ ) {
            await to( History.insertIntoHistory( userHistory[i], schema ) );
            
            if (eventStatus !== eventStatusEnum.COMPLETE && schema === 'public'){
                handleNotification(userHistory[i], "eventSettlement");
            }
        }
    }
};

// process.on("message", async function (message) {
//     const { eventId } = JSON.parse(message);
//     try {
//         await getClosedEventFromDB();
//         var response = JSON.stringify({ 'status': 'success' });
//         process.send(response);
//         process.exit();
//     } catch (e) {
//         var response = JSON.stringify({ 'status': 'error', 'message': e.toString() });
//         process.send(response);
//         process.exit();
//     }
// });

module.exports = {populateHistoryBlob};
//module.exports = {getClosedEventFromDB};
