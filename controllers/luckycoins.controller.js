const { PartnerService } = require("../services/partner.service");
const { UserService } = require("../services/user.service");
const { RegionService } = require('../services/region/index');
const { ReS, ReE } = require("../services/util.service");
const { getTransactionCount } = require("../models/transactions");
const { TRANSACTIONS } = require("../utils/constants");
const CONFIG = require("../config/config");
const { User } = require("../models");
const { getExchangeRate, getCurrency } = require("../services/exchange.service");
const { to, waitTimer } = require('../services/util.service');
const { generateOrderId } = require("../msg_recv/utils");
const {
  verifyTripleAWithdrawSource,
  createPayoutOrder,
  scheduleJobToCancel,
  confirmPayoutOrder,
  verifySignature
} = require("../services/triplea.service");

const log = (...args) => {
  console.log(`[LUCKYCOINSCONTROLLER]`, ...args);
};

const details = async (req, res) => {
  const details = await PartnerService.getPartnerServiceConfiguration(
    "luckyCoins",
    req?.user
  );
  const language = req?.user?.preferred_locale ?? 'en-IN';
  await UserService.translateActions(details?.config, language);
  return ReS(res, details?.config, 200);
};

const convertToDeposit = async (req, res) => {
  try {
    let amount = parseInt(req?.body?.amount);
    if (isNaN(amount)) {
      return ReE(res, "Invalid Amount", 400);
    }
    const config = await PartnerService.getPartnerServiceConfiguration(
      "luckyCoins",
      req?.user
    );
    const walletData = await User.getWalletBalance(req?.user?.id, false);
    const { limits } = config.config || {};
    const exchangeRate = config?.config?.exchange_rate?.tradex;

    const deposit = limits.redeemDeposit;
    const truncation = deposit?.maxInterval ?? "day";

    if (amount > walletData.coinsp) {
      return ReE(res, "Insufficient Funds", 400);
    }

    if (deposit?.minimumBalance) {
      if (walletData.coinsp < deposit?.minimumBalance) {
        return ReE(
          res,
          `Need a minimum balance of ${deposit?.minimumBalance} luckycoins to enable conversion to crypto`,
          400
        );
      }
    }

    const transactionCount = await getTransactionCount(
      req?.user?.id,
      "CRLC",
      truncation
    );
    
    if (transactionCount > 0){
      return ReE(
        res,
        `Only 1 request allowed per ${truncation}`,
        400
      );
    }


    let coin_amount = parseInt(req.body.amount);

    var txnArr = [];

    var txnidDebit = "LCPM" + (100000000 + parseInt(req.user.id));
    var txnDataDebit = {
      userid: req.user.id,
      message: `${coin_amount} Tokens debited from your wallet`,
      txnid: txnidDebit,
      wallettype: "P",
      type: "DEBIT",
      amount: coin_amount,
      surcharge: 0,
    };
    txnArr.push({
      ...txnDataDebit,
      action: TRANSACTIONS.fundsDebitPromoCash,
    });

    let deposit_amount = exchangeRate * coin_amount;

    var txnDataCredit = {
        'userid': req.user.id,
        'message': `${deposit_amount} Token points credited to your wallet`,
        'txnid': 'CRLC' + (100000000 + parseInt(req.user.id)),
        'wallettype': 'D',
        'type': 'CREDIT',
        'amount': deposit_amount
    };
    txnArr.push({
        ...txnDataCredit,
        action: TRANSACTIONS.fundsDeposit
    });

    const results = await UserService.executeTransactions(txnArr, true);

    return ReS(res, {"status" : "success", "msg": `Redeem successfully placed`, results});
  } catch (e) {
    log(e.message);
    return ReE(res, e.message, 200);
  }
};

const convertToCrypto = async (req, res) => {
  try {
    let amount = parseInt(req?.body?.amount);
    if (isNaN(amount)) {
      return ReE(res, "Invalid Amount", 400);
    }
    const config = await PartnerService.getPartnerServiceConfiguration(
      "luckyCoins",
      req?.user
    );
    const walletData = await User.getWalletBalance(req?.user?.id, false);
    const { limits } = config.config || {};
    const usdt = limits.redeemCrypto;
    const truncation = usdt?.maxInterval ?? "day";
    if (amount > walletData.coinsp) {
      return ReE(res, "Insufficient Funds", 400);
    }
    var txnid = "LCRD" + (100000000 + parseInt(req.user.id));
    if (usdt?.minimumBalance) {
      if (walletData.coinsp < usdt?.minimumBalance) {
        return ReE(
          res,
          `Need a minimum balance of ${usdt?.minimumBalance} luckycoins to enable conversion to crypto`,
          400
        );
      }
    }
    const transactionCount = await getTransactionCount(
      req?.user?.id,
      "LCRD",
      truncation
    );
    const transactionCountCancel = await getTransactionCount(
      req?.user?.id,
      "LCRC",
      truncation
    );
    
    if (transactionCount - transactionCountCancel > 0){
      return ReE(
        res,
        `Only 1 request allowed per ${truncation}`,
        400
      );
    }


    const getAddValidateCryptoWallet =  RegionService?.payout?.getAddValidateCryptoWallet?.['REST_OF_WORLD'];
    const address = await getAddValidateCryptoWallet(req.user, req?.body?.walletAddress);
    if (!address.status) {
      return ReE(res, address.msg, 402);
    } else {
      req.user['virtual_wallet_address'] = req.user.wallet_address;
    }

    const { status, msg } = await verifyTripleAWithdrawSource(req?.user);
    if (!status) {
      return ReE(res, msg, 400);
    }


    log(`Token configs ${config}`);
    const payload = {
      amount: config.config.exchange_rate.USDT * amount,
    };
    payload["amount"] = parseFloat(amount) * (100 / 101);
    payload.remarks = "Tokens Convert to Crypto";
    payload.data = "Tokens Convert to Crypto";

    payload.notify_url = '/v2/luckycoins/crypto-payout-hook';

    const data = await createPayoutOrder(req?.user, payload);
    if (!data) {
      return ReE(
        res,
        "Error creating gateway payout order",
        400
      );
    }
    const generatedOrderId = generateOrderId();
    const exchangeRate = await getExchangeRate(data?.crypto_currency, 'INR');
    var redeem_data = Object.assign({}, { userid: req.user.id , amount : amount, pg : 'triplea', transferid: generatedOrderId,
      currency : data?.crypto_currency , exchange_rate : exchangeRate?.value, refid: data?.payout_reference });

    let redeem_req = await User.putRedeemRequests(Object.assign({}, redeem_data, { 'transactionid': 'tobeupdated' }));

    
    //insert intp redeem and payload.notify_url change before calling createPayoutOrder
    const results = {
      payout_reference: data?.payout_reference,
      fields: [
        {
          label: "Total credits to be withdrawn",
          value: amount,
        },
        {
          label: "Amount to be withdrawn",
          value: `${data?.crypto_amount} ${data?.crypto_currency}`,
        },
        {
          label: "USDT Wallet Address",
          value: data?.crypto_address,
        },
        {
          label: "Gateway Fee",
          value: CONFIG.withdrawalConfig.REST_OF_WORLD.gatewayFees,
        },
        {
          label: "Network Fee",
          value: `${data?.network_fee_crypto_amount} ${data?.crypto_currency}`,
        },
        {
          label: "Net amount to be credited",
          value: `${data?.net_crypto_amount} ${data?.crypto_currency}`,
        },
      ],
    };
    return ReS(res, { results });
  } catch (e) {
    log("Error", e);
    return ReE(res, "Internal Server Error", 400 );
  }
};

const confirmConvertToCrypto = async (req, res) => {
    try {
        const payoutReference = req?.body?.payout_reference;
        const redeem = await User.getRedeemByRefId(payoutReference);
        if(!req?.body?.payout_reference) {
            return ReE(res, 400, 'Error no payout reference to confirm');
        }
        const data = await confirmPayoutOrder(payoutReference);
        if(!data){
          return ReE(res, "Cannot confirm payout order", 400 );
        }
        let payload = {};
        var txnArr = [];
        let txnid, txnDataDebit;
        let response = { status: false, msg: "Something went wrong" };
        payload["local_amount"] = data["local_amount"];
        payload["amount"] = redeem["amount"];
        payload["currency"] = data["crypto_currency"];
        payload["exchange_rate"] = parseFloat(data["exchange_rate"]);
        payload["redeemId"] = redeem.id;
        switch (data["status"]) {
          case "confirm":
            
            txnid = "LCRD" + (100000000 + parseInt(req.user.id));
            txnDataDebit = {
              userid: req.user.id,
              message: `${redeem.amount} Tokens debited from your wallet`,
              txnid: txnid,
              wallettype: "P",
              type: "DEBIT",
              amount: redeem.amount,
              surcharge: 0,
            };
            txnArr.push({
              ...txnDataDebit,
              action: TRANSACTIONS.fundsDebitPromoCash,
            });
        
            await UserService.executeTransactions(txnArr, true);

            var updateRData = Object.assign(
              {},
              {
                id: redeem.id,
                refid: payload.payout_reference,
                status: "C",
                pgstatus: "confirm",
                pgacknowledged: 1,
                exchange_rate: 1/payload["exchange_rate"],
                transactionid: txnid
              }
            );
            [err, _redreemReqs] = await to(User.updateRedeemRequests(updateRData));
            if (err) throw err;
            response["status"] = true;
            response["msg"] = `Your withdrawal request has been placed.`;
            response["data"] = redeem;
            response[
              "disclaimer"
            ] = `Might take 15-30 mins for the transaction to get updated`;
            break;
          default:
            break;
        }

        data.msg = `${data?.net_crypto_amount} USDT has been credited to your wallet`;
        return ReS(res, data);
    } catch(e) {
        log("Error", e);
        return ReE(res, 400, "Internal Server Error");
    }
};
const notifyConvertToCrypto = async (req, res, next) => {
  try {
    const payout_reference = req.body['payout_reference']
    if (!payout_reference) {
        return ReE(res, `Invalid payout_reference`, 402);
    }
    const reqKey = `updating_payout_${payout_reference}`;
    const unlock = await lock(reqKey, 300000);
    try {
        const signature = req.headers['triplea-signature'];
        console.log('cryptoPayoutHook signature', signature);
        console.log('cryptoPayoutHook data', req.body);
        let payload = req.body;
        if (!verifySignature(signature, req.body)) {
          console.log("Invalid signature");
          return { status: false, msg: "Invalid signature" };
        }
        const redeemData = await User.getRedeemByRefId(payload["payout_reference"]);
        if (
          redeemData.pg == "triplea" &&
          redeemData.status == "C" &&
          redeemData.pgstatus == "done"
        ) {
          return { status: false, msg: "Already processed..." };
        }
        let response = {};
        switch (payload["status"]) {
          case "done":
            var updateRData = Object.assign(
              {},
              {
                id: redeemData.id,
                status: "C",
                pgstatus: payload["status"],
                pgacknowledged: 1
              }
            );
            [err, _redreemReqs] = await to(User.updateRedeemRequests(updateRData));
            if (err) throw err;
            response["status"] = true;
            response["msg"] = `Redeem request processed successfully`;
            response["data"] = updateRData;
            break;
          case "cancel":
          case "invalid":
            UserService.cancelRedeemRequest([redeemData.id]);
            response["status"] = true;
            response["msg"] = `Redeem request cancelled`;
            break;
          default:
            response["status"] = false;
            response["msg"] = `Invalid request`;
            break;
        }
        unlock();
        return ReS(res, response);
    } catch (err) {
        unlock();
        next(err);
    }
  } catch (error) {
      next(error);
  }
};

module.exports.details = details;
module.exports.convertToDeposit = convertToDeposit;
module.exports.convertToCrypto = convertToCrypto;
module.exports.confirmConvertToCrypto = confirmConvertToCrypto;
module.exports.notifyConvertToCrypto = notifyConvertToCrypto;
