const { ProbeV2, Probe, User, CurrentPrice, Partner } = require('../models');
const { to, ReE, ReS, waitTimer } = require('../services/util.service');
const { UserService } = require('../services/user.service');
const { redisCaching } = require('../services/cache.service');
const zmqService = require('../services/zmq.service');
const { isDashboardUser } = require('../middleware/dashboard.user');
const { isAnInternalUser } = require('../utils/user.util');
const moment = require('moment');
const logger = require('../services/logger.service');
const { LiquidityPool } = require('../models/liquidity.pool');
const { updateEventInfoInCache } = require('../utils/redis.utilities/update.event.info');
const { canParticipate, updateParticipationCount } = require('../utils/redis.utilities/tournament.participation');
const ProbeCallsOpen = require('../models/probecallsopen');
const ProbeCalls = require('../models/probecalls');
const { messages } = require('../messages/messages');
const { putCategoryPreference } = require('../utils/customize.feeds');
const { getExPriceAndUpdate, updatePrices } = require('../utils/exchange.maths.js');
const CONFIG = require('../config/config');
const { getCDP } = require('../utils/getCdp.util');
const { getOpenCallsCachingKey, MERGE_YES_NO_TOKENS, TRANSACTIONS } = require('../utils/constants');
const lodash = require('lodash');
const { isForceUpdate } = require('../utils/build.version');
// const socketService = require('../services/socket.service');
const { getTruePrices } = require('../utils/exchange.maths');
const { getTradingFee, isExemptUser, updateBonusCredits } = require('../utils/tradingfee.util');
const { getExchangePricePerShare, getCurrentLiquidityData } = require('../msg_recv/exchange');
const { isUserSuspended } = require('../utils/isUserSuspended.util');
const { mergeTokens } = require('../msg_recv/merge_yes_no_tokens');
const { uuid } = require("uuidv4");
const { promisify } = require('util');
const lock = promisify(require('redis-lock')(redisCaching.client));
const { threadId } = require('worker_threads');
const Contest = require("../models/contest");
const { mergeTokensCDA } = require("../msg_recv/merge_yes_no_tokens_cda");
const { loadFromPartnerUserWallet, loadToPartnerUserWallet } = require('../utils/partner.ups.wallet');
const { localesService } = require('../services/locale/index');
const { generateOrderIdNew } = require("../msg_recv/utils");
const {updateUserRewardFlow} = require('../services/rewards.service.js');
const { DateTime } = require("luxon");
const EXCLUDE_LIST_INTERNAL_USERS = [122426, 31038, 193297, 433061, 29645, 603727, 396569, 977627, 1970715];
const KOL_ID_FOR_PUMP_AND_DUMP = [145401,197831,1484250,1210464,163297,267685];

let uid = Date.now() + 1;

const _isAFirstPosition = async (userId) => {
    const [err, betsCount] = await to(ProbeV2.getBetsCountByUserId(userId));
    if (err) throw err;
    return betsCount === 0;
}

const handleTournamentPutCall = async (data, userId, probeInfo, reqKey) => {
    /* Handle number of positions for a user on an event*/
    await updateParticipationCount(data['probeid'], userId);
    uid = uid + 1;
    const thisExecId = `ex_${(uid).toString(32)}_${process.env.MACHINE_ID}_${threadId}`;
    const _probeId = data['probeid'], _probeTitle = probeInfo['title'], _entryFee = probeInfo['entryfee'];
    /* Put the entry in probecalls table */
    const probeCallEntry = Object.assign({}, {
        userid: userId,
        probeid: _probeId,
        coins: _entryFee,
        callvalue: data['callvalue'],
        returns: 0,
        orderid: thisExecId,
        execid: thisExecId
    });
    let [err, _] = await to(Probe.putCall(probeCallEntry));
    if (err) throw err;
    /* Put the entry in transaction table */
    const txnMsg = `Tournament: ${_probeTitle}\nTook a position for ${_entryFee}`;
    const txnId = 'EX' + (100000000 + parseInt(_probeId));
    let txnData = [{
        'amount': _entryFee,
        'refid': thisExecId,
        'userid': userId,
        'type': 'DEBIT',
        'wallettype': 'D',
        'txnid': txnId,
        'message': txnMsg,
        'surcharge': 0
    }];
    [err, _] = await to(User.addBatchTransaction(txnData));
    if (err) throw err;
    /* Update wallet */
    const walletData = { 'coinsd': _entryFee, 'userid': userId };
    [err, _] = await to(User.updateWallet(walletData, -1));
    if (err) throw err;

    await redisCaching.delKey(reqKey);
}

const putCall = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    
    if (req.baseUrl.includes('v1')) {
        return ReE(res, messages.TRADING_NOT_ALLOWED, 405);
    }

    let startTime = Date.now();
    const requestDateTime = new Date(Date.now()).toISOString().replace('T', ' ').replace('Z', '');
    var _user = req.user;
    var userId = req.user.id, fillopenpos = false, _probeInfo, _userCoins, putStatus, _probesObject;
    const region = req.user.region || 'INDIA';
    if (!req.body.probeid) {
        return ReE(res, messages.UNAUTHORIZED_REQUEST, 400);
    }

    if ( CONFIG.KOSTAR_BLOCKED_USERS.includes(userId) ) {
        return ReE(res, "User not allowed to Trade.", 400);
    }

    let orderType = req.body.ordertype || 'order';
    delete req.body.ordertype;

    const domainPrefix = req.domain ? `${req.domain}_` : '';
    const reqKey = `${domainPrefix}put_call_req_${userId}_${req.body.probeid}`;
    const log = (...args) => console.log(`[Trade] ${reqKey}`, ...args);
    const language = req?.user?.preferred_locale ?? 'en-IN';
    const translator = await localesService.getTranslator(language, 'singleEventPage');

    // await redisCaching.delKey(reqKey);
    try {

        if (CONFIG.MMIDs.indexOf(userId) === -1 && CONFIG.APIPARTNERUSERS.indexOf(userId) === -1) {
            const unlock = await lock(`${domainPrefix}put_call_req_${userId}`, 60000);
            let isReqInProgress = await redisCaching.getKey(reqKey);
            if (isReqInProgress) {
                unlock();
                return ReE(res, translator(messages.REQUEST_IN_PROGRESS), 423);
            }
            await redisCaching.setKey(reqKey, true, 120);
            unlock();
            while (!!(await redisCaching.getKey(`put_redeem_req_${userId}`))) {
                await waitTimer(200)
            }
        } else {
            // let isReqInProgress = await redisCaching.getKey(reqKey);
            // if (isReqInProgress) {
            //     return ReE(res, messages.REQUEST_IN_PROGRESS, 423);
            // }
            // await redisCaching.setKey(reqKey, true, 60);
        }

        const isADashboardUser = isDashboardUser(req);
        if (!isADashboardUser && isForceUpdate(Object.assign({}, req, { query: { app_version: req.body.appVersion } }))) {
            // socketService.sendForceUpdateUser(userId).catch(() => logger.error("While broadcasting force update socket event"));
            return ReE(res, translator(messages.TRADING_NOT_ALLOWED), 405);
        }
        const isUserBlocked = await User.isUserBlocked(userId);
        if (isUserBlocked) {
            return ReE(res, translator(messages.USER_BLOCKED), 500);
        }
        // const timeCheck = await isUserSuspended(userId);
        // if (timeCheck.suspended) {
        //     return ReE(res, messages.USER_SUSPENDED, 500);
        // }

        let err;
        // let err, fcmToken;
        // [err, fcmToken] = await to(User.findFCMTokenByUserId(userId));
        // if (err) throw err;
        let { ptype, openCallToSwap, ...data } = Object.assign({}, req.body, { userid: userId });
        if (!ptype) {
            ptype = 'bet';
        }

        let _schema = 'public';
        if (req?.domain) {
            _schema = req?.domain;
        }

        if (typeof data['islimit'] !== 'undefined') {
            data['ismarket'] = !data['islimit'];
        }
        let isMarketOrder = data['ismarket']
        /*Do not Delete. Might be needed in future
        const isUserAllowed = await User.isUserAllowed(userId);
        if (!isUserAllowed) {
            return ReE(res, messages.TRADING_BLOCKED_USER, 400);
        }
        */

        // const isFirstPosition = await _isAFirstPosition(userId);

        // let takeRate = isFirstPosition ? 0.0 : 0.0025;
        let takeRate = 0.0025;
        let takeAmount = 0.0;

        const isInternalUser = await isAnInternalUser(req);
        const probeId = parseInt(data['probeid']);
        if (isNaN(probeId)) {
            return ReE(res, translator(messages.INVALID_REQUEST), 400);
        }
        data['probeid'] = probeId;

        log(`Trade Request ${Date.now()}, ${threadId}`);

        if (data['callvalue']) {
            if (!(data['callvalue'] === 'Y' | data['callvalue'] === 'N')) {
                return ReE(res, translator(messages.INVALID_REQUEST), 400);
            }
        }

        if (data['trade_initiated_price']) {
            if (isNaN(Number(data['trade_initiated_price']))) {
                return ReE(res, translator(messages.INVALID_REQUEST), 400);
            }
            const tradeInitiatedPrice = parseFloat(data['trade_initiated_price']);
            data['trade_initiated_price'] = tradeInitiatedPrice;
        }

        if (ptype === 'bet') {
            [err, _probesObject] = await to(Probe.getProbes({ partnerId: req?.user?.partner?.id ?? 1, 'probeid': data['probeid'], 'region': region, 'isDashboardUser': isADashboardUser, isInternalTestUser: isInternalUser, fantasy: req?.fantasy }, 1000, _schema));
            if (err) throw err;
            if (_probesObject.rows.length == 0) {
                return ReE(res, translator(`Trading not allowed on this event`), 400);
            }
            // redisCaching.set(`event_${data['probeid']}`, JSON.stringify(_probesObject));
            // let eventtFromCache = await redisCaching.getKey(`event_${data['probeid']}`);
            // if (eventtFromCache) {
            //     _probesObject = JSON.parse(eventtFromCache)
            // } else {
            //     [err, _probesObject] = await to(Probe.getProbes({ 'probeid': data['probeid'], 'isDashboardUser': isADashboardUser, isInternalTestUser: isInternalUser }));
            //     if (err) throw err;
            //     redisCaching.set(`event_${data['probeid']}`, JSON.stringify(_probesObject));
            // }

            _probeInfo = _probesObject.rows;
            const item = _probeInfo[0];
            const partnerId = req?.user?.partner?.id ?? 1;
            if(
                (partnerId === 5 && process.env.NODE_ENV === 'production') ||
                (partnerId === 3 && process.env.NODE_ENV !== 'production')
            ) {
                const validTrade = ( luxon.DateTime.now().setZone('Asia/Kolkata')?.hour > 6 );
                if (!validTrade) {
                    return ReE(res, messages.TRADING_SECURITY_HALT, 405);
                }
            }
            if (_probeInfo[0].probe_type == 'exclude') {
                const userGroups = await User.getUserGroups(userId);
                if (userGroups && userGroups.length) {
                    let probeExcludedGroups = _probeInfo[0]?.probe_type_props?.exclude_group_names ?? [];
                    let intersection = userGroups.filter(item => probeExcludedGroups.includes(item))
                    if (intersection.length) {
                        return ReE(res, translator(`Trading not allowed on this event`), 400);
                    }
                }
            }
            if (_probeInfo[0].is_private && orderType == 'order' && !EXCLUDE_LIST_INTERNAL_USERS.includes(userId)) {
                const isUserEligible = await Probe.isUserExistInCustomPrivateEventUsers(userId, data['probeid'])
                if (!isUserEligible) {
                    // Not eligible to buy on this event
                    await redisCaching.delKey(reqKey);
                    return ReE(res, translator(messages.NOT_ELIGIBLE_TO_BUY), 405);
                }
                let userCustomPrivateEvents = await Probe.getUserCustomPrivateEvents(userId)
                const userCustomPrivateEventIds = userCustomPrivateEvents.map(function (e) { return e.probeid })
                let tradedPrivateEvents = await Probe.getUserPrivateEventProbeCalls(userId)
                const alreadyTradedPrivateEventIds = tradedPrivateEvents.map(function (e) { return e.probeid })
                if (alreadyTradedPrivateEventIds.includes(probeId) && (!userCustomPrivateEventIds.includes(probeId))) {
                    await redisCaching.delKey(reqKey);
                    return ReE(res, translator(messages.GPE_CAN_ONLY_BUY_ONCE), 405);
                }
                if (!userCustomPrivateEventIds.includes(probeId) && alreadyTradedPrivateEventIds.length >= CONFIG.MAX_ALLOWED_PRIVATE_EVENTS_COUNT) {
                    await redisCaching.delKey(reqKey);
                    return ReE(res, translator(messages.MAX_ALLOWED_GPE_REACHED), 405);
                }
                if (alreadyTradedPrivateEventIds.includes(probeId) && userCustomPrivateEventIds.includes(probeId)) {
                    let tradeCount = await Probe.getUserCustomPrivateEventTradeCount(userId, probeId, _schema)
                    if (tradeCount >= CONFIG.MAX_ALLOWED_RETENTION_PRIVATE_EVENTS_COUNT) {
                        await redisCaching.delKey(reqKey);
                        return ReE(res, translator(messages.MAX_ALLOWED_GPE_REACHED), 405);
                    }
                }
            }
            if (_probeInfo[0].max_trade_amount && orderType == 'order' && userId !== 603727){
                if(  
                    (KOL_ID_FOR_PUMP_AND_DUMP.includes(userId) && _probeInfo[0]['createdby'] === userId ) ||
                    CONFIG.APIPARTNERUSERS.includes(userId) 
                ) {
                    console.log(`KOL OR PARTNER USER max trade amount bypased. user: ${userId}, event ${probeId}`)
                } else {
                    let total_buy_user = await Probe.getTotalBuy(userId, probeId, _probeInfo[0]['is_price_editable']);
                    let allowed_buy = _probeInfo[0].max_trade_amount;
                    let current_buy = (data['coins'] * parseFloat(data['noofcontracts']));
                    if(allowed_buy < total_buy_user + current_buy){
                        await redisCaching.delKey(reqKey);
                        return ReE(res, `Can only buy a maximum of ${allowed_buy} amount on this event`, 405);
                    }
                }
            }
        } else {
            [err, _probesObject] = await to(Probe.getTournaments({ 'probeid': data['probeid'] }));
            if (err) throw err;
            _probeInfo = _probesObject;
        }

        /* Update preference for the current user */
        // if (orderType === 'order')
        //     putCategoryPreference(_probeInfo[0], userId);
        if (_schema == "fantasy") {
            let contestinfo = await Contest.getContestById(Number(req.fantasy.fantasy_id), _schema);
            if (contestinfo.length <= 0) {
                return ReE(res, translator('Contest does not exist'), 422, translator('Contest does not exist'));
            }

            contestinfo = contestinfo[0];
            if (contestinfo.disablesell === true && (orderType === 'sell' || orderType === 'exit')) {
                return ReE(res, translator('Sell is not allowed in this contest'), 422, translator('Sell is not allowed in this contest'));
            }
            if (moment(contestinfo.start_time).isAfter(moment())) {
                return ReS(res, { status: 'ERROR', message: "Contest event can be traded only after contest start time" });
            }

            if (!contestinfo || !contestinfo['end_time'] || contestinfo.status !== 'A' || moment(contestinfo.end_time).isBefore(moment())) {
                await redisCaching.delKey(reqKey);
                let message = ptype === 'bet' ? messages.MARKET_CLOSED_BUY : messages.TOURNAMENT_CLOSED;
                if (orderType === 'cancel' || orderType === 'cancelsell') {
                    message = messages.MARKET_CLOSED_CANCEL;
                } else if (orderType === 'sell' || orderType === 'exit') {
                    message = messages.MARKET_CLOSED_SELL;
                }
                message = translator(message);
                await redisCaching.delKey(reqKey);
                return ReS(res, { status: 'ERROR', message });
            }
        }


        if (!_probeInfo[0] || !_probeInfo[0].endsat || _probeInfo[0].status !== 'A' || moment(_probeInfo[0].endsat).isBefore(moment())) {
            await redisCaching.delKey(reqKey);
            let message = ptype === 'bet' ? messages.MARKET_CLOSED_BUY : messages.TOURNAMENT_CLOSED;
            if (_probeInfo[0].status === 'H') {
                message = messages.MARKET_CLOSED_HALTED;
            } else if (orderType === 'cancel' || orderType === 'cancelsell') {
                message = messages.MARKET_CLOSED_CANCEL;
            } else if (orderType === 'sell' || orderType === 'exit') {
                message = messages.MARKET_CLOSED_SELL;
            }
            message = translator(message);
            const isExemptedUser = isExemptUser(userId);
            if (!isExemptedUser) {
                await redisCaching.delKey(reqKey);
                return ReS(res, { status: 'ERROR', message });
            }
        }

        //Do not allow to take action on parent event
        if (_probeInfo[0].parent_id && ([-1, -2].includes(_probeInfo[0].parent_id))) {
            await redisCaching.delKey(reqKey);
            return ReE(res, translator(`Unfortunately, this operation is forbidden.`), 400);
        }

        const maxReturns = _probeInfo[0]['totalamount'];
        const mincoins = 1 * maxReturns / 100;
        const maxcoins = 99 * maxReturns / 100;
        const liquidityFeeFactor = _probeInfo[0]?.liquidity_fee_factor;
        const isPriceNonEditableEvent = !_probeInfo[0]['is_price_editable'];
        const isVariableLiquidityPool = _probeInfo[0]['is_variable_liquidity_pool'];
        const maxAllowedPosition = _probeInfo[0]['max_allowed_position'] || (isPriceNonEditableEvent ? CONFIG.INSTANT_MATCH_POSITION_MAX_ALLOWED : CONFIG.CDA_POSITION_MAX_ALLOWED);
        let noofcontracts = parseFloat(data['noofcontracts']);

        if (isPriceNonEditableEvent) {
            if (!noofcontracts) {
                await redisCaching.delKey(reqKey);
                return ReE(res, translator(messages.INVALID_REQUEST), 400);
            }
        }

        if (!isPriceNonEditableEvent) {
            if (noofcontracts && isNaN(Number(noofcontracts))) {
                await redisCaching.delKey(reqKey);
                return ReE(res, translator(messages.INVALID_REQUEST), 400);
            }
            noofcontracts = Math.floor(data['noofcontracts'] || 1);
            if ((orderType === "order" || orderType === 'sell' || orderType === 'exit')
                && parseFloat(data['noofcontracts']) !== noofcontracts) {
                log(`invalid noofcontracts: ${noofcontracts}, ${data['noofcontracts']}`);
                await redisCaching.delKey(reqKey);
                return ReE(res, translator(`Invalid Request. Fractional Buy/Sell of shares not allowed in this Market`), 400);
            }
            if (!isMarketOrder) {
                if (data['coins'] % _probeInfo[0]['range'] > 0) {
                    await redisCaching.delKey(reqKey);
                    return ReE(res, translator(`Invalid Request. Price not in range`), 400);
                }
            }
        }

        // if (isPriceNonEditableEvent && isVariableLiquidityPool) {
        //     let currentData = await getCurrentLiquidityData(data['probeid'], true);
        //     if (currentData === null || currentData === {} || Object.keys(currentData).length === 0) {
        //         return ReE(res, `Liquidity does not exist for this event `, 400);
        //     }
        // }

        if (ptype === 'bet') {
            const tokens = data['coins'] ? data['coins'].toString().split(".") : [];
            if (tokens.length === 2 && tokens[1].length > 2) {
                await redisCaching.delKey(reqKey);
                return ReE(res, translator(`Bad Request`), 400);
            }
            if (isNaN(Number(data['coins']))) {
                await redisCaching.delKey(reqKey);
                return ReE(res, translator(messages.INVALID_REQUEST), 400);
            }
            if (!isPriceNonEditableEvent) {
                const maxContracts = parseInt(maxAllowedPosition / maxReturns);
                if (data['coins'] < mincoins || data['coins'] > maxcoins || noofcontracts < 1) {
                    await redisCaching.delKey(reqKey);
                    return ReE(res, translator(messages.INVALID_REQUEST), 400);
                }
                if (data['coins'].toString().split('.').length > 1) {
                    await redisCaching.delKey(reqKey);
                    return ReE(res, translator(`Fractional share price cannot be entered`), 400);
                }
            } else {
                if (noofcontracts < 0.1) {
                    await redisCaching.delKey(reqKey);
                    return ReE(res, translator(`Cannot place order. Number of shares should be at least 0.1`), 500);
                }
            }
        }

        const _eventTitle = _probeInfo[0].title || ' Title';

        // if (_user['coinsd'] === undefined) {
        //     let [err, userData] = await to(User.findById(userId, false));
        //     if (err) {
        //         throw err;
        //     }
        //     _user['coinsd'] = userData['coinsd'] || 0;
        //     _user['coinsb'] = userData['coinsb'] || 0;
        //     _user['coinsw'] = userData['coinsw'] || 0;
        // }
        if (_schema === 'public') {
            let [er, userData] = await to(User.getWalletBalance(userId, false));
            if (er) {
                throw er;
            }
            _user['coinsd'] = userData['coinsd'] || 0;
            _user['coinsb'] = userData['coinsb'] || 0;
            _user['coinsw'] = userData['coinsw'] || 0;
        } else {
            let [er, userData] = await to(User.getContestUserEventBalance(userId, req?.fantasy?.fantasy_id, false, _schema));
            _user['coins'] = userData['coins'] || 0;
        }

        let orderId = generateOrderIdNew();
        let commissionFee = 0.0;
        let _deductFrom = Object.assign({}, { coinsd: 0, coinsb: 0, coinsw: 0 });

        let noOfContractsTobeCanceled = 0;
        // if( req.user.partner?.name === 'MyMaster11' ){
        //     return ReE(res, `Trading is temporarily under maintenance, it will resume shortly`, 400);
        // }
        if (orderType == 'order') {
            if( req.user.partner?.name === 'Kostar' ){
                return ReE(res, `Buying is temporarily under maintenance, it will resume shortly`, 400);
            }
            let netAmount = 0;
            let oCoins = parseFloat(data['coins']);
            if (isPriceNonEditableEvent) {
                netAmount = parseFloat(data['coins']);
                if (isNaN(netAmount)) {
                    await redisCaching.delKey(reqKey);
                    return ReE(res, translator(`Trade amount passed is a non numeric value. It should be a numeric`), 423);
                }
                let prices;
                if (isVariableLiquidityPool) {
                    prices = await getExchangePricePerShare(data['probeid'], 'buy', 1, netAmount, data['callvalue'], maxReturns, liquidityFeeFactor, _schema);
                } else {
                    prices = await getExPriceAndUpdate(data['probeid'], 'buy', 1, netAmount, data['callvalue'], maxReturns, false);
                }
                if (prices['exPrice']) {
                    oCoins = prices['exPrice'];
                    noofcontracts = netAmount / oCoins;
                    if (noofcontracts < 0.1) {
                        await redisCaching.delKey(reqKey);
                        return ReE(res, translator(`Cannot place order. Number of shares should be at least 0.1`), 500);
                    }
                }
                if (!EXCLUDE_LIST_INTERNAL_USERS.includes(userId) && !KOL_ID_FOR_PUMP_AND_DUMP.includes(userId) && !CONFIG.APIPARTNERUSERS.includes(userId)) {
                    if (parseFloat(data['coins']) > maxAllowedPosition) {
                        await redisCaching.delKey(reqKey);
                        return ReE(res, translator(`Cannot purchase shares worth more than {{maxAllowedPosition}} at a time`, { 'maxAllowedPosition': maxAllowedPosition }), 422);
                    }
                } else if (KOL_ID_FOR_PUMP_AND_DUMP.includes(userId)) {
                    if (parseFloat(data['coins']) > maxAllowedPosition) {
                        if(_probeInfo[0]['createdby'] !== userId) {
                            await redisCaching.delKey(reqKey);
                            return ReE(res, translator(`Cannot purchase shares worth more than {{maxAllowedPosition}} at a time`, { 'maxAllowedPosition': maxAllowedPosition }), 422);
                        } else {
                            log(`KOL IM buy bypased`)
                        }
                    }
                }
            } else { //CDA
                if (data['ismarket'] && orderType === 'order') {
                    data['orderamount'] = parseFloat(data['orderamount'])
                    if (isNaN(data['orderamount'])) {
                        await redisCaching.delKey(reqKey);
                        return ReE(res, translator(messages.INVALID_REQUEST), 400);
                    }
                }
                netAmount = data['ismarket'] ? parseFloat(data['orderamount']) : parseFloat((data['coins'] * noofcontracts).toFixed(2));
                if (!EXCLUDE_LIST_INTERNAL_USERS.includes(userId) && !KOL_ID_FOR_PUMP_AND_DUMP.includes(userId) && !CONFIG.APIPARTNERUSERS.includes(userId)) {
                    if (netAmount > maxAllowedPosition) {
                        await redisCaching.delKey(reqKey);
                        return ReE(res, translator(`Cannot purchase shares worth more than {{maxAllowedPosition}} at a time`, { 'maxAllowedPosition': maxAllowedPosition }), 422);
                    }
                } else if (KOL_ID_FOR_PUMP_AND_DUMP.includes(userId)) {
                    if (netAmount > maxAllowedPosition) {
                        if(_probeInfo[0]['createdby'] !== userId) {
                            await redisCaching.delKey(reqKey);
                            return ReE(res, translator(`Cannot purchase shares worth more than {{maxAllowedPosition}} at a time`, { 'maxAllowedPosition': maxAllowedPosition }), 422);
                        } else {
                            log(`KOL CDA buy bypased`)
                        }
                    }
                }
            }

            let partnerData = {
                isPriceNonEditableEvent,
                userData: _user,
                orderType,
                data: data,
                partner: req.partner,
                region: region,
                eventData: _probeInfo?.[0],
            }

            let loadResp = await loadFromPartnerUserWallet(partnerData, orderId);
            if (loadResp?.success === false) {
                await redisCaching.delKey(reqKey);
                const errMsg = loadResp.code === 2001 ? loadResp.message : `Insufficient funds. Please recharge your wallet for trading.`;
                log('PARTNER LOAD WALLET ERROR', loadResp.message);
                return ReE(res, errMsg, 500);
            }
            if (_schema === 'public') {
                let [er1, userData1] = await to(User.getWalletBalance(userId, false));
                if (er1) {
                    throw er1;
                }
                _user['coinsd'] = userData1['coinsd'] || 0;
                _user['coinsb'] = userData1['coinsb'] || 0;
                _user['coinsw'] = userData1['coinsw'] || 0;
                _user['coinsp'] = userData1['coinsp'] || 0;
            }

            // takeAmount = parseFloat((netAmount * (takeRate)).toFixed(2));
            // for (let i = 0; i < CONFIG.takeRate.length; i++) {
            //     let lowerBound = CONFIG.takeRate[i]['range'][0] * (maxReturns / 100);
            //     let upperBound = CONFIG.takeRate[i]['range'][1] * (maxReturns / 100);
            //     if (oCoins > lowerBound && oCoins <= upperBound) {
            //         commissionFee = CONFIG.takeRate[i]['fee'] * (maxReturns / 100);
            //     }
            // }
            takeAmount = 0
            // takeAmount = getTradingFee(orderType, noofcontracts, data['coins'], data['probeid'])
            // takeAmount = await getTradingFee(orderType, data['callvalue'], noofcontracts, oCoins, data['probeid'], req?.user?.id, _probeInfo[0]['is_price_editable'], isMarketOrder)
            let nC0 = isMarketOrder ? data['orderamount'] / oCoins : noofcontracts;
            if (_schema === 'public') {
                takeAmount = await getTradingFee(orderType, data['callvalue'], nC0, oCoins, data['probeid'], req?.user?.id, _probeInfo[0]['is_price_editable'], isMarketOrder)

                log(`trading fee: ${takeAmount}`)
                let totalAmount = (netAmount + takeAmount);
                
                let currentHolding = 0;
                if( _probeInfo[0]['probe_type'] === 'promo' ) {
                    currentHolding = _user['coinsp'];
                } else {
                    currentHolding = _user['coinsd'] + _user['coinsb'] + _user['coinsw'];
                }
                log(`Trade Balance check: totalAmount ${totalAmount}, netAmount ${netAmount}, takeAmount ${takeAmount} < currentHolding ${currentHolding}`);
                if ( currentHolding < totalAmount ) {
                    await redisCaching.delKey(reqKey);
                    const requiredAmount = totalAmount - (currentHolding);
                    let position_string = data['callvalue'] === "Y" ? "Yes" : "No";
                    let respData = {
                        title: translator('Insufficient Credits'),
                        info: translator('Please top-up your credits in order to win more.'),
                        metadata: [
                            { key: translator("Qty x Price"), value: data['coins'].toString() + ` (${position_string})` + ' x ' + noofcontracts.toString() },
                            { key: translator("Total Order Value"), value: parseFloat(totalAmount).toFixed(2).toString() }
                        ]
                    };
                    const partnerName = req.user.partner?.name || 'TradeX';
                    if (partnerName === 'MetaOne') {
                        respData.info = 'Please visit your TMR wallet to add funds.'
                        return ReS(res, {
                            status: 'ERROR',
                            message: messages.INSUFFICIENT_FUNDS,
                            respData
                        });
                    }
                    if (partnerName === 'USP') {
                        respData.info = 'Please recharge your Juego wallet.'
                        return ReS(res, {
                            status: 'ERROR',
                            message: messages.INSUFFICIENT_FUNDS,
                            respData
                        });
                    }
                    if( _probeInfo[0]['probe_type'] === 'promo' ) {
                        return ReS(res, {
                            status: 'ERROR',
                            message: translator(messages.INSUFFICIENT_LUCKYCOINS),
                            respData
                        });
                    }
                    return ReS(res, {
                        status: 'ERROR',
                        message: translator(messages.INSUFFICIENT_FUNDS),
                        'required': Math.ceil(requiredAmount),
                        respData
                    });
                }
            } else {
                if (_user['coins'] < netAmount) {
                    await redisCaching.delKey(reqKey);
                    const requiredAmount = netAmount - (_user['coins']);
                    let position_string = data['callvalue'] === "Y" ? "Yes" : "No";
                    let respData = {
                        title: translator('Insufficient Credits'),
                        info: translator('Please top-up your credits in order to win more.'),
                        metadata: [
                            { key: translator("Qty x Price"), value: data['coins'].toString() + ` (${position_string})` + ' x ' + noofcontracts.toString() },
                            { key: translator("Total Order Value"), value: parseFloat(requiredAmount).toFixed(2).toString() }
                        ]
                    };
                    return ReS(res, {
                        status: 'ERROR',
                        message: translator(messages.INSUFFICIENT_FUNDS),
                        respData
                    });
                }
            }

            delete data.ptype;
            delete data.fillopenpos;
            delete data['bonuslimit'];

            redisCaching.setHMKey(userId, 'callsMap', true);

            // await updateEventInfoInCache(data['probeid'], { updatedVolume: netAmount }, maxReturns);

            _deductFrom = Object.assign({}, { coinsd: 0, coinsb: 0, coinsw: 0 });
            _deductFrom['coinsd'] = netAmount;
        }
        if (orderType === 'sell' || orderType === 'exit') {
            if (isPriceNonEditableEvent) {
                let noofcontracts = parseFloat(data['noofcontracts']);
                if (isNaN(noofcontracts)) {
                    await redisCaching.delKey(reqKey);
                    return ReE(res, translator(`Number of contracts passed is a non numeric value. It should be a numeric`), 424);
                }
                const coins = parseFloat(data['coins']);
                if (!EXCLUDE_LIST_INTERNAL_USERS.includes(userId)
                    && coins * noofcontracts > maxAllowedPosition && !KOL_ID_FOR_PUMP_AND_DUMP.includes(userId)) {
                    await redisCaching.delKey(reqKey);
                    return ReE(res, translator(`Cannot sell shares worth more than {{maxAllowedPosition}} at a time`, { "maxAllowedPosition": maxAllowedPosition }), 500);
                } else if (KOL_ID_FOR_PUMP_AND_DUMP.includes(userId)) {
                    if (coins * noofcontracts > maxAllowedPosition) {
                        if(_probeInfo[0]['createdby'] !== userId) {
                            await redisCaching.delKey(reqKey);
                            return ReE(res, translator(`Cannot purchase shares worth more than {{maxAllowedPosition}} at a time`, { 'maxAllowedPosition': maxAllowedPosition }), 422);
                        } else {
                            console.log(`KOL im sell buy bypased. user: ${userId}, event ${probeId}`)
                        }
                    }
                }
                let params = {
                    'status': 'A',
                    'userId': userId,
                    'probeId': data['probeid'],
                    'callValue': data['callvalue'],
                    'orderType': 'sell',
                    'numberOfContracts': noofcontracts
                }
                log("searching params: " + JSON.stringify(params));
                const matchedOrderListResultSet = await to(ProbeCalls.getMatchedOrderList(params, _schema));
                log("Matched order search result: " + JSON.stringify(matchedOrderListResultSet));
                if (matchedOrderListResultSet[1].length === 0) {
                    await redisCaching.delKey(reqKey);
                    return ReE(res, translator(`You have no shares to sell`), 425);
                }
                let totalAvailableForSell = 0;
                const matchedOrders = matchedOrderListResultSet[1];
                for (const matchedOrder of matchedOrders) {
                    totalAvailableForSell += matchedOrder.numberOfContracts;
                }
                if (noofcontracts - totalAvailableForSell > 0.01) {
                    await redisCaching.delKey(reqKey);
                    return ReE(res, translator("You have {{totalAvailableForSell}} shares. Cannot sell {{noofcontracts}}", { 'totalAvailableForSell': totalAvailableForSell, 'noofcontracts': noofcontracts }), 425);
                }
            }
        }

        if (orderType === 'cancel') {
            if (!data || !data['orderid']) {
                return ReE(res, translator('Bad Request'), 400);
            } else {
                const resultSet = await to(ProbeCallsOpen.getOpenPositionByUserIdAndOrderId(userId, data['orderid'], _schema));
                if (resultSet[0]) {
                    throw resultSet[0];
                }
                if (resultSet[1].length === 0) {
                    return ReE(res, translator(messages.UNAUTHORIZED_REQUEST), 400);
                }
                try {
                    noOfContractsTobeCanceled = parseInt(resultSet[1][0]['noofcontracts']);
                } catch (e) { }
                let netAmount = resultSet[1][0]['coins'] * resultSet[1][0]['noofcontracts'];
                takeAmount = parseFloat((netAmount * (takeRate)).toFixed(2));
            }
        }
        if (orderType === 'cancelsell') {
            const resultSet = await to(ProbeCallsOpen.getOpenPositionByUserIdAndOrderId(userId, data['orderid'], _schema));
            if (resultSet[0]) {
                throw resultSet[0];
            }
            if (resultSet[1].length === 0) {
                return ReE(res, translator(messages.UNAUTHORIZED_REQUEST), 400);
            }
            try {
                noOfContractsTobeCanceled = parseInt(resultSet[1][0]['noofcontracts']);
            } catch (e) { }
        }

        if (ptype === 'competition') {
            const flag = await canParticipate(data['probeid'], userId);
            if (!flag)
                return ReS(res, { status: 'ERROR', message: messages.POSITIONS_LIMIT });
            [err, participationCount] = await to(Probe.getParticipationCountOnTournament(data['probeid']));
            if (err) throw err;
            [err, tournamentSpecificInfo] = await to(Probe.getTournamentSpecificInfo(data['probeid']));
            if (err) throw err;
            if (participationCount >= tournamentSpecificInfo.max_players)
                return ReS(res, { status: 'ERROR', message: translator(messages.NO_SPOTS) });
        }
        /* Removing current price for event after each putcall to calculate it again */
        let currentPriceObj = await redisCaching.getHMKey(data['probeid'], 'eventCpMap');
        if (currentPriceObj) {
            await redisCaching.setHMKey(data['probeid'], 'eventLastCpMap', currentPriceObj);
        }
        await redisCaching.delKey(getOpenCallsCachingKey(data['probeid'], _schema));

        data['coins'] = parseFloat(data['coins'])
        data['noofcontracts'] = parseFloat(data['noofcontracts'])
        data['preventSlippage'] = !!data['preventSlippage']
        data['allowedSlippage'] = CONFIG?.PREVENTSLIPPAGE?.allowedSlippage ?? 4
        // if(orderType === 'order') {
        //     data['trade_initiated_price'] =  data['trade_initiated_price'] - 4
        // } else {
        //     data['trade_initiated_price'] =  data['trade_initiated_price'] + 4
        // }
        _deductFrom['coinsd'] = 10;
        switch (ptype) {
            case 'bet':
                var msg = {
                    action: 'TRADE',
                    type: 'ORDER',
                    userId: userId,
                    data: data,
                    range: _probeInfo[0]['range'],
                    probeType: _probeInfo[0]['probe_type'],
                    deductAmt: _deductFrom,
                    takeAmount: takeAmount,
                    orderType: orderType,
                    // fcmToken: fcmToken,
                    openCallToSwap: openCallToSwap,
                    eventTitle: _eventTitle,
                    maxReturn: maxReturns,
                    // isFirstPosition,
                    liquidityFeeFactor,
                    isPriceNonEditableEvent,
                    isVariableLiquidityPool,
                    orderId: orderId,
                    reqKey,
                    startTime,
                    url: req.url,
                    method: req.method,
                    ip: req.headers['x-forwarded-for']
                    // || req.socket.remoteAddress
                };
                if (_schema === 'fantasy') {
                    msg['fantasyType'] = req.fantasy.fantasy_type;
                    msg['fantasyId'] = Number(req.fantasy.fantasy_id);
                    msg['data']['fantasyType'] = req.fantasy.fantasy_type;
                    msg['data']['fantasyId'] = Number(req.fantasy.fantasy_id);

                }
                msg = JSON.stringify(msg);
                zmqService.send(msg, isPriceNonEditableEvent, isVariableLiquidityPool, data['probeid'], userId);
                break;
            case 'competition':
                await handleTournamentPutCall(data, userId, _probeInfo[0], reqKey);
                break;
        }

        let endB4Matching = Date.now();
        let processTimeB4Matching = endB4Matching - startTime;
        log(`Trade B4 Matching time: ${processTimeB4Matching}`);
        await waitTimer(300);
        while (!!(await redisCaching.getKey(reqKey))) {
            await waitTimer(100);
            logger.info(`Request ${reqKey} is in processing`);
        }
        await redisCaching.delHMKey(data['probeid'], 'eventCpMap');
        await redisCaching.delHMKey(data['probeid'], 'eventCpMapChart');

        let endTimeMatching = Date.now();
        let processTimeMatching = endTimeMatching - startTime;
        log(`Trade Matching time: ${processTimeMatching}`);

        let partnerData = {
            isPriceNonEditableEvent,
            userData: _user,    
            orderType,
            data: data,
            partner: req.partner,
            region: region,
            eventData: _probeInfo[0]
        }
        let tradeOrderId = orderId;
        if (orderType === 'cancel') {
            orderId = null;
            orderId = data['orderid'];
            tradeOrderId = data['orderid'];
        } else if (orderType === 'order') {
            partnerData["orderType"] = 'cancel';
        } else {
            orderId = null;
        }
        await loadToPartnerUserWallet(partnerData, orderId);

        let tradPriceErr;
        [err, tradPriceErr] = await to(redisCaching.getKey('buy_trading_high_price_failed_im' + data['probeid'] + '_' + userId));
        await redisCaching.delKey('buy_trading_high_price_failed_im' + data['probeid'] + '_' + userId);
        if (tradPriceErr) {
            return ReE(res, tradPriceErr, 413);
        }


        const attemptWithDelayAndRetry = async (fn, maxAttempts, delay, isValidResult, ...args) => {
            const delayPromise = (ms) => new Promise(resolve => setTimeout(resolve, ms));
          
            const attempt = async (attemptNumber) => {
              try {
                log(`Getting order details ${{...args}} attempt ${attemptNumber}`);
                const result = await fn(...args);
                // Use the isValidResult function to check if the result is valid
                if (isValidResult(result)) {
                  return isValidResult(result);
                } else if (attemptNumber < maxAttempts) {
                  // Result is not valid, and more attempts are allowed
                  await delayPromise(delay);
                  return attempt(attemptNumber + 1);
                } else {
                  // Result is not valid, but no more attempts are left
                  throw new Error('Result not valid and maximum attempts reached');
                }
              } catch (err) {
                if (attemptNumber < maxAttempts) {
                  await delayPromise(delay);
                  return attempt(attemptNumber + 1);
                } else {
                  return false;
                }
              }
            };
          
            return attempt(1);
        };
        if (orderType === 'cancel' || orderType === 'cancelsell') {
            tradeOrderId = data['orderid'];
        }
        let orderDetails = await attemptWithDelayAndRetry(Probe.getTradeDetails, 3, 600, (r) => {
            return r.length > 0 ? r : false;
        }, _schema, tradeOrderId, userId, probeId, /^sell|exit/gi.test(orderType) ? ['EX', 'H'] : undefined);

            await redisCaching.delKey(reqKey);
        if(!orderDetails) {
            log("NO MATCHING POSITIONS FOR ORDER ID", tradeOrderId);
            return ReS(res, { success: false, status: 'ERROR', message: translator(messages.NO_MARKET_ORDER_PLACED), executed: false });
        }
        const pCalls = orderDetails.find( i => i.type === 'probecalls');
        const pCallsOpen = orderDetails.find( i => i.type === 'probecallsopen');
        let matched = Number(parseFloat(pCalls?.noofcontracts ?? Number(0)).toFixed(2));
        let matchedCoins = Number(parseFloat(pCalls?.coins ?? Number(0)).toFixed(2));
        let unmatched = Number(parseFloat(pCallsOpen?.noofcontracts ?? Number(0)).toFixed(2));
        let unmatchedCoins = Number(parseFloat(pCallsOpen?.coins ?? Number(0)).toFixed(2));

        

        if (
            ( isPriceNonEditableEvent || data['ismarket'] ) &&
            matched === 0 
        ) {
            log("NO MATCHING POSITIONS FOR ORDER ID Only OPEN ORDERS", tradeOrderId);
            return ReS(res, { success: false, status: 'ERROR', message: translator(messages.NO_MARKET_ORDER_PLACED), executed: false });
        }
        if (ptype === 'bet') {
            updatePrice(data['probeid'], _schema);
        }

        if (!isPriceNonEditableEvent && EXCLUDE_LIST_INTERNAL_USERS.includes(userId)) {
            data['orderId'] = tradeOrderId;
        }

        let tradePriceMsg = false;
        let partiallyExecuted = false;
        [err, tradePriceMsg] = await to(redisCaching.getKey('trade_partially_executed' + data['probeid'] + '_' + userId));
        if (tradePriceMsg) {
            partiallyExecuted = true
            logger.info('trade_partially_executed' + tradePriceMsg);
            await redisCaching.delKey('trade_partially_executed' + data['probeid'] + '_' + userId);
        }

        let endTime = Date.now();
        let processTime = endTime - startTime;
        log(`Trade Process time: ${processTime}`);

        let respData = {};
        let info = "";
        let position_string = data['callvalue'] === "Y" ? "Yes" : "No";
        let metadata = [
            { 
                key: translator("Qty x Price"), 
                value: `${matched} (${position_string})` + ' x ' + matchedCoins.toFixed(2).toString() },
            { 
                key: translator("Total Order Value"), 
                value: (matched * matchedCoins).toFixed(2).toString() 
            }
        ];

        let titleStr = translator("Order") + " ";
        if (orderType !== 'cancel' && orderType !== 'cancelsell') {
            if (matched == 0 && unmatched > 0) {
                titleStr = titleStr + translator("Placed");
                info = translator("We're currently processing your order.");
                metadata = [
                    { 
                        key: translator("Qty x Price"), 
                        value: `${unmatched} (${position_string})` + ' x ' + unmatchedCoins.toFixed(2).toString() },
                    { 
                        key: translator("Total Order Value"), 
                        value: (unmatched * unmatchedCoins).toFixed(2).toString() 
                    }
                ]
            } else if (matched > 0 && unmatched == 0) {
                titleStr = titleStr + translator("Executed") + " ";
                info = translator("Visit Portfolio to track your trades");
                if (partiallyExecuted) {
                    info = translator("Visit Portfolio to track your trades") + translator(tradePriceMsg);
                }
                respData['redirect'] = translator("Portfolio");
            } else {

                if (isPriceNonEditableEvent || (!isPriceNonEditableEvent && data['ismarket'])) {
                    // metadata = [
                    //     { key: translator("Matched Qty x Price"), value: putStatus[0].calls[0]['noofcontracts'].toFixed(2).toString() + ` (${position_string})` + ' x ' + putStatus[0].calls[0]['coins'].toFixed(2).toString() },
                    //     { key: translator("Total Order Value"), value: (putStatus[0].calls[0]['noofcontracts'] * putStatus[0].calls[0]['coins']).toFixed(2).toString() },
                    //     { key: translator("Refunded"), value: "" }
                    // ];

                } else {
                    // metadata = [
                    //     { key: translator("Matched Qty x Price"), value: matched.toString() + ` (${position_string})` + ' x ' + matchedCoins.toString() },
                    //     { key: translator("Total Order Value"), value: parseFloat(matched * matchedCoins).toFixed(2).toString() },
                    //     { key: translator("Unmatched Qty"), value: unmatched },
                    //     { key: translator("Unmatched Order Value"), value: (unmatchedCoins * unmatched).toFixed(2).toString() }
                    // ];
                    metadata = metadata.concat([
                        { 
                            key: translator("Unmatched Qty"), 
                            value: unmatched,
                        },
                        { 
                            key: translator("Unmatched Order Value"), 
                            value: (unmatchedCoins * unmatched).toFixed(2).toString()
                        }
                    ])
                }
                titleStr = titleStr + translator("Partially Executed") + " ";
                info = translator("Your order has been executed partially. Visit Portfolio to track your unmatched trades");
                respData['redirect'] = translator("Portfolio");

            }
        }
        await updateUserRewardFlow(req.user);

        respData['metadata'] = metadata;
        respData['title'] = titleStr;
        respData['info'] = info;
        if (orderType === 'cancel' || orderType === 'cancelsell') {
            respData = { title: translator('Order Cancelled'), info: translator('Your order has been cancelled successfully'), metadata: {} };
        }

        /**
         * Check if First in first 10 minutes 
         */
        
        let show_promo_message = false;
        promo_message = {};
        // if(timeElapsed.minutes && timeElapsed.minutes < 11) {
        //     const isFirstTrade = await User.isFirstTrade(req?.user?.id);
        //     if(isFirstTrade) {
        //         show_promo_message = isFirstTrade;
        //         promo_message = {
        //             title: 'You have successfully placed your first trade',
        //             subtitle: ['Now do 2 more trades in next 30 minutes',  'and get 100 more tokens as reward']
        //         }
        //     }
        // }
        respData['promo_message'] = promo_message;
        respData['show_promo_message'] = show_promo_message;
        const finalResults = {
            success: true,
            call: Object.assign({ rank: -1, returns: 100 }, data),
            user: _userCoins,
            orderId: tradeOrderId,
            // calls: putStatus[0].calls,
            // msg: tradePriceMsg,
            // partiallyExecuted: partiallyExecuted,
            unmatched,
            matched,
            eventData: {
                title: _probeInfo?.[0]?.title,
                category: _probeInfo?.[0]?.category,
                subcategory: _probeInfo?.[0]?.subcategory,
                subsubcat: _probeInfo?.[0]?.subsubcat,
                hashtags: _probeInfo?.[0]?.hashtags,
            },
            respData
        };
        if(CONFIG.APIPARTNERUSERS.includes(req?.user?.id)) {
            orderDetails = orderDetails.map( i  => ({
                noofcontracts: i.noofcontracts,
                coins: i.coins,                    
                rank: i.rank,
                type: i.type,
                status: i.status,
                id: i.id
            }))
            finalResults.orderDetails = orderDetails;
        }
        
        
        return ReS(res, finalResults);;

    } catch (err) {
        redisCaching.delKey(reqKey);
        next(err);
    } finally {
        redisCaching.delKey(reqKey);
    }
}





const slippage_tracker_func = async (probeId, tradeAmount, orderType, userId, tradePrice) => {
    try {
        const amount = parseFloat(tradeAmount).toFixed(2);
        logger.info(`slippage logs parameters - probeid=${probeId}, amount = ${tradeAmount}, ordertype = ${orderType}, userid =${userId}, tradeprice = ${tradePrice}`);
        var statusToSearch;
        if (orderType === 'sell' || orderType === 'exit') {
            statusToSearch = 'EX';
        } else if (orderType === 'order' || orderType === 'Buy') {
            statusToSearch = 'A';
        }

        let err, _newData;
        [err, _newData] = await to(ProbeV2.getLatestProbeData(userId, probeId, statusToSearch));
        if (err) throw err;

        const dataFromProbeCalls = _newData[0];
        let slippage_percentage = Math.abs(((tradePrice - dataFromProbeCalls.coins) / tradePrice) * 100);
        slippage_percentage = parseFloat(slippage_percentage).toFixed(2);
        const dataToAdd = Object.assign({
            "userid": userId,
            "probeid": probeId,
            "execution_price": dataFromProbeCalls.coins,
            "display_price": tradePrice,
            "total_trade_amt": tradeAmount,
            "no_of_shares": dataFromProbeCalls.noofcontracts,
            "slippage_percentage": slippage_percentage
        });
        logger.info(`data into table - ${JSON.stringify(dataToAdd)}`);
        let _userCoins;
        [err, _userCoins] = await to(ProbeV2.addToSlippageTracker(dataToAdd));
        if (err) throw err;

    } catch (e) {
        logger.error(`could not update slippage_tracker table: ${e.message}`);
        throw e;
    }
}


const updatePrice = async (eventId, schema = 'public') => {
    try {
        let _yCalls = [], _nCalls = [];
        let yCP = 50, nCP = 50, newYCP, newNCP, portfolioNCP, portfolioYCP;
        let [err, resObj] = await to(Probe.getProbeById(eventId, ['totalamount',
            'is_price_editable', 'is_variable_liquidity_pool'], schema));
        if (err) throw err;

        // do we really need this?
        if (!resObj || !resObj.totalamount) {
            return;
        }

        const maxReturn = parseFloat((resObj.totalamount).toFixed(2));

        // [err, _yCalls] = await to(ProbeV2.getProbeCallsOpen2({ probeid: eventId, callvalue: 'Y', userid: -1 }, maxReturn));
        // if (err) throw err;
        // [err, _nCalls] = await to(ProbeV2.getProbeCallsOpen2({ probeid: eventId, callvalue: 'N', userid: -1 }, maxReturn));
        // if (err) throw err;



        if (resObj && resObj['is_price_editable'] === true) {
            // let cdpArr = getCDP(lodash.cloneDeep(_yCalls), lodash.cloneDeep(_nCalls), maxReturn);

            // yCP = cdpArr[0];
            // nCP = cdpArr[1];
            // if (maxReturn > 1) {
            //     yCP = Math.min(yCP, 99);
            //     nCP = Math.min(nCP, 99);
            // } else {
            //     yCP = parseFloat((Math.min(yCP + 0.01, 0.99)).toFixed(2));
            //     nCP = parseFloat((Math.min(nCP + 0.01, 0.99)).toFixed(2));
            // }
            const d = new Date().valueOf();
            console.time(`CDA Current Price PutCall ${d}`)
            const [err, resp] = await to(ProbeV2.getCDABestPrice(eventId, schema));
            if (err) throw err;
            yCP = resp?.[0]?.yCP ?? 50;
            nCP = resp?.[0]?.nCP ?? 50;

            newYCP = resp?.[0]?.newYCP ?? null;
            newNCP = resp?.[0]?.newNCP ?? null;
            portfolioNCP = resp?.[0]?.portfolioNCP ?? null;
            portfolioYCP = resp?.[0]?.portfolioYCP ?? null;
            console.timeEnd(`CDA Current Price PutCall ${d}`)
        } else if (resObj['is_variable_liquidity_pool'] === false) {
            let px = await getTruePrices(eventId);
            yCP = px['yPrice'];
            nCP = px['nPrice'];
        } else {
            let px = await getCurrentLiquidityData(eventId, false, schema);
            yCP = px.priceYes;
            nCP = px.priceNo;
            newYCP = yCP;
            newNCP = nCP;
        }
        await redisCaching.setHMKey( eventId, 'eventCpMap', JSON.stringify({ 'currentPrice': { yCP, nCP, newYCP, newNCP, portfolioNCP, portfolioYCP } }) );

        // const isEntryPresent = await CurrentPrice.doesCurrentPriceExist(eventId);
        // if (isEntryPresent === true)
        // await CurrentPrice.updateLatestCpYes({ eventId: eventId, latest_cp_yes: yCP });
    } catch (e) {
        logger.error(e);
        logger.error(`could not update current price Reason: ${e.message}`);
    }
}

const getExitPositions = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');

    try {
        var err, userCall, callRows, maxReturn, userId = req.user.id;
        let { eventid, callvalue } = req.body;
        let respObj = {};
        let yCP, nCP, newNCP, newYCP;
        const CPexistsInCache = await redisCaching.doesKeyExistinHM(eventid, 'eventCpMap');
        // var data = Object.assign({}, req.body, { 'probeid': eventid, orderid: orderid, userid: userId });
        // [err, userCall] = await to(ProbeV2.getUserCall(data));
        // if (err) throw err;
        // let dataObj = userCall[0];
        // if (!dataObj) {
        //     return ReS(res, {
        //         success: true
        //     });
        // }
        // [err, callRows] = await to(ProbeV2.getBestExitOptions(dataObj));
        // if (err) throw err;

        let _schema = 'public';
        if (req?.domain) {
            _schema = req?.domain;
        }

        [err, maxReturn] = await to(Probe.getProbeById(eventid, ['totalamount'], true, _schema));
        if (err) throw err;
        maxReturn = parseFloat(parseFloat((maxReturn.totalamount).toString()).toFixed(2));

        // if (callRows.length !== 0)
        //     respObj = callRows[0];
        // else
        //     respObj = {
        //         probeid: eventid,
        //         coins: parseFloat(parseFloat((maxReturn / 2).toString()).toFixed(2)),
        //         callvalue: dataObj['callvalue'],
        //         noofcontracts: 1,
        //         status: 'A',
        //     };

        // for (let i = 1; i < callRows.length; i++)
        //     respObj.noofcontracts += callRows[i].noofcontracts;

        if (CPexistsInCache) {
            let cachedObj = await redisCaching.getHMKey(eventid, 'eventCpMap');
            cachedObj = JSON.parse(cachedObj);
            if (!cachedObj['currentPrice'] || !cachedObj['currentPrice']['yCP'] || !cachedObj['currentPrice']['nCP']) {
                yCP = parseFloat(parseFloat((maxReturn / 2).toString()).toFixed(2));
                nCP = parseFloat(parseFloat((maxReturn / 2).toString()).toFixed(2))
            } else {
                yCP = cachedObj.currentPrice.yCP;
                nCP = cachedObj.currentPrice.nCP;
            }
            newYCP = cachedObj?.currentPrice?.newYCP ?? null;
            newNCP = cachedObj?.currentPrice?.newNCP ?? null;
                   
        } else {
            // let _yCalls, _nCalls;
            // [err, _yCalls] = await to(ProbeV2.getProbeCallsOpen2({ probeid: eventid, callvalue: 'Y', userid: -1 }, maxReturn));
            // if (err) throw err;
            // [err, _nCalls] = await to(ProbeV2.getProbeCallsOpen2({ probeid: eventid, callvalue: 'N', userid: -1 }, maxReturn));
            // if (err) throw err;
            const d = new Date().valueOf();
            console.time(`CDA Current get Exit Positions ${d}`)
            const [err, resp] = await to(ProbeV2.getCDABestPrice(eventid, true, _schema));
            if (err) throw err;
            yCP = resp?.[0]?.yCP ?? 50;
            nCP = resp?.[0]?.nCP ?? 50;
            newYCP = resp?.[0]?.newYCP ?? null;
            newNCP = resp?.[0]?.newNCP ?? null;
            console.timeEnd(`CDA Current get Exit Positions ${d}`)
            // let cdpArr = getCDP(lodash.cloneDeep(_yCalls), lodash.cloneDeep(_nCalls), maxReturn);
            // yCP = cdpArr[0], nCP = cdpArr[1];
            await redisCaching.setHMKey(eventid, 'eventCpMap', JSON.stringify({ 'currentPrice': { yCP, nCP, newNCP, newYCP } }));
        }

        if (callvalue == 'Y') respObj['coins'] = maxReturn - parseFloat(nCP.toFixed(2));
        else respObj['coins'] = maxReturn - parseFloat(yCP.toFixed(2));

        // decrement coins by one(0.1 in case of 0-1 scale) when user wants to sell
        // Not Required as we have udpated current price logic to sum upto to hundred

        // if (maxReturn === 100 && respObj['coins'] >= 2) {
        //     respObj['coins'] = parseFloat((respObj['coins'] - 1).toFixed(2));
        // } else if (maxReturn === 1 && respObj['coins'] >= 0.02) {
        //     respObj['coins'] = parseFloat((respObj['coins'] - 0.01).toFixed(2));
        // }
        return ReS(res, {
            success: true, exitOption: respObj
        });

    } catch (err) {
        next(err);
    }
}


const makeExit = async (req, res, next) => {
    if (!req || !req.body || !req.body.callvalue) {
        return ReS(res, { success: true, status: 'ERROR', message: messages.TRADING_NOT_ALLOWED });
    }
    var err, userCall, callRows, userId = req.user.id;
    let { eventid, orderid } = req.body;
    var data = Object.assign({}, req.body, { 'probeid': eventid, orderid: orderid, userid: userId });

    // [err, userCall] = await to(ProbeV2.getUserCall(data));
    // if (err) throw err;

    // let dataObj = userCall[0];

    // [err, callRows] = await to(ProbeV2.getBestExitOptions(dataObj));
    // if (err) throw err;

    // let dataObjCR = callRows[0];

    // if (!dataObjCR) {
    //     // return ReS(res, {
    //     //     success: true, message: 'Position not available'
    //     // });
    // }
    // if (err) throw err;
    req.body.ordertype = 'exit';
    // req.body.openCallToSwap = dataObjCR;
    // req.body.callvalue = dataObj.callvalue;
    // req.body.lastprice = dataObj.coins;
    next();
}
const callSell = async (req, res, next) => {
    if (!req || !req.body || !req.body.callvalue) {
        return ReS(res, { success: true, status: 'ERROR', message: messages.TRADING_NOT_ALLOWED });
    }
    req.body.ordertype = 'sell';
    next();
}
const cancelOnHold = async (req, res, next) => {
    req.body.ordertype = 'cancelsell';
    next();
}

const cancelOrder = async (req, res, next) => {
    req.body.ordertype = 'cancel';
    // req.body.ordertype = 'exit';
    next();
}

const takePositionsFromDashboard = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    try {
        if (!isDashboardUser(req)) {
            res.writeStatus("401");
            return ReS(res, {
                success: true, msg: 'Unauthorized request, incident has been reported'
            });
        }
        if (!req.body.probeid) {
            return ReE(res, 'Bad Request, missing attribute : probeid', 400);
        }
        let putCallData = req.body.data, internalUserData = [];
        if (putCallData && Array.isArray(putCallData) && putCallData.length > 0) {
            let userIds = [], err;
            for (const userData of putCallData) {
                userIds.push(userData.userid);
            }
            [err, internalUserData] = await to(Probe.getInternalTestUser(userIds));
            if (err)
                throw err;
            userIds = [];
            internalUserData.forEach(userData => {
                userIds.push(userData.userid);
            });
            const putCallRequestData = putCallData.filter((dataChunk) => {
                if (userIds.includes(dataChunk.userid)) {
                    return {
                        userid: dataChunk.userid,
                        coins: dataChunk.coins,
                        noofcontracts: dataChunk.noofcontracts,
                        callvalue: dataChunk.callvalue
                    }
                }
                return false;
            });
            const probeId = req.body.probeid;
            // necessary to avoid headers already sent error
            const mockResponse = {
                setHeader: () => { },
                send: () => { },
                json: () => { }
            };
            for (const reqData of putCallRequestData) {
                req.user = { id: process.env.NODE_ENV === 'production' ? 31038 : 89 };
                reqData['probeid'] = probeId;
                req.body = reqData;
                try {
                    await putCall(req, mockResponse, next);
                } catch (e) {
                    logger.error(`error occurred while taking position(from dashboard) on event id: ${reqData.probeid} by user id: ${req.user.id} `);
                }
            }

        } else {
            return ReE(res, 'Bad Request', 400);
        }
        return ReS(res, {});
    } catch (error) {
        next(error);
    }
}

const mergeYesNoTokens = async (req, res, next) => {
    let startTime = Date.now();
    if (req.baseUrl.includes('v1')) {
        return ReE(res, messages.TRADING_NOT_ALLOWED, 405);
    }
    const _user = req.user;
    const userId = req.user.id;

    const probeId = req.body.probeid;
    let data = Object.assign({}, req.body, { userid: userId });
    let reqKey = `put_call_req_${userId}_${probeId}`;
    let shares = req.body.shares;

    if ( CONFIG.KOSTAR_BLOCKED_USERS.includes(userId) ) {
        return ReE(res, "User not allowed to Trade.", 400);
    }

    let _schema = 'public';
    if (data?.domain) {
        _schema = data?.domain;
    }
    const region = req.user.region || 'INDIA';
    try {
        const isADashboardUser = isDashboardUser(req);
        const isInternalUser = await isAnInternalUser(req);
        let [err, _probesObject] = await to(Probe.getProbes({
            region,
            'probeid': data['probeid'],
            partnerId: req?.user?.partner?.id ?? 1,
            'isDashboardUser': isADashboardUser,
            'isInternalTestUser': isInternalUser
        }, 1000, _schema));
        let probeInfo = _probesObject.rows;

        const isExemptedUser = isExemptUser(userId);
        if (probeInfo[0]['status'] === 'H' && !isExemptedUser) {
            let message = messages.MARKET_CLOSED_HALTED;
            return ReS(res, { status: 'ERROR', message });
        }
        const probeCalls = await ProbeCalls.getAllActiveProbes({ probeid: probeId, userid: userId }, _schema);
        let totalYesContracts = 0;
        let totalNoContracts = 0;
        for (let calls of probeCalls) {
            if (calls['callvalue'] === 'Y') {
                totalYesContracts = totalYesContracts + calls['noofcontracts'];
            } else {
                totalNoContracts = totalNoContracts + calls['noofcontracts'];
            }
        }

        if (data['mmrequest']) {
            shares = Math.min(totalYesContracts, totalNoContracts);
            data['shares'] = shares;
        }

        logger.info(`merege request shares: ${shares}, userId: ${userId}`)

        if (shares === undefined || shares === null || shares === 0) {
            return ReE(res, `Shares should not be empty`, 400);
        }
        // const isPriceNonEditableEvent = !probeInfo[0]['is_price_editable'];
        // if (!isPriceNonEditableEvent) {
        //     return ReE(res, `Merge Yes and No tokes is allowed only on Instant Match Events`, 400);
        // }
        await redisCaching.setKey(reqKey, true, 60);
        // let fcmToken;
        // [err, fcmToken] = await to(User.findFCMTokenByUserId(userId));
        // if (err) throw err;


        if (totalYesContracts === 0) {
            redisCaching.delKey(reqKey);
            return ReE(res, `Cannot merge the tokens as user does not possess yes tokens`, 400);
        } else if (totalNoContracts === 0) {
            redisCaching.delKey(reqKey);
            return ReE(res, `Cannot merge the tokens as user does not possess no tokens`, 400);
        }
        if (shares > totalYesContracts) {
            return ReE(res, `Cannot merge ${shares} shares, not enough of yes tokens`, 400);
        } else if (shares > totalNoContracts) {
            return ReE(res, `Cannot merge ${shares} shares, not enough of no tokens`, 400);
        }
        const eventTitle = probeInfo[0].title || ' Title';

        let requestParameters = {};
        requestParameters.probeId = data['probeid'];
        requestParameters.userId = userId;
        requestParameters.merge_shares = data['shares'];
        requestParameters.maxReturn = probeInfo[0].totalamount
        requestParameters.probeTitle = eventTitle;

        const requestId = uuid();

        let finalResp;
        if (probeInfo[0]['is_price_editable']) {
            // if (CONFIG.MMIDs.indexOf(userId) !== -1) {
            finalResp = await mergeTokensCDA(requestParameters, requestId);
            // }
        } else {
            finalResp = await mergeTokens(requestParameters, requestId, _schema);
        }
        // await updateBonusCredits(userId, data['probeid'], 'merge');

        let partnerData = {
            isPriceNonEditableEvent: probeInfo[0]['is_price_editable'],
            userData: _user,
            data: data,
            partner: req.partner,
            region: region,
            eventData: probeInfo[0]
        }
        await loadToPartnerUserWallet(partnerData);

        redisCaching.delKey(reqKey);
        return ReS(res, Object.assign({}, finalResp, { success: true }));
    } catch (err) {
        redisCaching.delKey(reqKey);
        next(err);
    } finally {
        await redisCaching.delKey(reqKey);
    }
}

const mergeYesNoTokensNumbers = async (req, res, next) => {
    const _user = req.user;
    const userId = req.user.id;
    const probeId = req.body.probeid;
    let data = Object.assign({}, req.body, { userid: userId });
    const shares = req.body.shares;

    let _schema = 'public';
    if (data?.domain) {
        _schema = data?.domain;
    }

    try {
        const isADashboardUser = isDashboardUser(req);
        const isInternalUser = await isAnInternalUser(req);
        let [err, _probesObject] = await to(Probe.getProbes({
            region: req?.user?.region,
            'probeid': data['probeid'],
            partnerId: req?.user?.partner?.id ?? 1,
            'isDashboardUser': isADashboardUser,
            'isInternalTestUser': isInternalUser
        }, 1000, _schema));
        let probeInfo = _probesObject.rows;

        const isExemptedUser = isExemptUser(userId);
        if (probeInfo[0]['status'] === 'H' && !isExemptedUser) {
            let message = messages.MARKET_CLOSED_HALTED;
            return ReS(res, { status: 'ERROR', message });
        }
        if (shares === undefined || shares === null || shares === 0) {
            return ReE(res, `Shares should not be empty`, 400);
        }
        // const isPriceNonEditableEvent = !probeInfo[0]['is_price_editable'];
        // if (!isPriceNonEditableEvent) {
        //     return ReE(res, `Merge Yes and No tokes is allowed only on Instant Match Events`, 400);
        // }

        // let fcmToken;
        // [err, fcmToken] = await to(User.findFCMTokenByUserId(userId));
        // if (err) throw err;

        const probeCalls = await ProbeCalls.getAllActiveProbes({ probeid: probeId, userid: userId }, _schema);
        let totalYesContracts = 0;
        let totalNoContracts = 0;
        for (let calls of probeCalls) {
            if (calls['callvalue'] === 'Y') {
                totalYesContracts += calls['noofcontracts'];
            } else {
                totalNoContracts += calls['noofcontracts'];
            }
        }
        if (totalYesContracts === 0) {
            return ReE(res, `Cannot merge the tokens as user does not possess yes tokens`, 400);
        } else if (totalNoContracts === 0) {
            return ReE(res, `Cannot merge the tokens as user does not possess no tokens`, 400);
        }
        if (shares > totalYesContracts) {
            return ReE(res, `Cannot merge ${shares} shares, not enough of yes tokens`, 400);
        } else if (shares > totalNoContracts) {
            return ReE(res, `Cannot merge ${shares} shares, not enough of no tokens`, 400);
        }
        let takeAmount = 0;
        if (_schema === 'public') {
            takeAmount = parseFloat((shares * probeInfo[0]['totalamount'] * CONFIG.takeRatePercentage) / 100).toFixed(2);
        }
        let resp = {
            totalYesContracts: totalYesContracts,
            totalNoContracts: totalNoContracts,
            perContractTotalPrice: probeInfo[0]['totalamount'],
            totalAmount: shares * probeInfo[0]['totalamount'],
            remainingYesContracts: totalYesContracts - shares,
            remainingNoContracts: totalNoContracts - shares,
            trading_fee: isExemptedUser ? 0.00 : parseFloat(takeAmount)
        }
        return ReS(res, Object.assign({}, resp, { success: true }));
    } catch (err) {
        next(err);
    }
}
const updateEventsStatus = async function (req, res, next) {
    try {
        const isADashboardUser = isDashboardUser(req);
        if (!isADashboardUser) {
            return ReE(res, 'INVALID_REQUEST', 405);
        }
        let data = Object.assign({}, req.body);
        var eventids = data['eventids'];
        const status = data['status'];
        logger.info(`Updating Probeids: ${JSON.stringify(eventids)} to Status ${status}`);
        const [err, _] = await to(Probe.updateEventsStatus(eventids, status));
        if (err) throw err;
        return ReS(res, {
            success: true
        });
    } catch (e) {
        next(e);
    }
}

module.exports.putCall = putCall;
module.exports.getExitPositions = getExitPositions;
module.exports.makeExit = makeExit;
module.exports.callSell = callSell;
module.exports.cancelOrder = cancelOrder;
module.exports.cancelOnHold = cancelOnHold;
module.exports.takePositionsFromDashboard = takePositionsFromDashboard;
module.exports.mergeYesNoTokens = mergeYesNoTokens;
module.exports.mergeYesNoTokensNumbers = mergeYesNoTokensNumbers;
module.exports.updatePrice = updatePrice;
module.exports.updateEventsStatus = updateEventsStatus;
