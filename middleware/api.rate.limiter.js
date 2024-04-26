const { to, ReE, ReS } = require('../services/util.service');
const ipsMap = {};

const safelistIPsMap = { '172.31.2.226': {} };
const flushTime = 30000;
const noOfReqsAPI = {
    '/v2/probe/putcall' : 1,
    '/v2/coupon/validate': 3
}
const timeLimit = {
    '/v2/probe/putcall' : 1000,        // 1 sec
    '/v2/coupon/validate': 1000*60*5   // 5 minute
}
const flushIPs = () => {
    for (let k in ipsMap) {
        if (Date.now() - ipsMap[k].lastRequestLimitSet > flushTime) {
            delete ipsMap[k];
        }
    }
    setTimeout(flushIPs, flushTime); //clear all ips where no request recieved in flushTime milliseconds
}

flushIPs();

const apiRateLimiter = async (req, res, next) => {
    var ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    var baseUrl = req.baseUrl;
    const time_limit = timeLimit[baseUrl];
    const noOfReqs = noOfReqsAPI[baseUrl];
    if (typeof safelistIPsMap[ip] !== 'undefined') {
        next();
    } else {
        try {
            if (ipsMap[ip]) {
                const now = Date.now();
                // console.log(now - ipsMap[ip].lastRequestLimitSet);
                if (now - ipsMap[ip].lastRequestLimitSet < time_limit) {
                    if (ipsMap[ip].n == 0) {
                        return ReE(res, 'Too many requests', 412);
                    } else {
                        ipsMap[ip].n--;
                        next();
                    }
                } else {
                    ipsMap[ip].lastRequestLimitSet = now;
                    ipsMap[ip].n = noOfReqs;
                    next();
                }
            } else {
                ipsMap[ip] = { n: noOfReqs, lastRequestLimitSet: Date.now() };
                next();
            }
        } catch (err) {
            next(err);
        }
    }
}

module.exports.apiRateLimiter = apiRateLimiter;
