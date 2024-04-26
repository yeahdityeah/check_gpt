const lodash = require('lodash');
const crypto = require('crypto');
const axios = require('axios');
const { usersCacheService, redisCaching } = require('../services/cache.service');
const { User, UserPreference, Payments, Partner } = require('../models');
const { to, ReE, ReS, getUID, isNumber } = require('../services/util.service');
const customStorage = require('../middleware/customStorage');
const { isDashboardUser } = require('../middleware/dashboard.user');
const CONFIG = require('../config/config');
const logger = require('../services/logger.service');
// const socketService = require('../services/socket.service');
const CommonController = require('./common.controller');
const UserController = require('./user.controller');
const { isEligibleToAdd } = require('../utils/checkRecharge.util');
const { promisify } = require('util');
const lock = promisify(require('redis-lock')(redisCaching.client));
const { threadId } = require('worker_threads');
const { UserService } = require('../services/user.service');
const { TRANSACTIONS } = require('../utils/constants');
const { executeTransactions } = require('../models/transactions');
const { getTransactionCount } = require('../models/transactions');
const { RegionService } = require("../services/region");
const { handleNotification } = require('../services/notification.service');
const { getExchangeRate } = require("../services/exchange.service");
const { getDepositStatus } = require('../services/direct24.service');
const { getCashoutStatus } = require('../services/direct24.service');
const { getExchangeRatesd24 } = require('../services/direct24.service');
const { trackEvent } = require('../services/singular.service');
const { getURLEncodedBody } = require('../lib/middleware');
const { PartnerService } = require('../services/partner.service');


const decentroAPIHeaderConfig = {
    headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'client_id': CONFIG.decentro.client_id,
        'client_secret': CONFIG.decentro.client_secret,
        'module_secret': CONFIG.decentro.module_secret,
        'provider_secret': CONFIG.decentro.provider_secret
    }
}

const paymentCallback = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {

        // logger.info(`Decentro Penny Drop transaction Webhook`);
        // console.log(req.body);
        var err;
        var postData = Object.assign({
            "orderId": req.body['orderId'],
            "orderAmount": req.body['orderAmount'],
            "referenceId": req.body['referenceId'],
            "txStatus": req.body['txStatus'],
            "paymentMode": req.body['paymentMode'],
            "txMsg": req.body['txMsg'],
            "txTime": req.body['txTime'],
        });

        let orderId = postData['orderId'];

        if (!orderId) {
            return ReS(res, {});
        }

        [err, pRows] = await to(User.getPayment({ 'orderid': orderId }));
        if (err) throw err;

        let paymentId = postData['referenceId'];
        let userId = pRows[0].userid;
        let jsonData = { getuser: true, type: 'N', title: `Funds Added Successfully`, body: `${postData['orderAmount']} added to your TradeX wallet` };

        if (pRows[0].paymentid != null) {
            // if (socketService.isOnline(userId)) {
            //     socketService.sendMsgViaSocket(userId, jsonData)
            // }
            return ReS(res, {});
        }

        var keys = Object.keys(postData);
        var signature = req.body.signature;
        var signatureData = "";

        let bankFee = ((CONFIG.rechargeCharges * 0.01) * postData['orderAmount']).toFixed(2);

        keys.forEach((key) => {
            if (key != "signature") {
                signatureData += postData[key];
            }
        });
        var computedSignature = crypto.createHmac('sha256', CONFIG.cashfreeParams.pmClientSecret).update(signatureData).digest('base64');
        if (computedSignature == signature) {
            let data = { 'orderid': orderId, paymentid: paymentId };
            logger.info(`Payment Success for user: ${userId}, paymentid: ${data['paymentid']}, orderid: ${data['orderid']} ${data['orderid']}`)
            var dataObj = { 'paymentid': data['paymentid'] };
            var whereObj = { 'orderid': data['orderid'] };


            [err, pRows] = await to(User.updatePayment(whereObj, dataObj));
            if (err) throw err;

            let amount = pRows[0]['amount'];

            let batchTxnData = [];

            let txnid = 'PM' + (100000000 + parseInt(pRows[0]['id']));
            let pmTxnData = {
                'userid': userId,
                'message': `Recharge of ${amount} completed succesfully`,
                'txnid': txnid,
                'wallettype': 'D',
                'type': 'CREDIT',
                'amount': amount
            };
            var message = `Recharge of ${amount} completed Succefully`;

            pmTxnData['surcharge'] = bankFee;
            pmTxnData['amount'] = pmTxnData['amount'] - pmTxnData['surcharge'];

            batchTxnData.push(pmTxnData);

            redisCaching.delHMKey(userId, 'userWallet');
            
            const transactions = batchTxnData.map( t => ({
                ...t,
                action: TRANSACTIONS.fundsDeposit
            }))
            await UserService.executeTransactions(transactions)

            await UserService.addCouponCashbackWallet( orderId, userId, amount, (100000000 + parseInt(pRows[0]['id'])));

            return ReS(res, {});
        } else {
            throw 'Invalid Signature';
        }
    } catch (err) {
        next(err);
    }

}

const initiatePayment = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        const upiHandle = req.body['upiHandle'];
        const amount = req.body['amount'];
        const userId = req.user.id;
        // var err;
        if (!isNumber(amount)) {
            ReS(res, {
                isValid: true, message: 'Invalid Amount'
            })
        }

        let order_amount;
        order_amount = Number(req.body.amount);

        // const _isEligibleToAdd = await isEligibleToAdd( userId, order_amount);
        // if(!_isEligibleToAdd){
        //     return ReE(res, `Your current deposit request exceed 1000 INR. Please try a lower amount or complete KYC to proceed.`, 402);
        // }

        const orderId = 'od_' + parseInt(getUID()).toString(32) + '_' + process.env.MACHINE_ID + '_' + threadId;
        var dataObj = {
            reference_id: orderId,
            payer_upi: upiHandle,
            payee_account: CONFIG.decentro.payee_account,
            amount: amount,
            purpose_message: `TradeX has requested amount ${amount} for adding funds`,
            expiry_time: 30
        };

        try {
            const decentroUrl = `${CONFIG.decentro.url}/v2/payments/collection`;
            var response = await axios.post(decentroUrl, dataObj, decentroAPIHeaderConfig);
            if (response['data'] && response['data']['status'] == 'SUCCESS') {
                const paymentId = response['data']['decentroTxnId']
                const addObj = { 'userid': userId, 'orderid': orderId, 'paymentid': paymentId, 'amount': amount, 'source': 3 }
                var [err, paymentRow] = await to(Payments.add(addObj));
                if (err) throw err;

                return ReS(res, { isValid: true, paymentId: paymentId });
            } else if (response['data'] && response['data']['status'] == 'FAILURE') {
                return ReS(res, Object.assign({ initiated: false }, response['data']));
            }
        } catch (e) {
            return ReE(res, { initiated: false, message: 'Something went wrong' }, 400);
        }
    } catch (e) {
        next(e);
    }
}

const getStatus = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {

        var txnId = req.body.txnId, userId = req.user.id, paymentRow, coins, _txns;
        var err, paymentRow;
        if (!txnId && !userId) {
            return ReE(res, 'Invalid Request', 400);
        }
        try {

            [err, paymentRow] = await to(Payments.get(txnId));

            if (paymentRow && paymentRow['status'] == 'C') {
                let amount = paymentRow['amount'];

                if (paymentRow != null) {
                    [err, coins] = await to(User.getEngagedCoins({ userid: userId }));
                    if (err) throw err;

                    [err, _txns] = await to(User.getTransactions({ 'userid': userId, limit: 2 }));
                    if (err) throw err;

                    return ReS(res, {
                        user: coins, transactions: _txns, 'message': `Recharge of ${amount} completed Succefully`
                    });
                }
            }
            var txnRes = await getStatusAndAddToTxns(txnId);
            return ReS(res, Object.assign({}, txnRes));
        } catch (e) {
            console.log(e);
            return ReE(res, { success: false }, 422);
        }

    } catch (e) {
        console.log(e);
        next(e);
    }
}

const getStatusAndAddToTxns = async (txnId) => {
    var response = await axios.get(`${CONFIG.decentro.url}/v2/payments/transaction/${txnId}/status`, decentroAPIHeaderConfig);
    var data = response['data']
    var err, paymentRow;

    [err, paymentRow] = await to(Payments.get(txnId, null));
    if (err) throw err;

    const orderId = paymentRow['orderid'];
    const reqKey = `updating_payment_${orderId}`;
    const unlock = await lock(reqKey);

    if (data['status'] == 'SUCCESS') {
        let updateObj = {}, whereObj = {};
        if (data['data']['transactionStatus'] == 'SUCCESS') {
            let userId = paymentRow['userid'];
            logger.info(`----Payment Success- ${paymentRow['orderid']}`);

            if (paymentRow['status'] == 'C') {
                unlock();
                logger.info(`Payment already registered for orderid - ${paymentRow['orderid']}`);
                return { payment: 'SUCCESS' };
            }

            updateObj = { 'status': 'C' }
            whereObj = { 'orderid': paymentRow['orderid'] }

            [err, paymentRow] = await to(Payments.update(whereObj, updateObj));
            if (err) throw err;

            let amount = paymentRow['amount'];
            let bankFee = ((CONFIG.rechargeCharges * 0.01) * amount).toFixed(2);
            let batchTxnData = [];

            let txnid = 'PM' + (100000000 + parseInt(paymentRow['id']));
            let pmTxnData = {
                'userid': userId,
                'message': `Recharge of ${amount} completed succesfully`,
                'txnid': txnid,
                'wallettype': 'D',
                'type': 'CREDIT',
                'amount': amount
            };
            var message = `Recharge of ${amount} completed Succefully`;

            const results = await UserService.executeTransactions([{
                ...pmTxnData,
                action: TRANSACTIONS.fundsDeposit
            }], true)
            const user = results?.[0]?.wallet;
            const transactions = results.map(t => t.transaction);
            unlock();
            return { payment: 'COMPLETE', user, transactions, 'message': message }

        } else if (data['data']['transactionStatus'] == 'PENDING') {
            unlock();
            return { payment: 'PENDING' };
        } else {
            updateObj = { 'status': 'F' }
            whereObj = { 'orderid': paymentRow['orderid'] }

            [err, paymentRow] = await to(Payments.update(whereObj, updateObj));
            if (err) throw err;

            unlock();
            return { payment: 'FAILED' };
        }
    } else {
        unlock();
        return { payment: 'FAILED' };
    }
}

const verifiyAndPay = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        const upiHandle = req.body['upiHandle'];
        if (upiHandle == 'aaa') {
            ``
            return ReS(res, {
                isValid: true
            });
        } else {
            return ReS(res, {
                isValid: false
            });
        }

    } catch (e) {
        next(e);
    }
}

const addBonus = async function (req, res, next) {
    if (!isDashboardUser(req)) {
        res.writeStatus( "401" );
        return ReS(res, {
            success: true, msg: 'Unauthorized request, incident has been reported'
        });
    }
    // res.setHeader('Content-Type', 'application/json');
    try {
        let list = req.body.list;
        let uid = Date.now()
        for (let uL of list) {
            uid += 1;
            const userId = uL['userid'];
            const amount = uL['amount'];
            let batchTxnData = [];
            let txnid = 'GT' + uid;
            let pmTxnData = {
                'userid': userId,
                'message': `Amount of ${amount} credited as bonus`,
                'txnid': txnid,
                'wallettype': 'D',
                'type': 'CREDIT',
                'amount': amount
            };
            batchTxnData.push(pmTxnData);

            const transactions = batchTxnData.map( t => ({
                ...t,
                action: TRANSACTIONS.fundsCoupon
            })) 
            await UserService.executeTransactions(transactions)

            if (err) {
                console.error(`Wallet not updated`)
            }
        }
        return ReS(res, {
            success: true
        });
    } catch (e) {
        next(e);
    }
}

const transferFunds = async function (req, res, next) {
    if (!isDashboardUser(req)) {
        res.writeStatus( "401" );
        return ReS(res, {
            success: true, msg: 'Unauthorized request, incident has been reported'
        });
    }

    /**
     *     
     * "list": [

    {"fromuid": "201720", "touid": "12345", "amount": "100", "action": "W"},

    FMU DFM (w, d) 

    U1 CFM (w)

    {"fromuid": "12345", "touid": "201720", "amount": "100", "action": "I"} 

    U1 PM, DFM (d)

    FMU CFM (d)
]
}
     */
    // res.setHeader('Content-Type', 'application/json');
    try {

        let list = req.body.list;
        let uid = Date.now()
        for (let uL of list) {
            uid += 1
            const fromUId = uL['fromuid'];
            const toUId = uL['touid'];
            const amount = uL['amount'];
            const action = uL['action'];

            let txnId = 'DFM' + uid;
            let dMsg = `${amount} debited as funds transfer to User: ${toUId}`;

            let batchTxnData = [];
            if(action === 'I') {

                /** Credit Fund Manager */
                `${amount} credited from fund management service from User: ${fromUId}`;
                let cTxnData1 = {
                    'userid': fromUId,
                    'message': `Recharge of ${amount} completed succesfully`,
                    'txnid': `PM${uid}`,
                    'wallettype': 'D',
                    'type': 'CREDIT',
                    'amount': amount,
                    surcharge: 0,
                    action: TRANSACTIONS.fundsDeposit
                };

                batchTxnData.push(cTxnData1);

                let dTxnData1 = {
                    'userid': fromUId,
                    'message': `${amount} debited for funds management service`,
                    'txnid': `DFM${uid}`,
                    'wallettype': 'D',
                    'type': 'DEBIT',
                    'amount': amount,
                    surcharge: 0,
                    action: TRANSACTIONS.fundsDebitFundUser
                };

                batchTxnData.push(dTxnData1);

                txnId = 'CFM' + uid;
                let cMsg = `${amount} credited from fund management service`;
                let cTxnData = {
                    'userid': toUId,
                    'message': cMsg,
                    'txnid': txnId,
                    'wallettype': 'D',
                    'type': 'CREDIT',
                    'amount': amount,
                    surcharge: 0,
                    action: TRANSACTIONS.fundsCreditFundManager
                };
                batchTxnData.push(cTxnData);
            } else if (action === 'W') {
                let dTxnData = {
                    'userid': fromUId,
                    'message': dMsg,
                    'txnid': txnId,
                    'wallettype': 'D',
                    'type': 'DEBIT',
                    'amount': amount,
                    surcharge: 0,
                    action: TRANSACTIONS.fundsDebitFundManager
                };
                batchTxnData.push(dTxnData);
                txnId = 'CFM' + uid;
                let cMsg = `${amount} credited from fund management service`;
                let cTxnData = {
                    'userid': toUId,
                    'message': cMsg,
                    'txnid': txnId,
                    'wallettype': 'D',
                    'type': 'CREDIT',
                    'amount': amount,
                    surcharge: 0,   
                    action: TRANSACTIONS.fundsCreditFundUser
                };
                batchTxnData.push(cTxnData);

            }
            await UserService.executeTransactions(batchTxnData)
        }

        return ReS(res, {
            success: true
        });

    } catch (e) {
        next(e);
    }
}

const initiateRefunds = async function (req, res, next) {
    if (!isDashboardUser(req)) {
        res.writeStatus( "401" );
        return ReS(res, {
            success: true, msg: 'Unauthorized request, incident has been reported'
        });
    }

    try {
        let refund_list = req.body.refunds;

        for (const item of refund_list){
            if(isNaN(Number(item.amount))){
                return ReE(res, 'One or more of the amounts is not a number', 422);
            }
        }

        const total_amount =  refund_list.map((item) => Number(item.amount)).reduce((acc, currentValue) => acc + currentValue, 0);

        if (total_amount > CONFIG.MAX_REFUND_TRADING_FEE){
            return ReE(res,
            `Cannot transfer more than ${CONFIG.MAX_REFUND_TRADING_FEE} credits at a time.
             Total amount exceeds by ${parseFloat(total_amount - CONFIG.MAX_REFUND_TRADING_FEE).toFixed(2)} credits`,
             422);
        }

        let errWB, walletData;
        [errWB, walletData] = await to(User.getWalletBalance(CONFIG.DEBIT_TRADING_FEE_USERID, false, 'public'));
        if (errWB) {
            throw errWB;
        }
        if (walletData['coinsd'] + walletData['coinsb'] + walletData['coinsw'] < total_amount) {
            return ReE(res,
                'Insufficient Wallet Balance',
                422
            );
        }

        let txnId = (req.body?.txnid ?? 'CTF') + '1000';
        let message = req.body?.message ?? 'Trading Fee Refund';

        let batchTxnData = [];

        for (let user of refund_list) {

            let cTxnData = {
                'userid': user['userid'],
                'message': message,
                'txnid': txnId + user['userid'].toString(),
                'wallettype': 'D',
                'type': 'CREDIT',
                'amount': Number(user['amount']),
                surcharge: 0,
                action: TRANSACTIONS.fundsDeposit
            };

            batchTxnData.push(cTxnData);

        }

        let dTxnData = {
            'userid': CONFIG.DEBIT_TRADING_FEE_USERID,
            'message': `${total_amount} debited for trading fee refund`,
            'txnid': `DTF1000${CONFIG.DEBIT_TRADING_FEE_USERID}`,
            'wallettype': 'D',
            'type': 'DEBIT',
            'amount': total_amount,
            surcharge: 0,
            action: TRANSACTIONS.fundsDebitFundUser
        };

        batchTxnData.push(dTxnData);

        await UserService.executeTransactions(batchTxnData);

        return ReS(res, {
            success: true
        });

    } catch (e) {
        next(e);
    }
}

const paykassmaPostback = async function  (req, res, next) {
    const log = (...args) => console.log("[Paykassma Postback]", ...args);
    try {
        log(JSON.stringify(req?.body ?? {}));
        var err;

        //signature logic


        let postbackData = req?.body ?? {};

        //handling for deposit
        if(postbackData['direction'].toLowerCase() === 'ingoing'){
            if (!postbackData['additional_data'].length || postbackData['additional_data'].length == 0 ||
            postbackData['additional_data'][0]['transaction_id'] === null || postbackData['additional_data'][0]['transaction_id'].trim() === '') {
                return ReS(res, {"status": "ok", message: "Incoming payload does not have transactionId"});
            }
            let pRows, _user;
            let orderId = postbackData['additional_data'][0]['plugin_custom_order_id'];

            const reqKey = `updating_payment_${orderId}`;
            let unlock = await lock(reqKey, 300000);

            [err, pRows] = await to(User.getPayment({ 'orderid': orderId }));
            if (err) throw err;

            if(pRows.length === 0){
                unlock();
                return ReS(res, {"status": "ok", message: "Payment ID Not found"});
            }

            let paymentId = postbackData['additional_data'][0]['transaction_id'];
            let userId = pRows[0].userid;
            const meta = `Paykassma Payment Success for user: ${userId}, paymentid: ${paymentId}, orderid: ${orderId}`;

            if (pRows[0].paymentid != null) {
                unlock();
                return ReS(res, {"status": "ok", meta, message: "Payment ID already processed"});
            }

            let data = { 'orderid': orderId, paymentid: paymentId };
            
            log(meta)

            //amount to be read from pRows or postbackData
            //get amount from postbackData and if currency_code !== 'INR' convert to INR and assign to amount else assign amount from postbackData directly
            let amount = postbackData['amount'];
            if (postbackData['currency_code'].toLowerCase() !== 'inr'){
                amount = Number(postbackData['converted_amount']['INR'] ?? 0);
            }

            var dataObj = { 'paymentid': data['paymentid'], 'amount' : amount };
            var whereObj = { 'orderid': data['orderid'] };
    
    
            [err, pRows] = await to(User.updatePayment3(whereObj, dataObj));
            if (err) throw err;
    
            if (pRows.length == 0) {
                unlock();
                log("Payment ID Not found")
                return ReS(res, {"status": "ok", meta, message: "Payment ID not Found"});
            }
            
    
            const userConfig = await User.getLevelConfig(userId, ['depositFee']);
            const { depositFee } = userConfig
            let depositAmount = amount;
            let promoAmount = 0;
            let bonusAmount = 0;
            if (depositFee) {
                const truncation = depositFee?.truncation ?? 'month';
                const transactionCount = await getTransactionCount(userId, 'PM', truncation);
                const currentTransactionCount = transactionCount + 1;
                const { depositWallet, promoWallet, bonusWallet } = RegionService.payment.getSplit(amount, depositFee?.slabs ?? [], currentTransactionCount);
                depositAmount = depositWallet;
                promoAmount = promoWallet;
                bonusAmount = bonusWallet
            }
            let txnid = 'PM' + (100000000 + parseInt(pRows[0]['id']));
            let pmTxnData = {
                'userid': userId,
                'message': `Recharge of ${depositAmount} completed successfully`,
                'txnid': txnid,
                'wallettype': 'D',
                'type': 'CREDIT',
                'amount': depositAmount
            };
    
            const txs = [{
                ...pmTxnData,
                surcharge: 0,
                action: TRANSACTIONS.fundsDeposit
            }];
            if (promoAmount > 0) {
                txs.push({
                    'userid': userId,
                    'message': `Promo GST cashback added`,
                    'txnid': `GSTPR${txnid}`,
                    'wallettype': 'D',
                    'type': 'CREDIT',
                    'amount': promoAmount,
                    action: TRANSACTIONS.fundsCoupon
                });
            }
            if (bonusAmount > 0) {
                txs.push({
                    'userid': userId,
                    'message': `Bonus GST cashback added`,
                    'txnid': `GSTCB${txnid}`,
                    'wallettype': 'D',
                    'type': 'CREDIT',
                    'amount': bonusAmount,
                    action: TRANSACTIONS.fundsSignUpBonus
                });
            }
    
            await UserService.executeTransactions(txs, true)
    
            log('paykassma addcouponcashback called from payment hook');
            await UserService.addCouponCashbackWallet(orderId, userId, amount, (100000000 + parseInt(pRows[0]['id'])));
    
            [err, _user] = await to(User.findById(userId, false));
            if (err) throw err
    
    
            let partnerConfig = await Partner.getPartnerWithConfig(parseInt(_user['partner']), 'INDIA', true);
            if (partnerConfig.notifications) handleNotification({ amount: amount, userid: userId, region : 'INDIA', partner : parseInt(_user['partner']) }, "deposit request success");
            unlock();
            /** trackAppsflyerEvent("recharge_success", {
        status: "success",
        orderId: "",
        datetime: new Date(),
        method: "",
        userId: userInfo?.userid,
      });
      trackAppsflyerEvent("recharge_amount", {
        status: "success",
        orderId: "",
        datetime: new Date(),
        af_revenue: amount,
        af_currency: "INR",
      }); */
            const platform = pRows[0]?.metadata?.platform ?? null;
            const device_id = pRows[0]?.metadata?.device_id ?? null;
            if (platform && device_id){
                await trackEvent(
                    'recharge_success',
                    userId,
                    {
                        status: "success",
                        orderId: orderId,
                        datetime: new Date(),
                        method: "",
                        userId: userId,
                        is_revenue_event : false
                    },
                    {platform : platform, packageOrBundleId :'com.theox', ip : '127.0.0.1', device_id: device_id}
                );
                await trackEvent(
                    'recharge_amount',
                    userId,
                    {
                        "pcc": postbackData?.currency_code,
                        "r": postbackData?.amount,
                        "is_revenue_event": true
                    },
                    {platform : platform, packageOrBundleId :'com.theox', ip : '127.0.0.1', device_id: device_id}
                );
            }
            return ReS(res, {"status": "ok", "message" : "Payment Successful"}, 200);

        }

        //handling for withdrawal
        if(postbackData['direction'].toLowerCase() === 'outgoing'){


            if (!postbackData['additional_data'].length || postbackData['additional_data'].length == 0 ||
            postbackData['additional_data'][0]['withdrawal_id'] === null || postbackData['additional_data'][0]['withdrawal_id'].trim() === '') {
                return ReS(res, {"status": "ok", message: "Incoming payload does not have withdrawalId"} );
            }

            let withdrawal_status = Number(postbackData['additional_data'][0]['withdrawal_status']);
            let withdrawal_id = postbackData['additional_data'][0]['withdrawal_id'];

            const reqKey = `updating_payout_${withdrawal_id}`;
            const unlock = await lock(reqKey, 300000);

            const redeemData = await User.getRedeemByTransferId(withdrawal_id);
            if(redeemData.pg === 'Paykassma' && redeemData.status === 'C' && String(redeemData.pgstatus) === String(1)){
                unlock();
                return ReS(res, {"status": "ok", message: "Redeem Request Already Processed"}, 200);
            }
            
            let response = {};
            switch(withdrawal_status){
                case 1:
                    var updateRData = Object.assign({}, { id: redeemData.id, status: 'C', pgstatus: withdrawal_status, pgacknowledged: 1});
                    [err, _redreemReqs] = await to(User.updateRedeemRequests(updateRData));
                    if (err) throw err;
                    break;
                case 5:
                    UserService.cancelRedeemRequest([redeemData.id]);
                    return ReS(res, {"status": "ok", message: `Redeem Request Cancelled`}, 200);
                default:
                    unlock();
                    return ReS(res, {"status": "ok", message: `Unknown status ${withdrawal_status}`}, 200);
            }
            unlock();
            return ReS(res, {"status": "ok", message: `Redeem Request Successfully Processed`}, 200);
        }
        

        
    } catch(e) {
        log(e.message);        
        return ReS(res, {"status": "ok", message: e.message}, 200);
    }
}

const d24Notification = async function  (req, res, next) {
    // const header = req.getHeader('content-type');
    const log = (...args) => console.log("[DIRECT24 Postback]", ...args);
    let postbackData = req?.body ?? {};

    try {
        if (req?.body?.external_id) {
            //withdrawal 
            
            postbackData = req?.body ?? {};

            if (!postbackData['external_id']) {
                return ReS(res, {"status": "ok", message: "Incoming payload does not have external_id"});
            }

            let redeemid = postbackData['external_id'];
            let cashout_id = postbackData['cashout_id'];

            let withdrawal_status = await getCashoutStatus({} , {"redeemid" : redeemid});

            const reqKey = `updating_payout_${redeemid}`;
            const unlock = await lock(reqKey, 300000);

            let redeemData = await User.getRedeemById(redeemid);
            redeemData = redeemData?.[0];
            if(redeemData.pg === 'Direct24' && redeemData.status === 'C' && String(redeemData.pgstatus) === String(1)){
                unlock();
                return ReS(res, {"status": "ok", message: "Redeem Request Already Processed"}, 200);
            }
            
            let response = {};
            switch(withdrawal_status?.cashout_status){
                case 1:
                    var updateRData = Object.assign({}, { id: redeemData.id, status: 'C', pgstatus: withdrawal_status?.cashout_status_description, pgacknowledged: 1});
                    [err, _redreemReqs] = await to(User.updateRedeemRequests(updateRData));
                    if (err) throw err;
                    break;
                case 3:
                    UserService.cancelRedeemRequest([redeemData.id]);
                    return ReS(res, {"status": "ok", message: `Redeem Request Cancelled`}, 200);
                default:
                    unlock();
                    return ReS(res, {"status": "ok", message: `Unknown status ${withdrawal_status}`}, 200);
            }
            unlock();
            return ReS(res, {"status": "ok", message: `Redeem Request Successfully Processed`}, 200);
        

        } else{
            log(JSON.stringify(req?.body ?? {}));
            if (String((postbackData?.deposit_id ?? '')).trim() === '') {
                return ReS(res, {"status": "ok", message: "Incoming payload does not have deposit_id"});
            }
            let deposit_id = postbackData['deposit_id'];
            let pRows, _user;


            let deposit_status = await getDepositStatus(deposit_id);
            if (!deposit_status){
                return ReS(res, {"status": "ok", message: "could not fetch deposit_status"});
            }
            if (deposit_status?.status !== "COMPLETED"){
                return ReS(res, {"status": "ok", message: "Deposit not completed"});
            }
            let orderId = deposit_status?.invoice_id;

            const reqKey = `updating_payment_${orderId}`;
            let unlock = await lock(reqKey, 300000);

            [err, pRows] = await to(User.getPayment({ 'orderid': orderId }));
            if (err) throw err;

            if(pRows.length === 0){
                unlock();
                return ReS(res, {"status": "ok", message: "Payment ID Not found"});
            }

            let paymentId = deposit_id;
            let userId = pRows[0].userid;
            const meta = `DIRECT24 Payment Success for user: ${userId}, paymentid: ${paymentId}, orderid: ${orderId}`;

            if (pRows[0].paymentid != null) {
                unlock();
                return ReS(res, {"status": "ok", meta, message: "Payment ID already processed"});
            }

            let data = { 'orderid': orderId, paymentid: paymentId };
            
            log(meta);

            let amount;
            let currency_exchange =  await getExchangeRatesd24('IN', deposit_status['usd_amount']);
            if (currency_exchange && currency_exchange.converted_amount){
                amount = Number(currency_exchange.converted_amount);
            }else{
                unlock();
                log(`DIRECT24 Payment could not be updated for user: ${userId}, paymentid: ${paymentId}, orderid: ${orderId}`);
                return ReS(res, {"status": "ok", meta, message: "Payment could not be updated for user"});
            }


            var dataObj = { 'paymentid': data['paymentid'], 'amount' : amount };
            var whereObj = { 'orderid': data['orderid'] };


            [err, pRows] = await to(User.updatePayment3(whereObj, dataObj));
            if (err) throw err;

            if (pRows.length == 0) {
                unlock();
                log("Payment ID Not found")
                return ReS(res, {"status": "ok", meta, message: "Payment ID not Found"});
            }
            

            const userConfig = await User.getLevelConfig(userId, ['depositFee']);
            const { depositFee } = userConfig
            let depositAmount = amount;
            let promoAmount = 0;
            let bonusAmount = 0;
            if (depositFee) {
                const truncation = depositFee?.truncation ?? 'month';
                const transactionCount = await getTransactionCount(userId, 'PM', truncation);
                const currentTransactionCount = transactionCount + 1;
                const { depositWallet, promoWallet, bonusWallet } = RegionService.payment.getSplit(amount, depositFee?.slabs ?? [], currentTransactionCount);
                depositAmount = depositWallet;
                promoAmount = promoWallet;
                bonusAmount = bonusWallet
            }
            let txnid = 'PM' + (100000000 + parseInt(pRows[0]['id']));
            let pmTxnData = {
                'userid': userId,
                'message': `Recharge of ${depositAmount} completed successfully`,
                'txnid': txnid,
                'wallettype': 'D',
                'type': 'CREDIT',
                'amount': depositAmount
            };

            const txs = [{
                ...pmTxnData,
                surcharge: 0,
                action: TRANSACTIONS.fundsDeposit
            }];
            if (promoAmount > 0) {
                txs.push({
                    'userid': userId,
                    'message': `Promo GST cashback added`,
                    'txnid': `GSTPR${txnid}`,
                    'wallettype': 'D',
                    'type': 'CREDIT',
                    'amount': promoAmount,
                    action: TRANSACTIONS.fundsCoupon
                });
            }
            if (bonusAmount > 0) {
                txs.push({
                    'userid': userId,
                    'message': `Bonus GST cashback added`,
                    'txnid': `GSTCB${txnid}`,
                    'wallettype': 'D',
                    'type': 'CREDIT',
                    'amount': bonusAmount,
                    action: TRANSACTIONS.fundsSignUpBonus
                });
            }

            await UserService.executeTransactions(txs, true)

            log('paykassma addcouponcashback called from payment hook');
            await UserService.addCouponCashbackWallet(orderId, userId, amount, (100000000 + parseInt(pRows[0]['id'])));

            [err, _user] = await to(User.findById(userId, false));
            if (err) throw err


            let partnerConfig = await Partner.getPartnerWithConfig(parseInt(_user['partner']), 'INDIA', true);
            if (partnerConfig.notifications) handleNotification({ amount: amount, userid: userId, region : 'INDIA', partner : parseInt(_user['partner']) }, "deposit request success");
            unlock();
            return ReS(res, {"status": "ok", "message" : "Payment Successful"}, 200);
        }
    } catch(e) {
        log(e.message);        
        return ReS(res, {"status": "ok", message: e.message}, 200);
    }
}
const creditLuckyCoins = async function (req, res, next) {
    if (!isDashboardUser(req)) {
        res.writeStatus( "401" );
        return ReS(res, {
            success: true, msg: 'Unauthorized request, incident has been reported'
        });
    }

    try {
        let refund_list = req.body.refunds;

        for (const item of refund_list){
            if(isNaN(Number(item.amount))){
                return ReE(res, 'One or more of the amounts is not a number', 422);
            }
        }

        const total_amount =  refund_list.map((item) => Number(item.amount)).reduce((acc, currentValue) => acc + currentValue, 0);
        const max_refund = CONFIG.MAX_REFUND_LUCKY_COINS;
        const admin_userid = CONFIG.DEBIT_LUCKY_COINS_USERID;
        if (total_amount > max_refund){
            return ReE(res,
            `Cannot transfer more than ${max_refund} credits at a time.
             Total amount exceeds by ${parseFloat(total_amount - max_refund).toFixed(2)} credits`,
             422);
        }

        let errWB, walletData;
        [errWB, walletData] = await to(User.getWalletBalance(admin_userid, false, 'public'));
        if (errWB) {
            throw errWB;
        }
        if (walletData['coinsp'] < total_amount) {
            return ReE(res,
                'Insufficient Wallet Balance',
                422
            );
        }

        let txnId = (req.body?.txnid ?? 'CLC') + '1000';
        let message = req.body?.message ?? 'Token points credit';

        let batchTxnData = [];

        for (let user of refund_list) {

            let cTxnData = {
                'userid': user['userid'],
                'message': message,
                'txnid': txnId + user['userid'].toString(),
                'wallettype': 'P',
                'type': 'CREDIT',
                'amount': Number(user['amount']),
                surcharge: 0,
                action: TRANSACTIONS.fundsCoupon
            };

            batchTxnData.push(cTxnData);

        }

        let dTxnData = {
            'userid': admin_userid,
            'message': `${total_amount} debited for Token points refund`,
            'txnid': `DLC1000${admin_userid}`,
            'wallettype': 'P',
            'type': 'DEBIT',
            'amount': total_amount,
            surcharge: 0,
            action: TRANSACTIONS.fundsDebitPromoCash
        };

        batchTxnData.push(dTxnData);

        await UserService.executeTransactions(batchTxnData);

        return ReS(res, {
            success: true
        });

    } catch (e) {
        next(e);
    }
}

const linkQuNotification = async(req, res) => {
    const log = (...args) => console.log('[LINKQU NOTIFICATION]', ...args);
    let pRows, err, unlock, _user;
    try {
        /**
         * Lock User Payment Update
         * Check of OrderId Exists
         * Check if Already updated deposits
         * Execute Transactions
         */
        const data = req?.body ?? {};
        const orderId = data.partner_reff;
        if(!orderId) {
            throw new Error("No order Id found");
        }
        const reqKey = `updating_payment_${orderId}`;
        unlock = await lock(reqKey, 300000);

        [err, pRows] = await to(User.getPayment({ 'orderid': orderId }));
        if (err) throw err;
        if(pRows.length === 0) {
            throw new Error(`No payment found with orderId ${orderId}`);
        }

        let paymentId = data?.payment_reff;
        let userId = pRows[0].userid;
        const meta = `Payment Success for user: ${userId}, paymentid: ${paymentId}, orderid: ${orderId} for amount ${data?.amount} IDR`;
        log(meta);
        if (pRows[0].paymentid != null) {
            unlock();
            throw new Error(`Order ID ${orderId} already processed with Payment ID ${pRows[0].paymentid}`);
        }
        if(data?.status !== 'SUCCESS') {
            throw new Error(`Exiting as payment status is not success for user: ${userId}, paymentid: ${paymentId}, orderid: ${orderId}`);
        }

        const exchangeRate = await getExchangeRate('IDR', 'INR');
        const amount = parseFloat(data?.amount) * exchangeRate.value; 

        const dataObj = { 'paymentid': paymentId, amount };
        const whereObj = { 'orderid': orderId };


        [err, pRows] = await to(User.updatePayment3(whereObj, dataObj));
        if (err) throw err;

        if (pRows.length == 0) {
            throw new Error(`No payment found with orderId ${orderId}`);
        }


        let txnid = 'PM' + (100000000 + parseInt(pRows[0]['id']));
        let pmTxnData = {
            'userid': userId,
            'message': `Recharge of ${amount} completed successfully`,
            txnid,
            'wallettype': 'D',
            'type': 'CREDIT',
            amount
        };

        const txs = [{
            ...pmTxnData,
            surcharge: 0,
            action: TRANSACTIONS.fundsDeposit
        }];
        await UserService.executeTransactions(txs, true);

        await UserService.addCouponCashbackWallet(orderId, userId, amount, (100000000 + parseInt(pRows[0]['id'])));

        [err, _user] = await to(User.findById(userId, false));
        if (err) throw err


        let partnerConfig = await Partner.getPartnerWithConfig(parseInt(_user['partner']), 'INDIA', true);
        if (partnerConfig.notifications) handleNotification({ amount: amount, userid: userId, region : 'INDIA', partner : parseInt(_user['partner']) }, "deposit request success");

    } catch(e) {
        log("ERROR", e.message);
        
    } finally {
        if(unlock && typeof unlock === 'function') {
            unlock();
        }
        return ReS(res, { "response": "OK"})
    }
}

const linkQuRedirect =  async (req, res) => {
    try {
        const data = await PartnerService.getPartnerServiceConfig(1, 'ASEAN', 'linkqu', );
        const config = data?.config ?? {};
        const qs = new URLSearchParams(req?.body ?? {}).toString();        
        res.writeStatus('302');
        res.writeHeader('location', `${config.url_webapp_redirect}?${qs}`);
        if(!res.aborted){
          res.end();
        }
    } catch(e) {
        console.log(e)
        res.end(e.message);
    }
}

module.exports.paymentCallback = paymentCallback;
module.exports.initiatePayment = initiatePayment;
module.exports.getStatus = getStatus;
module.exports.verifiyAndPay = verifiyAndPay;
module.exports.getStatusAndAddToTxns = getStatusAndAddToTxns;
module.exports.transferFunds = transferFunds;
module.exports.addBonus = addBonus;
module.exports.initiateRefunds = initiateRefunds;
module.exports.paykassmaPostback = paykassmaPostback;
module.exports.d24Notification = d24Notification;
module.exports.creditLuckyCoins = creditLuckyCoins;
module.exports.linkQuNotification = linkQuNotification;
module.exports.linkQuRedirect = linkQuRedirect;