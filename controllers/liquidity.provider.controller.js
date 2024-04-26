const { ReE, to, ReS, waitTimer } = require('../services/util.service');
const { messages } = require('../messages/messages');
const { isDashboardUser } = require('../middleware/dashboard.user');
const { isForceUpdate } = require('../utils/build.version');
// const socketService = require('../services/socket.service');
const logger = require('../services/logger.service');
const { User, Probe, ProbeV2 } = require('../models');
const { redisCaching } = require('../services/cache.service');
const { isAnInternalUser } = require('../utils/user.util');
const { putCategoryPreference } = require('../utils/customize.feeds');
const moment = require('moment');
const { getExPriceAndUpdate } = require('../utils/exchange.maths');
const { getTradingFee } = require('../utils/tradingfee.util.js');
const CONFIG = require('../config/config');
const { updateEventInfoInCache } = require('../utils/redis.utilities/update.event.info');
const ProbeCallsOpen = require('../models/probecallsopen');
const { canParticipate } = require('../utils/redis.utilities/tournament.participation');
const { getOpenCallsCachingKey, ADD_LIQUIDITY, REMOVE_LIQUIDITY } = require('../utils/constants');
const zmqService = require('../services/zmq.service');
const ProbeCalls = require('../models/probecalls');
const LiquidityEvent = require('../models/liquidity.event');
const LiquidityUsers = require('../models/liquidity.user');
const { addTradingFeeLiquidity } = require('../msg_recv/add_trading_fee_liquidity');
const { getCurrentLiquidityData, getExchangePricePerShare, updateExchangePrice } = require('../msg_recv/exchange');
const { generateOrderId } = require('../msg_recv/utils');
const { isUserSuspended } = require('../utils/isUserSuspended.util');

const addLiquidity = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    if (req.baseUrl.includes('v1')) {
        return ReE(res, messages.TRADING_NOT_ALLOWED, 405);
    }
    let startTime = Date.now();
    const _user = req.user;
    const userId = req.user.id;
    const probeId = req.body.probeid;
    let data = Object.assign({}, req.body, { userid: userId });
    let reqKey = `put_call_req_${userId}_${probeId}`;
    logger.info(`Add Liquidity: ` + JSON.stringify(data));

    let _probeInfo, _userCoins;

    let _schema = 'public';
    if(data?.domain) {
        _schema = data?.domain;
    }

    try {
        const isADashboardUser = isDashboardUser(req);
        const isInternalUser = await isAnInternalUser(req);
        let [err, _probesObject] = await to(Probe.getProbes({
            region: req?.user?.region ?? 'INDIA',
            'probeid': data['probeid'],
            partnerId: req?.user?.partner?.id ?? 1,
            'isDashboardUser': isADashboardUser,
            'isInternalTestUser': isInternalUser
        }, 1000, _schema));
        _probeInfo = _probesObject.rows;

        if (_probeInfo[0]['status'] == 'H') {
            let message =  messages.MARKET_CLOSED_HALTED;
            return ReS(res, { status: 'ERROR', message });
        }
        // let fcmToken;
        // [err, fcmToken] = await to(User.findFCMTokenByUserId(userId));
        // if (err) throw err;

        const isPriceNonEditableEvent = !_probeInfo[0]['is_price_editable'];

        let resp = await validateLiquidityRequest(req, res, _probeInfo, userId, probeId, isADashboardUser, reqKey);
        if (resp !== true) {
            return resp;
        }
        await redisCaching.setKey(reqKey, true, 60);
        const amount = data['amount'];
        resp = await validateAddLiquidityRequest(req, res, _user, amount, _probeInfo[0]);
        if (resp !== true) {
            redisCaching.delKey(reqKey);
            return resp;
        }

        const _eventTitle = _probeInfo[0].title || ' Title';
        if (_user['coinsd'] === undefined) {
            let [err, userData] = await to(User.findById(userId));
            if (err) {
                throw err;
            }
            _user['coinsd'] = userData['coinsd'] || 0;
        }

        /* Removing current price for event after each putcall to calculate it again */
        let currentPriceObj = await redisCaching.getHMKey(data['probeid'], 'eventCpMap');
        if (currentPriceObj) {
            await redisCaching.setHMKey(data['probeid'], 'eventLastCpMap', currentPriceObj);
        }
        await redisCaching.delHMKey(data['probeid'], 'eventCpMap');
        await redisCaching.delKey(getOpenCallsCachingKey(data['probeid'], _schema));

        var msg = JSON.stringify({
            action: 'ADD_LIQUIDITY',
            userId: userId,
            data: data,
            takeAmount: 0,
            orderType: ADD_LIQUIDITY,
            // fcmToken: fcmToken,
            eventTitle: _eventTitle,
            amount: parseFloat(amount),
            maxReturn: _probeInfo[0].totalamount,
            reqKey,
            startTime,
            url: req.url,
            method: req.method,
            ip: req.headers['x-forwarded-for'],
            // || req.socket.remoteAddress
        });
        if (_schema === 'fantasy'){
            msg['fantasy_type'] = req.fantasy.fantasy_type;
            msg['fantasy_id'] = req.fantasy.fantasy_id;
        }
        zmqService.send(msg, true, true, data['probeid'], userId);

        do {
            await waitTimer(1000);
            logger.info(`Request ${reqKey} is in processing`);
        }
        while (await redisCaching.getKey(reqKey));

        if( _schema === 'public' ) {
            [err, _userCoins] = await to(User.getEngagedCoins(Object.assign({}, { 'userid': userId })));
            redisCaching.setHMKey(userId, 'userWallet', JSON.stringify(_userCoins));
            if (err) throw err;
        }

        redisCaching.delKey(reqKey);

        let finalResp;
        [err, finalResp] = await to(redisCaching.getKey('add_liquidity_resp_' + probeId + '_' + userId));
        if (err) throw err;
        finalResp = JSON.parse(finalResp);
        redisCaching.delKey('add_liquidity_resp_' + probeId + '_' + userId);
        return ReS(res, Object.assign({}, finalResp, { success: true }));

    } catch (err) {
        redisCaching.delKey(reqKey);
        next(err);
    } finally {
        await redisCaching.delKey(reqKey);
    }

};

const validateLiquidityRequest = async function (req, res, probeInfo, userId, probeId, isADashboardUser, reqKey) {
    const isUserBlocked = await User.isUserBlocked(userId);
    if (isUserBlocked) {
        return ReE(res, messages.USER_BLOCKED, 500);
    }
    // const timeCheck = await isUserSuspended(userId);
    // if (timeCheck.suspended) {
    //     return ReE(res, messages.USER_SUSPENDED, 500);
    // }
    if (!isADashboardUser && isForceUpdate(Object.assign({}, req, { query: { app_version: req.body.appVersion } }))) {
        // socketService.sendForceUpdateUser(userId).catch(() => logger.error('While broadcasting force update socket event'));
        return ReE(res, messages.TRADING_NOT_ALLOWED, 405);
    }
    let isReqInProgress = await redisCaching.getKey(reqKey);
    if (isReqInProgress) {
        return ReE(res, messages.REQUEST_IN_PROGRESS, 500);
    }
    if (!probeInfo[0] || !probeInfo[0].endsat || probeInfo[0].status !== 'A'
        || moment(probeInfo[0].endsat).isBefore(moment())) {
        redisCaching.delKey(reqKey);
        let message = messages.MARKET_ADD_LIQUIDITY;
        return ReE(res, { status: 'ERROR', message });
    }
    //Do not allow to take action on parent event
    if (probeInfo[0].parent_id && ([-1, -2].includes(probeInfo[0].parent_id))) {
        return ReE(res, `Unfortunately, this operation is forbidden.`, 400);
    }
    if (probeInfo[0]['is_price_editable'] !== false) {
        return ReE(res, `Liquidity can only be updated in Instant Match events.`, 400);
    }
    if (probeInfo[0]['is_variable_liquidity_pool'] === false) {
        return ReE(res, `Liquidity can only be updated in variable Liquidity pool events.`, 400);
    }
    return true;
};

const validateAddLiquidityRequest = async function (req, res, user, amount, probeInfo) {
    if( probeInfo['probe_type'] && probeInfo['probe_type'] === 'promo') {
        if (user['coinsp'] < amount) {
            return ReE(res, `Insufficient Token Wallet balance`, 400);
        }
    } else {
        if (user['coinsd'] + user['coinsb'] + user['coinsw']  < amount) {
            return ReE(res, `Insufficient Wallet balance`, 400);
        }
    }

    if (amount.toString().split('.').length > 1) {
        return ReE(res, `Fractional Liquidity cannot be added`, 400);
    }
    if (amount < CONFIG.MIN_ADD_LIQUIDITY || amount > CONFIG.MAX_ADD_LIQUIDITY) {
        return ReE(res, `Valid Liquidity range is: ` +
            CONFIG.MIN_ADD_LIQUIDITY + ' to ' + CONFIG.MAX_ADD_LIQUIDITY, 500);
    }
    return true;
};

const validateRemoveLiquidityRequest = async function (req, res, probeId, userId, amount, shares, schema='public') {
    if (amount < CONFIG.MIN_REMOVE_LIQUIDITY || amount > CONFIG.MAX_REMOVE_LIQUIDITY) {
        return ReE(res, `Valid Liquidity range is: ` +
            CONFIG.MIN_REMOVE_LIQUIDITY + ' to ' + CONFIG.MAX_REMOVE_LIQUIDITY, 500);
    }
    if (!shares || shares == 0) {
        return ReE(res, `This field can not be empty`, 400);
    }
    if (shares < 0 || typeof shares !== 'number') {
        return ReE(res, `Please enter a valid input`, 400);
    }
    let currUserLiq = await LiquidityUsers.getUserCurrentLiquidityForProbe(userId, probeId, schema);
    let userCurrTokens = currUserLiq[0]['total_liquidity_tokens_count'];
    userCurrTokens = parseFloat((userCurrTokens).toFixed(2));
    if (currUserLiq[0]['total_liquidity_tokens_count'] < shares) {
        return ReE(res, `The maximum no of shares you can remove are ${currUserLiq[0]['total_liquidity_tokens_count']}, cannot withdraw ${shares}`, 400);
    }

    let currentData = await getCurrentLiquidityData(probeId, true, schema);
    if (currentData.liqTokensCount <= shares) {
        return ReE(res, `Complete liquidity ${currentData.liqTokensCount} cannot be withdrawn, Shares: ${shares}`, 400);
    }
    return true;
};

const removeLiquidity = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    if (req.baseUrl.includes('v1')) {
        return ReE(res, messages.TRADING_NOT_ALLOWED, 405);
    }
    let startTime = Date.now();
    const _user = req.user;
    const userId = req.user.id;
    const probeId = req.body.probeid;
    let data = Object.assign({}, req.body, { userid: userId });
    let reqKey = `put_call_req_${userId}_${probeId}`;
    logger.info(`Remove Liquidity: ` + JSON.stringify(data));
    let _probeInfo, _userCoins;

    let _schema = 'public';
    if(data?.domain) {
        _schema = data?.domain;
    }

    try {
        const isADashboardUser = isDashboardUser(req);
        const isInternalUser = await isAnInternalUser(req);
        let [err, _probesObject] = await to(Probe.getProbes({
            region: req?.user?.region ?? 'INDIA',
            'probeid': data['probeid'],
            partnerId: req?.user?.partner?.id ?? 1,
            'isDashboardUser': isADashboardUser,
            'isInternalTestUser': isInternalUser
        }, 1000, _schema));
        _probeInfo = _probesObject.rows;

        if (_probeInfo[0]['status'] == 'H') {
            let message =  messages.MARKET_CLOSED_HALTED;
            return ReS(res, { status: 'ERROR', message });
        }
        // let fcmToken;
        // [err, fcmToken] = await to(User.findFCMTokenByUserId(userId));
        // if (err) throw err;

        const isPriceNonEditableEvent = !_probeInfo[0]['is_price_editable'];

        let resp = await validateLiquidityRequest(req, res, _probeInfo, userId, probeId, isADashboardUser, reqKey);
        if (resp !== true) {
            return resp;
        }
        await redisCaching.setKey(reqKey, true, 60);
        let currUserLiq = await LiquidityUsers.getUserCurrentLiquidityForProbe(userId, probeId, _schema);
        if (currUserLiq[0]['total_liquidity_tokens_count'] < data['shares']
            && ((data['shares'] - currUserLiq[0]['total_liquidity_tokens_count']) < 0.0000001)) {
            data['shares'] = currUserLiq[0]['total_liquidity_tokens_count'];
        }
        let liquidity;
        [err, liquidity] = await to(LiquidityEvent.getLatestRow(probeId, true, _schema));
        const amount = data['shares'] * liquidity[0]['liquidity_token_price'];
        resp = await validateRemoveLiquidityRequest(req, res, probeId, userId, amount, data['shares'], _schema);
        if (resp !== true) {
            redisCaching.delKey(reqKey);
            return resp;
        }
        const _eventTitle = _probeInfo[0].title || ' Title';
        if (_user['coinsd'] === undefined) {
            let [err, userData] = await to(User.findById(userId));
            if (err) {
                throw err;
            }
            _user['coinsd'] = userData['coinsd'] || 0;
        }

        /* Removing current price for event after each putcall to calculate it again */
        let currentPriceObj = await redisCaching.getHMKey(data['probeid'], 'eventCpMap');
        if (currentPriceObj) {
            await redisCaching.setHMKey(data['probeid'], 'eventLastCpMap', currentPriceObj);
        }
        await redisCaching.delHMKey(data['probeid'], 'eventCpMap');
        await redisCaching.delKey(getOpenCallsCachingKey(data['probeid'], _schema));

        var msg = JSON.stringify({
            action: 'REMOVE_LIQUIDITY',
            userId: userId,
            data: data,
            takeAmount: 0,
            orderType: REMOVE_LIQUIDITY,
            // fcmToken: fcmToken,
            eventTitle: _eventTitle,
            amount: parseFloat(amount),
            maxReturn: _probeInfo[0].totalamount,
            reqKey,
            startTime,
            url: req.url,
            method: req.method,
            ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
        });
        if (_schema === 'fantasy'){
            msg['fantasy_type'] = req.fantasy.fantasy_type;
            msg['fantasy_id'] = req.fantasy.fantasy_id;
        }
        zmqService.send(msg, true, true, data['probeid'], userId);

        do {
            await waitTimer(1000);
            logger.info(`Request ${reqKey} is in processing`);
        }
        while (await redisCaching.getKey(reqKey));

        if( _schema === 'public' ){
            [err, _userCoins] = await to(User.getEngagedCoins(Object.assign({}, { 'userid': userId })));
            redisCaching.setHMKey(userId, 'userWallet', JSON.stringify(_userCoins));
            if (err) throw err;
        }

        redisCaching.delKey(reqKey);

        let finalResp;
        [err, finalResp] = await to(redisCaching.getKey('remove_liquidity_resp_' + probeId + '_' + userId));
        if (err) throw err;
        finalResp = JSON.parse(finalResp);
        redisCaching.delKey('remove_liquidity_resp_' + probeId + '_' + userId);
        return ReS(res, Object.assign({}, finalResp, { success: true }));
    } catch (err) {
        redisCaching.delKey(reqKey);
        next(err);
    } finally {
        await redisCaching.delKey(reqKey);
    }

};

const getAddLiquidityNumbers = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    const _user = req.user;
    const userId = req.user.id;
    const probeId = req.body.probeid;
    let data = Object.assign({}, req.body, { userid: userId });
    let reqKey = `put_call_req_${userId}_${probeId}`;
    logger.info(`Add Liquidity Numbers: ` + JSON.stringify(data));
    let _probeInfo, _userCoins;
    let finalResp = {};

    let _schema = 'public';
    if(data?.domain) {
        _schema = data?.domain;
    }

    try {
        const isADashboardUser = isDashboardUser(req);
        const isInternalUser = await isAnInternalUser(req);
        let [err, _probesObject] = await to(Probe.getProbes({
            region: req?.user?.region ?? 'INDIA',
            'probeid': data['probeid'],
            partnerId: req?.user?.partner?.id ?? 1,
            'isDashboardUser': isADashboardUser,
            'isInternalTestUser': isInternalUser
        }, 1000, _schema));
        _probeInfo = _probesObject.rows;

        // let fcmToken;
        // [err, fcmToken] = await to(User.findFCMTokenByUserId(userId));
        // if (err) throw err;

        let resp = await validateLiquidityRequest(req, res, _probeInfo, userId, probeId, isADashboardUser, reqKey);
        if (resp !== true) {
            return resp;
        }
        let liquidity;
        [err, liquidity] = await to(LiquidityEvent.getLatestRow(probeId, true, _schema));
        const amount = data['amount'];
        resp = await validateAddLiquidityRequest(req, res, _user, amount, _probeInfo[0]);
        if (resp !== true) {
            return resp;
        }
        const finalData = {};
        if (liquidity.length === 0) {
            finalData.priceYes = 50.00;
            finalData.priceNo = 50.00;
            finalData.quantityYes = amount / 100;
            finalData.quantityNo = amount / 100;
            finalData.liqPoolConstant = finalData.quantityYes * finalData.quantityNo;
            finalData.liqPoolPrice = amount;
            finalData.liqTokenPrice = 100.00;
            finalData.liqTokensCount = finalData.liqPoolPrice / finalData.liqTokenPrice;
            finalResp.liquidity_token_price = finalData.liqTokenPrice;
            finalResp.liquidity_token_count = finalData.liqTokensCount;
            finalResp.position_token = 0;
            finalResp.position_type = null;
            finalResp.position_price = finalData.priceYes;
        } else {
            let currentData = await getCurrentLiquidityData(probeId, true, _schema);
            finalData.priceYes = currentData.priceYes;
            finalData.priceNo = currentData.priceNo;
            let details = {};
            details.newQuantityYes = currentData.quantityYes + (amount / 100);
            details.newQuantityNo = currentData.quantityNo + (amount / 100);
            if (currentData.priceYes === currentData.priceNo) {
                finalResp.position_token = 0;
                finalResp.position_type = null;
                finalData.quantityNo = details.newQuantityNo;
                finalData.quantityYes = details.newQuantityYes;
            } else {
                if (currentData.priceYes > currentData.priceNo) {
                    let temp = details.newQuantityNo * (currentData.quantityYes / currentData.quantityNo);
                    finalResp.position_token = details.newQuantityYes - temp;
                    finalResp.position_type = 'Y';
                    finalResp.position_price = finalData.priceYes;
                    finalData.quantityYes = temp;
                    finalData.quantityNo = details.newQuantityNo;
                } else {
                    let temp = details.newQuantityYes * (currentData.quantityNo / currentData.quantityYes);
                    finalResp.position_token = details.newQuantityNo - temp;
                    finalResp.position_type = 'N';
                    finalResp.position_price = finalData.priceNo;
                    finalData.quantityNo = temp;
                    finalData.quantityYes = details.newQuantityYes;
                }
            }
            finalData.liqPoolPrice = (finalData.quantityYes * finalData.priceYes) + (finalData.quantityNo * finalData.priceNo);
            finalData.liqPoolConstant = finalData.quantityYes * finalData.quantityNo;
            finalData.liqTokenPrice = currentData.liqTokenPrice;
            finalData.liqTokensCount = currentData.liqTokensCount * (finalData.liqPoolPrice / currentData.liqPoolPrice);
            finalResp.liquidity_token_price = finalData.liqTokenPrice;
            finalResp.liquidity_token_count = finalData.liqTokensCount - currentData.liqTokensCount;
        }
        return ReS(res, Object.assign({}, finalResp, { success: true }));
    } catch (err) {
        next(err);
    }
};

const getRemoveLiquidityNumbers = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    const _user = req.user;
    const userId = req.user.id;
    const probeId = req.body.probeid;
    let data = Object.assign({}, req.body, { userid: userId });
    let reqKey = `put_call_req_${userId}_${probeId}`;
    logger.info(`Remove Liquidity Numbers: ` + JSON.stringify(data));
    let _probeInfo;
    let finalResp = {};

    let _schema = 'public';
    if(data?.domain) {
        _schema = data?.domain;
    }

    try {
        const isADashboardUser = isDashboardUser(req);
        const isInternalUser = await isAnInternalUser(req);
        let [err, _probesObject] = await to(Probe.getProbes({
            region: req?.user?.region ?? 'INDIA',
            'probeid': data['probeid'],
            partnerId: req?.user?.partner?.id ?? 1,
            'isDashboardUser': isADashboardUser,
            'isInternalTestUser': isInternalUser
        }, 1000, _schema));
        _probeInfo = _probesObject.rows;

        // let fcmToken;
        // [err, fcmToken] = await to(User.findFCMTokenByUserId(userId));
        // if (err) throw err;

        let resp = await validateLiquidityRequest(req, res, _probeInfo, userId, probeId, isADashboardUser, reqKey);
        if (resp !== true) {
            return resp;
        }
        let liquidity;
        [err, liquidity] = await to(LiquidityEvent.getLatestRow(probeId, true, _schema));
        const amount = data['shares'] * liquidity[0]['liquidity_token_price'];

        resp = await validateRemoveLiquidityRequest(req, res, probeId, userId, amount, data['shares'], _schema);
        if (resp !== true) {
            return resp;
        }
        const finalData = {};

        let currentData = await getCurrentLiquidityData(probeId, true, _schema);
        finalData.priceYes = currentData.priceYes;
        finalData.priceNo = currentData.priceNo;

        let yesAmountReduction = amount / 2;
        let noAmountReduction = amount / 2;
        let yesTokenReduction = yesAmountReduction / finalData.priceYes;
        let noTokenReduction = noAmountReduction / finalData.priceNo;
        finalResp.yesTokenReceived = yesTokenReduction;
        finalResp.noTokenReceived = noTokenReduction;
        finalResp.priceYes = finalData.priceYes;
        finalResp.priceNo = finalData.priceNo;
        finalData.quantityYes = currentData.quantityYes - yesTokenReduction;
        finalData.quantityNo = currentData.quantityNo - noTokenReduction;

        finalData.liqPoolConstant = finalData.quantityYes * finalData.quantityNo;
        finalData.liqPoolPrice = (finalData.quantityYes * finalData.priceYes) +
            (finalData.quantityNo * finalData.priceNo);
        finalData.liqTokenPrice = currentData.liqTokenPrice;
        finalData.liqTokensCount = currentData.liqTokensCount * (finalData.liqPoolPrice / currentData.liqPoolPrice);

        finalResp.liquidityAmountRemoved = currentData.liqPoolPrice - finalData.liqPoolPrice;

        return ReS(res, Object.assign({}, finalResp, { success: true }));
    } catch (err) {
        next(err);
    }
};

const getUpdatedPrice = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    const userId = req.user.id;
    const probeId = parseInt(req.query.eventId);
    if (isNaN(probeId)) {
        return ReE(res, messages.INVALID_REQUEST, 400);
    }

    const callvalue = req.query.callvalue;
    if (callvalue) {
        if (!(callvalue === 'Y' | callvalue === 'N')) {
            return ReE(res, messages.INVALID_REQUEST, 400);
        }
    }

    const price = req.query.price;
    if (price && isNaN(Number(price))) {
        return ReE(res, messages.INVALID_REQUEST, 400);
    }

    const noofcontracts = req.query.noofcontracts;
    if (noofcontracts && isNaN(Number(noofcontracts))) {
        return ReE(res, messages.INVALID_REQUEST, 400);
    }

    let data = Object.assign({}, req.body, { userid: userId });
    logger.info(`Get Updated Price: ` + JSON.stringify(data));
    const schema = req?.domain || 'public';
    let [err, eventInfo] = await to(ProbeV2.getEvent(probeId, ['totalamount', 'liquidity_fee_factor'], schema));
    if (err) throw err;

    let maxReturns = eventInfo['totalamount'];
    let liquidity_fee_factor = eventInfo['liquidity_fee_factor'];

    let prices = await getExchangePricePerShare(probeId, req.query.action,
        parseFloat(req.query.noofcontracts), parseFloat(req.query.price),
        req.query.callvalue, maxReturns, liquidity_fee_factor, schema);
    const respObject = {
        true_price_yes: prices.pYes,
        true_price_no: prices.pNo,
        ex_price: prices.exPrice
    };
    let tradingFee = 0.0;
    let pUpperLimit = 99.75 * maxReturns / 100;
    let pLowerLimit = 0.25 * maxReturns / 100;
    tradingFee = 0;
    if(schema === 'public') {
        if (req.query.action === 'buy') {
            if (respObject['true_price_yes'] > pUpperLimit || respObject['true_price_no'] > pUpperLimit) {
                return ReE(res, 'Cannot place such large order', 500);
            }
            let nC = req.query.price / prices.exPrice;
            // tradingFee = (req.query.price * CONFIG.takeRatePercentage * 0.01).toFixed(2);
            tradingFee = await getTradingFee("ORDER", req.query.callvalue, nC, prices.exPrice, probeId, req?.user?.id, false);
        } else {
            if (respObject['true_price_yes'] < pLowerLimit || respObject['true_price_no'] < pLowerLimit) {
                return ReE(res, 'No contracts available to sell', 500);
            }
            const contracts = parseFloat(req.query.noofcontracts);
            tradingFee = await getTradingFee("ORDER", req.query.callvalue, contracts, prices.exPrice, probeId, req?.user?.id, false);
        }
    }
    
    respObject['trading_fee'] = parseFloat(tradingFee.toFixed(2));
    return ReS(res, {
        success: true, data: respObject
    });
};

module.exports.addLiquidity = addLiquidity;
module.exports.removeLiquidity = removeLiquidity;
module.exports.getAddLiquidityNumbers = getAddLiquidityNumbers;
module.exports.getRemoveLiquidityNumbers = getRemoveLiquidityNumbers;
module.exports.getUpdatedPrice = getUpdatedPrice;
