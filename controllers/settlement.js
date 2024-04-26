const { Probe, User, ProbeV2, CurrentPrice, History } = require('../models');
const { to } = require('../services/util.service');
const logger = require('../services/logger.service');
const { redisCaching } = require('../services/cache.service');
const eventStatusEnum = require('../utils/eventStatusEnum.util');
const { getOpenCallsCachingKey, CANCEL } = require('../utils/constants');
const { probeSettlementKeyPrefix } = require('../utils/constants');
const LiquidityEvent = require('../models/liquidity.event');
const LiquidityUsers = require('../models/liquidity.user');
const { LiquidityPool } = require('../models/liquidity.pool');
const CONFIG = require('../config/config');
const TdsUsers = require('../models/tdsUsers');
const { DEBIT } = require('../utils/constants');
const { getTradingFee, updateBonusCredits } = require('../utils/tradingfee.util.js');
const UserTradingFee = require("../models/user.trading.fee");
const { TRANSACTIONS } = require('../utils/constants');
const { UserService } = require('../services/user.service');
const { PartnerService } = require('../services/partner.service');
const { loadToPartnerUserWallet } = require('../utils/partner.ups.wallet');

const toFloat = (data) => parseFloat(parseFloat(data.toString()).toFixed(2));

async function settle(data, eventStatus, eventTitle, schema) {
    var reSettle = false;
    if (eventStatus == eventStatusEnum.COMPLETE) {
        reSettle = true;
    }
    const sFee = 0.1, takeRate = 0.0025;
    let userData = {};
    let userDataTDS = {};
    let _probeCalls, _lpUsers;
    const _probeId = data['id'];
    var callsData = { 'probeid': data['id'] };
    let colsArray = ['totalamount', 'is_price_editable', 'is_variable_liquidity_pool'];
    if (schema == 'fantasy') {
        colsArray.push('fantasy_type', 'fantasy_id');
    }
    let [er, maxReturn] = await to(Probe.getProbeById(data['id'], colsArray, true, schema));
    if (er) throw er;

    if (data['settlement'] === undefined) {
        logger.error(`ERROR: Can not distinguish whether to settle or refund, EventId: ${_probeId}`);
        return;
    }
    /* Remove the event from redis hashmaps only after settling the event */
    if (data['settlement'] === true) {
        redisCaching.delHMKey(_probeId, 'eventLiveStatsYT');
        redisCaching.delHMKey(_probeId, 'eventLiveStatsCrypto');
        redisCaching.delHMKey(_probeId, 'eventLiveStatsTwitter');
        redisCaching.delHMKey(_probeId, 'eventInfoMap');
        redisCaching.delHMKey(_probeId, 'eventCpMap');
        redisCaching.delKey(getOpenCallsCachingKey(_probeId, schema));

        const isEntryPresent = await CurrentPrice.doesCurrentPriceExist(_probeId, schema);
        if (isEntryPresent === true) {
            CurrentPrice.deleteCurrentPrice(_probeId, schema);
            CurrentPrice.deleteCurrentPriceTemp(_probeId, schema);
        }
    }

    try {
        let lpEventsErr, lpEventRow = [], lpPrice;
        if (maxReturn['is_variable_liquidity_pool']) {
            [lpEventsErr, lpEventRow] = await to(LiquidityEvent.getLatestRow(_probeId, true, schema));
            if (lpEventsErr) {
                throw lpEventsErr;
            }
        }
        if (lpEventRow.length > 0 && !reSettle) {
            const pranavUserId = process.env.NODE_ENV === 'production' ? 396569 : 89;
            let poolPrice = (lpEventRow[0]['quantity_yes'] * (data['correctvalue'] === 'Y' ? 100 : 0))
                + (lpEventRow[0]['quantity_no'] * (data['correctvalue'] === 'N' ? 100 : 0));
            let newLiqData = {
                user_id: pranavUserId,
                probe_id: _probeId,
                liquidity_pool_price: poolPrice,
                liquidity_pool_constant: lpEventRow[0]['liquidity_pool_constant'],
                liquidity_tokens_count: lpEventRow[0]['liquidity_tokens_count'],
                liquidity_token_price: poolPrice / lpEventRow[0]['liquidity_tokens_count'],
                quantity_yes: lpEventRow[0]['quantity_yes'],
                quantity_no: lpEventRow[0]['quantity_no'],
                price_per_contract_yes: data['correctvalue'] === 'Y' ? 100 : 0,
                price_per_contract_no: data['correctvalue'] === 'N' ? 100 : 0,
                message: 'Liquidity Settled for event: ' + _probeId
            };
            let liquidityResp = await to(LiquidityEvent.addLiquidity(newLiqData, schema));
            lpPrice = poolPrice / lpEventRow[0]['liquidity_tokens_count'];
            lpEventRow[0] = newLiqData;
        }

        let perContractReturns = maxReturn.totalamount;
        let notifArray = [];
        let _yN = data['correctvalue'] == 'Y' ? 'YES' : 'NO';

        if (data['settlement'] === true) {
            if (eventStatus == eventStatusEnum.COMPLETE || eventStatus == eventStatusEnum.ACTIVE || eventStatus == eventStatusEnum.FREEZE || eventStatus == eventStatusEnum.RESET || eventStatus == eventStatusEnum.HALT) {
                let matchedCallsData = Object.assign({}, callsData);
                let err;
                [err, _probeCalls] = await to(ProbeV2.getProbeCallsWithUsers(matchedCallsData, schema));
                if (err) throw err;

                _probeCalls = _probeCalls.filter(p => p.rank !== -1);

                for (let i = 0; i < _probeCalls.length; i++) {
                    let _userId = _probeCalls[i].userid;
                    if (!userData[_userId]) {
                        userData[_userId] = {
                            totalInvested: 0,
                            amount: 0,
                            lpamount: 0,
                            unsettledAmount: 0,
                            fcmtoken: _probeCalls[i]['fcmtoken'],
                            number: _probeCalls[i]['number'],
                            id: parseInt(_probeId),
                            type: 'S',
                            surcharge: 0,
                            matched_contracts: 0
                        }
                    }
                    if (_probeCalls[i]['status'] === eventStatusEnum.REFUNDED || _probeCalls[i]['status'] === eventStatusEnum.CANCELLED)
                        continue;
                    if (_probeCalls[i]['status'] === eventStatusEnum.HOLDING) {
                        if (_probeCalls[i]['callvalue'] == data['correctvalue']) {
                            userData[_userId]['amount'] += perContractReturns * _probeCalls[i]['noofcontracts'];
                            userData[_userId]['matched_contracts'] += _probeCalls[i]['noofcontracts'];
                        }
                        userData[_userId]['totalInvested'] += _probeCalls[i]['lastprice'] * _probeCalls[i]['noofcontracts'];
                    } else {
                        userData[_userId]['totalInvested'] += _probeCalls[i]['coins'] * _probeCalls[i]['noofcontracts'];
                        if (_probeCalls[i]['rank'] == -1) {
                            if (_probeCalls[i]['status'] == 'A')
                                // userData[_userId]['surcharge'] += (takeRate * _probeCalls[i]['coins'] * _probeCalls[i]['noofcontracts']);
                                if (_probeCalls[i]['status'] != eventStatusEnum.REFUNDED)
                                    userData[_userId]['amount'] += toFloat(_probeCalls[i]['coins'] * _probeCalls[i]['noofcontracts']);
                        } else if (_probeCalls[i]['rank'] == 0 || _probeCalls[i]['rank'] == 1) {
                            if (_probeCalls[i]['callvalue'] == data['correctvalue']) {
                                _probeCalls[i].returns = toFloat(perContractReturns);
                                if (_probeCalls[i]['rank'] == 0) {
                                    _probeCalls[i].rank = 1;
                                    let [err, _probeCallRows] = await to(Probe.updateCall(_probeCalls[i], schema));
                                }
                                if (err) {
                                    logger.error(`ERRORCALLCLOSE: UserId : ${_userId}, EventId: ${_probeId}`);
                                    logger.error(err.toString());
                                }
                                userData[_userId]['amount'] += toFloat(perContractReturns * _probeCalls[i]['noofcontracts']);
                                userData[_userId]['matched_contracts'] += _probeCalls[i]['noofcontracts'];
                            }
                        }
                    }
                }
            }
            let [err, _probeCallsOpen] = await to(Probe.getProbeCallsOpen(callsData, schema));
            if (err) throw err;

            let _unsettledBets = [], _unsettledBetsRows;

            for (let i = 0; i < _probeCallsOpen.length; i++) {
                let _userId = _probeCallsOpen[i].userid;
                // if (_userId != 1) {
                if (!userData[_userId]) {
                    userData[_userId] = {
                        totalInvested: 0, amount: 0, unsettledAmount: 0,
                        lpamount: 0, fcmtoken: _probeCallsOpen[i]['fcmtoken'],
                        number: _probeCallsOpen[i]['number'],
                        id: parseInt(_probeId),
                        type: 'U', surcharge: 0,
                        matched_contracts: 0
                    }
                } else {
                    if (userData[_userId]['amount'] == 0) {
                        userData[_userId]['type'] = 'U';
                    }
                }
                if (_probeCallsOpen[i]['status'] == eventStatusEnum.ACTIVE) {
                    userData[_userId]['unsettledAmount'] += toFloat(_probeCallsOpen[i]['coins'] * _probeCallsOpen[i]['noofcontracts']);
                    userData[_userId]['amount'] += toFloat(_probeCallsOpen[i]['coins'] * _probeCallsOpen[i]['noofcontracts']);
                    userData[_userId]['totalInvested'] += toFloat(_probeCallsOpen[i]['coins'] * _probeCallsOpen[i]['noofcontracts']);
                    // userData[_userId]['surcharge'] += (takeRate * _probeCallsOpen[i]['coins'] * _probeCallsOpen[i]['noofcontracts'])

                    let oRank = -1;
                    let fillOrder = Object.assign({}, { 'probeid': _probeId, 'userid': _userId, 'coins': _probeCallsOpen[i]['coins'], 'noofcontracts': _probeCallsOpen[i]['noofcontracts'], 'rank': oRank, 'callvalue': _probeCallsOpen[i].callvalue, 'returns': 0, 'orderid': _probeCallsOpen[i].orderid, 'status': _probeCallsOpen[i].status, 'orderid': _probeCallsOpen[i].orderid, 'execid': _probeCallsOpen[i].execid, 'lastprice': _probeCallsOpen[i].lastprice, originaltimestamp: _probeCallsOpen[i].originaltimestamp });
                    _unsettledBets.push(fillOrder);
                } else if (_probeCallsOpen[i]['status'] == eventStatusEnum.HOLDING) {
                    if (_probeCallsOpen[i]['callvalue'] == data['correctvalue']) {
                        userData[_userId]['amount'] += toFloat(perContractReturns * _probeCallsOpen[i]['noofcontracts']);
                        userData[_userId]['matched_contracts'] += _probeCallsOpen[i]['noofcontracts'];
                    }
                    let oRank = _probeCallsOpen[i].status == eventStatusEnum.HOLDING ? 0 : -1;
                    let fillOrder = Object.assign({}, { 'probeid': _probeId, 'userid': _userId, 'coins': _probeCallsOpen[i]['coins'], 'noofcontracts': _probeCallsOpen[i]['noofcontracts'], 'rank': oRank, 'callvalue': _probeCallsOpen[i].callvalue, 'returns': 0, 'orderid': _probeCallsOpen[i].orderid, 'status': _probeCallsOpen[i].status, 'orderid': _probeCallsOpen[i].orderid, 'execid': _probeCallsOpen[i].execid, 'lastprice': _probeCallsOpen[i].lastprice, originaltimestamp: _probeCallsOpen[i].originaltimestamp });
                    _unsettledBets.push(fillOrder);
                }
            }

            [err, _lpUsers] = await to(LiquidityUsers.getAllUsersLiquidityForProbe(_probeId, schema));

            userDataTDS = JSON.parse(JSON.stringify(userData));
            for (let i = 0; i < _lpUsers.length; i++) {
                let _userId = _lpUsers[i]['user_id'];
                if (!userData[_userId]) {
                    userData[_userId] = {
                        totalInvested: 0, amount: 0, lpamount: 0,
                        unsettledAmount: 0, fcmtoken: _lpUsers[i]['fcmtoken'],
                        number: _lpUsers[i]['number'],
                        id: parseInt(_probeId), type: 'U',
                        surcharge: 0,
                        matched_contracts: 0
                    };
                }
                userData[_userId]['lpamount'] += toFloat(lpPrice * _lpUsers[i]['total_liquidity_tokens_count']);
                userData[_userId]['amount'] += userData[_userId]['lpamount'];
            }

            // Handle remaining liquidity return for liquidity provider starts
            if (maxReturn['is_price_editable'] === false && maxReturn['is_variable_liquidity_pool'] === false) {
                let [lspErr, liqPoolStatic] = await to(LiquidityPool.get(parseInt(_probeId),
                    ['quantity_no', 'quantity_yes', 'price_per_contract_yes', 'price_per_contract_no']));
                if (!lspErr && liqPoolStatic != undefined) {
                    const fixedLiqPoolUserId = process.env.NODE_ENV === 'production' ? 433061 : 89;
                    if (!userData[fixedLiqPoolUserId]) {
                        userData[fixedLiqPoolUserId] = {
                            totalInvested: 0,
                            amount: 0,
                            unsettledAmount: 0,
                            fcmtoken: undefined,
                            number: undefined,
                            id: parseInt(_probeId),
                            type: 'U',
                            surcharge: 0,
                            matched_contracts: 0,
                            lpamount: 0

                        };
                    }
                    if (data['correctvalue'] === 'Y') {
                        userData[fixedLiqPoolUserId]['amount'] += toFloat(liqPoolStatic['quantity_yes'] * 100);
                    } else {
                        userData[fixedLiqPoolUserId]['amount'] += toFloat(liqPoolStatic['quantity_no'] * 100);
                    }
                }
            }
            // Handle remaining liquidity return for liquidity provider ends

            if (_unsettledBets.length > 0) {
                [err, _unsettledBetsRows] = await to(Probe.putCalls(_unsettledBets, schema));
                if (err) throw err;

                [err, _unsettledBets] = await to(Probe.deleteCallOpen({ 'probeid': _probeId }, schema));
                if (err) throw err;
            }
        }
        else if (data['settlement'] === false) {
            let [err, _probeCallsOpen] = await to(Probe.getProbeCallsOpen(callsData, schema));
            if (err) throw err;
            let _unsettledBets = [], _unsettledBetsRows;

            for (let i = 0; i < _probeCallsOpen.length; i++) {
                let _userId = _probeCallsOpen[i].userid;
                if (!userData[_userId]) {
                    userData[_userId] = {
                        totalInvested: 0, amount: 0, unsettledAmount: 0,
                        fcmtoken: _probeCallsOpen[i]['fcmtoken'], number: _probeCallsOpen[i]['number'],
                        id: parseInt(_probeId), type: 'U', surcharge: 0,
                        matched_contracts: 0, lpamount: 0
                    };
                } else {
                    if (userData[_userId]['amount'] == 0) {
                        userData[_userId]['type'] = 'U';
                    }
                }
                let oRank, fillOrder;
                if (_probeCallsOpen[i]['status'] == eventStatusEnum.ACTIVE) {
                    userData[_userId]['unsettledAmount'] += toFloat(_probeCallsOpen[i]['coins'] * _probeCallsOpen[i]['noofcontracts']);
                    userData[_userId]['amount'] += toFloat(_probeCallsOpen[i]['coins'] * _probeCallsOpen[i]['noofcontracts']);
                    userData[_userId]['totalInvested'] += toFloat(_probeCallsOpen[i]['coins'] * _probeCallsOpen[i]['noofcontracts']);
                    // userData[_userId]['surcharge'] += (takeRate * _probeCallsOpen[i]['coins'] * _probeCallsOpen[i]['noofcontracts'])
                }
                oRank = _probeCallsOpen[i].status == eventStatusEnum.HOLDING ? 0 : -1;
                fillOrder = Object.assign({}, {
                    'probeid': _probeId,
                    'userid': _userId,
                    'coins': _probeCallsOpen[i]['coins'],
                    'noofcontracts': _probeCallsOpen[i]['noofcontracts'],
                    'rank': oRank,
                    'callvalue': _probeCallsOpen[i].callvalue,
                    'returns': 0,
                    'orderid': _probeCallsOpen[i].orderid,
                    'status': _probeCallsOpen[i].status == eventStatusEnum.HOLDING ? eventStatusEnum.HOLDING : eventStatusEnum.REFUNDED,
                    'execid': _probeCallsOpen[i].execid,
                    'lastprice': _probeCallsOpen[i].lastprice
                });
                _unsettledBets.push(fillOrder);
            }
            if (_unsettledBets.length > 0) {
                [err, _unsettledBetsRows] = await to(Probe.putCalls(_unsettledBets, schema));
                if (err) throw err;

                [err, _unsettledBets] = await to(Probe.deleteCallOpen({ 'probeid': _probeId }, schema));
                if (err) throw err;
            }
        }

        for (let uid in userData) {
            let amount = userData[uid]['amount'];
            let fcmToken = userData[uid]['fcmtoken'];
            let [errUserProfile, userProfile] = await to(User.findById(uid));
            let partnerConfig, errPartnerConfig;
            if(!errUserProfile) {
                [errPartnerConfig, partnerConfig] = await to(PartnerService.getPartner(userProfile.partner, userProfile.region, true));
            }
            
            let title = `Oops! You lost`;
            let msgBody;
            let totalInvested = userData[uid]['totalInvested'];
            const lossAmount = Math.max(totalInvested - amount, 0);
            let batchTxns = [];
            console.log(`userid: ${uid}, probeid: ${_probeId}, lossAmount: ${lossAmount} data: ${JSON.stringify(userData[uid])}`)

            let walletData = { 'userid': uid };
            if (data['settlement'] === true)
                msgBody = `The market "${eventTitle}" is settled for ${_yN}`;
            else
                msgBody = `The market "${eventTitle}" is closed! Money refunded for unmatched orders`
            if (amount == 0) {
                const jsonData = { 'probeid': _probeId, 'title': title, 'type': 'N', 'body': msgBody };
                if (data['settlement'] === true) {
                    if (!reSettle) {
                        notifArray.push(Object.assign(jsonData, { 'fcmToken': fcmToken, userId: uid }));
                    }
                }
                if (lossAmount > 0 && schema !== 'fantasy' && userProfile.partner === 1) {
                    // batchTxns.push({
                    //     wallettype: 'D',
                    //     userid: uid,
                    //     probeid: _probeId, action: TRANSACTIONS.movePromoBalance,
                    //     txnid: "SPTD" + 'S' + (100000000 + parseInt(_probeId)),
                    //     amount: CONFIG.PROMO_MOVEMENT_PERCENT * 0.01 * lossAmount,
                    //     type: "CREDIT",
                    //     message: "Bonus transferred to deposits",
                    //     surcharge: 0,
                    //     ...(schema == 'fantasy' && { 'fantasy_type': maxReturn['fantasy_type'], 'fantasy_id': maxReturn['fantasy_id'] })
                    // });
                }
                await UserService.executeTransactions(batchTxns, true, null, schema);
                console.log(`Settling probeid ${_probeId} for user ${uid} of partner id ${partnerConfig?.id}`)
                if(schema === 'public' && partnerConfig) {
                    let [errLoadToPartner, loadToPartner] = await to(loadToPartnerUserWallet({
                        userData: userProfile,
                        partner: partnerConfig,
                        eventData: {
                            id: data?.id,
                            title:eventTitle,
                        }
                    }));
                    if(errLoadToPartner) {
                        console.log('[Settlement load to partner wallet error]', errLoadToPartner.message);
                    }
                }
                continue;
            }
            let unsettledAmount = userData[uid]['unsettledAmount'];
            let txnId;
            if (data['settlement'] === true) {
                txnId = 'S' + (100000000 + parseInt(_probeId));
                let matchedCallsAmount = userData[uid]['amount'] - userData[uid]['unsettledAmount'] - userData[uid]['lpamount']
                userData[uid]['surcharge'] = 0;
                if (schema === 'public') {
                    userData[uid]['surcharge'] = await getTradingFee('SETTLEMENT', data['correctvalue'], userData[uid]['matched_contracts'], 100, parseInt(_probeId), uid, maxReturn['is_price_editable'], false);
                }
            }
            else {
                txnId = 'RF' + (100000000 + parseInt(_probeId));
            }
            let sCharge = toFloat(userData[uid]['surcharge']);
            let txnData = { 'amount': userData[uid]['amount'], 'userid': uid, 'type': 'CREDIT', 'txnid': txnId, 'wallettype': 'W', 'message': '', 'surcharge': sCharge };
            title = `${parseFloat(amount.toFixed(2))} credited to your wallet`;

            if (sCharge > 0) {
                persistTradingFee(sCharge, _probeId, uid);
            }
            if (unsettledAmount > 0) {
                amount -= unsettledAmount;
                batchTxns.push({ 'amount': unsettledAmount, 'userid': uid, 'type': 'CREDIT', 'txnid': 'RF' + (100000000 + parseInt(_probeId)), 'wallettype': 'D', 'message': "Refund of unmatched orders", 'surcharge': 0, probeid: _probeId, action: TRANSACTIONS.eventCancellation, ...(schema == 'fantasy' && { 'fantasy_type': maxReturn['fantasy_type'], 'fantasy_id': maxReturn['fantasy_id'] }) });
                const results = await UserService.executeTransactions(batchTxns, true, null, schema);
                if(schema === 'public' && partnerConfig) {
                    let [errLoadToPartner, loadToPartner] = await to(loadToPartnerUserWallet({
                        userData: userProfile,
                        partner: partnerConfig,
                        orderType: 'cancel',
                        eventData: {
                            id: data?.id,
                            title:eventTitle,
                        }
                    }));
                    if(errLoadToPartner) {
                        console.log('[Settlement load to partner wallet error]', errLoadToPartner.message);
                    }
                }
                batchTxns = [];
            }
            if (amount > 0) {
                walletData['coinsd'] = amount - parseFloat(sCharge);
                let sMsg;
                if (data['settlement'] === true)
                    sMsg = `Market: ${eventTitle}\nSettled (${walletData['coinsd'].toFixed(2)} credited)`;
                else
                    sMsg = `Market: ${eventTitle}\nClosed (${walletData['coinsd'].toFixed(2)} credited)`;
                batchTxns.push({ 'amount': amount, 'userid': uid, 'type': 'CREDIT', 'txnid': txnId, 'wallettype': 'D', 'message': sMsg, 'surcharge': sCharge, probeid: _probeId, action: TRANSACTIONS.eventSettlement, ...(schema == 'fantasy' && { 'fantasy_type': maxReturn['fantasy_type'], 'fantasy_id': maxReturn['fantasy_id'] }) });
            }

            if (lossAmount > 0 && schema != 'fantasy' && userProfile.partner === 1) {
                // batchTxns.push({
                //     wallettype: 'D',
                //     userid: uid,
                //     probeid: _probeId, action: TRANSACTIONS.movePromoBalance,
                //     txnid: "SPTD" + txnId,
                //     amount: CONFIG.PROMO_MOVEMENT_PERCENT * 0.01 * lossAmount,
                //     type: "CREDIT",
                //     message: "Bonus transferred to deposits",
                //     surcharge: 0,
                //     ...(schema == 'fantasy' && { 'fantasy_type': maxReturn['fantasy_type'], 'fantasy_id': maxReturn['fantasy_id'] })
                // });
            }

            if (amount == 0 && userData[uid]['type'] == 'S') {
                // title = `Oops!`;
                // msgBody = `Position taken by you on event ${eventTitle} turned out to be incorrect. Better luck next time!`
                txnData = null;
                walletData = null;
            }

            // let transactionId = undefined;
            let jsonData = { 'probeid': _probeId, 'title': title, 'type': 'N', 'body': msgBody };
            var notifyUser = false;
            if (batchTxns.length > 0) {
                let err, _txns = [];
                // if (reSettle) {
                    [err, _txns] = await to(User.getTransactions({ 'userid': uid, 'txnid': txnId }, schema, false));
                    if (err) {
                        logger.error(`ERROR (Settlement.js): UserId : ${uid}, EventId: ${_probeId}`);
                        logger.error(err.toString());
                    }
                // }
                if(_txns?.length > 0) {
                    console.log(`[SETTLEMENT ${txnId}] Duplicate found for user ${uid}`);
                }
                if (!_txns || _txns.length == 0) {
                    // [err, _txns] = await to(User.addBatchTransaction(batchTxns));
                    const results = await UserService.executeTransactions(batchTxns, true, null, schema);
                    if(schema === 'public' && partnerConfig) {
                        let [errLoadToPartner, loadToPartner] = await to(loadToPartnerUserWallet({
                            userData: userProfile,
                            partner: partnerConfig,
                            eventData: {
                                id: data?.id,
                                title:eventTitle,
                            }
                        }));
                        if(errLoadToPartner) {
                            console.log('[Settlement load to partner wallet error]', errLoadToPartner.message);
                        }
                    }
                    _txns = results.map(t => t.transaction)
                    if (err) {
                        logger.error(`ERROR (Settlement.js): UserId : ${uid}, EventId: ${_probeId}`);
                        logger.error(err.toString());
                    }
                    // await updateBonusCredits(uid, _probeId, 'settle');
                }
                // transactionId = _txns[0]['id'];
            }
            if (!reSettle) {
                notifArray.push(Object.assign(jsonData, { 'fcmToken': fcmToken, userId: uid }));
            } else if (reSettle && notifyUser) {
                notifArray.push(Object.assign(jsonData, { 'fcmToken': fcmToken, userId: uid }));
            }
            await PartnerService.triggerPartnerNotification(uid, 'SETTLEMENT', {
                event_id: data?.id,
                event_name: eventTitle,
                outcome: _yN
            });
        }

        if (data['settlement'] === true)
            logger.info(`Settlement done for Event: ${data['id']}`);
        else
            logger.info(`Money refunded for unmatched calls for Event: ${data['id']}`);

        History.removeFromHistory(data['id'], schema);

        await redisCaching.setKey(probeSettlementKeyPrefix + _probeId, JSON.stringify(notifArray), 3 * 60 * 60);
    } catch (e) {
        console.log('Settlement Error', _probeId, e);
        logger.error(JSON.stringify(e));
        throw e;
    }
    return { "status": "success" };
}

const persistTradingFee = async (surCharges, probeId, userId) => {
    logger.info(`Referral fee: surcharge: "${surCharges}"`);
    const probeInfo = await Probe.getProbeById(probeId, ['id', 'probe_type']);
    if (surCharges > 0 && probeInfo?.probe_type !== 'promo') {
        const tradingFee = surCharges.toFixed(2);
        const oTradingFee = {
            userid: userId,
            eventid: probeId,
            trading_fee: tradingFee

        };
        const divisionFactor = 100 / CONFIG.REFERRAL_PERCENTAGE_NEW;
        oTradingFee['referrer_payout_amount'] = parseFloat((oTradingFee.trading_fee / divisionFactor).toFixed(2));
        logger.info(`Referral fee: referral payout: "${oTradingFee['referrer_payout_amount']}"`);
        try {
            const resultSet = await User.getReferrerIdAndEarning(userId);
            logger.info(`Referral fee: getReferrerIdAndEarning: "${resultSet}"`);
            if (resultSet.length === 0 || !resultSet[0].referrer_id) {
                logger.info(`Referral fee: Request: "${userId}" - referrer data not found`);
                return;
            }
            if (!resultSet[0].sum) {
                resultSet[0].sum = 0;
            }
            const earned = resultSet[0].sum;
            if (earned >= CONFIG.MAX_REFERRAL_EARN_LIMIT) {
                logger.info(`Referral fee: Already earned: "${userId}" - more than limit`);
                const msg = `Not recording trading fee for referral because referrer has earned more than max limit (${CONFIG.MAX_REFERRAL_EARN_LIMIT})`;
                logger.warn(`Request: "${userId}" - ${msg}`);
                return;
            }

            if (CONFIG.REFERRAL_END_DATE_MS <= Date.now()) {
                logger.info(`Referral fee: Program expired: "${userId}"`);
                const msg = `Not recording trading fee for referral because end date (${new Date(CONFIG.REFERRAL_END_DATE_MS)}) has passed`;
                logger.warn(`Request: "${userId}" - ${msg}`);
                return;
            }

            oTradingFee['referrer_id'] = resultSet[0]['referrer_id'];
            logger.info(`Referral fee: Final action: "${oTradingFee['referrer_id']}"`);
            await UserTradingFee.insert(oTradingFee);
            logger.info(`Referral fee: Request: "${userId}" - persisted trading fee data: ${JSON.stringify(oTradingFee)}`);
        } catch (e) {
            lo
            logger.error(`Referral fee: Request: "${userId}" - Failed while persisting data in user_trading_fee table. Data: ${JSON.stringify(oTradingFee)}`);
        }
    }
}

process.on("message", async function (message) {
    const { data, eventStatus, eventTitle, schema } = JSON.parse(message);
    try {
        var nAr = await settle(data, eventStatus, eventTitle, schema);
        var response = JSON.stringify({ 'status': 'success', 'notifArray': nAr });
        process.send(response);
        process.exit();
    } catch (e) {
        var response = JSON.stringify({ 'status': 'error', 'message': e.toString() });
        process.send(response);
        process.exit();
    }
});