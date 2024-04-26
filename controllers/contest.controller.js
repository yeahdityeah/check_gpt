const fs = require('fs');
const path = require('path');
const process = require('process');
const { authenticate } = require('@google-cloud/local-auth');
const { google } = require('googleapis');
const axios = require('axios');

const { isDashboardUser } = require("../middleware/dashboard.user");
const Contest = require("../models/contest");
const Level = require("../models/level");
const { getTimestamptz } = require('../utils/date.util');
const { to, ReE, ReS, waitTimer } = require('../services/util.service');
const { redisCaching } = require('../services/cache.service');
const { UserService } = require('../services/user.service');
const { promisify } = require('util');
const lock = promisify(require('redis-lock')(redisCaching.client));
const knex = require('../knex/knex.js');
const { messages } = require("../messages/messages");
const logger = require("../services/logger.service");
const eventStatusEnum = require("../utils/eventStatusEnum.util");
const { TRANSACTIONS } = require('../utils/constants');
const CONFIG = require('../config/config');
const { EventsService } = require('../services/events.service');
const { handleNotification } = require('../services/notification.service');
const { cancelEvent } = require('../controllers/event.cancel.controller');
const { settleAllEventsAndContest, serverURLAdmin, getToken } = require('../recurring_tasks/contest_settlements')
const { localesService } = require("../services/locale");
const { DeadSimpleChat } = require('../services/deadsimplechat.service');


const log = (...args) => console.log('[Contest Controller]', ...args);

const getLiveContests = async (req, res) => {
    try {

        let contestFormat = req.query.format ? req.query.format.split(',').map(number => `format${number}`) : ['format1'];
        if (req?.query?.contest_id) contestFormat = null;
        const contests = await Contest.getLiveContests(req?.user?.id, 1000, 0, req?.query?.contest_id, contestFormat);

        let userID = req?.user?.id;
        const excludeUsers = await Level.getUsersLevel([3, 4]);
        let excludeUserList = [];
        for (let user of excludeUsers) {
            excludeUserList.push(parseInt(user['userid']));
        }
        excludeUserList = excludeUserList.concat([2165617, 2061060, 1681046, 1940569, 2140581, 1947942, 953094, 2190824,
            1308138, 965267, 1684308, 1970756, 1030806, 1500128, 2224677, 20212, 631443, 2138425, 1480376, 2012000,
            1046984, 332102, 2208341, 2213106, 1045189, 1728339, 2099253, 1918105, 518506, 1875054, 2212432, 173224,
            524122, 1098076, 1797782, 2207666, 2233317, 306779, 784603, 294385, 591944, 2062966, 2201750, 2225862,
            2247241, 1453895, 705924, 898488, 2064243, 1801781, 1851526, 2215965, 1758973, 380573, 2235661, 2217678,
            118856, 2233220, 2132121, 757499, 601600, 821231, 972013, 670605, 1745470, 2093017, 1469927, 2224369, 962425,
            599339, 263515, 1665638, 1971632, 1841650, 2217066, 2056865, 1458839, 340470, 725735, 592273, 2233722, 418168,
            884487, 257322, 604425, 2217893, 2217597, 473187, 1007263, 2253373, 2223898, 2198324, 1349930, 366918, 2213035,
            1622307, 1587874, 532331, 1081546, 1496383, 865332, 743170, 1015944, 1984138, 1285619, 1406738, 267686,
            1979466, 2232676, 1643096, 473368, 329090, 2261857, 1932530, 540685, 2025802, 382913, 15864, 1484250, 566658,
            1171331, 2279091, 1766352, 1586175, 1011737, 1633075, 1514411, 1999972, 2217322, 286551, 251139, 2145447,
            750462, 1862280, 1210464, 1999764, 2276686, 1082368, 315709, 2086251, 1400389, 1707726, 176563, 757736,
            615658, 1771591, 2217092, 2198076, 1640846, 790868, 819679, 1089004, 2222472, 1693230, 1913112, 2088348,
            1452246, 1758877, 1432766, 867525, 2217295, 2200984, 1684430, 2066889, 1514868, 1464469, 2254077, 2261129,
            1590610, 963696, 251572, 266558, 2175379, 790884, 1027159, 199594, 1322692, 2203373, 474411, 1318872, 507821,
            155366, 2031284, 2216646, 1848288, 2213136, 1612690, 126652, 48685, 1158460, 951429, 1297868, 2251816,
            2239333, 378842, 1496376, 2040434, 654299, 915431, 1754888, 1491406, 369724, 406702, 304841, 591046, 728531,
            129357, 321514, 2226883, 2248793, 345660, 468599, 401862, 1468624, 2257242, 393633, 2037989, 2051698,
            942901, 319918, 2126950, 439704, 896681, 304098, 288576, 565188, 312811, 2194576, 1115748, 437022, 2190980,
            2217126]);

        let filterContest = [];
        if (excludeUserList.includes(userID)) {
            for (let contest of contests) {
                if (contest.entry_fee !== 0) {
                    filterContest.push(contest);
                } else {
                    let contestId = contest.id;
                    let allContestUser = await Contest.getAllContestUsers(contestId, 'fantasy', true);
                    let allUserId = [];
                    for (let user of allContestUser) {
                        allUserId.push(parseInt(user.user_id));
                    }
                    if (allUserId.includes(userID)) {
                        filterContest.push(contest);
                    }
                }
            }
        } else {
            filterContest = contests;
        }

        return ReS(res, { contests: filterContest });

    } catch (e) {
        log(e.message)
        throw e;
        next(e)
    }
}

const getClosedContests = async (req, res) => {
    try {

        // const isDashboardUser = await isDashboardUser(req);
        let contestFormat = req.query.format ? req.query.format.split(',').map(number => `format${number}`) : ['format1'];
        if (req?.query?.contest_id) contestFormat = null;
        const contests = await Contest.getClosedContests(req?.user?.id, req?.query?.limit, req?.query?.page, contestFormat);
        return ReS(res, { contests });

    } catch (e) {
        log(e.message)
        throw e;
        next(e)
    }
}

const getContests = async (req, res) => {
    try {

        // const isDashboardUser = await isDashboardUser(req);
        // if(!isDashboardUser) {
        //     return ReE(res, 'Unauthorized', 401, 'Unauthorized')
        // }

        const contests = await Contest.getContests({
            status: req?.query?.status,
            search: req?.query?.search,
            offset: req?.query?.offset,
            limit: req?.query?.limit,
        });
        return ReS(res, { contests });

    } catch (e) {

    }
}

const createContest = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {

        if (!isDashboardUser(req)) {
            res.writeStatus("401");
            return ReS(res, {
                success: true, msg: 'Unauthorized request, incident has been reported'
            });
        }

        var err, _contestId, _schema, sharelink, roomLink;
        var data = Object.assign({}, req.body);
        /*
        machine's timezne is UTC, for events dashboard users enter time in IST
        convert the incoming values for endsat and settledate to UTC
        */
        try {
            let timezone = data?.timezone ?? 'Asia/Kolkata';
            if (data['end_time']) {
                data['end_time'] = getTimestamptz([data['end_time']].join(' '));
            }
            if (data['start_time']) {
                const startDate = getTimestamptz([data['start_time']].join(' '));
                if ((data['end_time'] && (data['end_time'] < startDate))) {
                    throw new Error('Start date can not be after end date or settlement date');
                }
                data['start_time'] = startDate;
            }
        } catch (e) {
            console.log(e);
            throw e;
        }
        console.log(data['start_time'], data['end_time'])


        if (data['virtual_credits'] < 0 || data['entry_fee'] < 0) {
            return ReE(res, {
                success: false, message: 'Virtual Credits or Entry Fee cannot be less than 0'
            });
        }
        if (data['winner_percentage'] > 100 || data['winner_percentage'] < 1) {
            return ReE(res, {
                success: false, message: 'Winner percentage should be between 1 and 100'
            });
        }

        if (!data['title'] || data['title'].trim() === '') {
            return ReE(res, {
                success: false, message: 'Title cannot be empty.'
            });
        }

        if (!data['description'] || data['description'].trim() === '') {
            return ReE(res, {
                success: false, message: 'Description cannot be empty.'
            });
        }

        if (req?.domain) {
            _schema = req?.domain;
        }

        if (data?.is_fixed_pool) {
            data.prize_pool = data.default_prize_pool;
        }
        const enableChat = data.enableChat;
        delete data.enableChat;
        [err, _contestId] = await to(Contest.createContest(data, _schema));
        if (err) throw err;

        try {
            sharelink = await EventsService.getShareLinkContest(Number(_contestId?.[0]), data['title']);
        } catch (e) {
            logger.error('Cannot create dynamic link for contest')
            logger.error(e)
        }
        if (sharelink) {
            const dataToUpdate = { 'id': Number(_contestId?.[0]), 'sharelink': sharelink };
            let _contest;
            [err, _contest] = await to(Contest.update(dataToUpdate, _schema));
            if (err) throw err;
        }

        if (enableChat){
            try {
                roomLink = await DeadSimpleChat.createRoom(data['title']);
                if(roomLink?.roomId){
                    const dataToUpdate = { 'id': Number(_contestId?.[0]), 'room_id': roomLink?.roomId };
                    let _contest;
                    [err, _contest] = await to(Contest.update(dataToUpdate, _schema));
                    if (err) throw err;
                }
            } catch (e) {
                logger.error('Cannot create dead simple ChatRoom for contest')
                logger.error(e)
            }
        }

        return ReS(res, {
            success: true, id: _contestId?.[0], data
        });



    } catch (err) {
        next(err);
    }
}

const enterContest = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {

        const contest_id = Number(req.body.contest_id);
        const user_id = req.user.id;
        var data = Object.assign({}, req.body);

        const language = req?.user?.preferred_locale ?? 'en-IN';
        const translator = await localesService.getTranslator(language, 'contest');

        let _schema, _resp, result, contestinfo;

        if (req?.domain) {
            _schema = req?.domain;
        }

        contestinfo = await Contest.getContestById(contest_id, _schema);
        if (contestinfo.length <= 0) {
            return ReE(res, translator('Contest does not exist'), 422, translator('Contest does not exist'));
        }

        contestinfo = contestinfo[0];

        if (contestinfo.status === 'C' || new Date(contestinfo.end_time).valueOf() < new Date().valueOf()) {
            return ReE(res, translator('Cannot enter a closed contest'), 400, translator('Cannot enter a closed contest'));
        }
        let amountToDebit = Number(contestinfo['entry_fee']);
        let amountToCredit = Number(contestinfo['virtual_credits']);
        let txninfo = { 'contest_id': contest_id, 'contest_name': contestinfo['title'], 'istopup': false };

        const responseEnterContest = await knex.transaction(async (trx) => {
            result = await UserService.debitPublicCreditFantasyWallet(user_id, amountToDebit, amountToCredit, txninfo, trx);

            if (result.success) {
                const reqKey = `enter_contest_${contest_id}`;
                const unlock = await lock(reqKey, 10000);

                if (contestinfo.is_fixed_pool === false) {
                    [err, _resp] = await to(Contest.updatePrizePool(contest_id, trx));
                    if (err) {
                        unlock();
                        throw err;
                    }
                    unlock();
                } else {
                    unlock();
                }


                [err, _resp] = await to(Contest.addUserToContest({ contest_id, user_id }, _schema, trx));
                if (err) {
                    throw new Error('User already added to this contest.');
                }
            }
        })



        //title info and startime of contest
        if (result.success == true) {
            if(req?.body?.roomId){
                await DeadSimpleChat.createUser(req.user, req?.body?.roomId);
            }
            return ReS(res, {
                success: true, title: translator('Entry Confirmed'),
                info: translator(`{{virtual_credits}} virtual coins are credited in your account. Trade now & stay top of the leaderboard to win rewards!`, { "virtual_credits": contestinfo['virtual_credits'] }),
                start_time: contestinfo['start_time'],
                end_time: contestinfo['end_time']
            });
        } else {
            return ReE(res, result.message, 424, translator(result.message), { info: translator('Please recharge your wallet immediately.'), required: result.required });
        }


    } catch (err) {
        next(err);
    }
}

const topupContest = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        return ReE(res, 'Topup is not allowed in this contest', 422, 'Topup is not allowed in this contest');

        const contest_id = Number(req.body.contest_id);
        const user_id = req.user.id;
        var data = Object.assign({}, req.body);

        let _schema, result, contestinfo, _resp, err;

        if (req?.domain) {
            _schema = req?.domain;
        }

        let userBalance = await Contest.getContestUserBalance(contest_id, user_id, _schema, true);
        if (!userBalance) {
            return ReE(res, 'User is not a part of this contest', 422, 'User is not a part of this contest');
        }

        contestinfo = await Contest.getContestById(contest_id, _schema);
        if (contestinfo.length <= 0) {
            return ReE(res, 'Contest does not exist', 422, 'Contest does not exist');
        }

        contestinfo = contestinfo[0];
        if (contestinfo.status === 'C' || new Date(contestinfo.end_time).valueOf() < new Date().valueOf()) {
            return ReE(res, 'Cannot topup a closed contest', 400, 'Cannot topup a closed contest');
        }
        let amountToDebit = Number(contestinfo['entry_fee']);
        let amountToCredit = Number(contestinfo['virtual_credits']);
        let txninfo = { 'contest_id': contest_id, 'contest_name': contestinfo['title'], 'istopup': true };

        await knex.transaction(async (trx) => {
            result = await UserService.debitPublicCreditFantasyWallet(user_id, amountToDebit, amountToCredit, txninfo, trx);
            if (result.success) {
                const reqKey = `enter_contest_${contest_id}`;
                const unlock = await lock(reqKey, 10000);

                [err, _resp] = await to(Contest.updatePrizePool(contest_id, trx));
                if (err) {
                    unlock();
                    throw err;
                }
                unlock();
            }
        })


        if (result.success) {
            return ReS(res, {
                success: true, title: 'Top Up Successful',
                info: `${contestinfo['virtual_credits']} virtual coins are credited in your account. Trade now & stay top of the leaderboard to win rewards!`,
                start_time: contestinfo['start_time'],
                end_time: contestinfo['end_time']
            });
        } else {
            return ReE(res, result.message, 424, result.message,
                { info: 'Please recharge your wallet immediately.', required: result.required });
        }

    } catch (err) {
        next(err);
    }
}

const getContestBalance = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {

        const contest_id = Number(req.query.contest_id);
        const user_id = req.user.id;

        const language = req?.user?.preferred_locale ?? 'en-IN';
        const translator = await localesService.getTranslator(language, 'contest');

        let _schema, result, contestinfo;

        if (req?.domain) {
            _schema = req?.domain;
        }

        contestinfo = await Contest.getContestById(contest_id, _schema);
        if (contestinfo.length <= 0) {
            return ReE(res, translator('Contest does not exist'), 422, translator('Contest does not exist'));
        }
        contestinfo = contestinfo[0];

        let userBalance = await Contest.getContestUserBalance(contest_id, user_id, _schema, true);
        if (!userBalance) {
            return ReE(res, translator('User is not a part of this contest'), 422, translator('User is not a part of this contest'));
        }


        return ReS(res, {
            success: true, coins: parseFloat(userBalance['coins']).toFixed(2),
            virtual_credits: parseFloat(contestinfo['virtual_credits']).toFixed(2),
            entry_fee: parseFloat(contestinfo['entry_fee']).toFixed(2)

        });



    } catch (err) {
        next(err);
    }
}

const update = async function (req, res, next) {
    if (!isDashboardUser(req)) {
        res.writeStatus("401");
        return ReS(res, {
            success: true, msg: 'Unauthorized request, incident has been reported'
        });
    }
    if (req.baseUrl.includes('v1')) {
        return ReE(res, messages.TRADING_NOT_ALLOWED, 405);
    }
    // res.setHeader('Content-Type', 'application/json');
    var data = {};
    const REDIS_KEY = 'CONTEST_UPDATE';
    const contest_id = Number(req.query.contest_id);
    try {
        data = Object.assign({}, req.body);
        delete data.enableChat;
        logger.info(`Settling Contest : ${contest_id}. Starting contest update`);
        // logDashboardRequest(req, 'updating event');

        let _schema = 'fantasy';

        const unlock = await lock(`contest_update_${contest_id}`, 60000);
        var isUpdating = false;
        const isADashboardUser = true;
        await redisCaching.delHMKey(contest_id, REDIS_KEY);
        const serializedData = await redisCaching.getHMKey(contest_id, REDIS_KEY);
        console.log(serializedData);
        if (serializedData) {
            try {
                isUpdating = serializedData === 'true';
            } catch (e) {
                // ignore
            }
        }
        if (isUpdating) {
            logger.error(` ${contest_id} isUpdating = true`);
            unlock();
            return ReE(res, 'A request is already in process', 400);
        }

        await redisCaching.setHMKey(contest_id, REDIS_KEY, 'true');
        unlock();

        let contestinfo = await Contest.getContestById(contest_id, _schema);
        contestinfo = contestinfo[0];

        if (contestinfo.status === 'C' || contestinfo.status === 'CAN') {
            logger.info(`Settling Contest : ${contest_id}. Contest already settled`);
            await redisCaching.delHMKey(contest_id, REDIS_KEY);
            return ReE(res, {
                success: false, message: 'Contest already settled'
            });
        }
        let allEventStr = '';
        if (data['status'] === eventStatusEnum.CANCELLED) {
            logger.info(`Cancelling Contest : ${contest_id}. Starting contest cancellation by user ${req.user.id}`);
            let allContestUsers = await Contest.getAllContestUsers(contest_id, _schema, true);
            if (allContestUsers.length === 0) {
                logger.info(`Cancelling Contest : ${contest_id}. No user participated in the contest.`);
                await Contest.updateContestStatus(data["contest_id"], 'CAN', false);
                await redisCaching.delHMKey(contest_id, REDIS_KEY);
                return ReS(res, { success: true })
            }
            let allUserStr = '';
            for (let user of allContestUsers) {
                if (allUserStr === '') {
                    allUserStr = allUserStr + user.user_id;
                } else {
                    allUserStr = allUserStr + ',' + user.user_id;
                }
            }
            logger.info(`Cancelling Contest : ${contest_id}. All user string: ${allUserStr}`);

            let allContestEvents = await Contest.getAllContestEvents(contest_id, _schema, true);
            for (let eventData of allContestEvents) {
                if (eventData['status'] == 'A' || eventData['status'] == 'F' || eventData['status'] == 'H') {
                    await cancelEvent(eventData['id'], _schema);
                }
            }

            let batchTxns = [];
            if (contestinfo.entry_fee > 0) {
                for (let userData of allContestUsers) {
                    let reward_user = userData['user_id'];
                    let txnData = {};
                    let action = TRANSACTIONS.fundsCoupon;
                    txnData = {
                        'userid': reward_user,
                        'message': `Refunds for Contest cancellation ${contestinfo.id}: ${contestinfo.title}`,
                        'txnid': `CR1000${contest_id}`,
                        'wallettype': 'P',
                        'type': 'CREDIT',
                        'amount': contestinfo.entry_fee,
                        surcharge: 0,
                        action: action
                    };
                    batchTxns.push(txnData);
                }
            }
            logger.info(`Refund : ${contest_id}. Processing refunds for ${batchTxns.length} users`);
            if (batchTxns.length > 0) {
                await UserService.executeTransactions(batchTxns, true, null, 'public');
            }
            await Contest.updateContestStatus(contest_id, 'CAN', false);
            await redisCaching.delHMKey(contest_id, REDIS_KEY);

        } else if (data['status'] === eventStatusEnum.COMPLETE) {
            logger.info(`Settling Contest : ${contest_id}. Starting contest settlement`);
            let allEvents = await Contest.getAllContestEvents(contest_id, _schema, true);
            if (allEvents && Array.isArray(allEvents)) {
                for (const event of allEvents) {
                    if (event['status'] !== 'C' && event['status'] !== 'CAN') {
                        logger.info(`Settling Contest: ${contest_id}. Contest event not settled: ${event.id}`);
                        await redisCaching.delHMKey(contest_id, REDIS_KEY);
                        return ReE(res, {
                            success: false, message: 'Please settle all the events of this Contest first'
                        });
                    }
                    if (allEventStr === '') {
                        allEventStr = allEventStr + event.id;
                    } else {
                        allEventStr = allEventStr + ',' + event.id;
                    }
                }
                logger.info(`Settling Contest : ${contest_id}. All event string: ${allEventStr}`);
                let allContestUser = await Contest.getAllContestUsers(contest_id, _schema, true);
                if (allContestUser.length === 0) {
                    logger.info(`Settling Contest : ${contest_id}. No user participated in the contest.`);
                    await Contest.updateContestStatus(data["contest_id"], 'C', false);
                    await redisCaching.delHMKey(contest_id, REDIS_KEY);
                    return ReS(res, { success: true })
                }
                let allUserStr = '';
                for (let user of allContestUser) {
                    if (allUserStr === '') {
                        allUserStr = allUserStr + user.user_id;
                    } else {
                        allUserStr = allUserStr + ',' + user.user_id;
                    }
                }
                logger.info(`Settling Contest : ${contest_id}. All user string: ${allEventStr}`);

                let allContestEventHistory = await Contest.getAllContestUserHistory(allUserStr, allEventStr, _schema, true);
                if (allContestEventHistory.length === 0) {
                    logger.info(`Settling Contest : ${contest_id}. No event history found. Exiting.`);
                    await Contest.updateContestStatus(data["contest_id"], 'C', false);
                    await redisCaching.delHMKey(contest_id, REDIS_KEY);
                    return ReS(res, { success: true })
                }
                let userEarningMap = {};
                let userEarningObj = [];
                for (let history of allContestEventHistory) {
                    if (history.userid in userEarningMap) {
                        userEarningMap[history.userid] = {
                            earnings: (history.totalreturn + history.totalrefund - history.totalinvested) + userEarningMap[history.userid].earnings,
                            totalreturn: history.totalreturn + userEarningMap[history.userid].totalreturn + history.totalrefund,
                            totalinvested: history.totalinvested + userEarningMap[history.userid].totalinvested,
                            historyIds: userEarningMap[history.userid].historyIds
                        }
                        userEarningMap[history.userid].historyIds.push(parseInt(history.id))
                    } else {
                        userEarningMap[history.userid] = {
                            earnings: (history.totalreturn + history.totalrefund - history.totalinvested),
                            totalreturn: history.totalreturn,
                            totalinvested: history.totalinvested,
                            historyIds: [parseInt(history.id)]
                        }
                    }
                }
                for (let key in userEarningMap) {
                    userEarningObj.push({
                        userid: key,
                        earning: userEarningMap[key].earnings,
                        totalreturn: userEarningMap[key].totalreturn,
                        totalinvested: userEarningMap[key].totalinvested,
                        historyIds: userEarningMap[key].historyIds,
                    })
                }
                userEarningObj.sort((a, b) => {
                    return b.earning - a.earning;
                });
                let totalParticipants = allContestUser.length;

                logger.info(`Settling Contest : ${contest_id}. Total contest participants: ${totalParticipants}`);
                logger.info(`Settling Contest : ${contest_id}. Total contest traders: ${userEarningObj.length}`);
                let winnerCount = Math.floor((contestinfo["winner_percentage"] / 100) * totalParticipants);
                if (winnerCount === 0) {
                    logger.info(`Settling Contest : ${contest_id}. No winners found`);
                    await Contest.updateContestStatus(data["contest_id"], 'C', false);
                    await redisCaching.delHMKey(contest_id, REDIS_KEY);
                    return ReS(res, { success: true })
                }
                if (winnerCount < 1) {
                    winnerCount = 1
                }
                logger.info(`Settling Contest : ${contest_id}. Contest eligible winner count: ${winnerCount}`);
                if (userEarningObj.length < winnerCount) {
                    winnerCount = userEarningObj.length;
                }
                if (winnerCount === 0) {
                    logger.info(`Settling Contest : ${contest_id}. No user traded in contest, returning`);
                    await Contest.updateContestStatus(data["contest_id"], 'C', false);
                    return;
                }
                logger.info(`Settling Contest : ${contest_id}. Final winner count: ${winnerCount}`);
                let prizePool = contestinfo["prize_pool"] * (contestinfo["prize_pool_percent"] / 100);

                const _path = path.join(__dirname, '../controllers', 'contest_price_pool.json');
                let prizeData = [];
                if (fs.existsSync(_path)) {
                    prizeData = fs.readFileSync(_path);
                    prizeData = JSON.parse(prizeData);
                }

                let winnerBracketStart, winnerBracketEnd;
                let distributionArr = [];
                for (let item of prizeData) {
                    if (item['winner_bracket_start'] <= winnerCount && item['winner_bracket_end'] >= winnerCount) {
                        distributionArr = item['distribution'];
                        winnerBracketStart = item['winner_bracket_start'];
                        winnerBracketEnd = item['winner_bracket_end'];
                        break;
                    }
                }
                distributionArr.sort((a, b) => {
                    return a.rank_start - b.rank_start;
                });

                logger.info(`Settling Contest : ${contest_id}. Distribution bracket start rank: ${winnerBracketStart}`);
                logger.info(`Settling Contest : ${contest_id}. Distribution bracket end rank: ${winnerBracketEnd}`);
                logger.info(`Settling Contest : ${contest_id}. Distribution rank bracket count: ${distributionArr.length}`);

                let allUserBalance = await Contest.getAllContestUserBalance(contest_id, _schema, true);
                let userFinalWallets = {};
                for (let balance of allUserBalance) {
                    userFinalWallets[balance.userid] = balance.coins;
                }

                let cumulativeWinnersWalletBalance = 0;
                for (let userEarning of userEarningObj.slice(0, winnerCount)) {
                    if (userFinalWallets.hasOwnProperty(userEarning.userid)) {
                        cumulativeWinnersWalletBalance += userFinalWallets[userEarning.userid];
                    }
                }
                if (contestinfo['contest_format'] === 'format1') {
                    for (let dist of distributionArr) {
                        let start_rank = dist.rank_start;
                        let end_rank = Math.min(winnerCount, dist.rank_end);
                        let percent = dist.percent;
                        let eachUserPercent = percent / (end_rank - start_rank + 1);
                        let batchTxns = [];

                        logger.info(`Settling Contest : ${contest_id}. Rank bracket start: ${start_rank}`);
                        logger.info(`Settling Contest : ${contest_id}. Rank bracket end: ${end_rank}`);
                        logger.info(`Settling Contest : ${contest_id}. Rank bracket percent: ${percent}`);
                        logger.info(`Settling Contest : ${contest_id}. Rank bracket percent per user: ${eachUserPercent}`);

                        for (let i = 0; i <= (end_rank - start_rank); i++) {
                            let user_detail = userEarningObj[(start_rank - 1 + i)];
                            let reward_user = user_detail["userid"];
                            let reward_amount = (eachUserPercent * prizePool) / 100;
                            let txns = await populateHistory(contestinfo, user_detail, reward_user, reward_amount, data, start_rank + i, userFinalWallets);
                            batchTxns.push(...txns);
                        }

                        await UserService.executeTransactions(batchTxns, true, null, 'public');
                    }
                    logger.info(`Settling Contest ${contestinfo.contest_format}: ${contest_id}. All distribution done, closing the contest`);
                }
                else if (contestinfo['contest_format'] === 'format2') {
                    let batchTxns = [];
                    let rank = 1;
                    for (let user_detail of userEarningObj.slice(0, winnerCount)) {
                        let reward_user = user_detail["userid"];
                        let reward_amount = (userFinalWallets[reward_user] / cumulativeWinnersWalletBalance * prizePool)
                        let txns = await populateHistory(contestinfo, user_detail, reward_user, reward_amount, data, rank, userFinalWallets);
                        rank++;
                        batchTxns.push(...txns);
                    }
                    await UserService.executeTransactions(batchTxns, true, null, 'public');
                    logger.info(`Settling Contest ${contestinfo.contest_format}: ${contest_id}. All distribution done, closing the contest`);
                }
            }
        }

        await Contest.updateContest(contest_id, data);
        if (contestinfo['room_id']){
            await DeadSimpleChat.deleteRoom(contestinfo?.room_id);
        }
        // await Contest.updateContestStatus(data["contest_id"], 'C', false);
        await redisCaching.delHMKey(contest_id, REDIS_KEY);
        return ReS(res, { success: true })
    } catch (err) {
        await redisCaching.delHMKey(contest_id, REDIS_KEY);
        console.log("", err)
        if (redisCaching.doesKeyExistinHM(contest_id, REDIS_KEY)) {
            // await redisCaching.setHMKey(data['id'], REDIS_KEY, false);
        }
        next(err);
    }
}

const getLeaderboard = async (req, res) => {
    try {
        let contestInfo = await Contest.getContestById(req?.params?.fantasy_id, 'fantasy');
        if (contestInfo.length <= 0) {
            return ReE(res, 'Contest does not exist', 422, 'Contest does not exist');
        }


        contestInfo = contestInfo[0];

        let leaderboard;
        if (contestInfo.status === 'C') {
            leaderboard = await Contest.getContestWinners(req?.user?.id, req?.params?.fantasy_id);
        } else {
            leaderboard = await Contest.getLeaderboard(req?.user?.id, req?.params?.fantasy_id);
        }

        let prizeData = [];
        const _path = path.join(__dirname, '../controllers', 'contest_price_pool.json');
        if (fs.existsSync(_path)) {
            prizeData = fs.readFileSync(_path);
            prizeData = JSON.parse(prizeData);
        }
        /**
         * {
                "winner_bracket_start": 1,
                "winner_bracket_end": 1,
                "distribution": [
                {
                    "rank_start": 1,
                    "rank_end": 1,
                    "percent": 100
                }
                ]
            },
         */
        let allContestUser = await Contest.getAllContestUsers(req?.params?.fantasy_id, 'fantasy', true);
        const totalParticipants = allContestUser.length;
        let winnerCount = Math.floor((contestInfo["winner_percentage"] / 100) * totalParticipants);
        let traderCount = await Contest.getContestTraders(req?.params?.fantasy_id);

        winnerCount = Math.min(traderCount, winnerCount)
        if (winnerCount == 0) {
            winnerCount = 1;
        }
        const prizePoolSchema = prizeData.find(p => p.winner_bracket_start <= winnerCount && p.winner_bracket_end >= winnerCount);
        const prize_pool_distribution = (prizePoolSchema?.distribution ?? []).map(d => {
            let start_rank = d.rank_start;
            let end_rank = d.rank_end;
            let display_end_rank = Math.min(winnerCount, end_rank)
            let percent = d.percent;
            let eachUserPercent = percent / (display_end_rank - start_rank + 1);
            return {
                key: display_end_rank === start_rank ? `Rank ${start_rank}` : `Rank ${start_rank}-${display_end_rank}`,
                value: parseFloat(contestInfo.calculated_prize_pool * eachUserPercent / 100).toFixed(2)
            }
        });

        return ReS(res, {
            leaderboard,
            prize_pool_distribution,
            winnings_percentage: contestInfo.winner_percentage,
            prize_pool: contestInfo.calculated_prize_pool
        });

    } catch (e) {
        log(e.message);
        return ReE(res, 'Internal server error', 500)
    }
}


const getEventOutcomes = async (req, res) => {
    try {

        // const isDashboardUser = await isDashboardUser(req);

        const events = await Contest.getEventOutcomes(req?.user?.id, req?.params?.id);
        return ReS(res, { events });

    } catch (e) {
        log(e.message)
        throw e;
        next(e)
    }
}

const populateHistory = async (contestinfo, user_detail, reward_user, reward_amount, data, rank, userFinalWallets) => {
    try {
        let _schema = 'fantasy';
        let batchTxns = [];
        let histObj = {};
        histObj.contest_id = data["contest_id"];
        histObj.user_id = reward_user;
        histObj.invest = user_detail.totalinvested;
        histObj.returns = user_detail.totalreturn;
        histObj.earnings = user_detail.earning;
        histObj.rank = rank;
        histObj.prize = reward_amount;
        histObj.final_wallet_amount = userFinalWallets[reward_user];
        histObj.history_ids = user_detail.historyIds;
        logger.info(`Settling Contest : ${data["contest_id"]}. User: ${reward_user}, Reward: ${reward_amount}`);
        await Contest.addContestHistory(histObj, _schema, true);

        let txnData = {};
        if (contestinfo.entry_fee === 0) {
            let action1 = TRANSACTIONS.fundsSignUpBonus;
            let action2 = TRANSACTIONS.fundsCoupon;
            let action3 = TRANSACTIONS.eventSettlement;
            let action4 = TRANSACTIONS.fundsDeposit;
            // txnData = {
            //     'userid': reward_user,
            //     'message': `Winnings for Contest: ${contestinfo.title}`,
            //     'txnid': `CW1000${data["contest_id"]}`,
            //     'wallettype': 'D',
            //     'type': 'CREDIT',
            //     'amount': reward_amount / 4,
            //     surcharge: 0,
            //     action: action1
            // };
            // batchTxns.push(txnData);
            txnData = {
                'userid': reward_user,
                'message': `Winnings for Contest: ${contestinfo.title}`,
                'txnid': `CW1000${data["contest_id"]}`,
                'wallettype': 'P',
                'type': 'CREDIT',
                'amount': reward_amount,
                surcharge: 0,
                action: action2
            };
            batchTxns.push(txnData);
            // txnData = {
            //     'userid': reward_user,
            //     'message': `Winnings for Contest: ${contestinfo.title}`,
            //     'txnid': `CW1000${data["contest_id"]}`,
            //     'wallettype': 'D',
            //     'type': 'CREDIT',
            //     'amount': reward_amount / 4,
            //     surcharge: 0,
            //     action: action3
            // };
            // batchTxns.push(txnData);
            // txnData = {
            //     'userid': reward_user,
            //     'message': `Winnings for Contest: ${contestinfo.title}`,
            //     'txnid': `CW1000${data["contest_id"]}`,
            //     'wallettype': 'D',
            //     'type': 'CREDIT',
            //     'amount': reward_amount / 4,
            //     surcharge: 0,
            //     action: action4
            // };
            // batchTxns.push(txnData);
        } else {
            let action = TRANSACTIONS.fundsCoupon;
            txnData = {
                'userid': reward_user,
                'message': `Winnings for Contest: ${contestinfo.title}`,
                'txnid': `CW1000${data["contest_id"]}`,
                'wallettype': 'P',
                'type': 'CREDIT',
                'amount': reward_amount,
                surcharge: 0,
                action: action
            };
            batchTxns.push(txnData);
        }
        handleNotification({ ...txnData, 'title': contestinfo.title }, "contestSettlementWin");
        return batchTxns;


    } catch (e) {
        log(e.message);
        throw e;
    }
}

const getGoogleClientCreds = async () => {
    const TOKEN_PATH = path.join(process.cwd(), 'token.json');
    const content = fs.readFileSync(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
}

const createBulkContestFromSpreadsheet = async (req, res, next) => {

    const serverURL = serverURLAdmin

    var spreadsheetId = req.body.spreadsheetId
    if (!spreadsheetId) {
        return ReE(res, 'Bad Request', 400)
    }
    async function createContestData(auth) {
        const sheets = google.sheets({ version: 'v4', auth });
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: 'Contest Bulk Req',
        });
        const rows = res.data.values;
        if (!rows || rows.length === 0) {
            console.log('No data found.');
            return;
        }

        var dx = {
            '0': 'start_time',
            '1': 'end_time',
            '2': 'title',
            '3': 'description',
            '4': 'entry_fee',
            '5': 'status',
            '6': 'virtual_credits',
            '7': 'winner_percentage',
            '8': 'prize_pool_percent',
            '9': 'default_prize_pool',
            '10': 'disablesell',
            '11': 'is_fixed_pool',
            '12': 'regions',
            '13': 'start_date',
            '14': 'endsat',
            '15': 'settledate',
            '16': 'title',
            '17': 'range',
            '18': 'liquidity_pool',
            '19': 'max_allowed_position',
            '20': 'source',
            '21': 'resolution',
            '22': 'category'
        }

        const contests = [];
        const posts = [];

        for (let i = 1; i < rows.length; i++) {
            let b = {}
            let a = { Maximum_Return: '100', is_variable_liquidity_pool: true, is_price_editable: false, type: 'Bet', options: [{ text: "YES", id: -9999, odds: 0 }, { text: "NO", id: -9998, odds: 0 }], status: 'A', parent_id: 0 }
            for (let j = 0; j < rows[i].length; j++) {
                if (j < 12) {
                    b[dx[j]] = rows[i][j]
                } else {
                    a[dx[j]] = rows[i][j]
                }
                if (j == 2) {
                    a['contest_title'] = rows[i][j]
                }
            }
            if (a['regions']) {
                a['regions'] = a['regions'].split(',');
            }
            if (a['range']) { //CDA
                a['is_price_editable'] = true;
                delete a['liquidity_pool']
                delete a['liquidity_fee_factor']
                a['is_variable_liquidity_pool'] = false;
            }
            if (a['start_date'] && a['endsat'] && a['title'] && a['settledate']) {
                const exists = contests.some(item => JSON.stringify(item) === JSON.stringify(b));
                if (!exists) {
                    contests.push(b)
                }
                posts.push(a);
            }
        }

        let createContest = async (body) => {
            const headers = {
                'Authorization': getToken(req)
            };
            const response = await axios.post(`${serverURL}/fantasy/createcontest`, { ...body }, { headers });
            return response?.data
        }

        let createEventsBulk = async (events, fantasyId) => {
            const config = {
                headers: { 'Authorization': getToken(req) }
            };
            let url = `${serverURL}/createbulkevents`;
            const postData = { events: events }
            if (fantasyId) {
                postData['fantasy_id'] = fantasyId
                postData['fantasy_type'] = "contest"
            }
            try {
                const response = await axios.post(url, postData, config);
                return response;
            } catch (e) {
                console.log(e);
            }
        }

        for (let i = 0; i < contests.length; i++) {
            let cet = new Date(contests[i]['end_time']);
            cet.setHours(cet.getHours() - 5)
            cet.setMinutes(cet.getMinutes() - 30)
            contests[i]['end_time'] = cet.toISOString();

            let cst = new Date(contests[i]['start_time']);
            cst.setHours(cst.getHours() - 5)
            cst.setMinutes(cst.getMinutes() - 30)
            contests[i]['start_time'] = cst.toISOString();

            contests[i]['disablesell'] = contests[i]['disablesell'] == "YES" ? true : false
            contests[i]['is_fixed_pool'] = contests[i]['is_fixed_pool'] == "YES" ? true : false
            const data = await createContest(contests[i]);
            if (data?.id) {
                let k = [];
                for (let j = 0; j < posts.length; j++) {
                    if (posts[j]['contest_title'] == contests[i]['title']) {
                        delete posts[j]['contest_title'];
                        posts[j]['schema'] = 'fantasy';
                        k.push(posts[j]);
                    }
                }
                let c = parseInt(k.length / 4)
                for (let x = 0; x <= c; x++) {
                    var sliced = k.slice(x * 4, (x + 1) * 4)
                    if (sliced.length > 0) {
                        try {
                            const data2 = await createEventsBulk(sliced, data.id);
                        } catch (e) {
                            console.log(e);
                        }
                    }
                }
            }
        }
    }
    var auth = await getGoogleClientCreds()
    await createContestData(auth);
    return ReS(res, { success: true });
}

const settleContest = async (req, res, next) => {
    const eventsArray = req.body.eventsArray;
    const fantasyId = req.body.contest_id;
    try {
        await settleAllEventsAndContest(req, eventsArray, fantasyId)
        return ReS(res, { success: true })
    } catch (e) {
        return ReE(res, { success: false, message: e })
    }



}
const createDeadSimpleUser = async (req, res, next) => {
    try {
        let err, user_deadsimple;
        let room_id = req?.body?.roomId;

        const fantasy_id = req?.fantasy?.fantasy_id;

        let contestUserData = await Contest.getContestUser(fantasy_id, req?.user?.id, 'fantasy', true);

        if( !(contestUserData?.islivechatenabled) ){
            const DeadSimpleUserData = await DeadSimpleChat.getUser(req.user);
            if (DeadSimpleUserData?._id){
                await DeadSimpleChat.makeChatRoomMember(req.user, room_id);
            }else{
                [err, user_deadsimple] = await to (DeadSimpleChat.createUser(req?.user, room_id));
                await DeadSimpleChat.makeChatRoomMember(req.user, room_id);
            }
            let updateUserData = await Contest.updateContestUser({"contest_id" : fantasy_id, "user_id" : req?.user?.id, "islivechatenabled" : true} , 'fantasy');
        }

        
        return ReS(res, { user_deadsimple });

    } catch (e) {
        next(e)
        log(e.message)
        throw e;
    }
}

module.exports.settleContest = settleContest;
module.exports.getGoogleClientCreds = getGoogleClientCreds;
module.exports.getLiveContests = getLiveContests;
module.exports.getClosedContests = getClosedContests;
module.exports.createContest = createContest;
module.exports.enterContest = enterContest;
module.exports.topupContest = topupContest;
module.exports.getContestBalance = getContestBalance;
module.exports.getContests = getContests;
module.exports.update = update;
module.exports.getLeaderboard = getLeaderboard;
module.exports.getEventOutcomes = getEventOutcomes;
module.exports.createBulkContestFromSpreadsheet = createBulkContestFromSpreadsheet;
module.exports.createDeadSimpleUser = createDeadSimpleUser;
