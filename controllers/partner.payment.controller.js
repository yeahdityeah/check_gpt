const{ ReE, to, ReS, waitTimer } = require( '../services/util.service' );
const{ messages } = require( '../messages/messages' );
const logger = require( '../services/logger.service' );
const{ Partner, User } = require( '../models' );
const crypto = require( 'crypto' );
const{ threadId } = require( 'worker_threads' );
const CONFIG = require( '../config/config' );
const{ TRANSACTIONS } = require( '../utils/constants' );
const{ UserService } = require( '../services/user.service' );
const{ getCurrency } = require( '../services/exchange.service' );
const{ RegionService } = require( '../services/region' );
const{ PartnerService } = require( '../services/partner.service' );
const{ loadFromPartnerUserWallet, loadToPartnerUserWallet } = require( '../utils/partner.ups.wallet' );
const { getProbeById, getProbesById } = require('../models/probe');
const {debitMyMaster11Wallet, creditMyMaster11Wallet} = require('../services/mymaster11.service.js');
const { generateOrderId } = require("../msg_recv/utils");

const getPartnerUserWalletBalance = async function( req, res, next ) {
    const payload = req.body.payload;
    console.log(req?.user?.partner);
    let payloadStr = '';
    try {
        let d = new Buffer( payload, 'base64' );
        const payloadDecrypt = crypto.privateDecrypt({
            key: CONFIG[`PARTNER_${(req?.user?.partner?.name).toUpperCase()}_PRIVATE_KEY`]
        }, Buffer.from( d ) );
        payloadStr = payloadDecrypt.toString( 'utf8' );
        console.log( payloadStr );
        console.log( `validatePartnerPayload: payloadStr: ${payloadStr}` );
    } catch( err ) {
        logger.error( `validatePartnerPayload: error decryption `, err );
        try {
            let d = Buffer.from( payload, 'base64' );
            const payloadDecrypt = crypto.privateDecrypt({
                key: CONFIG[`PARTNER_${(req?.user?.partner?.name).toUpperCase()}_PRIVATE_KEY`],
                // padding: crypto.constants.RSA_NO_PADDING
                padding: crypto.constants.RSA_PKCS1_PADDING
            }, d );
            payloadStr = payloadDecrypt.toString( 'utf8' );
            console.log( payloadStr );
            console.log( `validatePartnerPayload: payloadStr: ${payloadStr}` );
        } catch( err ) {
            logger.error( `validatePartnerPayload: error decryption `, err );
            return ReE( res, messages.PARTNER_PRIVATE_KEY_MISMATCH, 400 );
        }
    }

    let payloadObj = JSON.parse( payloadStr );
    let partnerId = payloadObj.partner_id;
    let partnerUserId = payloadObj.partner_user_id;

    const partner = await PartnerService.getPartner( partnerId );
    if( partner.name !== 'MetaOne'  && partner.name !== 'MyMaster11') {
        return ReE( res, messages.PARTNER_WALLET_ERROR, 400 );
    }
    let whereCond = { email: partnerUserId, partner: partnerId };
    let[ userErr, _userRows ] = await to( User.get( 'users', whereCond ) );
    if( userErr ) throw userErr;

    if( _userRows.length === 0 ) {
        return ReE( res, messages.PARTNER_USER_ERROR, 400 );
    }
    let userId = _userRows[0].id;

    let[ er, userData ] = await to( User.getWalletBalance( userId, false ) );
    if( er ) {
        throw er;
    }
    let balance_inr = userData['coinsd'] + userData['coinsw'];
    const currencies = {
        'MetaOne': 'USDT',
        'MyMaster11': 'INR'
    }
    const[ err, result ] = await to( RegionService.getExchangeRate( currencies[partner.name], CONFIG.CURRENCIES.INR ) );
    let balance_usdt = ( 1 / result.value ) * balance_inr;
    if(partner.name === 'MetaOne') {
        return ReS( res, {
            success: true,
            balance_usdt: balance_usdt,
        });
    }
    return ReS( res, {
        success: true,
        withdrawable_balance: userData['coinsw'] / result.value,
        total_balance: (userData['coinsw'] + userData['coinsd'] ) / result.value
    });
};

const debitParnerUserWallet = async function( req, res, next ) {
    const payload = req.body.payload;
    let payloadStr = '';
    try {
        let d = new Buffer( payload, 'base64' );
        const payloadDecrypt = crypto.privateDecrypt({
            key: CONFIG[`PARTNER_${(req?.user?.partner?.name).toUpperCase()}_PRIVATE_KEY`],
        }, Buffer.from( d ) );
        payloadStr = payloadDecrypt.toString( 'utf8' );
        console.log( payloadStr );
        console.log( `validatePartnerPayload: payloadStr: ${payloadStr}` );
    } catch( err ) {
        logger.error( `validatePartnerPayload: error decryption `, err );
        try {
            let d = Buffer.from( payload, 'base64' );
            const payloadDecrypt = crypto.privateDecrypt({
                key: CONFIG[`PARTNER_${(req?.user?.partner?.name).toUpperCase()}_PRIVATE_KEY`],
                // padding: crypto.constants.RSA_NO_PADDING
                padding: crypto.constants.RSA_PKCS1_PADDING
            }, d );
            payloadStr = payloadDecrypt.toString( 'utf8' );
            console.log( payloadStr );
            console.log( `validatePartnerPayload: payloadStr: ${payloadStr}` );
        } catch( err ) {
            logger.error( `validatePartnerPayload: error decryption `, err );
            return ReE( res, messages.PARTNER_PRIVATE_KEY_MISMATCH, 400 );
        }
    }

    let payloadObj = JSON.parse( payloadStr );
    let partnerId = payloadObj.partner_id;
    let partnerUserId = payloadObj.partner_user_id;
    let amount_usdt = payloadObj.amount;

    const partner = await PartnerService.getPartner( partnerId );
    if( partner.name !== 'MetaOne' && partner.name !== 'MyMaster11' ) {
        return ReE( res, messages.PARTNER_WALLET_ERROR, 400 );
    }

    let whereCond = { email: partnerUserId, partner: partnerId };
    let[ userErr, _userRows ] = await to( User.get( 'users', whereCond ) );
    if( userErr ) throw userErr;

    if( _userRows.length === 0 ) {
        return ReE( res, messages.PARTNER_USER_ERROR, 400 );
    }
    let userId = _userRows[0].id;
    const currencies = {
        'MetaOne': 'USDT',
        'MyMaster11': 'INR'
    }
    const[ err, result ] = await to( RegionService.getExchangeRate( currencies[partner.name], CONFIG.CURRENCIES.INR ) );
    let amount_inr = result.value * amount_usdt;

    let[ er, userData ] = await to( User.getWalletBalance( userId, false ) );
    if( er ) {
        throw er;
    }
    let withdraw_balance = userData['coinsw'] + userData['coinsd'];
    if(partner.name === 'MyMaster11') {
        withdraw_balance =  userData['coinsw'];
    }
    if( withdraw_balance < amount_inr ) {
        return ReE( res, `Withdrawable balance is ${withdraw_balance / result.value}. Cannot withdraw ${amount_usdt}`, 400 );
    }

    let action = TRANSACTIONS.fundsRedeem;
    const refid = generateOrderId().replace('od_', 'tr_');
    let txnData = {
        'userid': userId,
        'message': `Debit to ${partner.name} wallet`,
        'txnid': `RD1000${userId}`,
        'wallettype': 'D',
        'type': 'DEBIT',
        'amount': amount_inr,
        surcharge: 0,
        action: action,
        refid,
    };
    let batchTxns = [];
    batchTxns.push( txnData );
    

    if(partner.name === 'MyMaster11') {
        try {
            const response = await creditMyMaster11Wallet(partnerId, partnerUserId, amount_inr, refid);
            if(response?.status) {
                await UserService.executeTransactions( batchTxns, true, null, 'public' );
                return ReS( res, {
                    success: true,
                    amount: amount_usdt,
                    referenceId: refid
                });
            }
            return ReE( res, `Error in Mymaster11 API ${response?.message}`, 400);
        } catch(e) {
            console.log("MYmaster11 credit error", e);
            return ReE( res, `Error in processing ${e?.message}`, 400);
        }
        
    } else {
        await UserService.executeTransactions( batchTxns, true, null, 'public' );
        return ReS( res, {
            success: true,
            amount: amount_usdt,
            tradex_credits: amount_inr
        });
    }
    
};

const creditParnerUserWallet = async function( req, res, next ) {
    const payload = req.body.payload;
    let payloadStr = '';
    try {
        let d = new Buffer( payload, 'base64' );
        const payloadDecrypt = crypto.privateDecrypt({
            key: CONFIG.PARTNER_METAONE_PRIVATE_KEY
        }, Buffer.from( d ) );
        payloadStr = payloadDecrypt.toString( 'utf8' );
        console.log( payloadStr );
        console.log( `validatePartnerPayload: payloadStr: ${payloadStr}` );
    } catch( err ) {
        logger.error( `validatePartnerPayload: error decryption `, err );
        try {
            let d = Buffer.from( payload, 'base64' );
            const payloadDecrypt = crypto.privateDecrypt({
                key: CONFIG.PARTNER_METAONE_PRIVATE_KEY,
                // padding: crypto.constants.RSA_NO_PADDING
                padding: crypto.constants.RSA_PKCS1_PADDING
            }, d );
            payloadStr = payloadDecrypt.toString( 'utf8' );
            console.log( payloadStr );
            console.log( `validatePartnerPayload: payloadStr: ${payloadStr}` );
        } catch( err ) {
            logger.error( `validatePartnerPayload: error decryption `, err );
            return ReE( res, messages.PARTNER_PRIVATE_KEY_MISMATCH, 400 );
        }
    }

    let payloadObj = JSON.parse( payloadStr );
    let partnerId = payloadObj.partner_id;
    let partnerUserId = payloadObj.partner_user_id;
    let amount_usdt = payloadObj.amount;

    const partner = await PartnerService.getPartner( partnerId );
    if( partner.name !== 'MetaOne' ) {
        return ReE( res, messages.PARTNER_WALLET_ERROR, 400 );
    }

    let whereCond = { email: partnerUserId, partner: partnerId };
    let[ userErr, _userRows ] = await to( User.get( 'users', whereCond ) );
    if( userErr ) throw userErr;

    if( _userRows.length === 0 ) {
        return ReE( res, messages.PARTNER_USER_ERROR, 400 );
    }
    let userId = _userRows[0].id;

    const[ err, result ] = await to( RegionService.getExchangeRate( 'USDT', CONFIG.CURRENCIES.INR ) );
    let amount_inr = result.value * amount_usdt;

    let action = TRANSACTIONS.fundsRedeemCancel;
    let txnData = {
        'userid': userId,
        'message': `Credit from Metaone wallet`,
        'txnid': `PM1000${userId}`,
        'wallettype': 'D',
        'type': 'CREDIT',
        'amount': amount_inr,
        surcharge: 0,
        action: action
    };
    let batchTxns = [];
    batchTxns.push( txnData );
    await UserService.executeTransactions( batchTxns, true, null, 'public' );

    return ReS( res, {
        success: true,
        message: 'Credit successful',
        amount: amount_usdt,
        tradex_credits: amount_inr
    });
};

const creditParnerUserWalletOpenSell = async function( req, res, next ) {
    let data = req.body;
    if( !data ) {
        return ReE( res, messages.OPEN_SELL_CREDIT_INVALID_PAYLOAD, 400 );
    }
    let userId = data.userid;
    console.log( `creditParnerUserWalletOpenSell data: ${data}` );
    console.log( `creditParnerUserWalletOpenSell userid: ${userId}` );
    if( !userId ) {
        return ReE( res, messages.OPEN_SELL_CREDIT_INVALID_PAYLOAD, 400 );
    }

    let[ errUserProfile, userProfile ] = await to( User.findById( userId ) );
    let partnerConfig, errPartnerConfig;
    console.log( `creditParnerUserWalletOpenSell data: ${userProfile}` );
    if( !errUserProfile ) {
        [ errPartnerConfig, partnerConfig ] = await to( PartnerService.getPartner( userProfile.partner, userProfile.region, true ) );
    } else {
        return ReE( res, messages.OPEN_SELL_CREDIT_INVALID_PAYLOAD, 400 );
    }

    if( partnerConfig.name === 'USP' && partnerConfig.withdraw_pg === 'partner_wallet' && partnerConfig ) {
        const eventData = await getProbesById(data?.eventid, 'public');
        console.log( `creditParnerUserWalletOpenSell updating both wallets`, JSON.stringify(eventData) );
        let[ errLoadToPartner, loadToPartner ] = await to( loadToPartnerUserWallet({
            userData: userProfile,
            partner: partnerConfig,
            eventData: eventData?.[0] ?? {},
        }) );
        if( errLoadToPartner ) {
            console.log( 'creditParnerUserWalletOpenSell [Cancellation load to partner wallet error]', errLoadToPartner.message );
        }
        console.log( `creditParnerUserWalletOpenSell both wallet updated successfully` );
        console.log( `creditParnerUserWalletOpenSell response: ${JSON.stringify(loadToPartner)}` );
    } else {
        return ReE( res, messages.PARTNER_NOT_SUPPORTED_ACTION, 400 );
    }
    return ReS( res, {
        success: true,
        message: 'Credit successful'
    });
};


module.exports.getPartnerUserWalletBalance = getPartnerUserWalletBalance;
module.exports.debitParnerUserWallet = debitParnerUserWallet;
module.exports.creditParnerUserWallet = creditParnerUserWallet;
module.exports.creditParnerUserWalletOpenSell = creditParnerUserWalletOpenSell;
