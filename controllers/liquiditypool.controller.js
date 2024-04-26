const { to, ReE, ReS, isFloat, isNumber } = require('../services/util.service');
const { LiquidityPool, Probe, ProbeV2, calculateTruePrice } = require('../models');
const { isDashboardUser } = require('../middleware/dashboard.user');
const logger = require('../services/logger.service');
const { getExPriceAndUpdate } = require('../utils/exchange.maths.js');
const { redisCaching } = require('../services/cache.service');
const REDIS_KEY = 'liquidity_pool_max_returns';

const _getTruePrice = async (probeId) => {
    probeId = parseInt(probeId, 10);
    [err, truePrice] = await to(LiquidityPool.get(probeId, ['price_per_contract_yes', 'price_per_contract_no']));
    if (err) throw err;

    return truePrice;
}

const getMarketData = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        if (!isDashboardUser(req)) {
            return ReE(res, 'Unauthorized request, incident has been reported', 401);
        }
        let err, truePrice, openOrderStats, matchedOrderStats;
        if (!req.query.probeid) {
            return ReE(res, 'Invalid Request', 400);
        }
        const probeId = req.query.probeid;
        truePrice = await _getTruePrice(probeId);
        [err, openOrderStats] = await to(Probe.openOrdersStatistics(probeId));
        if (err) throw err;
        if (!openOrderStats || Object.keys(openOrderStats).length === 0) {
            openOrderStats = {
                "min_price_yes": 0,
                "max_price_yes": 0,
                "avg_price_yes": 0.0,
                "min_price_no": 0,
                "max_price_no": 0,
                "avg_price_no": 0.0
            };
        }

        [err, matchedOrderStats] = await to(Probe.matchedOrdersStatistics(probeId));
        if (err) throw err;
        if (!matchedOrderStats || Object.keys(matchedOrderStats).length === 0) {
            matchedOrderStats = {
                "probeid": probeId,
                "matched_volume_yes": 0,
                "matched_volume_no": 0,
                "matched_average_volume_yes": 0.0,
                "matched_average_volume_no": 0.0,
                "total_contracts_yes": 0,
                "total_contracts_no": 0
            };
        }

        const truePriceYes = truePrice && truePrice.price_per_contract_yes ? truePrice.price_per_contract_yes : 0.0;
        const truePriceNo = truePrice && truePrice.price_per_contract_no ? truePrice.price_per_contract_no : 0.0;
        const respObject = {
            true_price: {
                yes: truePriceYes,
                no: truePriceNo
            },
            open_order_statistics: openOrderStats,
            matched_order_statistics: matchedOrderStats
        };

        return ReS(res, {
            success: true, data: {
                stats: respObject
            }
        });
    } catch (error) {
        next(error);
    }
};

const getTruePrice = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        // logger.info("Request received for true price. Query parameters: " + JSON.stringify(req.query));
        let truePrice;
        if (!req.query.eventId ||
            !req.query.action ||
            !['buy', 'sell'].includes(req.query.action) ||
            !req.query.callvalue ||
            !['Y', 'N'].includes(req.query.callvalue)) {
            return ReE(res, 'Invalid Request', 400);
        }
        let noOfContracts = 0;
        let orderType = req.query.action;
        let price = req.query.price;
        let callValue = req.query.callvalue;
        let qty = req.query.noofcontracts || 0;
        let eventId = req.query.eventId;
        let maxReturnsObj = {};
        const serializedData = await redisCaching.getHMKey(eventId, REDIS_KEY);
        if (serializedData) {
            try {
                maxReturnsObj[eventId] = parseInt(serializedData);
            } catch (e) {
                // ignore
            }
        }
        let maxReturns = 0;
        if (maxReturnsObj[eventId]) {
            maxReturns = maxReturnsObj[eventId];
        } else {
            let [err, eventInfo] = await to(ProbeV2.getEvent(eventId, ['totalamount']));
            if (err) throw err;

            maxReturns = eventInfo['totalamount'];
            maxReturnsObj[eventId] = maxReturns;
            await redisCaching.setHMKey(eventId, REDIS_KEY, maxReturns);
        }

        const prices = await getExPriceAndUpdate(eventId, orderType, qty, price, callValue, maxReturns, false);

        const respObject = {
            true_price_yes: prices.yPrice,
            true_price_no: prices.nPrice,
            ex_price: prices.exPrice
        };
        let pUpperLimit = 99.75 * maxReturns / 100;
        let pLowerLimit = 0.25 * maxReturns / 100;
        let tradingFee = 0.0;
        if (orderType == 'buy') {

            if (respObject['true_price_yes'] > pUpperLimit || respObject['true_price_no'] > pUpperLimit) {
                respObject['status'] = 'error';
                respObject['message'] = 'Cannot place such large order';
            }
            const contracts = parseFloat(req.query.noofcontracts) || 1;
            const price = parseFloat(req.query.price);
            if (req.query.callvalue === 'Y') {
                tradingFee = (contracts * price * 0.01).toFixed(2);
            } else if (req.query.callvalue === 'N') {
                tradingFee = (contracts * price * 0.01).toFixed(2);
            }
        } else {
            if (respObject['true_price_yes'] < pLowerLimit || respObject['true_price_no'] < pLowerLimit) {
                respObject['status'] = 'error';
                respObject['message'] = 'No contracts available to sell';
            }

            const contracts = parseFloat(req.query.noofcontracts);
            if (req.query.callvalue === 'Y') {
                // const price = parseFloat(respObject['true_price_yes']);
                tradingFee = (contracts * prices.exPrice * 0.01).toFixed(2);
                console.log("trading fee is: " + tradingFee);
            } else if (req.query.callvalue === 'N') {
                // const price = parseFloat(respObject['true_price_no']);
                tradingFee = (contracts * prices.exPrice * 0.01).toFixed(2);
                console.log("trading fee is: " + tradingFee);
            }
        }
        respObject['trading_fee'] = parseFloat(tradingFee);
        return ReS(res, {
            success: true, data: respObject
        });
    } catch (error) {
        next(error);
    }
};

const updateLiquidityPool = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    try {
        if (!isDashboardUser(req)) {
            return ReE(res, 'Unauthorized request, incident has been reported', 401);
        }

        const { eventId, yTokens, nTokens, yPrice, nPrice } = req.body;

        if (!isNumber(eventId) || !isFloat(nPrice) || !isFloat(yPrice) || !isFloat(yTokens) || !isFloat(nTokens)) {
            return ReE(res, 'Invalid request. Check data', 412);
        }
        if ((yPrice <= 0 || yPrice >= 100) || (nPrice <= 0 || nPrice >= 100)) {
            return ReE(res, 'Invalid request. Prices can only lie between 0 to 100', 412);
        }

        const data = {
            quantity_yes: yTokens,
            quantity_no: nTokens,
            price_per_contract_yes: yPrice,
            price_per_contract_no: nPrice,
            liquidity_pool: yTokens * nTokens * yPrice * nPrice
        }

        const [err, respObject] = await to(LiquidityPool.update(eventId, data));
        if (err) throw err;

        return ReS(res, {
            success: true
        });

    } catch (error) {
        next(error);
    }

}

module.exports.getMarketData = getMarketData;
module.exports.getTruePrice = getTruePrice;
module.exports.updateLiquidityPool = updateLiquidityPool;
