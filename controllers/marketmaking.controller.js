const { ReE, waitTimer, to, ReS } = require("../services/util.service");
const { messages } = require("../messages/messages");
const { redisCaching } = require("../services/cache.service");
const { isDashboardUser } = require("../middleware/dashboard.user");
const logger = require("../services/logger.service");
const { User, Probe, ProbeV2 } = require("../models");
const CONFIG = require("../config/config");
const moment = require("moment");
const ProbeCalls = require("../models/probecalls");
const ProbeCallsOpen = require("../models/probecallsopen");
const { getOpenCallsCachingKey } = require("../utils/constants");
const zmqService = require("../services/zmq.service");
const EventController = require("./events.controller");
const { promisify } = require("util");
const lock = promisify(require("redis-lock")(redisCaching.client));
const axios = require('axios');

const EXCLUDE_LIST_INTERNAL_USERS = [
    122426, 31038, 193297, 433061, 29645, 603727, 396569, 1970715,
];

const putCallbulk = async function (req, res, next) {
    res.setHeader("Content-Type", "application/json");
    if (req.baseUrl.includes("v1")) {
        return ReE(res, messages.TRADING_NOT_ALLOWED, 405);
    }

    let startTime = Date.now();
    const requestDateTime = new Date(Date.now())
        .toISOString()
        .replace("T", " ")
        .replace("Z", "");
    var _user = req.user,
        userId;
    if (_user) {
        userId = req.user.id;
    } else {
        userId = req.body.userId;
        _user = { id: userId };
    }
    var fillopenpos = false,
        _probeInfo,
        _userCoins,
        putStatus,
        _probesObject;

    if (!req.body.probeid) {
        return ReE(res, messages.UNAUTHORIZED_REQUEST, 400);
    }
    let reqKey = `put_call_req_${userId}_${req.body.probeid}`;
    let orderType = req.body.ordertype || "order";
    delete req.body.ordertype;

    try {
        if (CONFIG.MMIDs.indexOf(userId) === -1) {
            let isReqInProgress = await redisCaching.getKey(reqKey);
            if (isReqInProgress) {
                return ReE(res, messages.REQUEST_IN_PROGRESS, 423);
            }
            await redisCaching.setKey(reqKey, true, 60);
        }

        // do {
        //     await waitTimer(100)
        // } while (!!(await redisCaching.getKey(`put_redeem_req_${userId}`)));

        const isADashboardUser = isDashboardUser(req);
        // if (!isADashboardUser && isForceUpdate(Object.assign({}, req, { query: { app_version: req.body.appVersion } }))) {
        //     socketService.sendForceUpdateUser(userId).catch(() => logger.error("While broadcasting force update socket event"));
        //     return ReE(res, messages.TRADING_NOT_ALLOWED, 405);
        // }
        // const isUserBlocked = await User.isUserBlocked(userId);
        // if (isUserBlocked) {
        //     return ReE(res, messages.USER_BLOCKED, 500);
        // }
        // const timeCheck = await isUserSuspended(userId);
        // if (timeCheck.suspended) {
        //     return ReE(res, messages.USER_SUSPENDED, 500);
        // }

        let err, fcmToken;
        // [err, fcmToken] = await to(User.findFCMTokenByUserId(userId));
        if (err) throw err;
        let { ptype, openCallToSwap, ...data } = Object.assign({}, req.body, {
            userid: userId,
        });
        if (!ptype) {
            ptype = "bet";
        }
        if (typeof data["islimit"] !== "undefined") {
            data["ismarket"] = !data["islimit"];
        }
        let isMarketOrder = data["ismarket"];
        if (isMarketOrder) {
            return ReE(res, `Market bulk order is not allowed`, 400);
        }
        if (orderType === "sell" || orderType === "exit") {
            return ReE(res, `Sell, Exit bulk order is not allowed`, 400);
        }
        let totalOrders = 0;
        /*Do not Delete. Might be needed in future
        const isUserAllowed = await User.isUserAllowed(userId);
        if (!isUserAllowed) {
            return ReE(res, messages.TRADING_BLOCKED_USER, 400);
        }
        */

        // let takeRate = isFirstPosition ? 0.0 : 0.0025;
        let takeRate = 0.0025;
        let takeAmount = 0.0;

        // const isInternalUser = await isAnInternalUser(req);
        const probeId = parseInt(data["probeid"]);
        if (isNaN(probeId)) {
            return ReE(res, messages.INVALID_REQUEST, 400);
        }
        data["probeid"] = probeId;

        if (ptype === "bet") {
            [err, _probesObject] = await to(
                Probe.getProbes({
                    partnerId: req?.user?.partner?.id ?? 1,
                    probeid: data["probeid"],
                    isDashboardUser: isADashboardUser,
                    isInternalTestUser: false,
                }),
            );
            if (err) throw err;
            if (orderType === "order") {
                for (const trades of data["bulk_trade"]) {
                    if (trades["callvalue"]) {
                        if (
                            !((trades["callvalue"] === "Y") | (trades["callvalue"] === "N"))
                        ) {
                            return ReE(res, messages.INVALID_REQUEST, 400);
                        }
                    }
                }
            }
            if (_probesObject.rows.length === 0) {
                return ReS(res, {
                    status: "ERROR",
                    message: messages.MARKET_CLOSED_BUY,
                });
            }
            _probeInfo = _probesObject.rows;
            if (
                _probeInfo &&
                _probeInfo[0] &&
                _probeInfo[0].is_private &&
                orderType === "order" &&
                !EXCLUDE_LIST_INTERNAL_USERS.includes(userId)
            ) {
                const isUserEligible = await Probe.isUserExistInCustomPrivateEventUsers(
                    userId,
                    data["probeid"],
                );
                if (!isUserEligible) {
                    // Not eligible to buy on this event
                    return ReE(res, messages.NOT_ELIGIBLE_TO_BUY, 405);
                }
                let tradedPrivateEvents =
                    await Probe.getUserPrivateEventProbeCalls(userId);
                const alreadyTradedPrivateEventIds = tradedPrivateEvents.map(
                    function (e) {
                        return e.probeid;
                    },
                );
                if (alreadyTradedPrivateEventIds.includes(probeId)) {
                    return ReE(res, messages.GPE_CAN_ONLY_BUY_ONCE, 405);
                }
                let userCustomPrivateEvents =
                    await Probe.getUserCustomPrivateEvents(userId);
                const userCustomPrivateEventIds = userCustomPrivateEvents.map(
                    function (e) {
                        return e.probeid;
                    },
                );
                if (
                    !userCustomPrivateEventIds.includes(probeId) &&
                    alreadyTradedPrivateEventIds.length >=
                    CONFIG.MAX_ALLOWED_PRIVATE_EVENTS_COUNT
                ) {
                    return ReE(res, messages.MAX_ALLOWED_GPE_REACHED, 405);
                }
            }
        }

        /* Update preference for the current user */
        // if (orderType === 'order')
        //     putCategoryPreference(_probeInfo[0], userId);

        if (
            !_probeInfo ||
            !_probeInfo[0] ||
            !_probeInfo[0].endsat ||
            _probeInfo[0].status !== "A" ||
            moment(_probeInfo[0].endsat).isBefore(moment())
        ) {
            await redisCaching.delKey(reqKey);
            let message =
                ptype === "bet"
                    ? messages.MARKET_CLOSED_BUY
                    : messages.TOURNAMENT_CLOSED;
            if (orderType === "cancel" || orderType === "cancelsell") {
                message = messages.MARKET_CLOSED_CANCEL;
            } else if (orderType === "sell" || orderType === "exit") {
                message = messages.MARKET_CLOSED_SELL;
            }
            return ReS(res, { status: "ERROR", message });
        }

        //Do not allow to take action on parent event
        if (_probeInfo[0].parent_id && [-1, -2].includes(_probeInfo[0].parent_id)) {
            return ReE(res, `Unfortunately, this operation is forbidden.`, 400);
        }

        const maxReturns = _probeInfo[0]["totalamount"];
        const mincoins = (1 * maxReturns) / 100;
        const maxcoins = (99 * maxReturns) / 100;
        const liquidityFeeFactor = _probeInfo[0]?.liquidity_fee_factor;
        const isPriceNonEditableEvent = !_probeInfo[0]["is_price_editable"];
        const isVariableLiquidityPool = _probeInfo[0]["is_variable_liquidity_pool"];
        const maxAllowedPosition =
            _probeInfo[0]["max_allowed_position"] ||
            (isPriceNonEditableEvent
                ? CONFIG.INSTANT_MATCH_POSITION_MAX_ALLOWED
                : CONFIG.CDA_POSITION_MAX_ALLOWED);

        if (!isPriceNonEditableEvent && ptype === "bet" && orderType === "order") {
            for (const trades of data["bulk_trade"]) {
                if (trades["noofcontracts"] && isNaN(Number(trades["noofcontracts"]))) {
                    return ReE(res, messages.INVALID_REQUEST, 400);
                }
                trades["noofcontracts"] = Math.floor(trades["noofcontracts"] || 1);
                if (
                    (orderType === "order" ||
                        orderType === "sell" ||
                        orderType === "exit") &&
                    parseFloat(trades["noofcontracts"]) !== trades["noofcontracts"]
                ) {
                    logger.info(
                        `invalid number of contracts for event: ${data["probeid"]}: ${trades["noofcontracts"]}, ${trades["noofcontracts"]}`,
                    );
                    return ReE(
                        res,
                        `Invalid Request. Fractional Buy/Sell of shares not allowed in this Market`,
                        400,
                    );
                }
                if (!isMarketOrder) {
                    for (const trades of data["bulk_trade"]) {
                        if (trades["coins"] % _probeInfo[0]["range"] > 0) {
                            return ReE(res, `Invalid Request. Price not in range`, 400);
                        }
                    }
                }
            }
        }

        // if (isPriceNonEditableEvent && isVariableLiquidityPool) {
        //     let currentData = await getCurrentLiquidityData(data['probeid'], true);
        //     if (currentData === null || currentData === {} || Object.keys(currentData).length === 0) {
        //         return ReE(res, `Liquidity does not exist for this event `, 400);
        //     }
        // }

        if (ptype === "bet" && orderType === "order") {
            for (const trades of data["bulk_trade"]) {
                const tokens = trades["coins"]
                    ? trades["coins"].toString().split(".")
                    : [];
                if (tokens.length === 2 && tokens[1].length > 2) {
                    return ReE(res, `Bad Request`, 400);
                }
                if (isNaN(Number(trades["coins"]))) {
                    return ReE(res, messages.INVALID_REQUEST, 400);
                }
                if (!isPriceNonEditableEvent) {
                    const maxContracts = parseInt(maxAllowedPosition / maxReturns);
                    if (
                        trades["coins"] < mincoins ||
                        trades["coins"] > maxcoins ||
                        trades["noofcontracts"] < 1
                    ) {
                        await redisCaching.delKey(reqKey);
                        return ReE(res, messages.INVALID_REQUEST, 400);
                    }
                    if (trades["coins"].toString().split(".").length > 1) {
                        await redisCaching.delKey(reqKey);
                        return ReE(res, `Fractional share price cannot be entered`, 400);
                    }
                }
            }
        }

        const _eventTitle = _probeInfo[0].title || " Title";

        if (_user["coinsd"] === undefined) {
            let [err, userData] = await to(User.findById(userId, false));
            if (err) {
                throw err;
            }
            _user["coinsd"] = userData["coinsd"] || 0;
            _user["coinsb"] = userData["coinsb"] || 0;
            _user["coinsw"] = userData["coinsw"] || 0;
        }
        let commissionFee = 0.0;

        let noOfContractsTobeCanceled = 0;
        if (ptype === "bet" && orderType === "order") {
            let netAmount = 0;
            if (isPriceNonEditableEvent) {
                return ReE(res, `Bulk buy on instant match is not allowed`, 500);
            } else {
                //CDA
                if (data["ismarket"] && orderType === "order") {
                    data["orderamount"] = parseFloat(data["orderamount"]);
                    if (isNaN(data["orderamount"])) {
                        return ReE(res, messages.INVALID_REQUEST, 400);
                    }
                }
                for (const trades of data["bulk_trade"]) {
                    netAmount = data["ismarket"]
                        ? parseFloat(data["orderamount"])
                        : parseFloat(
                            (trades["coins"] * trades["noofcontracts"]).toFixed(2),
                        );
                    if (!EXCLUDE_LIST_INTERNAL_USERS.includes(userId)) {
                        if (netAmount > maxAllowedPosition) {
                            return ReE(
                                res,
                                `Cannot purchase shares worth more than Rs. ${maxAllowedPosition} at a time`,
                                422,
                            );
                        }
                    }
                }
            }
            totalOrders = data["bulk_trade"].length;
            for (const trades of data["bulk_trade"]) {
                trades["coins"] = parseFloat(trades["coins"]);
                trades["noofcontracts"] = parseFloat(trades["noofcontracts"]);
                let oCoins = parseFloat(trades["coins"]);
                let nC0 = isMarketOrder
                    ? data["orderamount"] / oCoins
                    : trades["noofcontracts"];
                // takeAmount = takeAmount + await getTradingFee(orderType, trades['callvalue'], nC0, oCoins, data['probeid'], req?.user?.id, _probeInfo[0]['is_price_editable'], isMarketOrder)
                takeAmount = 0;
            }

            console.log(`trading fee: ${takeAmount}`);
            let totalAmount = netAmount + takeAmount;
            logger.info(
                `Trade Balance check: User ${userId}, ProbeID ${probeId}, netAmount ${totalAmount}, netAmount ${netAmount}, takeAmount ${takeAmount}, WalletBalance ${_user["coinsd"]} `,
            );
            if (_user["coinsd"] + _user["coinsw"] + _user["coinsb"] < totalAmount) {
                await redisCaching.delKey(reqKey);
                const requiredAmount = totalAmount - _user["coinsd"];
                return ReS(res, {
                    status: "ERROR",
                    message: messages.INSUFFICIENT_FUNDS,
                    required: Math.ceil(requiredAmount),
                });
            }

            delete data.ptype;
            // delete data.fillopenpos;
            delete data["bonuslimit"];

            redisCaching.setHMKey(userId, "callsMap", true);

            // await updateEventInfoInCache(data['probeid'], { updatedVolume: netAmount }, maxReturns);

            var _deductFrom = Object.assign({}, { coinsd: 0, coinsb: 0, coinsw: 0 });
            _deductFrom["coinsd"] = netAmount;
        }
        if (orderType === "sell" || orderType === "exit") {
            return ReE(res, `Bulk sell is not allowed`, 500);
        }

        if (orderType === "cancel") {
            totalOrders = data["bulk_cancel"].length;
            for (const trade of data["bulk_cancel"]) {
                const resultSet = await to(
                    ProbeCallsOpen.getOpenPositionByUserIdAndOrderId(userId, trade),
                );
                if (resultSet[0]) {
                    throw resultSet[0];
                }
                if (resultSet[1].length === 0) {
                    return ReE(res, messages.UNAUTHORIZED_REQUEST, 400);
                }
                try {
                    noOfContractsTobeCanceled =
                        noOfContractsTobeCanceled +
                        parseInt(resultSet[1][0]["noofcontracts"]);
                } catch (e) { }

                let netAmount =
                    resultSet[1][0]["coins"] * resultSet[1][0]["noofcontracts"];
                takeAmount = parseFloat((netAmount * takeRate).toFixed(2));
            }
        }
        if (orderType === "cancelsell") {
            totalOrders = data["bulk_cancel"].length;
            for (const trade of data["bulk_cancel"]) {
                const resultSet = await to(
                    ProbeCallsOpen.getOpenPositionByUserIdAndOrderId(userId, trade),
                );
                if (resultSet[0]) {
                    throw resultSet[0];
                }
                if (resultSet[1].length === 0) {
                    return ReE(res, messages.UNAUTHORIZED_REQUEST, 400);
                }
                try {
                    noOfContractsTobeCanceled =
                        noOfContractsTobeCanceled +
                        parseInt(resultSet[1][0]["noofcontracts"]);
                } catch (e) { }
            }
        }

        /* Removing current price for event after each putcall to calculate it again */
        let currentPriceObj = await redisCaching.getHMKey(
            data["probeid"],
            "eventCpMap",
        );
        if (currentPriceObj) {
            await redisCaching.setHMKey(
                data["probeid"],
                "eventLastCpMap",
                currentPriceObj,
            );
        }
        await redisCaching.delKey(
            getOpenCallsCachingKey(data["probeid"], "public"),
        );

        // if(orderType === 'order') {
        //     data['trade_initiated_price'] =  data['trade_initiated_price'] - 4
        // } else {
        //     data['trade_initiated_price'] =  data['trade_initiated_price'] + 4
        // }

        for (let i = 0; i < totalOrders; i++) {
            await redisCaching.setKey(`${reqKey}_${i + 1}`, true, 60);
        }

        switch (ptype) {
            case "bet":
                var msg = JSON.stringify({
                    action: "TRADE",
                    type: "ORDER",
                    userId: userId,
                    data: data,
                    range: _probeInfo[0]["range"],
                    deductAmt: _deductFrom,
                    takeAmount: takeAmount,
                    orderType: orderType,
                    // fcmToken: fcmToken,
                    openCallToSwap: openCallToSwap,
                    eventTitle: _eventTitle,
                    maxReturn: maxReturns,
                    liquidityFeeFactor,
                    isPriceNonEditableEvent,
                    isVariableLiquidityPool,
                    reqKey,
                    startTime,
                    url: req.url,
                    method: req.method,
                    // ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
                });
                logger.info(`Bulk API queue message: ${msg} `);
                zmqService.send(
                    msg,
                    isPriceNonEditableEvent,
                    isVariableLiquidityPool,
                    data["probeid"],
                    userId,
                );
                break;
        }

        do {
            await waitTimer(10);
            logger.info(`Request ${reqKey} is in processing`);
        } while (await checkAllKeys(reqKey, totalOrders));
        await redisCaching.delKey(reqKey);
        await redisCaching.delHMKey(data["probeid"], "eventCpMap");

        let unmatched = 0.0;
        let matched = 0.0;

        let callsQ = { userid: userId, eventid: data["probeid"] };
        [err, putStatus] = await to(ProbeV2.getMyBets(callsQ, false));
        // console.log("ERROR TRADE CHECK 1", err, JSON.stringify(putStatus))
        if (err) throw err;
        if (putStatus[0] == null) {
            // return ReS(res, { success: true, status: 'ERROR', message: messages.TAKING_TIME });
            return ReS(res, {
                success: false,
                status: "ERROR",
                message: messages.NO_MARKET_ORDER_PLACED,
                executed: false,
            });
        }

        [err, _userCoins] = await to(
            User.getEngagedCoins(Object.assign({}, { userid: userId })),
        );
        redisCaching.setHMKey(userId, "userWallet", JSON.stringify(_userCoins));
        if (err) throw err;

        await redisCaching.delKey(reqKey);

        unmatched = 0.0;
        var checkMatched = true;
        if (ptype === "bet" && orderType === "order") {
            for (const trades of data["bulk_trade"]) {
                const whereClause = `userid = ${userId} and probeid = ${data["probeid"]} and callvalue = '${trades["callvalue"]}' and createdat >= '${requestDateTime}'`;
                if (!isPriceNonEditableEvent && !data["ismarket"]) {
                    const putCallResultSet = await to(
                        ProbeCallsOpen.getOpenPositions(whereClause),
                    );
                    if (putCallResultSet[0]) throw putCallResultSet[0];
                    // matched = isPriceNonEditableEvent ? matched : parseFloat((data['noofcontracts'] - 0.0).toFixed(2));
                    if (
                        putCallResultSet &&
                        putCallResultSet[1] &&
                        putCallResultSet[1][0]
                    ) {
                        unmatched = parseFloat(
                            putCallResultSet[1][0].noofcontracts.toFixed(2),
                        );
                        // matched = parseFloat((data['noofcontracts'] - putCallResultSet[1][0].noofcontracts).toFixed(2));
                    }
                    if (unmatched == trades["noofcontracts"]) {
                        checkMatched = false;
                    }
                }
                if (checkMatched && ["order", "sell", "exit"].includes(orderType)) {
                    const whereStatus =
                        orderType == "order"
                            ? `${whereClause} and status = 'A'`
                            : `${whereClause} and status = 'EX'`;

                    const matchedRecordResultSet = await to(
                        ProbeCalls.getPositions(whereStatus),
                    );
                    // console.log("ERROR TRADE CHECK 2", whereStatus, err, JSON.stringify(matchedRecordResultSet))
                    if (
                        matchedRecordResultSet[0] ||
                        matchedRecordResultSet[1].length === 0
                    ) {
                        return ReS(res, {
                            success: false,
                            status: "ERROR",
                            message: messages.NO_MARKET_ORDER_PLACED,
                            executed: false,
                        });
                    } else {
                        matched = parseFloat(
                            matchedRecordResultSet[1][0].noofcontracts.toFixed(2),
                        );
                    }
                }
            }
        }

        if (ptype === "bet") {
            EventController.updatePrice(data["probeid"]);
        }

        let tradePriceMsg = false;
        let partiallyExecuted = false;
        [err, tradePriceMsg] = await to(
            redisCaching.getKey(
                "trade_partially_executed" + data["probeid"] + "_" + userId,
            ),
        );
        if (tradePriceMsg) {
            partiallyExecuted = true;
            logger.info("trade_partially_executed" + tradePriceMsg);
            redisCaching.delKey(
                "trade_partially_executed" + data["probeid"] + "_" + userId,
            );
        }

        let endTime = Date.now();
        let processTime = endTime - startTime;
        logger.info(`Trade Process time: ${processTime}`);
        return ReS(res, {
            success: true,
            call: Object.assign({ rank: -1, returns: 100 }, data),
            user: _userCoins,
            calls: putStatus[0].calls,
            msg: tradePriceMsg,
            partiallyExecuted: partiallyExecuted,
            unmatched,
            matched,
        });
    } catch (err) {
        redisCaching.delKey(reqKey);
        next(err);
    } finally {
        redisCaching.delKey(reqKey);
    }
};
const mmScriptStatusUpdate = async function (req, res, next) {
    let data = req.body;
    const probeId = data["probeid"];
    const status = data["status"];
    if (!status) {
        return ReE(res, messages.INVALID_REQUEST, 400);
    }
    [err, stratObj] = await to(Probe.getMMdata(probeId));
    if (err) throw err;
    if (!stratObj || !stratObj.length) {
        [err, updatedData] = await to(Probe.insertMMdata(data));
        if (err) throw err;
    } else {
        if (status == 'I') {
            data['mm_script_metadata'] = null
            if (stratObj[0].mm_script_metadata) {
                let URL = `https://api.mollybet.com/v1/sessions/${stratObj[0].mm_script_metadata}/`
                await axios.delete(URL, {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    data: {}
                });
            }
        }
        [err, updatedData] = await to(Probe.updateMMdata(probeId, data));
        if (err) throw err;
    }
    let mmUserCacheKey = `mmprobes`;
    await to(redisCaching.delKey(mmUserCacheKey));
    return ReS(res, {
        success: true,
        updatedData,
    });
};

const mmOddsOrder = async function (req, res, next) {
    let data = req.body;
    // const userId = 193297;
    // const userId = 146;
    const userId = data["userId"];
    const probeId = data["probe_id"];
    const odds = data["odds"];
    const amount = data["amount"];
    // const coins = data['odds']
    // const amount = data['amount']
    let coins = data["coins"];
    let noofcontracts = data["noofcontracts"];

    if (data["callvalue"] === "Y") {
        data["callvalue"] = "N";
    } else {
        data["callvalue"] = "Y";
    }

    // if (odds <= 1 || odds >= 100) {
    //     let response = { success: false, message: 'Odds should be between 1 and 100' }
    //     return ReS(res, response);
    // }

    const reqKey = `put_call_req_${userId}_${probeId}`;
    let startTime = Date.now();
    const requestDateTime = new Date(Date.now())
        .toISOString()
        .replace("T", " ")
        .replace("Z", "");
    logger.info(`Probeid : ${probeId}`);

    let isReqInProgress = await redisCaching.getKey(reqKey);
    if (isReqInProgress) {
        return ReE(res, messages.REQUEST_IN_PROGRESS, 423);
    }
    await redisCaching.setKey(reqKey, true, 60);

    let [er, probeObj] = await to(
        Probe.getProbes({
            partnerId: req?.user?.partner?.id ?? 1,
            probeid: probeId,
            isDashboardUser: false,
            isInternalTestUser: false,
        }),
    );
    let probe = probeObj.rows[0];
    logger.info(`Probeid : ${JSON.stringify(probe)}`);
    if (probe.parent_id === -1) {
        let response = { success: false, message: "Cannot trade on parent event" };
        await redisCaching.delKey(reqKey);
        return ReS(res, response);
    } else if (probe.parent_id === 0) {
        // coins = 100 - (100 / odds);
    } else {
        let [er, parentProbe] = await to(
            Probe.getProbeById(probe.parent_id, ["title", "parent_id"]),
        );
        if (parentProbe.title.toLowerCase().indexOf("outcome") > -1) {
            if (data["callvalue"] === "N") {
                // coins = 100 - (100 / odds);
            } else {
                // coins = 100 / odds;
            }
        } else {
            // coins = 100 - (100 / odds);
        }
    }
    coins = Math.floor(coins);
    // let noofcontracts = Math.floor(amount / coins);
    logger.info(`TestMMOrder: coins ${coins}`);
    logger.info(`TestMMOrder: shares ${shares}`);

    let dataP = {
        callvalue: data["callvalue"],
        coins: coins,
        noofcontracts: noofcontracts,
        probeid: probeId,
        userid: userId,
        ptype: "bet",
        tradeType: "Buy",
        preventSlippage: false,
        islimit: true,
    };
    logger.info(`TestMMOrder: data ${JSON.stringify(dataP)}`);

    let resp = await mmCancelOrderAbstraction(
        probeId,
        userId,
        callValue,
        data,
        req.url,
        req.method,
        req.headers["x-forwarded-for"],
    );

    var msg = JSON.stringify({
        action: "TRADE",
        type: "ORDER",
        userId: userId,
        data: dataP,
        range: probe["range"],
        orderType: "order",
        eventTitle: probe.title,
        maxReturn: 100,
        isPriceNonEditableEvent: probe.isPriceNonEditableEvent,
        isVariableLiquidityPool: probe.isVariableLiquidityPool,
        reqKey,
        startTime,
        url: req.url,
        method: req.method,
        ip: req.headers["x-forwarded-for"],
    });
    logger.info(`Trade Payload: ${msg} `);
    zmqService.send(
        msg,
        probe.isPriceNonEditableEvent,
        probe.isVariableLiquidityPool,
        probeId,
        userId,
    );

    await waitTimer(100);
    while (!!(await redisCaching.getKey(reqKey))) {
        await waitTimer(100);
        logger.info(`Request ${reqKey} is in processing`);
    }
    await redisCaching.delKey(getOpenCallsCachingKey(probeId, "public"));
    await redisCaching.delHMKey("" + probeId, "eventCpMap");

    let callsQ = { userid: userId, eventid: probeId };
    let [err, putStatus] = await to(ProbeV2.getMyBets(callsQ, false));

    let [e, _userCoins] = await to(
        User.getEngagedCoins(Object.assign({}, { userid: userId })),
    );
    redisCaching.setHMKey(userId, "userWallet", JSON.stringify(_userCoins));

    if (err) throw err;
    let unmatched = 0.0;
    let matched = 0.0;
    var checkMatched = true;
    const whereClause = `userid = ${userId} and probeid = ${probeId} and callvalue = '${data["callvalue"]}' and createdat >= '${requestDateTime}'`;
    const putCallResultSet = await to(
        ProbeCallsOpen.getOpenPositions(whereClause),
    );
    if (putCallResultSet[0]) throw putCallResultSet[0];
    // matched = isPriceNonEditableEvent ? matched : parseFloat((data['noofcontracts'] - 0.0).toFixed(2));
    if (putCallResultSet && putCallResultSet[1] && putCallResultSet[1][0]) {
        unmatched = parseFloat(putCallResultSet[1][0].noofcontracts.toFixed(2));
        // matched = parseFloat((data['noofcontracts'] - putCallResultSet[1][0].noofcontracts).toFixed(2));
    }
    if (unmatched === shares) {
        checkMatched = false;
    }

    if (checkMatched) {
        const whereStatus = `${whereClause} and status = 'A'`;

        const matchedRecordResultSet = await to(
            ProbeCalls.getPositions(whereStatus),
        );
        // console.log("ERROR TRADE CHECK 2", whereStatus, err, JSON.stringify(matchedRecordResultSet))
        if (matchedRecordResultSet[0] || matchedRecordResultSet[1].length === 0) {
            await redisCaching.delKey(reqKey);
            return ReS(res, {
                success: false,
                status: "ERROR",
                message: messages.NO_MARKET_ORDER_PLACED,
                executed: false,
            });
        } else {
            matched = parseFloat(
                matchedRecordResultSet[1][0].noofcontracts.toFixed(2),
            );
        }
    }

    // EventController.updatePrice(probeId);

    let tradePriceMsg = false;
    let partiallyExecuted = false;
    [err, tradePriceMsg] = await to(
        redisCaching.getKey("trade_partially_executed" + probeId + "_" + userId),
    );
    if (tradePriceMsg) {
        partiallyExecuted = true;
        logger.info("trade_partially_executed" + tradePriceMsg);
        redisCaching.delKey("trade_partially_executed" + probeId + "_" + userId);
    }

    let endTime = Date.now();
    let processTime = endTime - startTime;
    logger.info(`Trade Process time: ${processTime}`);
    await redisCaching.delKey(reqKey);
    return ReS(res, {
        success: true,
        call: Object.assign({ rank: -1, returns: 100 }, data),
        user: _userCoins,
        calls: putStatus[0].calls,
        msg: tradePriceMsg,
        partiallyExecuted: partiallyExecuted,
        unmatched,
        matched,
    });
};

const mmCancelAll = async function (req, res, next) {
    let data = req.body;
    const callValue = data["callValue"];
    let cancelY = callValue == "Y" || !callValue;
    let cancelN = callValue == "N" || !callValue;

    const userId = data["userId"];
    const probeId = data["probe_id"];
    const reqKey = `put_call_req_${userId}_${probeId}`;
    let isReqInProgress = await redisCaching.getKey(reqKey);
    if (isReqInProgress) {
        return ReE(res, messages.REQUEST_IN_PROGRESS, 423);
    }
    await redisCaching.setKey(reqKey, true, 60);
    try {
        if (cancelY) {
            await mmCancelOrderAbstraction(
                probeId,
                userId,
                "Y",
                data,
                req.url,
                req.method,
                req.headers["x-forwarded-for"],
            );
        }
        if (cancelN) {
            await mmCancelOrderAbstraction(
                probeId,
                userId,
                "N",
                data,
                req.url,
                req.method,
                req.headers["x-forwarded-for"],
            );
        }
    } catch (e) {
        console.log(e);
        return ReE(res, e);
    }

    await redisCaching.delKey(reqKey);
    return ReS(res, {
        success: true,
    });
};

const mmHaltUnhalt = async function (req, res, next) {
    try {
        let data = Object.assign({}, req.body);
        var probeids = data.probeids;
        const matchkey = data.matchkey || "";
        const status = data.status;
        console.log(data);
        if (matchkey != "" && !probeids) {
            let probes = await Probe.getProbesByMatchKey(matchkey);
            probeids = probes.map((probe) => probe.id);
        }
        if (status == "H" && probeids.length) {
            logger.info(`haltProbes Probeids: ${JSON.stringify(probeids)}`);
            const [err, _] = await to(Probe.haltProbes(probeids));
            if (err) throw err;
        }
        if (status == "A" && probeids.length) {
            logger.info(`unhaltProbes Probeids: ${JSON.stringify(probeids)}`);
            const [err, _] = await to(Probe.unhaltProbes(probeids));
            if (err) throw err;
        }
        return ReS(res, {
            success: true,
        });
    } catch (e) {
        next(e);
    }
};

var mmCancelOrderAbstraction = async (
    probeId,
    userId,
    callValue,
    data,
    url,
    method,
    ip,
) => {
    let [er, probeObj] = await to(
        Probe.getProbes({
            probeid: probeId,
            isDashboardUser: false,
            isInternalTestUser: false,
        }),
    );
    let probe = probeObj.rows[0];
    const reqKey = `put_call_req_${userId}_${probeId}`;
    let startTime = Date.now();

    const resultSet = await to(
        ProbeCallsOpen.getAllOpenOrdersForUserByEventId(probeId, userId, callValue),
    );
    if (resultSet[0] || (resultSet[1] && resultSet[1].length == 0)) {
        return "No orders found";
    }
    const openOrders = resultSet[1];
    for (const openOrder of openOrders) {
        if (callValue !== openOrder.callvalue) {
            continue;
        }
        let dataP = {
            callvalue: openOrder.callvalue,
            coins: openOrder.coins,
            noofcontracts: openOrder.noofcontracts,
            probeid: probeId,
            orderid: openOrder.orderid,
            userid: userId,
        };
        var msg = JSON.stringify({
            action: "TRADE",
            type: "ORDER",
            userId: userId,
            data: dataP,
            orderType: "cancel",
            eventTitle: probe.title,
            maxReturn: 100,
            isPriceNonEditableEvent: probe.isPriceNonEditableEvent,
            isVariableLiquidityPool: probe.isVariableLiquidityPool,
            reqKey,
            startTime,
            url: url,
            method: method,
            ip: ip,
        });
        logger.info(`Trade Payload: ${msg} `);
        zmqService.send(
            msg,
            probe.isPriceNonEditableEvent,
            probe.isVariableLiquidityPool,
            probeId,
            userId,
        );

        await waitTimer(100);
        while (!!(await redisCaching.getKey(reqKey))) {
            await waitTimer(100);
            logger.info(`Request ${reqKey} is in processing`);
        }
        await redisCaching.delHMKey("" + probeId, "eventCpMap");
        await redisCaching.delKey(getOpenCallsCachingKey(probeId, "public"));

        EventController.updatePrice(probeId);
        // let [e, _userCoins] = await to(User.getEngagedCoins(Object.assign({}, { 'userid': userId })));
        // redisCaching.setHMKey(userId, 'userWallet', JSON.stringify(_userCoins));
    }
};

const mmDisplayPage = async function (req, res, next) {
    console.log(
        `MarketMaking: request ip header: ${req.headers["x-forwarded-for"]} , ${JSON.stringify(req.body)}`,
    );
    let data = req.body;
    data["mmUser"] = true;
    data["isDashboardUser"] = true;
    const userId = data["userId"] || 177348;
    const eventIds = data["events"] || [];

    let mmUserCacheKey = `mmprobes`,
        _probesObject;
    const unlock = await lock(`${mmUserCacheKey}_lock`, 60000);

    let [errx, mmRedisReply] = await to(redisCaching.getKey(mmUserCacheKey));
    if (mmRedisReply) {
        console.log(`MarketMaking: getting data from redis cache`);
        _probesObject = JSON.parse(mmRedisReply);
    } else {
        console.log(`MarketMaking: getting data from DB`);
        [errx, _probesObject] = await to(
            Probe.getProbes({ ...data, partnerId: req?.user?.partner?.id ?? 1 }, 1000),
        );
        if (errx) {
            console.log(errx);
            throw errx;
        }
        await redisCaching.setKey(
            mmUserCacheKey,
            JSON.stringify(_probesObject),
            60,
        );
    }
    unlock();

    let excludeList = [];
    // logger.info(JSON.stringify(_probesObject.rows));
    let _probeRows = _probesObject.rows;
    // _probeRows = await getCurrentPrice(_probeRows, data);
    let sportsCDAProbes = [];
    let parentIds = [];
    let parents = [];
    let parentIdToName = {};
    let errT,
        trades = [];
    for (const probe of _probeRows) {
        // if ((probe.category === 'News' || probe.category === 'Sports' || probe.category === 'Finance') && probe.is_price_editable === true
        //     && probe.title.toLowerCase().indexOf('virtual event:') === -1) {
        if (probe.parent_id <= 0) {
            parents.push(probe);
            parentIds.push(probe.id);
        }
        // }
        if (probe.parent_id <= 0) {
            parentIdToName[probe.id] = probe.title;
        }
    }
    if (eventIds.length > 0) {
        [errT, trades] = await to(
            ProbeV2.getMyBetsV3(userId, "public", eventIds, "/*mm query*/"),
        );
    }
    for (const probe of _probeRows) {
        // logger.info("Test MM 2");
        // if ((probe.category === 'News' || probe.category === 'Sports' || probe.category === 'Finance') && probe.is_price_editable === true
        //     && probe.title.toLowerCase().indexOf('virtual event:') === -1) {

        if (
            probe.parent_id === 0 ||
            (probe.parent_id > 0 && !parentIds.includes(probe.parent_id))
        ) {
            // logger.info("Test MM 3: found 1 with no parent");
            if (probe.newYCP) {
                probe["yesOdds"] = 100 / probe.newYCP;
            } else {
                probe["yesOdds"] = null;
            }
            if (probe.newNCP) {
                probe["noOdds"] = 100 / probe.newNCP;
            } else {
                probe["noOdds"] = null;
            }
            probe["yAmount"] = null;
            probe["nAmount"] = null;
            probe["yQty"] = 0;
            probe["nQty"] = 0;
            probe["yBestPrice"] = 0;
            probe["nBestPrice"] = 0;
            probe["yAvgPrice"] = 0;
            probe["nAvgPrice"] = 0;
            let errPY,
                _yCalls = [],
                errPN,
                _nCalls = [];

            if (eventIds.indexOf(probe.id) > -1) {
                [errPY, _yCalls] = await to(
                    ProbeV2.getProbeCallsOpen2(
                        { probeid: probe.id, callvalue: "Y", userid: -1 },
                        100,
                        true,
                    ),
                );
                if (errPY) throw errPY;
                [errPN, _nCalls] = await to(
                    ProbeV2.getProbeCallsOpen2(
                        { probeid: probe.id, callvalue: "N", userid: -1 },
                        100,
                        true,
                    ),
                );
                if (errPN) throw errPN;
            }

            if (_nCalls.length > 0) {
                probe["yAmount"] = _nCalls[0].noofcontracts * (100 - _nCalls[0].coins);
                probe["yBestPrice"] = 100 - _nCalls[0].coins;
                probe["yQty"] = _nCalls[0].noofcontracts;
            }
            if (_yCalls.length > 0) {
                probe["nAmount"] = _yCalls[0].noofcontracts * (100 - _yCalls[0].coins);
                probe["nBestPrice"] = 100 - _yCalls[0].coins;
                probe["nQty"] = _yCalls[0].noofcontracts;
            }

            let sumMatchedContYes = 0,
                sumMatchedContNo = 0;
            let yInvested = 0,
                nInvested = 0;
            let mmYQty = 0,
                mmNQty = 0,
                mmTotalYBuyAmount = 0,
                mmTotalNBuyAmount = 0,
                mmYQtyMatched = 0,
                mmNQtyMatched = 0,
                mmTotalNBuyAmountUnmatched = 0,
                mmTotalYBuyAmountUnmatched = 0;

            for (const trade of trades) {
                if (trade.id === probe.id) {
                    for (const call of trade.calls) {
                        if (call.rank === 0 && call.callvalue === "Y") {
                            sumMatchedContYes = sumMatchedContYes + call.noofcontracts;
                            yInvested = yInvested + call.noofcontracts * call.coins;
                        } else if (call.rank === 0 && call.callvalue === "N") {
                            sumMatchedContNo = sumMatchedContNo + call.noofcontracts;
                            nInvested = nInvested + call.noofcontracts * call.coins;
                        }
                        if (call.rank == -1) {
                            if (call.status == "H") {
                                if (call.callvalue == "Y") {
                                    mmYQtyMatched += call.noofcontracts;
                                    mmYQty += call.noofcontracts;
                                    mmTotalYBuyAmount += call.noofcontracts * call.lastprice;
                                } else {
                                    mmNQtyMatched += call.noofcontracts;
                                    mmNQty += call.noofcontracts;
                                    mmTotalNBuyAmount += call.noofcontracts * call.lastprice;
                                }
                            } else {
                                if (call.callvalue == "Y") {
                                    mmYQty += call.noofcontracts;
                                    mmTotalYBuyAmount += call.noofcontracts * call.coins;
                                    mmTotalYBuyAmountUnmatched += call.noofcontracts * call.coins;
                                } else {
                                    mmNQty += call.noofcontracts;
                                    mmTotalNBuyAmount += call.noofcontracts * call.coins;
                                    mmTotalNBuyAmountUnmatched += call.noofcontracts * call.coins;
                                }
                            }
                        } else {
                            if (call.callvalue == "Y") {
                                mmYQtyMatched += call.noofcontracts;
                                mmTotalYBuyAmount += call.noofcontracts * call.coins;
                            } else {
                                mmNQtyMatched += call.noofcontracts;
                                mmTotalNBuyAmount += call.noofcontracts * call.coins;
                            }
                        }
                    }
                }
            }

            let yPnL,
                nPnL = 0;
            yPnL = mmYQtyMatched * 100 - (mmTotalYBuyAmount + mmTotalNBuyAmount);
            nPnL = mmNQtyMatched * 100 - (mmTotalYBuyAmount + mmTotalNBuyAmount);
            probe["yOdds"] = yInvested / (yInvested + nInvested);
            probe["nOdds"] = nInvested / (yInvested + nInvested);
            probe["pnl"] = yPnL - nPnL;
            probe["mmYQty"] = mmYQty;
            probe["mmNQty"] = mmNQty;
            probe["mmYAvgPrice"] = mmTotalYBuyAmountUnmatched / mmYQty;
            probe["mmNAvgPrice"] = mmTotalNBuyAmountUnmatched / mmNQty;
            // logger.info(`Test MM profit calc: ${sumMatchedContYes}, ${sumMatchedContNo}, ${yInvested} ${nInvested}`);
            probe["profitYes"] = sumMatchedContYes * 100 - (yInvested + nInvested);
            probe["profitNo"] = sumMatchedContNo * 100 - (yInvested + nInvested);

            if (probe.parent_id > 0) {
                probe["parent_title"] = parentIdToName[probe.parent_id];
            }
            if (!excludeList.includes(probe.id)) {
                sportsCDAProbes.push(probe);
            }

            // }
        }
    }

    for (const parent of parents) {
        let allChildEvent = [];
        let allChildEventIds = [];
        for (const probe of _probeRows) {
            if (probe.parent_id === parent.id) {
                allChildEvent.push(probe);
                allChildEventIds.push(probe.id);
            }
        }
        let totalInvetment = 0;
        // let [err, trades] = await to(ProbeV2.getMyBetsV3(userId));
        // logger.info(`Test MM C: trades: ${JSON.stringify(trades)}`);
        let totalNoMatchedContForEachEvent = {};
        for (const trade of trades) {
            // logger.info(`Test MM C: trade.id: ${trade.id}`);
            if (allChildEventIds.includes(trade.id)) {
                // logger.info(`Test MM C: profit test enter ${parent.id} : ${trade.id}`);
                for (const call of trade.calls) {
                    // logger.info(`Test MM C: profit test calls ${call.rank} : ${trade.id}`);
                    if (call.rank === 0) {
                        totalInvetment = totalInvetment + call.noofcontracts * call.coins;
                        // logger.info(`Test MM C: profit test totalI ${totalInvetment} : ${trade.id}`);
                    }
                    if (call.rank === 0 && call.callvalue === "N") {
                        // logger.info(`Test MM C: profit test nfound ${call.callvalue} : ${trade.id}`);
                        if (trade.id in totalNoMatchedContForEachEvent) {
                            totalNoMatchedContForEachEvent[trade.id] =
                                totalNoMatchedContForEachEvent[trade.id] + call.noofcontracts;
                            // logger.info(`Test MM C: profit test n matched totalNoMatchedContForEachEvent: ${trade.id} , ${JSON.stringify(totalNoMatchedContForEachEvent)}`);
                        } else {
                            totalNoMatchedContForEachEvent[trade.id] = call.noofcontracts;
                            // logger.info(`Test MM C: profit test n matched totalNoMatchedContForEachEvent: ${trade.id} , ${JSON.stringify(totalNoMatchedContForEachEvent)}`);
                        }
                    }
                }
            }
        }
        // logger.info(`Test MM C: totalInvetment: ${parent.id},  ${totalInvetment}`);
        for (const child of allChildEvent) {
            // logger.info(`Test MM C: child.newYCP: ${child.newYCP}`);
            // logger.info(`Test MM C: child.newNCP: ${child.newNCP}`);
            if (child.newYCP) {
                child["yesOdds"] = 100 / child.newYCP;
            } else {
                child["yesOdds"] = null;
            }
            if (child.newNCP) {
                child["noOdds"] = 100 / (100 - child.newNCP);
            } else {
                child["noOdds"] = null;
            }
            child["yAmount"] = null;
            child["nAmount"] = null;
            child["yQty"] = 0;
            child["nQty"] = 0;
            child["yBestPrice"] = 0;
            child["nBestPrice"] = 0;
            child["yAvgPrice"] = 0;
            child["nAvgPrice"] = 0;
            // logger.info(`Test MM C: child['yesOdds']: ${child['yesOdds']}`);
            // logger.info(`Test MM C: child['yesOdds']: ${child['yesOdds']}`);
            let errPY,
                _yCalls = [],
                errPN,
                _nCalls = [];
            if (eventIds.indexOf(child.id) > -1) {
                [errPY, _yCalls] = await to(
                    ProbeV2.getProbeCallsOpen2(
                        { probeid: child.id, callvalue: "Y", userid: -1 },
                        100,
                        true,
                    ),
                );
                if (errPY) throw errPY;
                [errPN, _nCalls] = await to(
                    ProbeV2.getProbeCallsOpen2(
                        { probeid: child.id, callvalue: "N", userid: -1 },
                        100,
                        true,
                    ),
                );
                if (errPN) throw errPN;
            }

            // logger.info(`Test MM C: _yCalls: ${JSON.stringify(_yCalls)}`);
            // logger.info(`Test MM C: _nCalls: ${JSON.stringify(_nCalls)}`);
            if (_nCalls.length > 0) {
                child["yAmount"] = _nCalls[0].noofcontracts * (100 - _nCalls[0].coins);
                child["yBestPrice"] = 100 - _nCalls[0].coins;
                child["yQty"] = _nCalls[0].noofcontracts;
            }
            if (_yCalls.length > 0) {
                child["nAmount"] = _yCalls[0].noofcontracts * (100 - _yCalls[0].coins);
                child["nBestPrice"] = 100 - _yCalls[0].coins;
                child["nQty"] = _yCalls[0].noofcontracts;
            }
            // logger.info(`Test MM C: child['yAmount']: ${child['yAmount']}`);
            // logger.info(`Test MM C: child['nAmount']: ${child['nAmount']}`);

            // let [err, trades] = await to(ProbeV2.getMyBetsV3(userId));
            let sumMatchedContYes = 0,
                sumMatchedContNo = 0;
            let mmYQty = 0,
                mmNQty = 0,
                mmTotalYBuyAmount = 0,
                mmTotalNBuyAmount = 0,
                mmYQtyMatched = 0,
                mmNQtyMatched = 0,
                mmTotalNBuyAmountUnmatched = 0,
                mmTotalYBuyAmountUnmatched = 0;

            for (const trade of trades) {
                if (trade.id === child.id) {
                    for (const call of trade.calls) {
                        if (call.rank === 0 && call.callvalue === "Y") {
                            sumMatchedContYes = sumMatchedContYes + call.noofcontracts;
                        } else if (call.rank === 0 && call.callvalue === "N") {
                            sumMatchedContNo = sumMatchedContNo + call.noofcontracts;
                        }
                        if (call.rank == -1) {
                            if (call.status == "H") {
                                if (call.callvalue == "Y") {
                                    mmYQtyMatched += call.noofcontracts;
                                    mmYQty += call.noofcontracts;
                                    mmTotalYBuyAmount += call.noofcontracts * call.lastprice;
                                } else {
                                    mmNQtyMatched += call.noofcontracts;
                                    mmNQty += call.noofcontracts;
                                    mmTotalNBuyAmount += call.noofcontracts * call.lastprice;
                                }
                            } else {
                                if (call.callvalue == "Y") {
                                    mmYQty += call.noofcontracts;
                                    mmTotalYBuyAmount += call.noofcontracts * call.coins;
                                    mmTotalYBuyAmountUnmatched += call.noofcontracts * call.coins;
                                } else {
                                    mmNQty += call.noofcontracts;
                                    mmTotalNBuyAmount += call.noofcontracts * call.coins;
                                    mmTotalNBuyAmountUnmatched += call.noofcontracts * call.coins;
                                }
                            }
                        } else {
                            if (call.callvalue == "Y") {
                                mmYQtyMatched += call.noofcontracts;
                                mmTotalYBuyAmount += call.noofcontracts * call.coins;
                            } else {
                                mmNQtyMatched += call.noofcontracts;
                                mmTotalNBuyAmount += call.noofcontracts * call.coins;
                            }
                        }
                    }
                }
            }

            let yPnL,
                nPnL = 0;
            yPnL = mmYQtyMatched * 100 - (mmTotalYBuyAmount + mmTotalNBuyAmount);
            nPnL = mmNQtyMatched * 100 - (mmTotalYBuyAmount + mmTotalNBuyAmount);
            child["yOdds"] =
                mmTotalYBuyAmount / (mmTotalYBuyAmount + mmTotalNBuyAmount);
            child["nOdds"] =
                mmTotalNBuyAmount / (mmTotalYBuyAmount + mmTotalNBuyAmount);
            child["pnl"] = yPnL - nPnL;
            child["mmYQty"] = mmYQty;
            child["mmNQty"] = mmNQty;
            child["mmYAvgPrice"] = mmTotalYBuyAmountUnmatched / mmYQty;
            child["mmNAvgPrice"] = mmTotalNBuyAmountUnmatched / mmNQty;
            let oppositeNoSum = 0;
            // logger.info(`Test MM oppositeNoSum: ${oppositeNoSum}`);
            for (const childId in totalNoMatchedContForEachEvent) {
                let childInt = parseInt(childId);
                if (allChildEventIds.includes(childInt) && child.id !== childInt) {
                    oppositeNoSum =
                        oppositeNoSum + totalNoMatchedContForEachEvent[childId];
                }
            }
            // logger.info(`Test MM oppositeNoSum: ${oppositeNoSum}`);

            // Debugging
            // logger.info(`Test MM profit test pnl: ${child.id}, ${child['pnl']}`);
            // logger.info(`Test MM profit test mmYQty: ${child.id}, ${child['mmYQty']}`);
            // logger.info(`Test MM profit test mmNQty: ${child.id}, ${child['mmNQty']}`);
            // logger.info(`Test MM profit test mmYAvgPrice: ${child.id}, ${child['mmYAvgPrice']}`);
            // logger.info(`Test MM profit test mmNAvgPrice: ${child.id}, ${child['mmNAvgPrice']}`);
            child["oppositeNoSum"] = oppositeNoSum;
            child["sumMatchedContYes"] = sumMatchedContYes;
            child["totalInvetment"] = totalInvetment;
            child["allChildEventIds"] = allChildEventIds;
            child["totalNoMatchedContForEachEvent"] = totalNoMatchedContForEachEvent;
            // Debugging ends

            child["profitYes"] =
                (sumMatchedContYes + oppositeNoSum) * 100 - totalInvetment;
            // logger.info(`Test MM child['profitYes']: ${child['profitYes']}`);
            // child['profitNo'] = (sumMatchedContNo * 100) - (totalInvetment);
            child["profitNo"] = 0;
            child["parent_title"] = parent.title;
            child["volume"] = 0;
            if (!excludeList.includes(child.id)) {
                let eventId = child.id
                let cacheKey = getOpenCallsCachingKey(eventId);
                // updateUserPreference(req, eventId);
                let err, redisReply, isLiveStatsEvent;
                [err, redisReply] = await to(redisCaching.getKey(cacheKey));
                if (err) throw err;
                if (redisReply) {
                    resData = JSON.parse(redisReply);
                    child["volume"] = parseFloat(resData["volume"].toFixed(2));
                }
                sportsCDAProbes.push(child);
            }
        }
    }

    // for (let e of sportsCDAProbes) {
    //     let cacheKeyPnL = `pnl_${userId}_${e.id}`, d, errx, pnlRedisReply;
    //     [errx, pnlRedisReply] = await to(redisCaching.getKey(cacheKeyPnL));
    //     if (pnlRedisReply) {
    //         d = JSON.parse(pnlRedisReply);
    //     } else {
    //         [errx, d] = await to(ProbeV2.getRevenueNPnL(userId, e.id))
    //         if (errx) {
    //             console.log(errx);
    //             throw errx;
    //         }
    //         redisCaching.setKey(cacheKeyPnL, JSON.stringify(d), 10)
    //     }

    //     e['revenue'] = d['revenue']
    //     e['pnl_y_settled'] = d['pnl_y_settled']
    //     e['pnl_n_settled'] = d['pnl_n_settled']
    //     e['gross_pnl_y_settled'] = d['gross_pnl_y_settled']
    //     e['gross_pnl_n_settled'] = d['gross_pnl_n_settled']
    // }

    // let resp = await marketLimitOrder(sportsCDAProbes);
    let response = {
        success: true,
        probes: sportsCDAProbes,
        total: sportsCDAProbes.length,
    };
    return ReS(res, response);
};

var checkAllKeys = async (key, n) => {
    if (n == 0) {
        return false;
    }
    var c = await redisCaching.getKey(`${key}_${n}`);
    if (c == null) {
        return checkAllKeys(key, n - 1);
    } else {
        return true;
    }
};

module.exports.putCallbulk = putCallbulk;
module.exports.mmDisplayPage = mmDisplayPage;
module.exports.mmOddsOrder = mmOddsOrder;
module.exports.mmCancelAll = mmCancelAll;
module.exports.mmHaltUnhalt = mmHaltUnhalt;
module.exports.mmScriptStatusUpdate = mmScriptStatusUpdate;
