const moment = require('moment');
const { to, ReE, ReS, waitTimer } = require('../services/util.service');
const ProbeCallsOpen = require('../models/probecallsopen');
const _ = require('lodash');
const logger = require('../services/logger.service');
const { User, Probe } = require('../models');
const axios = require('axios');
const { messages } = require('../messages/messages');
const { isDashboardUser } = require('../middleware/dashboard.user');
const sgMail = require('@sendgrid/mail');
const config = require('../config/config');
const redisClient = require('redis').createClient(config.redis);
const STOP_TIME = 15 * 60;
const ORDER_TYPE = 'order';
const CACHING_KEY = 'market_maker_v2_data';
const USER_ID = 122426;//process.env.NODE_ENV === 'production' ? 31038 : 122;
const SERVER_URL = process.env.NODE_ENV === 'production' ? 'https://api.theox.co/v2' : 'https://testapi.theox.co/v2';
let JWT = undefined;
let eventData = {};
const runningEvents = {};
const coins = [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
    23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33,
    34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44,
    45, 46, 47, 48, 49
];

const shouldRun = async (eventId) => {
    const resultSet = await to(Probe.getProbeById(eventId, ['endsat', 'status', 'type']));
    if (resultSet[0]) {
        throw resultSet[0];
    }
    const now = moment();
    const end = moment(resultSet[1].endsat);
    const duration = moment.duration(end.diff(now));
    const difference = duration.asSeconds();
    const stopTimeForEvent = eventData[eventId]['stop_time'];
    return difference > stopTimeForEvent && resultSet[1].status === 'A' && resultSet[1].type === 'Bet';

};

const handleMatchMaking = async function (eventId) {
    if (eventData[eventId].status !== 'A') {
        return;
    }

    if (!runningEvents[eventId]) {
        runningEvents[eventId] = true;
    } else {
        logger.info(`Automated Market maker V2 - request is already in progress for eventID: ${eventId}`);
        return;
    }
    if (!JWT) {

        const [err, jwt] = await to(User.getJWT(USER_ID, false, true));
        if (err) {
            logger.error('While fetching JWT token for userid: ' + USER_ID);
        }
        JWT = jwt;
    }
    try {

        try {
            if (!(await shouldRun(eventId))) {
                await deleteEventData(eventId);
                return;
            }
        } catch (e) {
            logger.error('Automated Market maker V2 - Error occurred while checking event eligibility');
            await deleteEventData(eventId);
        }
        const maxReturn = eventData[eventId]['maxReturn'];
        const activeCalls = await getAllActiveCalls(eventId);
        const dataForBuyOrders = findPricesAndCallValueForBuyOrder(activeCalls, maxReturn);
        const sellOrderPrices = findPricesAndCallValueForSellOrder(activeCalls, maxReturn);
        try {
            await executeBuyOrders(eventId, dataForBuyOrders);
            await executeSellOrders(eventId, sellOrderPrices);
            delete runningEvents[eventId];
        } catch (e) {
            if (e.message !== 'Request failed with status code 500') {
                if (e.message === messages.MARKET_CLOSED_BUY) {
                    logger.error('Automated Market maker V2 - Market is closed for taking positions. Removing it from the queue');
                    delete runningEvents[eventId];
                    await deleteEventData(eventId);
                    informViaEmail(`Automated Match making has been "STOPPED" for event ${eventId}. Reason: ${e.message}`);
                } else {
                    eventData[eventId].status = 'I';
                    await updateMatchMakingData(eventData);
                    delete runningEvents[eventId];
                    const message = `Automated Market maker V2 has been "PAUSED" for event ${eventId}. Reason: ${e.message}`;
                    logger.error('Automated Market maker V2 - ' + message);
                    informViaEmail(message);
                }
            } else {
                // continue market maker if any error occurs because of manual intervention
                delete runningEvents[eventId];
            }
        }

    } catch (error) {
        delete runningEvents[eventId];
        throw error;
    }
};

const findPricesAndCallValueForSellOrder = (activeCalls, maxReturn) => {
    const sellPricesAndCallValueList = [];
    activeCalls.forEach(call => {
        if (call.status === 'A' && call.rank === 0) {
            sellPricesAndCallValueList.push({
                coins: call.coins + (maxReturn === 100 ? 1 : 0.01),
                callvalue: call.callvalue
            });
        }
    });
    return sellPricesAndCallValueList;
};

const findPricesAndCallValueForBuyOrder = (activeCalls, maxReturn) => {
    const buyPricesAndCallValueList = [];
    const calls = [];
    activeCalls.forEach(call => {
        if (call.callvalue === 'Y') {
            if (call.status === 'H') {
                calls.push((call.coins - (maxReturn === 100 ? 1 : 0.01)) + 'Y');
            }
            calls.push((call.coins) + 'Y');
        } else if (call.callvalue === 'N') {
            if (call.status === 'H') {
                calls.push((call.coins - (maxReturn === 100 ? 1 : 0.01)) + 'N');
            }
            calls.push((call.coins) + 'N');
        }
    });
    coins.forEach(coin => {
        coin = maxReturn === 100 ? coin : (coin / 100);
        if (!calls.includes(coin + 'N')) {
            buyPricesAndCallValueList.push({ 'coins': coin, callvalue: 'N' });
        }
        if (!calls.includes(coin + 'Y')) {
            buyPricesAndCallValueList.push({ 'coins': coin, callvalue: 'Y' });
        }
    });
    return buyPricesAndCallValueList;
};

const executeBuyOrders = async (eventId, orderData) => {
    await executeOrder(eventId, orderData, 'order');
};

const executeSellOrders = async (eventId, orderData) => {
    await executeOrder(eventId, orderData, 'sell');
};

const executeOrder = async (eventId, orderData, orderType) => {
    if (!JWT) {
        JWT = User.getJWT(USER_ID, false, true);
    }
    const orderObject = {
        ordertype: orderType,
        userid: USER_ID,
        noofcontracts: 1,
        coins: 0,
        probeid: eventId,
        callvalue: '',
        appVersion: 999999
    };

    for (const entry of orderData) {
        orderObject['coins'] = parseFloat((entry['coins']).toFixed(2));
        orderObject['callvalue'] = entry['callvalue'];

        const headers = {
            'Authorization': JWT
        };
        try {
            const response = await axios.post(SERVER_URL + '/probe/putcall', orderObject, { headers: headers });
            if (response.data.message !== messages.TAKING_TIME &&
                (response.data.status === 'ERROR' || response.data.success === false)
            ) {
                throw new Error(response.data.message ? response.data.message : response.data.error || '');
            }
            logger.info('Automated Market maker V2 - order created successfully');
        } catch (e) {
            let message = '<unknow>';
            if (e instanceof Error) {
                message = e.message;
            }
            logger.error('Automated Market maker V2 - While placing order with parameters: ' + JSON.stringify(orderObject) + ' Message: ' + message);
            throw e;
        }
    }
};


const getAllActiveCalls = async (eventId) => {
    return await ProbeCallsOpen.getAllActiveCalls(eventId, USER_ID);
};

const deleteEventData = async function (eventId) {
    const oEventData = await getEventData();
    const newEventData = {};
    Object.keys(oEventData).forEach((key) => {
        if (key !== eventId.toString()) {
            newEventData[key] = oEventData[key];
        }
    });
    eventData = newEventData;
    delete runningEvents[eventId];
    await updateMatchMakingData(newEventData);
    logger.info(`Automated Market maker V2 - Event: ${eventId} removed from the queue`);
};

const addEventToMarketMaker = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        if (!isDashboardUser(req)) {
            return ReE(res, messages.UNAUTHORIZED_REQUEST, 401);
        }
        if (!req.body.probeid || typeof req.body.probeid !== 'number' || isNaN(req.body.probeid)) {
            return ReE(res, messages.BAD_REQUEST, 400);
        }
        const probeId = req.body.probeid;
        const eventData = await getEventData();
        if (eventData[probeId]) {
            return ReE(res, 'Duplicate Record', 409);
        }
        let stopTime = STOP_TIME;
        if (req.body.stop_time && typeof req.body.stop_time === 'number' && !isNaN(req.body.stop_time)) {
            const parsedTime = parseInt(req.body.stop_time, 10);
            stopTime = isNaN(parsedTime) ? STOP_TIME : parsedTime * 60;
        }

        const resultSet = await to(Probe.getProbeById(probeId, ['id', 'totalamount', 'is_price_editable']));
        if (resultSet[0]) {
            throw resultSet[0];
        }
        if (!resultSet[1]) {
            return ReE(res, 'Invalid Event ID', 400);
        }

        if (resultSet[1].is_price_editable === false) {
            return ReE(res, 'Can not run Market maker for non-editable priced events', 400);
        }
        eventData[probeId] = {
            maxReturn: parseFloat(resultSet[1].totalamount.toFixed(2)),
            status: 'A',
            'stop_time': stopTime
        };
        await updateMatchMakingData(eventData);
        logger.info(`Automated Market maker V2 - New Event: ${probeId} added to the queue`);
        return ReS(res, { status: 'SUCCESS', message: 'Event is queued for match-making' });
    } catch (e) {
        next(e);
    }
};

const updateMarketMakerEventData = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        if (!isDashboardUser(req)) {
            return ReE(res, messages.UNAUTHORIZED_REQUEST, 401);
        }
        if (!req.body.probeid) {
            return ReE(res, messages.BAD_REQUEST, 400);
        }
        const probeId = req.body.probeid;
        const eventData = await getEventData();
        if (!eventData[probeId]) {
            return ReE(res, messages.NOT_FOUND, 404);
        }

        if (req.body.stop_time && typeof req.body.stop_time === 'number' && !isNaN(req.body.stop_time)) {
            let parsedTime = parseInt(req.body.stop_time, 10);
            eventData[probeId]['stop_time'] = isNaN(parsedTime) ? STOP_TIME : parsedTime * 60;
        }

        if (req.body.status && ['A', 'I'].includes(req.body.status)) {
            eventData[probeId]['status'] = req.body.status;
        }
        await updateMatchMakingData(eventData);
        logger.info(`Automated Market maker V2 - Event: ${probeId} has been updated`);
        return ReS(res, { status: 'SUCCESS', message: 'UPDATED' });
    } catch (e) {
        next(e);
    }
};

const deleteMarketMakerEventData = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        if (!isDashboardUser(req)) {
            return ReE(res, messages.UNAUTHORIZED_REQUEST, 401);
        }
        if (!req.body.probeid) {
            return ReE(res, messages.BAD_REQUEST, 400);
        }
        const probeId = req.body.probeid;
        const eventData = await getEventData();
        if (!eventData[probeId]) {
            return ReE(res, messages.NOT_FOUND, 404);
        }
        logger.info(`Automated Market maker V2 - Processing request to delete Event: ${probeId} in the queue`);
        await deleteEventData(probeId);
        return ReS(res, { status: 'SUCCESS', message: 'DELETED' });
    } catch (e) {
        next(e);
    }
};

const updateMatchMakingData = async function (matchMakingData) {
    await redisClient.set(CACHING_KEY, JSON.stringify(matchMakingData));
};

const getEventData = async function () {
    let eventData = {};
    const marketMakingData = await getMarketData();
    if (!marketMakingData) {
        eventData = {};
        redisClient.set(CACHING_KEY, JSON.stringify(eventData));
    } else {
        eventData = JSON.parse(marketMakingData);
    }
    return eventData;
}

const runMarketMakerV2 = async function () {
    try {

        eventData = await getEventData();
        const promiseArray = [];
        Object.keys(eventData).forEach(probeId => {
            if (eventData[probeId].status === 'A') {
                const promise = new Promise(() => {
                    handleMatchMaking(probeId);
                });
                promiseArray.push(promise);
            }
        });
        await Promise.all(promiseArray);

    } catch (e) {
        logger.error(e.message);
    }
};

const getMarketData = async function () {
    return new Promise((resolve, reject) => {
        redisClient.get(CACHING_KEY, (err, data) => {
            if (err) reject(err);
            resolve(data);
        });
    });
};


const informViaEmail = function (message) {
    try {
        const sgMail = require('@sendgrid/mail');
        const config = require('../config/config');
        sgMail.setApiKey(config.SENDGRID_API_KEY);
        const sender = 'info@theox.co';
        const environment = process.env.NODE_ENV;
        const mailObj = {
            to: [
                {
                    email: 'sushil@theox.co',
                    name: 'Sushil Jain'
                },
                {
                    email: 'rohit@theox.co',
                    name: 'Rohit Sharma'
                },
                {
                    email: 'roy@theox.co',
                    name: 'Inderjit Roy'
                },
                {
                    email: 'pranav@theox.co',
                    name: 'Pranav Diwedi'
                }
            ],
            from: sender,
            subject: `Market maker has been paused/stopped on "${environment}".`,
            html: message
        };
        if (environment === 'production' || environment === 'staging') {
            sgMail.send(mailObj);
        }
    } catch (err) {
        logger.error(`Automated Market maker V2 - Email not sent to Rohit and Sushil`);
    }
};

const getMarketMakerStats = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        if (!isDashboardUser(req)) {
            return ReE(res, 'Unauthorized Request', 401);
        }
        const probeId = req.body && req.body.probeid ? req.body.probeid : null;
        if (!probeId) {
            return ReE(res, messages.BAD_REQUEST, 400);
        }
        const marketMakingData = await getMarketData();
        const data = JSON.parse(marketMakingData);
        if (!Object.keys(data).includes(probeId.toString())) {
            return ReE(res, messages.NOT_FOUND, 404);
        }

        const activeCalls = await getAllActiveCalls(probeId, USER_ID);
        const unmatchedCallsYes = [];
        const unmatchedCallsNo = [];
        const matchedCallsYes = [];
        const matchedCallsNo = [];
        const onHoldCallsYes = [];
        const onHoldCallsNo = [];

        activeCalls.forEach((call) => {
            if (call.rank === 0 && call.status === 'A') {
                if (call.callvalue === 'Y') {
                    matchedCallsYes.push(call.coins);
                } else {
                    matchedCallsNo.push(call.coins);
                }
            } else if (call.rank === -1 && ['H', 'A'].includes(call.status)) {

                if (call.status === 'A') {
                    if (call.callvalue === 'Y') {
                        unmatchedCallsYes.push(call.coins);
                    } else {
                        unmatchedCallsNo.push(call.coins);
                    }
                } else {
                    if (call.callvalue === 'Y') {
                        onHoldCallsYes.push(call.coins);
                    } else {
                        onHoldCallsNo.push(call.coins);
                    }
                }

            }
        });

        const responseData = {
            unmatched_calls_yes: unmatchedCallsYes.sort((a, b) => a - b),
            unmatched_calls_no: unmatchedCallsNo.sort((a, b) => a - b),
            matched_calls_yes: matchedCallsYes.sort((a, b) => a - b),
            matched_calls_no: matchedCallsNo.sort((a, b) => a - b),
            onhold_calls_yes: onHoldCallsYes.sort((a, b) => a - b),
            onhold_calls_no: onHoldCallsNo.sort((a, b) => a - b)
        };

        return ReS(res, { status: 'SUCCESS', data: responseData });
    } catch (e) {
        next(e);
    }
};

module.exports.addEventToMarketMaker = addEventToMarketMaker;
module.exports.updateMarketMakerEventData = updateMarketMakerEventData;
module.exports.deleteMarketMakerEventData = deleteMarketMakerEventData;
module.exports.getMarketMakerStats = getMarketMakerStats;
module.exports.runMarketMakerV2 = runMarketMakerV2;
