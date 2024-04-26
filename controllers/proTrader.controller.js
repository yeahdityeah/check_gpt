const ProTraderIncentive = require("../models/proTraderIncentive");
const { redisCaching } = require("../services/cache.service");
const { ReS, ReE } = require("../services/util.service");
const luxon = require("luxon");

const log = (...args) => console.log('[PRO TRADER INCENTIVE]', ...args);

const getIncentiveConfig = async () => {
    let data;
    const cacheKey = 'pro_trader_config';
    data = await redisCaching.getKey(cacheKey);
    if(data) {
        data = JSON.parse(data);
        return data;
    }
    data = await ProTraderIncentive.getIncentiveConfig();
    await redisCaching.setKey(cacheKey, JSON.stringify(data), 24 * 60 * 60);
    return data;
}

// const getIncentiveByUser = async (ts, userId, incentives) => {
//     let data;
//     const cacheKey = `pro_trader_incentive_${userId}_${ts}`;
//     data = await redisCaching.getKey(cacheKey);
//     if(data) {
//         data = JSON.parse(data);
//         return data;
//     }
//     data = await ProTraderIncentive.getIncentiveByUser(ts, userId, incentives);
//     await redisCaching.setKey(cacheKey, JSON.stringify(data), 1 * 60);
//     return data;
// }

const incentiveByUser = async (req, res) => {
    try {

        const userId = req.user.id;
        const ts = luxon.DateTime.now().setZone('Asia/Kolkata').startOf('day').toISODate();
        const incentives = await getIncentiveConfig();
        const status = await ProTraderIncentive.getIncentiveByUser(ts, userId, incentives);
        const data = {
            status,
            incentives,
            todayEvents: ['All Orderbook Events'],
            termsConditions: [
                'Token trades will not be counted in this program',
                'This program is only for eligible users',
                'Rewards are for matched shares quantity (buy and sell) only',
                'The program applies to all orderbook events',
                "Shares between price 10 and 90 will be counted towards target quanity",
                'Prizes will be credited next day'
            ]
        }
        return ReS(res, data, 200);
    } catch(e) {
        log("ERROR", e);
        return ReE(res, 'Internal Server Error', 500);
    }
}

module.exports = {
    incentiveByUser
}