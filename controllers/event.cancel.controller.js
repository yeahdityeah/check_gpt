
const { to } = require('../services/util.service');
const logger = require('../services/logger.service');
const { Probe, User, Transactions } = require('../models');
const ProbeCalls = require('../models/probecalls');
const ProbeCallsOpen = require('../models/probecallsopen');
const LiquidityUser = require('../models/liquidity.user');
const UserTradingFee = require("../models/user.trading.fee");
const LiquidityProviderTradingFee = require("../models/liquidity.provider.tradingfee.earning");
const TdsUsers = require("../models/tdsUsers");
const { TRANSACTIONS } = require('../utils/constants');
const { UserService } = require('../services/user.service');
const { PartnerService } = require('../services/partner.service');
const { loadToPartnerUserWallet } = require('../utils/partner.ups.wallet');

const cancelEvent = async function (probeId, schema = 'public') {
    logger.info('Event Cancellation: Begins');
    try {
        logger.info('Event Cancellation: Probe-Id: ' + probeId);
        // mark event cancel

        const probeData = await getProbeById(probeId, schema);

        await handleCancellationTrade(probeData, probeId, schema);
        await handleCancellationLiquidity(probeData, probeId, schema);
        if (schema === 'public') {
            await handleCancellationProviderFee(probeData, probeId, schema);
            await handleCancellationReferral(probeData, probeId, schema);
            await handleCancellationEventReferral(probeData, probeId, schema);
            await handleCancellationTDS(probeData, probeId, schema);
        }
        await updateProbeToCancel(probeId, schema);
        logger.info('Event Cancellation: Ends');
    } catch (err) {
        throw (err);
    }
};

const handleCancellationTrade = async (probeData, probeId, schema = 'public') => {
    // Get distinct userids belonging to the probe/event
    const distinctUsersArr = await Probe.getDistinctUsersCountInEvent(probeId, schema);
    const distinctUsers = new Set(distinctUsersArr);
    logger.info('Event Cancellation: Probe-Id: ' + probeId + ' distinct users: ' + distinctUsers);
    let err, txn, txnData, txnId, totalAmount = 0;

    for (const user of distinctUsers) {
        totalAmount = 0;
        let userId = user['userid'];
        logger.info('Event Cancellation: Probe-Id: ' + probeId + ' Userid: ' + userId);
        let probeCalls = await Probe.getAllActiveProbeCallsForUser(probeId, userId, schema);

        let walletEntry = 0;
        // handle probecallsopen for the user
        let openCalls = probeCalls['userProbeCallsOpen'];
        const openCallsObj = await handleEventCancelForProbeOpenCalls(probeId, userId, openCalls, schema);

        logger.info('Event Cancellation: Probe-Id: ' + probeId + ' Userid: ' +
            userId + ' Total amount from probeCallsOpen Unmatched to be refund : ' + openCallsObj.amountUnmatchedRefund);
        walletEntry += openCallsObj.amountUnmatchedRefund;

        // handle probecalls for the user
        let matchedCalls = probeCalls['userProbeCalls'];
        matchedCalls = matchedCalls.filter(p => p.rank !== -1);
        const probeCallsObj = await handleEventCancelForProbeCall(probeId, userId, matchedCalls, schema);
        logger.info('Event Cancellation: Probe-Id: ' + probeId + ' Userid: ' +
            userId + ' Total amount from probeCalls :: Yes : ' + probeCallsObj.yesAmount + ' No : ' + probeCallsObj.noAmount
            + 'Total shares from probecalls ::  yes : ' + probeCallsObj.yesContracts + ' no : ' + probeCallsObj.noContracts);

        // ProbecallsOpen
        // amountUnmatchedRefund: totalAmountUnmatched,
        // yesAmount: totalAmountHoldingYes,
        // noAmount: totalAmountHoldingNo,
        // holdingYes: holdingContractsYes,
        // holdingNo: holdingContractsNo

        // ProbeCall
        // yesAmount: totalAmountYes,
        // noAmount: totalAmountNo,
        // yesContracts: contractsYes,
        // noContracts: contractsNo,
        // holdingYes: holdingYes,
        // holdingNo: holdingNo

        const totalYesInvestement = openCallsObj.yesAmount + probeCallsObj.yesAmount;
        const totalNoInvestement = openCallsObj.noAmount + probeCallsObj.noAmount;
        const totalYesContracts = openCallsObj.holdingYes + probeCallsObj.yesContracts;
        const totalNoContracts = openCallsObj.holdingNo + probeCallsObj.noContracts;
        const yesHolding = openCallsObj.holdingYes + probeCallsObj.holdingYes;
        const noHolding = openCallsObj.holdingNo + probeCallsObj.holdingNo;

        logger.info('Event Cancellation: Probe-Id: ' + probeId + ' Userid: ' +
            userId + ' Yes total investement : ' + totalYesInvestement + ' No total investement : ' + totalNoInvestement +
            ' yes total contracts : ' + totalYesContracts + ' no total contracts : ' + totalNoContracts);

        const yesAvgPrice = totalYesContracts == 0 ? 0 : totalYesInvestement / totalYesContracts;
        const noAvgPrice = totalNoContracts == 0 ? 0 : totalNoInvestement / totalNoContracts;

        const yesRefund = yesAvgPrice * yesHolding;
        const noRefund = noAvgPrice * noHolding;

        walletEntry += yesRefund;
        walletEntry += noRefund;

        logger.info('Event Cancellation: Probe-Id: ' + probeId + ' Userid: ' +
            userId + ' Yes avg price : ' + yesAvgPrice + ' No avg Price : ' + noAvgPrice +
            ' yes total holding : ' + yesHolding + ' no total holding : ' + noHolding);

        logger.info('Event Cancellation: Probe-Id: ' + probeId + ' Userid: ' +
            userId + ' Yes refund : ' + yesRefund + ' No refund : ' + noRefund);

        // handle surcharge refund to user
        totalAmount = await getUserTransactionsForProbe(probeId, userId, schema);
        const totalPurchasedContracts = (totalYesContracts + totalNoContracts);
        const avgTradingFee = totalPurchasedContracts ? totalAmount / totalPurchasedContracts : 0;
        let totalSurchargeRefund = avgTradingFee * (yesHolding + noHolding);

        logger.info('Event Cancellation: Probe-Id: ' + probeId + ' Userid: ' +
            userId + ' Total amount from surcharge: ' + totalAmount + ' Avg trding fee per contract : ' + avgTradingFee
            + ' trading fee refund : ' + totalSurchargeRefund);

        //const amountInTransaction = walletEntry;
        walletEntry += totalSurchargeRefund;

        // Surcharge Refund in case of event cancellation should be negative
        //totalSurchargeRefund = -1 * totalSurchargeRefund;
        txnData = eventCancelRefundTransactionEntry(TRANSACTIONS.eventCancellation, probeData, probeId, walletEntry, userId, 'RF', totalSurchargeRefund);
        logger.info('Event Cancellation: Probe-Id: ' + probeId + ' Userid: ' +
            userId + ' Transaction updated: ' + walletEntry);

        if (probeData['fantasy_id'] && probeData['fantasy_type']) {
            txnData.fantasy_id = probeData.fantasy_id;
            txnData.fantasy_type = probeData.fantasy_type;
        }
        [err, results] = await to(UserService.executeTransactions([txnData], true, null, schema));
        if (err) throw err;
        
        let [errUserProfile, userProfile] = await to(User.findById(userId));
        let partnerConfig, errPartnerConfig;
        if(!errUserProfile) {            
            [errPartnerConfig, partnerConfig] = await to(PartnerService.getPartner(userProfile.partner, userProfile.region, true));
        }
        if(schema === 'public' && partnerConfig) {
            let [errLoadToPartner, loadToPartner] = await to(loadToPartnerUserWallet({
                userData: userProfile,
                partner: partnerConfig,
                orderType: 'cancel',
                eventData: {
                    id: probeId,
                    title: probeData?.title,
                }
            }));
            if(errLoadToPartner) {
                console.log('[Cancellation load to partner wallet error]', errLoadToPartner.message);
            }
            await PartnerService.triggerPartnerNotification(userId, 'CANCELLATION', {
                event_id: probeId,
                event_name: probeData?.title,
            });
        }
        logger.info('Event Cancellation: Probe-Id: ' + probeId + ' Userid: ' +
            userId + ' Wallet updated: Amount - ' + walletEntry);

    }
}

const updateTransactionsAndWallet = async (title, probeId, operations, walletMultipler = 1, schema = 'public') => {
    for (let operation of operations) {
        const { method, data, userId } = operation;
        logger.info(title + 'Event Cancellation: Probe-Id: ' + probeId + ' Userid: ' +
            userId + ' Transaction updated: ' + data.amount);
        data['probeid'] = probeId;
        const probeData = await getProbeById(probeId, schema);
        if (probeData['fantasy_id'] && probeData['fantasy_type']) {
            data.fantasy_id = probeData.fantasy_id;
            data.fantasy_type = probeData.fantasy_type;
        }
        const [err, results] = await to(UserService.executeTransactions([data], false, null, schema));
        // [ err, txn ] = await to( method( data ) );
        if (err) throw err;
        // txnId = txn[0].id;
        //add to wallet and add in transaction
        // await eventCancelRefundWallet( data.amount, userId, txnId, walletMultipler );
        logger.info(title + 'Event Cancellation: Probe-Id: ' + probeId + ' Userid: ' +
            userId + ' Wallet updated: Amount - ' + data.amount);
    }
    return;
}

const handleCancellationTDS = async function (probeData, probeId, schema = 'public') {
    const tdsRefunds = await TdsUsers.getTdsRefund(probeId);
    const operations = tdsRefunds.map(item => {
        const message = 'Refund TDS due to event cancellation'
        const operation = {
            method: User.addTransaction,
            userId: item.userId,
            data: eventCancelRefundTransactionEntry(
                TRANSACTIONS.eventCancellationRefundTds,
                probeData,
                probeId,
                item.totalRefund, // amount
                item.userId, // user ID
                "TDSRF",
                0,
                "CREDIT",
                message
            ),
        };
        return operation
    });

    await updateTransactionsAndWallet("TDS Cancellation", probeId, operations, 1)
    await TdsUsers.deleteTDSonCancellation(probeId);
}

const handleCancellationProviderFee = async function (probeData, probeId, schema = 'public') {
    await LiquidityProviderTradingFee.deleteUnprocessedProvidersEventCancellation(probeId, schema);
    let usersAmounts = await LiquidityProviderTradingFee.getDistinctProvider(probeId, schema);
    const operations = usersAmounts.map(item => {
        const message = 'Reverse provider fee due to event cancellation'
        const operation = {
            method: User.addTransaction,
            userId: item.provider_id,
            data: eventCancelRefundTransactionEntry(
                TRANSACTIONS.eventCancellationReverseLpProviderFee,
                probeData,
                probeId,
                item.provider_sum, // amount
                item.provider_id, // user ID
                "PREV",
                0,
                "DEBIT",
                message
            ),
        };
        return operation
    });

    // Update in DB
    await updateTransactionsAndWallet("Provider Fee Recovery", probeId, operations, -1, schema)

}

const handleCancellationReferral = async function (probeData, probeId, schema = 'public') {
    await UserTradingFee.deleteUnprocessedOnCancel(probeId);
    const referralRecoveries = await UserTradingFee.getTradingFeeRecoveries(probeId);

    const operations = referralRecoveries.map(item => {
        const message = 'Reverse referral fee due to event cancellation'
        const operation = {
            method: User.addTransaction,
            userId: item.userId,
            data: eventCancelRefundTransactionEntry(TRANSACTIONS.eventCancellationReverseUserTradingFee, probeData, probeId, item.totalRecovery, item.userId, 'RREV', 0, 'DEBIT', message)
        }
        return operation
    });

    await updateTransactionsAndWallet("Referral Fee Recovery", probeId, operations, -1)
    await UserTradingFee.setIsDeleted(probeId);
};

const handleCancellationEventReferral = async function (probeData, probeId, schema = 'public') {
    const referralRecoveries = await UserTradingFee.getEventTradingFeeRecoveries(probeId);
    const operations = referralRecoveries.map(item => {
        const message = 'Reverse event referral fee due to event cancellation'
        const operation = {
            method: User.addTransaction,
            userId: item.userId,
            data: eventCancelRefundTransactionEntry(TRANSACTIONS.eventCancellationReverseEventTradingFee, probeData, probeId, item.totalRecovery, item.userId, 'RREV', 0, 'DEBIT', message)
        }
        return operation
    });

    await updateTransactionsAndWallet("Referral Fee Recovery", probeId, operations, -1)
    await UserTradingFee.deleteEventTradingFee(probeId);
};

const handleCancellationLiquidity = async function (probeData, probeId, schema = 'public') {
    await LiquidityUser.setUserLiqCancelEvent(probeId);
    const liquidityRefundUsers = await LiquidityUser.getEventCancelRefund(probeId, schema);

    const operations = liquidityRefundUsers.map((item) => {
        const operation = {
            method: User.addTransaction,
            userId: item.userId,
            data: eventCancelRefundTransactionEntry(
                TRANSACTIONS.eventCancellationRefundLiquidity,
                probeData,
                probeId,
                item.totalRefund,
                item.userId,
                "LRF",
                0,
                "CREDIT",
                `Liquidity refunded ${item.tokens} LP shares x (${item.price} each) due to event cancellation`
            ),
        };
        return operation;
    });

    await updateTransactionsAndWallet("Liquidity Refund", probeId, operations, 1, schema)
};

const getUserTransactionsForProbe = async (probeId, userId, schema = 'public') => {
    let totalAmount = 0;
    let userTransaction = await Transactions.getUserAllTransactions(probeId, userId, schema);
    for (let trans of userTransaction) {
        if (trans['surcharge'] > 0) {
            totalAmount += trans['surcharge'];
        }
    }
    return totalAmount;
};

const eventCancelRefundTransactionEntry =
    (action, probeData, probeId, walletEntry, userId, prefix, surcharge, type = "CREDIT", message = "Refund due to event cancellation") => {
        let txnData = {
            'probeid': probeId,
            'action': action,
            'amount': walletEntry,
            'userid': userId,
            type,
            'txnid': prefix + (100000000 + parseInt(probeId)),
            'wallettype': 'D',
            'message': [probeData['title'], message].join('\n'),
            'surcharge': -1 * surcharge                 // Surcharge Refund in case of event cancellation should be negative
        };
        return txnData;
    };

const eventCancelRefundWallet = async (walletEntry, userId, txnId, mul = 1) => {
    const walletData = { 'coinsd': walletEntry, 'userid': userId, 'transactionId': txnId };
    let [err, _] = await to(User.updateWallet(walletData, mul));
    if (err) throw err;
};

const getProbeById = async (probeId, schema = 'public') => {
    let [err, probeData] = await to(Probe.getProbesById(probeId, schema));
    if (err) throw err;
    return probeData[0];
};

const updateProbeToCancel = async (probeId, schema = 'public') => {
    const data = {
        'id': probeId,
        'status': 'CAN'
    };
    let [err, probeData] = await to(Probe.update(data, schema));
    if (err) throw err;
    return probeData[0];
};

const handleEventCancelForProbeOpenCalls = async (probeId, userId, openCalls, schema = 'public') => {
    let totalAmountUnmatched = 0, totalAmountHoldingYes = 0, holdingContractsYes = 0, totalAmountHoldingNo = 0, holdingContractsNo = 0;

    let probeCallOpenPrimaryKeyList = [];
    for (let openCall of openCalls) {
        let amount;
        if (openCall['status'] === 'H') {
            amount = openCall['lastprice'] * openCall['noofcontracts'];
            if (openCall['callvalue'] === 'Y') {
                totalAmountHoldingYes += amount;
                holdingContractsYes += openCall['noofcontracts'];
            } else {
                totalAmountHoldingNo += amount;
                holdingContractsNo += openCall['noofcontracts'];
            }

        } else {
            amount = openCall['coins'] * openCall['noofcontracts'];
            totalAmountUnmatched += amount;
        }

        //totalAmount += amount;
        probeCallOpenPrimaryKeyList.push(openCall['id']);
    }
    logger.info('Event Cancellation: Probe-Id: ' + probeId + ' Userid: ' +
        userId + ' Probe call open Holding Yes amount: ' + totalAmountHoldingYes + ' Holding Yes amount: ' + holdingContractsYes +
        ' Probe call open Holding No amoun: ' + totalAmountHoldingNo + ' Holding No contracts: ' + holdingContractsNo);

    logger.info('Event Cancellation: Probe-Id: ' + probeId + ' Userid: ' +
        userId + ' Probe call Open Unmatched amount ' + totalAmountUnmatched);

    await insertCancelledProbeCalls(openCalls, schema);
    await deleteFromProbeCallsOpen(probeCallOpenPrimaryKeyList, schema);

    const respObj = {
        amountUnmatchedRefund: totalAmountUnmatched,
        yesAmount: totalAmountHoldingYes,
        noAmount: totalAmountHoldingNo,
        holdingYes: holdingContractsYes,
        holdingNo: holdingContractsNo
    }
    return respObj;
};

const handleEventCancelForProbeCall = async (probeId, userId, matchedCalls, schema = 'public') => {
    let totalAmountYes = 0, totalAmountNo = 0, holdingYes = 0, holdingNo = 0, contractsYes = 0, contractsNo = 0, amount = 0;

    for (let matchedCall of matchedCalls) {
        if (matchedCall.status == 'A') {
            amount = matchedCall['coins'] * matchedCall['noofcontracts'];
            if (matchedCall.callvalue == 'Y') {
                totalAmountYes += amount;
                holdingYes += matchedCall.noofcontracts;
                contractsYes += matchedCall.noofcontracts;
            } else {
                totalAmountNo += amount;
                holdingNo += matchedCall.noofcontracts;
                contractsNo += matchedCall.noofcontracts;
            }

            const data = {};
            data['status'] = 'CN';
            data['updatedat'] = 'now()';
            await to(ProbeCalls.update(data, matchedCall.id, schema));

        } else if (matchedCall.status == 'MG' || matchedCall.status == 'EX') {

            const price = matchedCall['lastprice'];
            amount = price * matchedCall['noofcontracts'];
            if (matchedCall.callvalue == 'Y') {
                totalAmountYes += amount;
                //holdingYes += matchedCall.noofcontracts;
                contractsYes += matchedCall.noofcontracts;
            } else {
                totalAmountNo += amount;
                //holdingNo += matchedCall.noofcontracts;
                contractsNo += matchedCall.noofcontracts;
            }
        }
    }
    const dataObj = {
        yesAmount: totalAmountYes,
        noAmount: totalAmountNo,
        yesContracts: contractsYes,
        noContracts: contractsNo,
        holdingYes: holdingYes,
        holdingNo: holdingNo
    }
    return dataObj;
};

const insertCancelledProbeCalls = async (records, schema = 'public') => {
    const batchDataObj = [];
    if (records.length === 0) {
        return;
    }

    for (const record of records) {
        if (record.id) {
            delete record.id;
        }
        const data = Object.assign({}, record, { status: 'CN' }, { rank: -2 }, { updatedat: 'now()' })
        batchDataObj.push(data);
    }

    const probeCallsResultSet = await to(ProbeCalls.insert(batchDataObj, schema));
    if (probeCallsResultSet[0]) {
        throw probeCallsResultSet[0];
    }
};

const deleteFromProbeCallsOpen = async (records, schema = 'public') => {
    const probeCallsOpenResultSet = await to(ProbeCallsOpen.delete(records, schema));
    if (probeCallsOpenResultSet[0]) {
        throw probeCallsOpenResultSet[0];
    }
};


module.exports.cancelEvent = cancelEvent;
