const CONFIG = require('../config/config');
const { to, ReE, ReS, waitTimer } = require('../services/util.service');
const ProbeCallsOpen = require('../models/probecallsopen');
const _ = require("lodash");
const logger = require('../services/logger.service');
const { User, Probe } = require('../models');
const axios = require('axios');
const { messages } = require('../messages/messages');
const { isDashboardUser } = require('../middleware/dashboard.user');
const redisClient = require("redis").createClient(CONFIG.redis);
const ORDER_TYPE = 'order';
const USER_ID = process.env.NODE_ENV === 'production' ? 31038 : 89;
const SERVER_URL = process.env.NODE_ENV === 'production' ?
    'https://api.theox.co/v2' :
    process.env.NODE_ENV === 'staging' ? 'https://testapi.theox.co/v2' : 'http://localhost:4000/v2';
let JWT = undefined;
let eventData = {};
const runningEvents = {};

const handleMatchMaking = async function (eventId) {
    if (eventData[eventId].status !== 'A') {
        return;
    }

    if (!runningEvents[eventId]) {
        runningEvents[eventId] = true;
    } else {
        logger.info(`Automated Market making - request is already in progress for eventID: ${eventId}`);
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
        const resultSet = await to(ProbeCallsOpen.getOpenOrdersByEventId(eventId, USER_ID));
        if (resultSet[0]) {
            throw resultSet[0];
        }
        const openOrders = resultSet[1];
        processOpenOrders(openOrders, eventId);
    } catch (error) {
        delete runningEvents[eventId];
        throw error;
    }
};

const processOpenOrders = async function (openOrders, eventId) {
    if (eventData[eventId].status !== 'A') {
        return;
    }
    if (openOrders.length === 0) {
        delete runningEvents[eventId];
        return;
    }
    const matrix = [];
    logger.info(`Automated Market making - total open orders found: ${openOrders.length}`);
    if (!eventData[eventId]) {
        return;
    }
    for (const openOrder of openOrders) {
        const maxReturn = eventData[eventId].maxReturn;
        const contracts = parseInt(openOrder.noofcontracts);
        const matrixRow = Object.assign({}, eventData[openOrder.probeid]);
        if (openOrder.status === 'H') {
            if (openOrder.callvalue === 'Y') {
                matrixRow.totalContractsOfYes += contracts;
                matrixRow.moneyInvestedInYes += contracts * openOrder.coins;
                matrixRow.moneyInvestedInYes = parseFloat(matrixRow.moneyInvestedInYes.toFixed(2));
            } else {
                matrixRow.totalContractsOfNo += contracts;
                matrixRow.moneyInvestedInNo += contracts * openOrder.coins;
                matrixRow.moneyInvestedInNo = parseFloat(matrixRow.moneyInvestedInNo.toFixed(2));
            }

        } else if (openOrder.status === 'A') {
            if (openOrder.callvalue === 'Y') {
                matrixRow.totalContractsOfNo += contracts;
                matrixRow.moneyInvestedInNo += contracts * (maxReturn - openOrder.coins);
                matrixRow.moneyInvestedInNo = parseFloat(matrixRow.moneyInvestedInNo.toFixed(2));
            } else {
                matrixRow.totalContractsOfYes += contracts;
                matrixRow.moneyInvestedInYes += contracts * (maxReturn - openOrder.coins);
                matrixRow.moneyInvestedInYes = parseFloat(matrixRow.moneyInvestedInYes.toFixed(2));
            }
        }
        matrixRow.totalInvestment = parseFloat((matrixRow.moneyInvestedInYes + matrixRow.moneyInvestedInNo).toFixed(2));
        matrixRow.volume = (matrixRow.totalContractsOfYes + matrixRow.totalContractsOfNo) * maxReturn;
        matrixRow.volume = parseFloat(matrixRow.volume.toFixed(2));
        matrixRow.profitOrLoss = Math.min(
            matrixRow.totalContractsOfYes * maxReturn, matrixRow.totalContractsOfNo * maxReturn,
        ) - matrixRow.totalInvestment;
        matrixRow.profitOrLoss = parseFloat(matrixRow.profitOrLoss.toFixed(2));
        matrixRow['createdat'] = openOrder.createdat;
        matrixRow['orderDetails'] = openOrder;
        matrix.push(matrixRow);
    }
    // remove open orders from the list which do not meet criteria. Refer: https://theox.atlassian.net/browse/TRDTNP-533
    const filteredMatrix = matrix.filter((matrixRow) => {
        return !(matrixRow.totalInvestment > eventData[matrixRow.orderDetails.probeid].investmentLimit ||
            matrixRow.profitOrLoss < eventData[matrixRow.orderDetails.probeid].lossLimit)
    });
    logger.info(`Automated Market making - total eligible orders: ${filteredMatrix.length}`);
    if (filteredMatrix.length === 0) {
        delete runningEvents[eventId];
        return;
    }
    // sort open orders on the basis of maxProfit and minLoss, then max volume, and created date
    const orderedMatrix = _.orderBy(filteredMatrix, ['profitOrLoss', 'volume', 'createdat'], ['desc', 'desc', 'asc']);
    // choose the first order from the sorted open orders list and then remove it from the open orders list(local array)
    const order = orderedMatrix.shift();
    try {
        logger.info(`Automated Market making - creating matching order: ${JSON.stringify(order.orderDetails)}`);
        // give a matching order to the chosen open order
        await createMatchingOrder(order.orderDetails);
        // update values for volume, investment, profitOrLoss, and etc.
        await updateNumbersForEvent(order);
    } catch (e) {
        if (e.message !== 'Request failed with status code 500') {
            if (e.message === messages.MARKET_CLOSED_BUY) {
                logger.error('Automated Market making - Market is closed for taking positions. Removing it from the queue');
                // market is closed do not process remaining orders and remover it from event data object
                orderedMatrix.splice(0, orderedMatrix.length);
                delete runningEvents[eventId];
                await deleteEventData(order.orderDetails.probeid);
                informViaEmail(`Match making has been "STOPPED" for event ${eventId}. Reason: ${e.message}`);
            } else {
                eventData[eventId].status = 'I';
                await updateMatchMakingData(eventData);
                delete runningEvents[eventId];
                const message = `Match making has been "PAUSED" for event ${eventId}. Reason: ${e.message}`;
                logger.error('Automated Market making - ' + message);
                informViaEmail(message);
            }
        }
    }
    // process remaining orders
    await waitTimer(250);
    await processOpenOrders(orderedMatrix.map(item => item.orderDetails), eventId);
};

const updateNumbersForEvent = async function (data) {
    const probeId = data.orderDetails.probeid;
    eventData[probeId].moneyInvestedInNo = data.moneyInvestedInNo;
    eventData[probeId].moneyInvestedInYes = data.moneyInvestedInYes;
    eventData[probeId].totalContractsOfNo = data.totalContractsOfNo;
    eventData[probeId].totalContractsOfYes = data.totalContractsOfYes;
    eventData[probeId].totalInvestment = data.totalInvestment;
    eventData[probeId].volume = data.volume;
    eventData[probeId].profitOrLoss = data.profitOrLoss;
    await updateMatchMakingData(eventData);
};


const createMatchingOrder = async function (orderDetails) {
    const maxReturn = eventData[orderDetails.probeid].maxReturn;
    const orderObject = {
        ordertype: ORDER_TYPE,
        userid: USER_ID,
        noofcontracts: orderDetails.noofcontracts
    };
    /**
     * if order status is 'A' then it is a buy order.
     * to give a matching order, create an order for the opposite call value and maxReturn - coin(price at which user took a position)
     *
     * if order status is 'H' then it is a sell order.
     * to give a matching order, create an order for with the same call value and coins
     */
    if (orderDetails.status === 'A') {
        const coins = parseFloat((maxReturn - orderDetails.coins).toFixed(2));
        const probeId = orderDetails.probeid;
        const callValue = orderDetails.callvalue === 'Y' ? 'N' : 'Y';
        orderObject['coins'] = coins;
        orderObject['probeid'] = probeId;
        orderObject['callvalue'] = callValue;
    } else if (orderDetails.status === 'H') {
        const coins = orderDetails.coins;
        const probeId = orderDetails.probeid;
        const callValue = orderDetails.callvalue;
        orderObject['coins'] = coins;
        orderObject['probeid'] = probeId;
        orderObject['callvalue'] = callValue;
    }

    if (Object.keys(orderObject).length === 6) {
        const headers = {
            'Authorization': JWT
        };
        orderObject['appVersion'] = 999999;
        try {
            const response = await axios.post(SERVER_URL + '/probe/putcall', orderObject, { headers: headers });
            if (response.data.message !== messages.TAKING_TIME &&
                (response.data.status === 'ERROR' || response.data.success === false)
            ) {
                throw new Error(response.data.message ? response.data.message : response.data.error || "");
            }
            logger.info('Automated Market making - order created successfully');
        } catch (e) {
            logger.error('Automated Market making - While placing order with parameters: ' + JSON.stringify(orderObject) + ' Message: ' + e.message);
            throw e;
        }

    }
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
    logger.info(`Automated Market making - Event: ${eventId} removed from the queue`);
};

const addEventToMatchMaking = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        if (!isDashboardUser(req)) {
            return ReE(res, messages.UNAUTHORIZED_REQUEST, 401);
        }
        if (!req.body.probeid || !req.body.investment_limit || !req.body.loss_limit
        ) {
            return ReE(res, messages.BAD_REQUEST, 400);
        }
        const probeId = req.body.probeid;
        const eventData = await getEventData();

        if (eventData[probeId]) {
            return ReE(res, 'Duplicate Record', 409);
        }
        const investmentLimit = parseFloat(req.body.investment_limit.toFixed(2));
        const lossLimit = parseFloat(req.body.loss_limit.toFixed(2));

        if (investmentLimit <= 0) {
            return ReE(res, 'Investment limit should be more than zero.', 400);
        }
        if (lossLimit >= 0) {
            return ReE(res, 'Loss limit should be less than zero.', 400);
        }

        const resultSet = await to(Probe.getProbeById(probeId, ['id', 'totalamount']));
        if (resultSet[0]) {
            throw resultSet[0];
        }

        eventData[probeId] = {
            investmentLimit,
            lossLimit,
            totalContractsOfYes: 0,
            totalContractsOfNo: 0,
            totalInvestment: 0.0,
            volume: 0.0,
            profitOrLoss: 0.0,
            moneyInvestedInYes: 0.0,
            moneyInvestedInNo: 0.0,
            maxReturn: parseFloat(resultSet[1].totalamount.toFixed(2)),
            status: 'A'
        };
        await updateMatchMakingData(eventData);
        logger.info(`Automated Market making - New Event: ${probeId} added to the queue`);
        return ReS(res, { status: 'SUCCESS', message: 'Event is queued for match-making' });
    } catch (e) {
        next(e);
    }
};

const updateMatchMakingEventData = async function (req, res, next) {
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

        if (req.body.investment_limit && req.body.loss_limit) {
            const investmentLimit = parseFloat(req.body.investment_limit.toFixed(2));
            const lossLimit = parseFloat(req.body.loss_limit.toFixed(2));
            if (investmentLimit <= 0) {
                return ReE(res, 'Investment limit should be more than zero.', 400);
            }
            if (lossLimit >= 0) {
                return ReE(res, 'Loss limit should be less than zero.', 400);
            }
            eventData[probeId]['investmentLimit'] = investmentLimit;
            eventData[probeId]['lossLimit'] = lossLimit;
        } else if (req.body.investment_limit) {
            const investmentLimit = parseFloat(req.body.investment_limit.toFixed(2));
            if (investmentLimit <= 0) {
                return ReE(res, 'Investment limit should be more than zero.', 400);
            }
            eventData[probeId]['investmentLimit'] = investmentLimit;
        } else if (req.body.loss_limit) {
            const lossLimit = parseFloat(req.body.loss_limit.toFixed(2));
            if (lossLimit >= 0) {
                return ReE(res, 'Loss limit should be less than zero.', 400);
            }
            eventData[probeId]['lossLimit'] = lossLimit;
        }

        if (req.body.status && ['A', 'I'].includes(req.body.status)) {
            eventData[probeId]['status'] = req.body.status;
        }
        await updateMatchMakingData(eventData);
        logger.info(`Automated Market making - Event: ${probeId} has been updated`);
        return ReS(res, { status: 'SUCCESS', message: 'UPDATED' });
    } catch (e) {
        next(e);
    }
};

const deleteMatchMakingEventData = async function (req, res, next) {
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
        logger.info(`Automated Market making - Processing request to delete Event: ${probeId} in the queue`);
        await deleteEventData(probeId);
        return ReS(res, { status: 'SUCCESS', message: 'DELETED' });
    } catch (e) {
        next(e);
    }
};

const updateMatchMakingData = async function (matchMakingData) {
    await redisClient.set('match_making_data', JSON.stringify(matchMakingData));
};

const getEventData = async function () {
    let eventData = {};
    const marketMakingData = await getMarketData();
    if (!marketMakingData) {
        eventData = {};
        redisClient.set('match_making_data', JSON.stringify(eventData));
    } else {
        eventData = JSON.parse(marketMakingData);
    }
    return eventData;
}

const runMatchMaking = async function () {
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
        redisClient.get('match_making_data', (err, data) => {
            if (err) reject(err);
            resolve(data);
        })
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
            subject: `Market making has been paused/stopped on "${environment}".`,
            html: message
        }
        if (environment === 'production' || environment === 'staging') {
            sgMail.send(mailObj);
        }
    } catch (err) {
        logger.error(`Automated Market making - Email not sent to Rohit and Sushil`);
    }
};

const getMatchMakingStats = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        if (!isDashboardUser(req)) {
            return ReE(res, 'Unauthorized Request', 401);
        }
        const probeId = req.body.probeid;
        const marketMakingData = await getMarketData();
        let eventData = undefined
        if (!marketMakingData) {
            eventData = {};
            await redisClient.set('match_making_data', JSON.stringify(eventData));
        } else {
            eventData = JSON.parse(marketMakingData);
            if (probeId) {
                eventData = eventData[probeId];
            }
        }
        return ReS(res, { status: 'SUCCESS', data: eventData });
    } catch (e) {
        next(e);
    }
};

module.exports.addEventToMatchMaking = addEventToMatchMaking;
module.exports.updateMatchMakingEventData = updateMatchMakingEventData;
module.exports.deleteMatchMakingEventData = deleteMatchMakingEventData;
module.exports.getMatchMakingStats = getMatchMakingStats;
module.exports.runMatchMaking = runMatchMaking;
