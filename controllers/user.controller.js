const multer = require('multer');
const fs = require('fs');
const path = require('path');
var bcrypt = require('bcrypt');
const bcrypt_p = require('bcrypt-promise');
const lodash = require('lodash');
var Readable = require('stream').Readable;
var geoip = require('geoip-lite');
var WAValidator = require('multicoin-address-validator');
const crypto = require('crypto');
const moment = require('moment');
const fuzz = require('fuzzball');
const { uuid } = require('uuidv4');
const redis = require('redis');
const jwt_lib = require("jsonwebtoken")
const {
    getPaymentOrderStatus: getPaymentOrderStatus,
    updatePaymentOrderStatus: updatePaymentOrderStatus
} = require("../services/onmeta.service");

const { usersCacheService, redisCaching } = require('../services/cache.service');
const { User, Level, UserPreference, Payments, Partner, PaymentConfig, Location, PaymentDetails, Rewards } = require('../models');
const TdsUsers = require('../models/tdsUsers');
const { to, ReE, ReS, getUID, waitTimer } = require('../services/util.service');
const customStorage = require('../middleware/customStorage');
const CONFIG = require('../config/config');
const logger = require('../services/logger.service');
// const socketService = require('../services/socket.service');
const CommonController = require('./common.controller');
const hashedPwd = '$2b$10$F7HkvNdaEou29W2dd5EQNOqJ/cMZd4HRDWXrcymW7iMzR3lgLTP82';
const notificationService = require('../services/notification.service');
const { UserService } = require('../services/user.service');
const sendEmail = require('../services/sendgrid.email.service');
const { isDashboardUser } = require('../middleware/dashboard.user');
const { logDashboardRequest } = require('../services/mongodb.service');
const { tokenizeAndSort } = require('../utils/sentence.util');
const { fuzzratiologic } = require('../utils/fuzzratiologic.util');
const { isPanCardAllowed, validatePayload, panVerification, bankVerification, pennyDropStatus, compareAndAddKyc, addToPaymentDetails } = require('../utils/kyc.utils');
const { verifyMobileNumber, verifyEmailId } = require('../utils/mobile.utils');
const { messages } = require("../messages/messages");
const { updateEmailVerifiedFalse } = require('../models/user');
const { googleAuth } = require('../services/emailverification.service');
const { ifscToBank } = require('../services/ifscToBank.service');
const { differenceInCalendarDays, startOfHour } = require('date-fns');
const { isProfileComplete, addSignUpTransactions } = require('../utils/user.util');
const { isEligibleToAdd } = require('../utils/checkRecharge.util');
const { getPinCodeDetails } = require('../services/blocked_pinCode.service');
const { persistTransactionData } = require("../msg_recv/utils");
const { isUserSuspended } = require('../utils/isUserSuspended.util');
const { handleNotification } = require('../services/notification.service');
const { sendGstInvoice } = require('../services/sendinvoiceviamail.service.js');
const { PartnerService } = require('../services/partner.service');
const { subscriberForNotifications } = require('../services/subscriberNotif.service');
// const { recordOpeningBalance } = require('../services/recordOpeningBalance.service');
const { isAnInternalUser } = require('../utils/user.util');
const { performance } = require('perf_hooks');
const { _handleFile } = require('../middleware/customStorageUws');
const { promisify } = require('util');
const { RegionService } = require('../services/region/index');
const { localesService } = require('../services/locale/index');
const lock = promisify(require('redis-lock')(redisCaching.client));
const { sendWithdrawalWhatsappNotifications } = require('../services/notification.service');
const { getExchangeRate, getCurrency } = require("../services/exchange.service");
const { threadId } = require('worker_threads');
const { TRANSACTIONS } = require('../utils/constants');
const { isExemptUser } = require("../utils/tradingfee.util");
const numberConverter = require('number-to-words');
const { getTransactionCount } = require('../models/transactions');
const Paykassma = require("../services/paykassma.service");
const Otpless = require('../models/otpless');
const { DeadSimpleChat } = require('../services/deadsimplechat.service');
const {addUserToRewardFlow} = require('../services/rewards.service.js');
const { canCreateEvent } = require('../models/rewards.js');
const {updateUserRewardFlow} = require('../services/rewards.service.js');
const luxon = require('luxon');
let blockedUsers = false;

const get = async function (req, res) {
    // res.setHeader('Content-Type', 'application/json');
    const platform = req.headers['x-platform'];
    const version = parseInt(req.headers['version']);
    var err, preference, _user;
    let user = req.user;
    if (user == null || user.id == null) {
        return ReS(res, {
            user: user
        });
    }
    [err, _user] = await to(User.findById(user.id, true, true));
    const region = req.user?.region ?? 'INDIA';
    if (err) throw err;
    const language = _user?.preferred_locale ?? 'en-IN';
    const translator = await localesService.getTranslator(language, 'wallet');

    [err, preference] = await to(User.getPreferenceEmail({ userid: user.id, preference_type: 'email' }));
    if (err) throw err;

    let emailPreference;
    if (preference.length < 1) emailPreference = false;
    else emailPreference = preference[0].preference_value === 'true' ? true : false;
    _user['emailNotifications'] = emailPreference;
    _user['howItWorks'] = _user['howitworks'];
    _user['isProfileComplete'] = true;
    _user['isDepositProfileComplete'] = true;
    if (_user['region'] == 'INDIA' && parseInt(_user['partner']) === 1) {
        if (!_user['displayname'] || !_user['pincode'] || !_user['dob'] || !_user['isEmailVerified'] || !_user['email'] || !_user['mobile']) {
            _user['isProfileComplete'] = false;
        }
    } else {
        if (!_user['displayname'] || !_user['dob'] || !_user['isEmailVerified'] || !_user['email']) {
            _user['isProfileComplete'] = false;
            _user['isDepositProfileComplete'] = false;
        }
    }
    delete _user.howitworks;
    _user['withdrawalLimit'] = {
        min:
            req?.user?.config?.minWithdraw ?? CONFIG.withdrawalConfig[region].redeemRequestLowerLimit, max: req?.user?.config?.maxWithdraw ?? CONFIG.withdrawalConfig[region].redeemRequestUpperLimit
    };
    _user['depositLimit'] = {
        min:
            req?.user?.config?.minDeposit ?? 1, max: req?.user?.config?.maxDeposit
    };
    if (
        req.user.region !== 'INDIA'
    ) {
        const fromCurrency = getCurrency(req?.user?.signup_country, platform, version);
        const exchangeRate = await getExchangeRate(fromCurrency, 'INR');
        if (RegionService.payment.depositLimits?.[req?.user?.signup_country] && fromCurrency != 'BTC' && fromCurrency != 'USDT') {
            const countryLimit = RegionService.payment.depositLimits?.[req?.user?.signup_country];
            const max = Math.min(countryLimit?.max, _user?.depositLimit?.max / parseFloat(exchangeRate?.value));
            const min = Math.max(countryLimit?.min, _user?.depositLimit?.min / parseFloat(exchangeRate?.value));
            _user['depositLimit']['max'] = Number(max.toFixed(2));
            _user['depositLimit']['min'] = Number(min.toFixed(2));
        } else {
            const fromCurrency = process.env.NODE_ENV !== 'production' ? 'BTC' : 'USDT';
            const exchangeRate = await getExchangeRate(fromCurrency, 'INR');
            _user['depositLimit']['max'] = Number((_user['depositLimit']['max'] / parseFloat(exchangeRate?.value)).toFixed(
                process.env.NODE_ENV === 'production' ? 2 : 8
            ));
            _user['depositLimit']['min'] = Number((_user['depositLimit']['min'] / parseFloat(exchangeRate?.value)).toFixed(
                process.env.NODE_ENV === 'production' ? 2 : 8
            ));
        }

        if (RegionService.payout.withdrawLimits?.[req?.user?.signup_country] && fromCurrency != 'BTC' && fromCurrency != 'USDT') {
            let countryWithdrawLimit = {
                min: _user['withdrawalLimit']['min'],
                max: _user['withdrawalLimit']['max']
            };
            if (fromCurrency !== 'BTC' || fromCurrency !== 'USDT') {
                countryWithdrawLimit = RegionService.payout.withdrawLimits?.[req?.user?.signup_country]
            }
            const withdrawMax = Math.min(countryWithdrawLimit?.max * parseFloat(exchangeRate?.value), _user?.withdrawalLimit?.max);
            const withdrawMin = Math.max(countryWithdrawLimit?.min * parseFloat(exchangeRate?.value), _user?.withdrawalLimit?.min);
            _user['withdrawalLimit']['max'] = Number(withdrawMax.toFixed(2));
            _user['withdrawalLimit']['min'] = Number(withdrawMin.toFixed(2));
        }

    }
    _user['is_liquidity_provider'] = false;
    let d;
    [err, d] = await to(User.getConfig(req.user.id));
    if (err) throw err;
    let currentBalance = (_user['coinsw']);
    if (d) {
        _user['is_liquidity_provider'] = d.is_liquidity_provider ? true : false;
        _user['withdrawalLimit'] = { min: req?.user?.config?.minWithdraw ?? CONFIG.withdrawalConfig[region].redeemRequestLowerLimit, max: d['max_withdrawal_limit'] };
    }

    if (_user.region_code == 'REST_OF_WORLD' || _user.region_code == 'ASEAN') {



        let rows = await User.getLastReconStatus();
        let processTillTime, balanceAfterLastRecon;
        if (rows && rows.length) {
            processTillTime = new Date(rows[0].end_time).toISOString();
        }
        [err, balanceAfterLastRecon] = await to(User.getWalletBalanceAfterTime(user.id, false, processTillTime));
        if (err) throw err;

        let maxWithdrawableBalance = 0;

        if (balanceAfterLastRecon) {
            maxWithdrawableBalance = (balanceAfterLastRecon['coinsw']);
        }
        let maxwithdrawalallowed = Math.min(currentBalance, maxWithdrawableBalance);

        _user['maxWithdrawableAmount'] = maxwithdrawalallowed;
        _user['holdAmount'] = 0;



    } else {
        _user['maxWithdrawableAmount'] = currentBalance;
        _user['holdAmount'] = 0
        const withdrawFee = req?.user?.config?.withdrawFee;
        let slab;
        if (withdrawFee) {
            slab = (withdrawFee?.slabs ?? []);
        }
        _user['withdraw_disclaimer'] = translator(`The bank charges 5 credits for each withdraw request. Maximum withdrawal limit per transaction is {{currentBalance}} credits.`, { 'currentBalance': currentBalance.toFixed(2) });
    }
    delete _user['id'];

    _user['level'] = (req?.user?.config?.level ?? 'Novice');
    _user['level_icon'] = `assets/icons/levels/${_user['level']}.png`;

    let currency = getCurrency(req?.user?.signup_country, platform, version);
    let depositMethod = RegionService.payment.getDepositMethod(req?.user?.signup_country, platform, version);

    let depositConfig = await PartnerService.getPartnerServiceConfiguration('depositConfig', req?.user, null, platform);
    _user['depositConfig'] = {
        currencyIcon: currency !== 'INR' ? `assets/icons/${currency}.png` : null,
        currencyPlaceholder: translator(CONFIG.CURRENCIES_PLACEHOLDER[`${currency}`]),
        depositMethod: depositMethod,
        ...(depositConfig?.config ?? CONFIG?.depositConfigPartnerRegion?.[req?.user?.partner?.id || "1"]?.[region] ?? CONFIG?.depositConfigNew?.[region] ?? {})
    }

    let luckyCoinsConfig = await PartnerService.getPartnerServiceConfiguration('luckyCoins', req?.user) ??  {};
    if (luckyCoinsConfig && luckyCoinsConfig.config) {
        _user['luckyCoins'] = {
            "exchange_rate": luckyCoinsConfig.config.exchange_rate,
            "is_enabled": luckyCoinsConfig.config.is_enabled,
            "note_string": platform === 'web' ? luckyCoinsConfig.config.note_string : undefined
        };
    }


    const calculateDepositLimits = async (pg) => {
        // Calculate depositLimit based on logic
        const fromCurrency = pg.currency;
        const exchangeRate = await getExchangeRate(fromCurrency, 'INR');

        if (
            RegionService.payment.depositLimits?.[req?.user?.region] &&
            fromCurrency !== 'BTC' &&
            fromCurrency !== 'USDT'
        ) {
            const countryLimit = RegionService.payment.depositLimits[req?.user?.region];
            const max = Math.min(countryLimit?.max, (req?.user?.config?.maxDeposit ?? 1) / parseFloat(exchangeRate?.value));
            const min = Math.max(countryLimit?.min, (req?.user?.config?.minDeposit ?? 1) / parseFloat(exchangeRate?.value));

            pg['depositLimit']['max'] = Number(max.toFixed(2));
            pg['depositLimit']['min'] = Number(min.toFixed(2));
        } else {
            const fromCurrency = pg.currency;
            const exchangeRate = await getExchangeRate(fromCurrency, 'INR');

            pg['depositLimit']['max'] = Number(((req?.user?.config?.maxDeposit ?? 1) / parseFloat(exchangeRate?.value)).toFixed(
                process.env.NODE_ENV === 'production' ? 2 : 8
            ));
            pg['depositLimit']['min'] = Number(((req?.user?.config?.minDeposit ?? 1) / parseFloat(exchangeRate?.value)).toFixed(
                process.env.NODE_ENV === 'production' ? 2 : 8
            ));
        }
    };
    // Iterate through each "pg" in depositConfig
    if (_user['depositConfig'] && _user['depositConfig'].pg) {
        for (const pg of _user['depositConfig'].pg) {
            // Add depositLimit key
            pg['depositLimit'] = { max: 0, min: 0 };
            await calculateDepositLimits(pg);
            if (pg?.value === 'paykassma') {
                let pgObj = await Paykassma.getAvailableWallets(req?.user, { currency });
                if (pgObj?.fields) {
                    pg['fields'] = pgObj?.fields;
                }
            }
        }
    }
    if (CONFIG.withdrawalConfig[region]) {
        const configWithdrawal = await UserService.updateFieldsWithdrawConfig(req.user, CONFIG.withdrawalConfig[region]);
        if (configWithdrawal) {
            CONFIG.withdrawalConfig[region] = configWithdrawal;
        }
    }
    _user['withdrawConfig'] = {
        isShowHoldAmount: req.user.region === 'INDIA' ? false : true,
        ...(CONFIG?.withdrawalConfigPartnerRegion[req?.user?.partner?.id || "1"]?.[region] ?? CONFIG.withdrawalConfig[region] ?? {})
    }

    if (region !== 'INDIA') {
        _user['withdrawConfig'] = {
            ..._user['withdrawConfig'],
            paymentdDetailAccount: req?.user?.signup_country === "PK" && currency === 'PKR'
                ? "Easypaisa Account Number"
                : req?.user?.signup_country === "BD" && currency === 'BDT'
                    ? "Bkash Account Number"
                    : "USDT Wallet Address",
            currency,
            paymentMode: req?.user?.signup_country === "PK" && currency === 'PKR' ? "Easypaisa" : req?.user?.signup_country === "BD" && currency === 'BDT' ? "Bkash" : ''
        };
    }
    if (_user?.withdrawConfig?.pg) {
        for (const pg of _user['withdrawConfig'].pg) {
            if (pg?.value === 'paykassma') {
                const withdraw_mobile = await User.getLatestMobileRedeemReq(req.user.id);
                pg.mobile = withdraw_mobile ?? null;
            }
        }
    }
    if (_user?.depositConfig?.pg) {
        for (const pg of _user['depositConfig'].pg) {
            if (pg?.isMobileReq) {
                const withdraw_mobile = await User.getLatestMobilePaymentReq(req.user.id);
                pg.mobile = withdraw_mobile ?? null;
            }
        }
    }
    const luckycoinsconfig = await PartnerService.getPartnerServiceConfiguration(
        "luckyCoins",
        req.user
    );
    const {refereeAmount, referrerAmount, signup_bonus} = luckycoinsconfig?.config?.signup ?? {};

    _user['userConfig'] = {
        isFirstTimeVideoVisible: req.user.region === 'INDIA' ? true : false,
        IsCheckPinCodeValid: req.user.region === 'INDIA' ? true : false,
        RefernEarnText: translator(`Your friend gets {{referralBonus}} credits and {{signup_bonus}} tokens on signup.`, {'referralBonus' : CONFIG.referralBonus, 'signup_bonus' : signup_bonus}), 
        RefernEarnText2: `You earn 25% cashback on your friend's total trading as tokens `,
        whatsappReferMessage : translator(`Join me on TradeX to earn by making predictions on sports, crypto, politics, movies and more. Use my referral code *{{coupon}}* to register and get {{referralBonus}} credits and {{signup_bonus}} Tokens.`, {'coupon': req.user.coupon, 'referralBonus' : CONFIG.referralBonus, 'signup_bonus' : signup_bonus}),
        txnfeeRedirectLink: "https://tradexmarkets.zohodesk.in/portal/en/kb/articles/trading-fee-liquidity-cost-structure",
        txnFeeInfoText: translator(`Includes trading fee on buy, sell and event settlement, {{dynamicString}} To know more`,{'dynamicString' : (req.user.region === 'INDIA' ? "Bank charges, GST and TDS." : "gateway fee")})
    }

    _user['show_locale_selection'] = req?.user?.region === 'BD';
    // _user['promo_message'] = {title : translator(`You've got {{signup_bonus}} \ntokens + {{referralBonus}} Credits`, {'signup_bonus' : signup_bonus, 'referralBonus' : CONFIG.referralBonus}),
    //                         subtitle : [translator("Make 1 trade in next 10 minutes"), translator("and get 500 extra tokens as reward")]};


    const balances = await UserService.getWalletBalances(_user, platform, version);

    /** Chatbot Enable */
    
    let is_chatbot_enabled = CONFIG.chatbotUsers.findIndex(c => c == req?.user?.id) > -1;
    // const rewardData = await Rewards.getRewardData(req.user.id);
    // const isRewardUser = rewardData ? !rewardData.flow_complete : rewardData;
    // const is_chatbot_enabled = CONFIG.chatbotUsers.findIndex(c => c == req?.user?.id) > -1;
    is_chatbot_enabled = true;

    const isCreator = await canCreateEvent(req?.user?.id);
    let create_event_enabled = CONFIG.CREATE_EVENT_USERS.includes(req?.user?.id);
    // if( new Date('Sat Mar 09 2024 20:00:00 GMT+0530').valueOf() > Date.now() &&
    //     new Date('Fri Mar 08 2024 13:00:00 GMT+0530').valueOf() < Date.now()
    // ) {
    //     create_event_enabled = true;
    // }
    const create_event_clickable = _user.coinsp >= 100;
    const create_event_defaults = {
        invest_amount: 100,
        duration: {  days: 1 },
        invest_option: 'Y'
    }
    let create_normal_event_enabled = (Number(req?.user?.partner?.id ?? 1) === 1) ? isCreator : false;
    const create_normal_event_clickable = (_user.coinsw + _user.coinsb + _user.coinsd)>= 100;
    const create_normal_event_defaults = {
        invest_amount: 100,
        duration: {  days: 1 },
        invest_option: 'Y'
    }
    const isDepositProfileMandatory = true;
    const showVerifyEmailPopUp = ( (Number(req?.user?.partner?.id ?? 1) === 1) && (!_user['isEmailVerified'] || !_user['email'])
                                && ((new Date(_user.createdat) < new Date('2024-03-15') ))) ? true : false;

    return ReS(res, {
        user: {
            ...balances,
            ..._user,
            is_chatbot_enabled,
            create_event_enabled,
            create_event_defaults,
            create_event_clickable,
            create_normal_event_enabled,
            create_normal_event_clickable,
            create_normal_event_defaults,
            partner: req?.user?.partner || req?.partner,
            isDepositProfileMandatory,
            showVerifyEmailPopUp
        },
    });
}

const getUser = async (req, res) => {
    // res.setHeader('Content-Type', 'application/json');
    var pwd = req.body.password;
    bcrypt.compare(pwd, hashedPwd, function (err, result) {
        return ReS(res, { status: result });
    });
}

const updateUsers = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    try {
        let { userid, kycstatus, comment } = req.body, err, _user;

        [err, _user] = await to(User.findById(userid, false));
        if (err) throw err;

        let { fcmtoken } = _user;

        [err, _user] = await to(User.update({ userid: userid, kycstatus: kycstatus }, true));
        if (err) throw err;

        [err, _user] = await to(User.updateKyc({ updatedat: 'now()', comment: comment }, userid));
        if (err) throw err;

        if (kycstatus) {
            var msgTitle = `Congratulations!`;
            var msgBody = `Your KYC has been completed succesfully. Now you can withdraw to your bank wallet`;
            if (kycstatus == 'F') {
                msgTitle = 'Action Required!'
                msgBody = 'Your KYC could not be completed succesfully.Submit your documents again';
            }
            var jsonData = { getuser: true, 'title': msgTitle, 'type': 'N', 'body': msgBody };
            // let [errx, res2] = await to(UserService.addMessageAndInform(userid, fcmtoken, jsonData));
        }
        return ReS(res, { user: _user[0] });
    } catch (err) {
        next(err);
    }
}

const login = async (req, res) => {
    // res.setHeader('Content-Type', 'application/json');
    var err, pwdMatches;
    var pwd = req.body.password;
    var email = req.body.email;
    let dashboardUser;
    const requestObject = Object.assign({}, req);
    delete requestObject.body.password;
    [err, dashboardUser] = await to(User.findDashboardUserByEmail(email));
    if (err) return ReE(res, err, 422);
    if (!dashboardUser) {
        logDashboardRequest(requestObject, 'attempt to login with incorrect email');
        return ReS(res, { status: false, error: 'Invalid Credentials' });
    }

    // if (dashboardUser.is_internal) {
    [err, pwdMatches] = await to(bcrypt_p.compare(pwd, dashboardUser.password));
    if (err) return ReE(res, err, 422);

    if (!pwdMatches) {
        logDashboardRequest(requestObject, 'attempt to login with incorrect password');
        return ReS(res, { status: false, error: 'Invalid Credentials' });
    }
    // } // Else loggedin with Google
    logDashboardRequest(requestObject, 'attempt to login with VALID credentials');
    const token = await to(User.getJWT(dashboardUser.id, true, req.baseUrl.includes("v2")));
    const useractions = [];
    let [errP, permissions] = await to(User.getPermissions(dashboardUser.id))
    if (errP) throw errP
    for (let p of permissions) {
        useractions.push(p['name']);
    }
    return ReS(res, { status: true, token: token[1], useractions: useractions, isInternal: dashboardUser.is_internal, partners: dashboardUser.partners, regions: dashboardUser.regions });
}

const putUser = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    let firstTimeLogin = false;
    const partnerId = Number(req.headers['x-partner-id']) || 1;
    let region = await RegionService.getRequestRegion(req);
    const platform = req?.headers?.['x-platform'] ?? 'web';
    let country_obj;
    req.partner = await PartnerService.getPartner(partnerId, region, true);
    var data = Object.assign({}, req.body);
    if (data?.mobile) {
        data.mobile = String(parseInt(data.mobile, 10));
    }
    var mobile = data?.mobile || data?.token || data?.appleid_token || data?.email;
    const reqKey = `adding_user_${mobile}`;
    const unlock = await lock(reqKey, 300000);
    try {
        var err, _userRows, _msgRows, userId, _couponRows, refId, _userRefRows, respEmail;
        let signup_country = req.body.signup_country; // || req.headers['country']  || 'IN';
        console.log('[SIGNUP COUNTRY HEADER]', req.headers['country'], req.headers['Country']);
        if(!signup_country) {
            signup_country = await RegionService.getRequestCountry(req);
        }
        // let region;
        var whereCond = {};
        if (data.email) {
            whereCond = { email: data.email, partner: partnerId };
            if (partnerId === 1){
                [err, _userRows] = await to(User.getTemp({mobile: data.email, partner: partnerId}));
                if((_userRows.length == 0) || !(_userRows?.[0]?.verified)){
                    unlock();
                    return ReE(res, `Bad Request`, 400);
                }
                [err, _userRows] = await to(User.deleteTempUser({mobile: data.email, partner: partnerId}));
                data.isEmailVerified = data?.isEmailVerified ?? null;
                if (err) throw err;
            }

        } else if (data.mobile) {
            const respData = await verifyMobileNumber(mobile);
            if (!respData.success) {
                unlock();
                return ReE(res, `Bad Request`, 400);
            }

            if (mobile.startsWith("+91")) {
                mobile = mobile.substring(3);
                data.mobile = mobile;
            }

            if (data.country_code) {
                [err, _msgRows] = await to(User.getIsoFromCountryCode({ "country_code": req.body.country_code }));
                if (err) throw err;

                if (_msgRows.length > 0 && _msgRows[0]['is_enabled'] == true) {
                    signup_country = _msgRows[0]['iso_code'];
                } else {
                    unlock();
                    return ReE(res, 'Unauthorised Request', 422);
                }
            }

            whereCond = { mobile: mobile, country_code: data.country_code ?? '+91', partner: partnerId };
            [err, _userRows] = await to(User.getTemp(whereCond));

            let session;
            if (data?.sid) {
                session = await Otpless.validateApprovedSession(data?.sid);
            }

            if ((data?.sid && _userRows.length == 0 && !session) || (!data?.sid && _userRows.length == 0)) {
                unlock();
                return ReE(res, `Bad Request`, 400);
            }

            if (data?.sid && session?.status !== 'APPROVED') {
                unlock();
                return ReE(res, 'Unauthorised Request', 422);
            }

            if (!data?.sid && !(_userRows?.[0]?.verified)) {
                unlock();
                return ReE(res, 'Unauthorised Request', 422);
            }

            [err, _userRows] = await to(User.deleteTempUser(whereCond));
            if (err) throw err;

            if (whereCond.country_code === '+91' || whereCond.country_code === '91'){
                [err, cachedCountries] =  await to (redisCaching.getKey(`live_countries`));
                if (!err && cachedCountries) {
                    countries = JSON.parse(cachedCountries);
                } else {
                    countries = await Location.getCountries();
                    if (countries.length) {
                        await redisCaching.setKey(`live_countries`, JSON.stringify(countries), 1 * 60 * 60);
                    }
                }
                country_obj = countries.find(c => c.iso_code === 'IN');
            }

        } else if (data.token) {
            //first check for partner if login via email has been enabled - db
            region = await RegionService.getRequestRegion(req);
            //extract and check emailid from logic in User.service
            respEmail = await UserService.authenticateEmail(data.token);
            if (!respEmail.verified) {
                unlock();
                return ReE(res, respEmail.msg, 400);
            }
            //update whereCond
            whereCond = { email: respEmail.email, partner: partnerId };
        } else if (data.appleid_token) {
            //first check for partner if login via email has been enabled - db
            region = await RegionService.getRequestRegion(req);
           
            //extract and check emailid from logic in User.service
            const decoded = jwt_lib.decode(data.appleid_token, { complete: true });
            logger.info(`Apple login value, decoded: ${JSON.stringify(decoded)} `);
            respEmail = await UserService.authenticateAppleId(decoded, data.appleid_token);
            if (!respEmail.verified) {
                unlock();
                return ReE(res, respEmail.msg, 400);
            }
            
            whereCond = { apple_userid: decoded?.payload?.['sub'], partner: partnerId };
            logger.info(`Apple login value, whereCond: ${JSON.stringify(whereCond)} `);
            //store apple_id irrespective of is_private in email column
            //if new user check if mobile is empty and set ismobileverified as false 
            //ismobileverified send in get user (check)
            // in getuser add try catch and log error in catch

            // if(decoded?.payload.is_private_email == false){
            data['email'] = decoded.payload.email;
            data['isEmailVerified'] = true;
            // }
        }
        const luckycoinsconfig = await PartnerService.getPartnerServiceConfiguration(
            "luckyCoins",
            {'partner' : {'id' : partnerId}, 'region' : region, 'signup_country' : signup_country}
        );
        const {refereeAmount, referrerAmount, signup_bonus} = luckycoinsconfig?.config?.signup ?? {};

        [err, _userRows] = await to(User.get('users', whereCond));
        if (err) throw err;

        var walletData = { 'coinsb': 0, 'coinsw': 0, 'coinsd': 0 };
        let _walletData;
        let referralBonus = CONFIG.referralBonus;
        const couponsCap = CONFIG.couponsCap;

        if (_userRows.length == 0) {

            if(String(partnerId) === '4') {
                return ReE(res, "Signups not allowed", 400);
            }
            let joiningBonus = CONFIG.joiningBonus;
            data['coins'] = joiningBonus;
            data['partner'] = partnerId;
            data['kycstatus'] = (signup_country === 'IN' || signup_country === 'CA') ? 'I' : 'C';
            data['platform'] = platform;
            var couponapplied;

            if (data['coupon']) {
                couponapplied = data['coupon'];
            }
            if (['gjg12j', 'gjg1sw', 'gjg0ns', 'gjg11f', 'gjg0y9', 'gjg0yj', 'gjg15m', 'gjg1fh', 'gjg1g8', 'gjg0yf', 'gjg0wn', 'gjg1xu', 'gjg0z5', 'gjg113', 'gjg1in', 'gjg0x5', 'gjg1gi', 'gjg0w7', 'gjg1gy', 'gjg0ee', 'gjg0nq', 'gjg0wq', 'gjg16v', 'gjfy7s', 'gjg0yl', 'gjg0wr', 'gjg1q4', 'gjg11q', 'gjg16a', 'gjg0nj', 'gjg1ia', 'gjg0sx', 'gjg1qd', 'gjfy4q', 'gjg1b6', 'gjg0gc', 'gjg0wk', 'gjg0yd', 'gjg0w8', 'gjg0en', 'gjg10b', 'gjg1m3', 'gjg1n4', 'gjg1o2', 'gjfwyt', 'gjfzdf', 'gjfzwm', 'gjg121', 'gjg127', 'gjg1vq', 'gjg0b3', 'gjg0fw', 'gjfzll', 'gjg13j', 'gjfyo1', 'gjfzer', 'gjg2di', 'gjg2hv', 'gjfx6v', 'gjfyfq', 'gjg04m', 'gjg04r', 'gjg128', 'gjg12b', 'gjg15d', 'gjg1kq', 'gjevzi', 'gjfy6g', 'gjfzku', 'gjg09p', 'gjg11d', 'gjg0hf', 'gjg0kk', 'gjg18d', 'gjg1hn', 'gjg1l6', 'xnqqh5og'].indexOf(couponapplied) > -1) {
                referralBonus = 0;
                couponapplied = null;
            }
            // if (['WELCOME30'].indexOf(couponapplied) > -1) {
            //     referralBonus = 30;
            // }
            if (data['refid']) {
                refId = data['refid'];
            }

            if (respEmail && respEmail.verified == true && !data['appleid_token']) {
                data['email'] = respEmail.email;
                data['isEmailVerified'] = true;
                data['kycstatus'] = 'C';
            }else if(respEmail && respEmail.verified == true && data['appleid_token']){
                data['apple_userid'] = whereCond.apple_userid;
                delete data['appleid_token'];
                data['kycstatus'] = 'C';
            }

            delete data['coupon'];
            delete data['refid'];
            delete data['version'];
            delete data['country_code'];
            delete data['whatsapp_notif'];
            delete data['token'];

            const device_id = data?.device_id;
            delete data.device_id;

            delete data['sid'];
            delete data['session_id'];
            delete data['status'];
            [err, _userRows] = await to(User.createUser(data));
            if (err) throw err;

            userId = _userRows[0];
            firstTimeLogin = true;
            let _prefRow;
            [err, _prefRow] = await to(UserPreference.createPreference({ userid: userId }));
            if (err) throw err;

            if (device_id && device_id !== '') {
                let [errD, devIdResp] = await to(User.putUserDeviceId(userId, device_id));
            }

            if (refId) {
                [err, _userRefRows] = await to(User.updateRef({ refid: refId, userid: userId }));
                if (err) throw err;
            }

            let levelData = {
                userid: userId,
                level_id: 1,
                is_active: true
            }
            levelData.level_id = UserService.getLevelPartnerCountry(signup_country, partnerId);
            let levelId;
            [err, levelId] = await to(Level.addUserLevel(levelData));

            if (CONFIG.GPE_ENABLED && firstTimeLogin) {
                let privateEventUserObj = {
                    'userid': userId,
                    'message': 'signup'
                }
                await User.addToPrivateEventUser(privateEventUserObj);
            }

            var couponCode = (parseInt(userId) + 1000000000).toString(36);
            data['coupon'] = couponCode;

            [err, _userRows] = await to(User.update({ coupon: couponCode, userid: userId }));
            if (err) throw err;

            walletData['userid'] = userId;

            let reqId = uuid();


            if (joiningBonus > 0) {
                if (partnerId !== 1 && partnerId !== 4) joiningBonus = 0;
                walletData['coinsd'] += joiningBonus;
                walletData['coinsb'] += joiningBonus;

                var newUserMsgData = {
                    'userid': userId,
                    'fromuserid': '-1',
                    'message': `Welcome to TradeX. Congratulations! You have been rewarded ${joiningBonus} in your wallet`,
                    'type': 'MSG'
                };

                [err, _msgRows] = await to(User.addMessage(newUserMsgData));
                if (err) throw err;

                var txnid = 'GT' + (100000000 + parseInt(userId));
                var newTxnData = {
                    'userid': userId,
                    'message': `${joiningBonus} credited to your wallet as joining Bonus`,
                    'txnid': txnid,
                    'wallettype': 'B',
                    'type': 'CREDIT',
                    'surcharge': 0,
                    'amount': joiningBonus
                };

                let signupTxnArray = [{
                    ...newTxnData,
                    action: TRANSACTIONS.fundsSignUpBonus
                }];
                if(signup_bonus) {
                    var txnid = 'LCJB' + (100000000 + parseInt(userId));
                    var newTxnDataSignup = {
                        'userid': userId,
                        'message': `${signup_bonus} credited to your wallet as joining Bonus`,
                        'txnid': txnid,
                        'wallettype': 'P',
                        'type': 'CREDIT',
                        'surcharge': 0,
                        'amount': signup_bonus
                    };
                    signupTxnArray.push({
                        ...newTxnDataSignup,
                        action: TRANSACTIONS.fundsCoupon
                    });
                }
                

                _walletData = { 'userid': userId, 'coinsd': joiningBonus, 'coinsb': joiningBonus }
                await addSignUpTransactions(signupTxnArray, _walletData, reqId, 1);

            }

            let couponsCap = CONFIG.couponsCap
            let isValid = false;

            const apply_coupon = UserService.processCoupon(couponapplied, 
                                        {'partner' : {'id' : partnerId}, 'id' : userId, 'signup_country' : signup_country}, 
                                        luckycoinsconfig);
            if(apply_coupon){ 
                walletData['coinsd'] = apply_coupon.coinsd;
                walletData['coinsb'] = apply_coupon.coinsb;
                walletData['coinsp'] = apply_coupon.coinsp;
            }

            data['kycstatus'] = signup_country == 'IN' ? 'I' : 'C';
            data['ageconsent'] = false;
            data['preferred_locale'] = 'en-IN';
            region = await Location.getCountryRegion(signup_country);

            let signup_ip_country, update_location;
            const ip = req.headers['x-forwarded-for'];
            if (ip) {
                var geo = geoip.lookup(ip);
                if (geo) {
                    signup_ip_country = req.headers['country'] || geo['country'];
                }
            }
            [err, update_location] = await to(User.update({ 'userid': userId, 'signup_country': signup_country, 'signup_ip_country': signup_ip_country }));
            if (err) throw err;



            if (req.body.whatsapp_notif == true) {
                let whereObj;
                const preference = {
                    userid: userId,
                    preference_type: 'whatsapp',
                    preference_value: 'true',
                    preference_data_type: 'boolean'
                };

                [err, _userRows] = await to(User.updatePreferenceTable(whereObj, preference));
                if (err) throw err;
            }

            // if (req.partner.notifications) {
            //     await handleNotification({ userid: userId, mobile: mobile, country_code: req.body.country_code ?? '91' }, "new user onboarding");
            // }
            if(partnerId == 1){
                await addUserToRewardFlow( {
                    id: userId
                }, 2);
            }

        } else {
            let ud, _prefRes;
            userId = _userRows[0].id;
            if (data['fcmtoken']) {
                [err, ud] = await to(User.update({ 'userid': userId, 'fcmtoken': data['fcmtoken'] }));
                if (err) throw err;
            }

            [err, _prefRes] = await to(UserPreference.getPreference(userId));
            if (err) throw err;

            if (_prefRes.length == 0) {
                let _prefRow;
                logger.error(`Preference entry doesn't exist for userid: ${userId}`);
                [err, _prefRow] = await to(UserPreference.createPreference({ userid: userId }));
                if (err) throw err;
                logger.info(`Preference entry created for userid: ${userId}.`);
            }

            walletData['coinsb'] = _userRows[0].coinsb;
            walletData['coinsd'] = _userRows[0].coinsw;
            walletData['coinsw'] = _userRows[0].coinsd;
            data['coupon'] = _userRows[0].coupon;
            data['avatar'] = _userRows[0].avatar;
            data['displayname'] = _userRows[0].displayname;
            data['mobile'] = _userRows[0].mobile;
            data['kycstatus'] = _userRows[0].kycstatus;
            data['email'] = _userRows[0].email;
            data['ageconsent'] = _userRows[0].ageconsent;
            data['preferred_locale'] = _userRows[0].preferred_locale;
            region = await Location.getCountryRegion(_userRows[0].signup_country);
        }

        if (req.body.whatsapp_notif == true) {
            let whereObj, pref;

            [err, pref] = await to(User.getPreferenceEmail({ userid: userId, preference_type: 'whatsapp', preference_value: 'true' }));
            if (err) throw err;

            const preference = {
                userid: userId,
                preference_type: 'whatsapp',
                preference_value: 'true',
                preference_data_type: 'boolean'
            };

            if (pref.length < 1) {
                [err, _userRows] = await to(User.updatePreferenceTable(whereObj, preference));
                if (err) throw err;
            }
        }

        [err, jwt] = await to(User.getJWT(userId, undefined, req.baseUrl.includes("v2")));
        if (err) throw err;

        unlock();
        const is_chatbot_enabled = CONFIG.chatbotUsers.findIndex(c => c == userId) > -1;
        return ReS(res, { token: jwt, is_chatbot_enabled, partner: partnerId, id: userId, userid: userId, coinsb: walletData['coinsb'], coinsd: walletData['coinsd'], coinsw: walletData['coinsw'], avatar: data['avatar'], displayname: data['displayname'], coupon: data['coupon'], mobile: data['mobile'], kycstatus: data['kycstatus'], email: data['email'], first_time_login: firstTimeLogin, ageconsent: data['ageconsent'], region: region, show_locale_selection: region === 'BD', preferred_locale: data['preferred_locale'], country: country_obj });
    } catch (err) {
        unlock();
        next(err);
    }
}

const payout = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    if (!isDashboardUser(req)) {
        res.writeStatus("401");
        return ReS(res, {
            success: true, msg: 'Unauthorized request, incident has been reported'
        });
    }
    try {
        let userId = 45, err, resData, rd;
        //whats happening here
        [err, rd] = await to(User.getBankDetails(userId));
        if (err) throw err;

        let refId = 'RD000000001';
        var postData = {
            "account_number": CONFIG.razorpayParams.accountNumber,
            "fund_account_id": rd.rp_fundid,
            "amount": 1000,
            "currency": "INR",
            "mode": "IMPS",
            "purpose": "payout",
            "queue_if_low_balance": true,
            "reference_id": refId
        };

        [err, resData] = await to(CommonController.createPayoutInRP(postData));
        if (err) throw err;
        // pout_HfFBCpfBp4j5hb

        // [err, resData] = await to(User.updateRedeemRequests(postData));
        // if (err) throw err;

        return ReS(res, {
            resData: resData
        });


    } catch (e) {
        next(e);
    }
}

const addBankDetails = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');

    delete req.body.name;
    next();
}
const addBankDetailsNew = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    // req.user = await User.findById( 177297, false );
    const userId = req.user.id;
    const partnerId = parseInt(req.user.partner?.id || 1);

    const language = req?.user?.preferred_locale ?? 'en-IN';
    const translator = await localesService.getTranslator(language, 'profile');

    const isUserBlocked = await User.isUserBlocked(userId);
    if (isUserBlocked) {
        return ReE(res, translator(messages.USER_BLOCKED), 500);
    }

    let payload = req.body;


    const reqKey = `kyc_process_${userId}`;

    // Delete Cache and Send Error 
    function deleteCacheSendError(reqKey, message, messageParams) {
        redisCaching.delKey(reqKey);
        return ReS(res, { 'success': false, 'error': translator(message, messageParams) });
    }


    const log = (...args) => console.log(`[addBankDetailsNew ${reqKey}]`, ...args);
    try {

        let isReqInProgress = await redisCaching.getKey(reqKey);
        if (isReqInProgress) {
            return ReE(res, translator(`Your request already in progress`), 423);
        }
        await redisCaching.setKey(reqKey, true, 60);

        if (req.body?.pg === 'direct24') {
            const response_payment_details = await addToPaymentDetails(req.user.id, payload);
            if (!response_payment_details.success) {
                return deleteCacheSendError(reqKey, response_payment_details.message, responseValidatePayload?.msgParams ?? null);
            }
            let errStatusUpdate, resStatusUpdate;
            [errStatusUpdate, resStatusUpdate] = await to(User.update({ userid: req.user.id, kycstatus: 'C' }, true));
            if (errStatusUpdate) {
                return deleteCacheSendError(reqKey, errStatusUpdate.message, null);
            }
            redisCaching.delKey(reqKey);
            return ReS(res, { 'success': true, 'resData': response_payment_details });
        }


        payload.pan = payload.pan.trim();
        payload['onlyBank'] = false;
        const responseValidatePayload = await validatePayload(req.user, payload);
        if (!responseValidatePayload.success) {
            return deleteCacheSendError(reqKey, responseValidatePayload.message, responseValidatePayload?.msgParams ?? null);
        }

        const responsePanVerification = await panVerification(req.user, payload);
        if (!responsePanVerification.success) {
            return deleteCacheSendError(reqKey, responsePanVerification.message);
        }

        const getPennyDropStatus = await pennyDropStatus(req.user, payload);
        if (!getPennyDropStatus.success) {
            return deleteCacheSendError(reqKey, getPennyDropStatus.message);
        }
        if (getPennyDropStatus['pennyDropStatus'].length == 0) {

            const responseBankVerification = await bankVerification(req.user, payload);
            if (!responseBankVerification.success) {
                return deleteCacheSendError(reqKey, responseBankVerification.message);
            }

        } else {
            payload['nameFromBankVerif'] = getPennyDropStatus['pennyDropStatus'][0]['name'];
            payload['bankResponseGateway'] = getPennyDropStatus['pennyDropStatus'][0]['banknamefrom'];
        }

        const responseNameCompareAddKyc = await compareAndAddKyc(req.user, payload);
        if (!responseNameCompareAddKyc.success) {
            return deleteCacheSendError(reqKey, responseNameCompareAddKyc.message);
        }

        redisCaching.delKey(reqKey);
        return ReS(res, { 'success': true, 'resData': responseNameCompareAddKyc.resData });


    } catch (e) {
        redisCaching.delKey(reqKey);
        log(e.message);
        next(e);
    }
}

const addOnlyBankDetails = async (req, res, next) => {

    const partnerId = parseInt(req.user.partner?.id || 1);
    const userId = req.user.id;
    let payload = req.body;
    payload['onlyBank'] = true;

    const isUserBlocked = await User.isUserBlocked(userId);
    if (isUserBlocked) {
        return ReE(res, messages.USER_BLOCKED, 500);
    }

    const reqKey = `kyc_process_${userId}`;

    function deleteCacheSendError(reqKey, message) {
        redisCaching.delKey(reqKey);
        return ReS(res, { 'success': false, 'error': message });
    }
    const log = (...args) => console.log(`[addOnlyBankDetails ${reqKey}]`, ...args);
    try {

        let isReqInProgress = await redisCaching.getKey(reqKey);
        if (isReqInProgress) {
            return ReE(res, `Your request already in progress`, 423);
        }
        await redisCaching.setKey(reqKey, true, 60);

        const responseValidatePayload = await validatePayload(req.user, payload);
        if (!responseValidatePayload.success) {
            return deleteCacheSendError(reqKey, responseValidatePayload.message);
        }

        const responsePanVerification = await panVerification(req.user, payload);
        if (!responsePanVerification.success) {
            return deleteCacheSendError(reqKey, responsePanVerification.message);
        }

        const getPennyDropStatus = await pennyDropStatus(req.user, payload);
        if (!getPennyDropStatus.success) {
            return deleteCacheSendError(reqKey, getPennyDropStatus.message);
        }
        if (getPennyDropStatus['pennyDropStatus'].length == 0) {

            const responseBankVerification = await bankVerification(req.user, payload);
            if (!responseBankVerification.success) {
                return deleteCacheSendError(reqKey, responseBankVerification.message);
            }

        } else {
            payload['nameFromBankVerif'] = getPennyDropStatus['pennyDropStatus'][0]['name'];
            payload['bankResponseGateway'] = getPennyDropStatus['pennyDropStatus'][0]['banknamefrom'];
        }

        const responseNameCompareAddKyc = await compareAndAddKyc(req.user, payload);
        if (!responseNameCompareAddKyc.success) {
            return deleteCacheSendError(reqKey, responseNameCompareAddKyc.message);
        }

        redisCaching.delKey(reqKey);
        return ReS(res, { 'success': true, 'resData': responseNameCompareAddKyc.resData });


    } catch (e) {
        redisCaching.delKey(reqKey);
        log(e.message);
        next(e);
    }
}

const removeBankDetails = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');

    const userId = req.user.id;
    const beneId = req.body.beneId;
    const partnerId = parseInt(req.user.partner?.id || 1);

    const language = req?.user?.preferred_locale ?? 'en-IN';
    const translator = await localesService.getTranslator(language, 'wallet');

    let lastActiveRdeemStatus;
    [err, lastActiveRdeemStatus] = await to(User.getRedeemStatus({ 'userid': userId, status: 'A', limit: 1 }));
    if (err) throw err;

    if (lastActiveRdeemStatus[0]) {
        return ReS(res, { 'success': false, 'error': translator('Your last withdrawl request is already in Progress. You cannot delete your bank details') });
    }

    //return ReS(res, { 'success': false, 'error': 'Unable to process. Please contact support' });
    try {

        if (req.body?.pg === 'direct24') {
            let removeRes = await PaymentDetails.removePaymentDetailsByUserId(req.user.id, 'direct24');
            if (removeRes) {

                let kycresp;
                [err, kycresp] = await to(User.update({ userid: userId, kycstatus: 'P' }, true));
                if (err) throw err;

                return ReS(res, {
                    'success': true
                });
            } else {
                return ReS(res, { 'success': false, 'error': translator('Unable to process.') });
            }
        }
        await CommonController.getCashFreeAccessToken();
        if (beneId) {
            let err, resData;
            var postData = Object.assign({
                "beneId": beneId
            });

            [err, bankDeets] = await to(User.getBankDetailsArray(userId));
            if (err) throw err;

            // if(bankDeets.length == 1){
            //     return ReS (res, {'success' : false, 'error' : '1 Bank Account cannot be deleted'});
            // }

            [err, resData] = await to(CommonController.removeBeneficiaryInCG(postData, parseInt(req.partner.id)));
            if (err) {
                logger.error(err);
                return ReS(res, { 'success': false, 'error': translator('Unable to process.') });
            }


            for (let i = 0; i < bankDeets.length; i++) {
                if (bankDeets[i]['cg_beneid'] == beneId) {
                    detailsToDelete = bankDeets[i];
                }
            }
            let resData1;
            [err, resData1] = await to(User.putBankEqPan(userId, detailsToDelete['accountnumber'], detailsToDelete['ifsc'], "false", partnerId));
            if (err) throw err;



            if (resData && resData['status'] == 'SUCCESS') {

                [err, resData] = await to(User.removeBankDetails(userId, beneId));
                if (err) {
                    return ReS(res, { 'success': false, 'error': translator('Unable to remove Bank Details. Try again later.') });
                }
                return ReS(res, {
                    'success': true
                });
            } else {
                if (parseInt(resData['subCode']) == 404) {
                    [err, resData] = await to(User.removeBankDetails(userId, beneId));
                    if (err) {
                        return ReS(res, { 'success': false, 'error': translator('Unable to remove Bank Details. Try again later.') });
                    }
                    return ReS(res, {
                        'success': true
                    });
                } else {
                    return ReS(res, { 'success': false, 'error': translator('Unable to remove Bank Details. Try again later.') });
                }

            }
        } else {
            //backward compatible

            let err, resData;
            [err, resData] = await to(User.getBankDetails(userId));
            if (err) {
                throw err;
            }

            const beneId1 = resData.cg_beneid;
            const accountnumber = resData.accountnumber;
            const ifsc = resData.ifsc;

            var postData = Object.assign({
                "beneId": beneId1
            });

            [err, resData] = await to(CommonController.removeBeneficiaryInCG(postData, parseInt(req.partner.id)));
            if (err) {
                logger.error(err);
                return ReS(res, { 'success': false, 'error': translator('Unable to process.') });
            }

            if (resData && resData['status'] == 'SUCCESS') {

                [err, resData] = await to(User.removeBankDetails(userId, beneId1));
                if (err) {
                    return ReS(res, { 'success': false, 'error': translator('Unable to remove Bank Details. Try again later.') });
                }
                let resData1;
                [err, resData1] = await to(User.putBankEqPan(userId, accountnumber, ifsc, "false", partnerId));
                if (err) throw err;

                return ReS(res, {
                    'success': true
                });
            } else {
                if (parseInt(resData['subCode']) == 404) {
                    [err, resData] = await to(User.removeBankDetails(userId, beneId1));
                    if (err) {
                        return ReS(res, { 'success': false, 'error': translator('Unable to remove Bank Details. Try again later.') });
                    }
                    return ReS(res, {
                        'success': true
                    });
                } else {
                    return ReS(res, { 'success': false, 'error': translator('Unable to remove Bank Details. Try again later.') });
                }
            }
        }


    } catch (e) {
        throw e;
    }


}
const addBankDetailsAdmin = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    const adminId = req.user.id;
    if (!isDashboardUser(req)) {
        res.writeStatus("401");
        return ReS(res, {
            success: true, msg: 'Unauthorized request, incident has been reported'
        });
    }
    const ids = req.body.ids;
    let err, resData, kycProcess;
    let _user;
    try {
        [err, kycProcess] = await to(User.getBankVerif(ids));
        if (err) throw err;
        if (kycProcess.length != ids.length) {
            return ReE(res, "Enter valid ids");
        }

        let successfulIds = [];
        let unsuccessfulIds = [];

        for (let userData of kycProcess) {

            let accountNumber = userData.accountnumber, ifsc = userData.ifsc,
                nameFromBankVerif = userData.name, nameFromPanVerif = userData.panname, userId = userData.userid, pan = userData.pan;

            const beneId = CONFIG.prefix + 10000000000 + userId;

            [err, currentData] = await to(User.findById(userId));
            if (err) {
                unsuccessfulIds.push({ "userId": userId, "message": "Unable to fetch user details" });
                logger.info(`Unable to fetch user details for User: ${userId}`);
                continue;
            }


            let mobile = currentData.mobile;
            let email = currentData.email;
            let bankDeets;
            [err, bankDeets] = await to(User.getBankDetails(userId));
            if (err) {
                unsuccessfulIds.push({ "userId": userId, "message": "Unable to fetch user details" });
                continue;
            }

            if (bankDeets && bankDeets.accountnumber) {
                var postData = Object.assign({
                    "beneId": bankDeets.cg_beneid
                });

                [err, resData] = await to(CommonController.removeBeneficiaryInCG(postData, parseInt(req.partner.id)));
                if (err) {
                    unsuccessfulIds.push({ "userId": userId, "message": "Unable to remove beneficiary in CG" });
                    logger.info(err);
                    logger.info(`Unable to remove beneficiary from cashfree for User: ${userId}`);
                    continue;
                }

                if (resData && resData['status'] == 'SUCCESS') {

                    [err, resData] = await to(User.removeBankDetails(userId, bankDeets.cg_beneid));
                    if (err) {
                        unsuccessfulIds.push({ "userId": userId, "message": "Unable to remove bank details" });
                        logger.info(`Unable to remove bank details for User: ${userId}`);
                        continue;
                    }
                    let resData1;
                    [err, resData1] = await to(User.putBankEqPan(userId, bankDeets.accountnumber, bankDeets.ifsc, "false", 1));
                    if (err) {
                        unsuccessfulIds.push({ "userId": userId, "message": "Unable to remove" });
                        continue;
                    }
                    logger.info(`Successfully removed details now adding new details for user : ${userId}`);

                }
            } else {

                let dataObj = { name: nameFromPanVerif, number: pan, photo: '', dob: '', userid: userId };

                [err, _userRows] = await to(User.addKyc(dataObj));
                if (err) {
                    unsuccessfulIds.push({ "userId": userId, "message": "Unable to add KYC details" });
                    logger.info(`Unable to add KYC details for User: ${userId}`);
                    continue;
                }
            }

            // let putTrue;
            // [err, putTrue] = await to(User.putBankEqPan(userId, accountNumber, ifsc, "true"));
            // if (err) throw err;
            var postData = Object.assign({
                "beneId": beneId,
                "name": nameFromBankVerif,
                "email": email,
                "phone": mobile,
                "bankAccount": accountNumber,
                "ifsc": ifsc,
                "address1": "NA"
            });
            let resCashfree = await addBankDetailsCashfree(postData, userId, beneId, nameFromPanVerif, parseInt(req.partner.id));

            if (resCashfree.success == true) {

                logger.info(`Successfully added KYC and Bank details for user : ${userId}`);
                [err, _user] = await to(User.update({ userid: userId, kycstatus: 'C' }, true));
                if (err) {
                    unsuccessfulIds.push({ "userId": userId, "message": "Unable to add KYC details" });
                    logger.info(`Cannot change KYC status for user : ${userId}`)
                }
                successfulIds.push({ "userId": userId, "message": "successfully completed KYC" });
                [err, resData] = await to(User.approveRejectKYC(Number(userData.id), 'A'));

            }
            else {
                unsuccessfulIds.push({ "userId": userId, "message": resCashfree.error });
                logger.info(`userid: ${userId}`);
                logger.info(`error: ${resCashfree.error}`);
            }
        }
        return ReS(res, {
            success: true, msg: 'All ids processed', "successful userIds": successfulIds, "unsuccessful userIds": unsuccessfulIds
        });


    } catch (e) {
        next(e);
    }
}
const rejectKycRequest = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    const adminId = req.user.id;
    if (!isDashboardUser(req)) {
        res.writeStatus("401");
        return ReS(res, {
            success: true, msg: 'Unauthorized request, incident has been reported'
        });
    }
    const ids = req.body.ids;
    let err, resData, kycProcess;
    let _user;
    try {
        [err, kycProcess] = await to(User.getBankVerif(ids));
        if (err) throw err;

        if (kycProcess.length != ids.length) {
            return ReE(res, "Enter valid ids");
        }

        for (let userData of kycProcess) {
            [err, resData] = await to(User.approveRejectKYC(Number(userData.id), 'R'));
            if (err) {
                logger.info(`Unable to change approval status for user: ${userData.userid}`);
            }
        }

        return ReS(res, {
            success: true, msg: 'All ids processed'
        });


    } catch (e) {
        next(e);
    }
}
const addBankDetailsCashfree = async (postData, userId, beneId, nameFromPanVerif, partnerId) => {
    let err, res;

    try {
        [err, resData] = await to(CommonController.addBeneficiaryInCG(postData, partnerId));

        if (err) {
            logger.error(err);
            return { 'success': false, 'error': 'Unable to process. Make sure details entered are correct' };
        }

        if (resData &&
            (resData['status'] == 'SUCCESS' ||
                (resData['status'] == 'ERROR' && resData['message'] == 'Beneficiary Id already exists'))) {

            let resifsc;

            [err, resifsc] = await to(ifscToBank(postData.ifsc));
            if (err) throw err;

            let responseDataIfsc;
            if (resifsc.data) responseDataIfsc = resifsc.data.BANK;

            var dataToAdd = {
                'userid': userId,
                'cg_beneid': beneId,
                'name': nameFromPanVerif,
                'ifsc': postData.ifsc,
                'accountnumber': postData.bankAccount,
                'bankname': responseDataIfsc,
                'partner': partnerId
            }
            let [err2, rd] = await to(User.getBankDetails(userId));
            if (err2) throw err2;

            if (!rd) {
                [err, resData] = await to(User.addBankDetails(dataToAdd));
                if (err) throw err;
            } else {
                return { 'success': false, 'error': 'Bank details already added. Access Denied.' };
            }

            return { 'success': true, resData: resData[0] };
        } else {
            if (resData['status'] == 'ERROR') {
                logger.error(`Add bank details failed for user: ${userId}, body: ${(postData)}`);
                logger.error(resData);
                return { 'success': false, 'error': resData['message'] };
            } else {
                return { 'success': false, 'error': 'Unable to add Bank Details. Try again later.' };
            }
        }
    }
    catch (err) {
        throw err;
    }
}
const validateVirtualWallet = async (req, res, next) => {

    const userId = req.user.id;
    let err, resp;

    try {

        if (req.user.region == 'INDIA') {
            return ReS(res, {
                success: false, msg: 'This service is not available in your region'
            });
        }
        const walletAddress = req.body.walletAddress;
        [err, resp] = await to(User.getUserIdFromCryptoWalletAddress(walletAddress));
        if (err) throw err;

        if (resp.length !== 0 && resp[0]['userid'] !== userId) {
            return ReS(res, {
                success: false, msg: 'This wallet address is already registered against another User.'
            });
        }



        var valid = WAValidator.validate(walletAddress, 'BTC', process.env.NODE_ENV === 'production' ? 'prod' : 'both');
        if (valid) {
            return ReS(res, {
                success: true, msg: 'Valid Virtual Wallet Address'
            });
        }
        return ReS(res, {
            'success': false,
            'msg': 'Virtual Wallet Address not Valid'
        })

    } catch (e) {
        throw e;
    }
}
/*
const addBankDetails = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');

    try {
        const userId = req.user.id;
        let err, resData, refID = CONFIG.prefix + 10000000000 + userId;
        let { name, accountNumber, ifsc, vpa } = req.body;
        let mobile = req.user.mobile;
        // mobile = '7838804000';

        var postDataC = {
            "name": name,
            "contact": mobile,
            "type": "customer",
            "reference_id": refID
        };

        [err, resData] = await to(CommonController.addContactInRP(postDataC));
        if (err) throw err;

        let contactId = resData['id'];

        var postData = {
            "contact_id": contactId,
            "account_type": "bank_account",
            "bank_account": {
                "name": name,
                "ifsc": ifsc,
                "account_number": accountNumber
            }
        };
        if (vpa) {
            postData['account_type'] = 'vpa';
            delete postData['bank_account'];
            postData['vpa'] = { 'address': vpa };
        }

        [err, resData] = await to(CommonController.addFundAccountInRP(postData));
        if (err) throw err;

        if (resData['error']) {
            return ReE(res, resData['error']['description']);
        }

        var dataToAdd = {
            'userid': userId,
            'rp_fundid': resData['id'],
            'rp_contactid': contactId,
            'vpa': vpa,
            'ifsc': ifsc,
            'accountnumber': accountNumber
        }
        if (resData['account_type'] == 'vpa') {
            dataToAdd['rp_vpa_active'] = resData['active'];
        } else if (resData['account_type'] == 'bank_account') {
            dataToAdd['rp_ba_active'] = resData['active'];
        }
        let [err2, rd] = await to(User.getBankDetails(userId));
        if (err2) throw err2;

        if (!rd) {
            [err, resData] = await to(User.addBankDetails(dataToAdd));
            if (err) throw err;
        } else {
            [err, resData] = await to(User.updateBankDetails(dataToAdd));
            if (err) throw err;
        }

        return ReS(res, {
            resData: resData[0]
        });
    } catch (err) {
        next(err);
    }
}

*/

const getBankDetails = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    try {
        let err;
        const userId = req.user.id;
        let resData;
        [err, resData] = await to(User.getBankDetails(userId));
        if (err) throw err;

        if (!resData) {
            [err, bankverif] = await to(User.getBankUnverifiedRows(userId));
            if (err) throw err;

            if (bankverif.length > 0) {
                return ReS(res, {
                    bankdetails: resData, errorCode: 413,
                    'status': 'Pending',
                    'error': 'KYC Verification takes upto 48 hours to process. Please back here for updates'
                });
            }
        }

        return ReS(res, {
            bankdetails: resData
        });
    } catch (err) {
        next(err);
    }
}
const getBankDetailsList = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    try {
        const userId = req.user.id;
        let resData;
        [err, resData] = await to(User.getBankDetailsArray(userId));
        if (err) throw err;

        return ReS(res, {
            bankdetails: resData
        });
    } catch (err) {
        next(err);
    }
}

const getMessages = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');

    try {
        const userId = req.params.id;
        var data = Object.assign({}, req.body, { userid: req.user.id });
        let err, messages;

        [err, messages] = await to(User.getMessagess(data));
        if (err) throw err;

        return ReS(res, {
            messages: messages
        });
    } catch (err) {
        next(err);
    }
}
const ifscConvert = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    try {
        let ifscCode = req.body.ifsc;
        let response;

        [err, response] = await to(ifscToBank(ifscCode));
        if (err) throw err;

        let responseData;
        if (response.data) responseData = response.data;
        return ReS(res, responseData);

    } catch (err) {
        next(err);
    }
}

const getEngagedCoins = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    try {
        let userId = req.user.id, redisReply;
        var data = Object.assign({}, req.body, { userid: req.user.id });
        let err, coins;
        var t1 = Date.now();

        // [err, redisReply] = await to(redisCaching.getHMKey(userId, 'userWallet'));
        // if (redisReply) {
        //     try {
        //         coins = JSON.parse(redisReply);
        //     } catch (e) { }
        // }

        if (!coins) {
            [err, coins] = await to(User.getEngagedCoins(data));
            if (err) throw err;
            redisCaching.setHMKey(userId, 'userWallet', JSON.stringify(coins));
        }
        var tDiff = (Date.now() - t1) / 1000;
        // logger.info(`Time taken to fetch coins: ${tDiff} seconds`);
        return ReS(res, {
            user: coins
        });
    } catch (err) {
        next(err);
    }
}


const getTransactions = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    try {
        let err, _txns, userId = req.user.id;
        var data = Object.assign({}, req.body, { userid: userId });

        const language = req?.user?.preferred_locale ?? 'en-IN';
        const translator = await localesService.getTranslator(language, 'wallet');

        [err, _txns] = await to(User.getTransactions(data));
        if (err) throw err;
        // _txns = _txns.filter(t => !(/^(PCR|PDB)/.test(t?.txnid)));

        for (let i = 0; i < _txns.length; i++) {
            if (_txns[i]['type'] == 'DEBIT') {
                // _txns[i]['surcharge'] = -1 * _txns[i]['surcharge'];
                _txns[i]['amount'] += _txns[i]['surcharge'];
            } else {
                if (_txns[i]['txnid'].indexOf('EX') === 0) {
                    _txns[i]['amount'] -= _txns[i]['surcharge'];
                }
            }
            _txns[i]['amount'] = parseFloat(_txns[i]['amount'].toFixed(2));
        }

        for (let i = 0; i < _txns.length; i++) {
            if (_txns[i]['type'] == 'DEBIT') {
                // _txns[i]['surcharge'] = -1 * _txns[i]['surcharge'];
                if (_txns[i]['txnid'].indexOf('PDB') === 0) {
                    _txns[i]['newmessage'] = _txns[i]['message'];
                    _txns[i]['transactionData'] = {
                        title: _txns[i]['message'], subtitle: 'Debit Yes/No Game Wallet', status: null, amount: _txns[i]['amount'], info: null,
                        metadata: [{ key: 'Amount', value: _txns[i]['amount'] },
                        { key: 'Transaction ID', value: '#' + _txns[i]['txnid'] },
                        { key: 'Date', value: _txns[i]['createdat'] }]
                    }
                } else if (_txns[i]['txnid'].indexOf('P') === 0) {

                    let eventId;
                    let txnId = _txns[i]['txnid'];
                    let message = _txns[i].message ?? '';

                    const metaRegEx = /Market\s*: (?<event_title>(.*))\n Bought (?<shares>(.*)) x (?<position>(.*)) \((Rs\. )?(?<amount>(.*))each\)(.*)/

                    const matches = metaRegEx.exec(message)
                    const groups = matches?.groups ?? {};


                    let newmessage = translator(`Invested in Event`);
                    let eventTitle = groups?.event_title ?? ' ';
                    let position = groups?.position ?? ' ';
                    let position_type = translator('BUY') + " " + translator((position == 'Y' ? 'YES' : 'NO'));
                    let avgPrice = groups?.amount ?? ' ';
                    let noOfShares = groups?.shares ?? ' ';


                    let infoArr = _txns[i]['message'].split("\n");


                    let marketObj = { marketTitle: eventTitle, position: position, info: infoArr[1], avgPrice: avgPrice, noOfShares: noOfShares, positionType: position_type };
                    _txns[i]['marketObj'] = marketObj;
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: eventTitle, status: null, amount: _txns[i]['amount'], info: eventTitle,
                        metadata: [{ key: 'Avg Price', value: avgPrice },
                        { key: translator('Shares'), value: position + ' x ' + noOfShares },
                        { key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] },
                        { key: translator('All Cost & Fees'), value: _txns[i]['surcharge'].toFixed(2) }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('LA') === 0) {
                    let eventId;
                    let txnId = _txns[i]['txnid'];
                    let message = _txns[i].message ?? '';

                    const metaRegEx = /Market\s*: (?<event_title>(.*))\nLiquidity Added (?<shares>(.*)) shares x \((Rs\. )?(?<amount>(.*)) each\)(.*)/

                    const matches = metaRegEx.exec(message)
                    const groups = matches?.groups ?? {};


                    let infoArr = _txns[i]['message'].split("\n");
                    let newmessage = translator(`Added Liquidity in Event`);
                    let eventTitle = groups?.event_title ?? ' ';

                    let avgPrice = groups?.amount ?? ' ';
                    let noOfShares = groups?.shares ?? ' ';

                    let marketObj = { marketTitle: eventTitle, info: infoArr[1], avgPrice: avgPrice, noOfShares: noOfShares };
                    _txns[i]['marketObj'] = marketObj;
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: eventTitle, status: null, amount: _txns[i]['amount'], info: eventTitle,
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('RD') === 0) {
                    let newmessage = translator(`Balance Withdrawal`);
                    let regexp = /Payment successfully completed for (.*) credits(.*)at an exchange rate of 1(?<currency>(.*)) = (?<exchangeRate>(.*)) credits/gs
                    let matches = regexp.exec(_txns[i].message)
                    if (matches && matches?.groups?.exchangeRate) {
                        const exchangeRate = parseFloat(matches?.groups?.exchangeRate)
                        const amount = parseFloat(_txns[i].amount)
                        if (!isNaN(exchangeRate) && !isNaN(amount) && exchangeRate > 0) {
                            const exchangeValue = `${(amount / exchangeRate).toFixed(4)} ${matches?.groups?.currency ?? 'USDT'}`
                            _txns[i]['exchangeRate'] = exchangeValue
                        }
                    }
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: 'Withdraw', subtitle: newmessage, status: translator('Success'), amount: _txns[i]['amount'], info: null,
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] },
                        { key: translator('All Cost & Fees'), value: _txns[i]['surcharge'].toFixed(2) }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('RREV1') === 0) {
                    let infoArr = _txns[i]['message'].split("\n");
                    let newmessage = translator(`Reverse Referral Fee Due to Event Cancellation`);
                    let eventTitle = infoArr[0];
                    let marketObj = { marketTitle: eventTitle };
                    _txns[i]['marketObj'] = marketObj;
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: eventTitle, status: translator('Success'), amount: _txns[i]['amount'], info: newmessage,
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] }]
                    }
                }
                else if (_txns[i]['txnid'].indexOf('TDSW') === 0) {
                    let newmessage = translator(`TDS Deducted`);
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: translator('TDS Deducted On Withdrawal'), status: null, amount: _txns[i]['amount'], info: null,
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('TD') === 0 && _txns[i]['txnid'].indexOf('TDSW') !== 0) {
                    let infoArr = _txns[i]['message'].split("\n");
                    let newmessage = translator(`TDS Deducted`);
                    let eventTitle = infoArr[0].replace('TDS: ', '');
                    eventTitle = eventTitle.replace('TDS : ', '');

                    let avgPrice = infoArr[0].slice(infoArr[0].indexOf('Rs.') + 4);

                    let marketObj = { marketTitle: eventTitle, avgPrice: avgPrice };
                    _txns[i]['marketObj'] = marketObj;
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: eventTitle, status: null, amount: _txns[i]['amount'], info: eventTitle,
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] }]
                    }
                }
                else if (_txns[i]['txnid'].indexOf('DFM') === 0) {
                    let infoArr = _txns[i]['message'].split("\n");
                    let newmessage = translator(`Debited for Funds Management Service`);
                    let eventTitle = infoArr[0];
                    let marketObj = { marketTitle: eventTitle };
                    _txns[i]['marketObj'] = marketObj;
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: eventTitle, status: null, amount: _txns[i]['amount'], info: eventTitle,
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] }]
                    }
                }
                else if (_txns[i]['txnid'].indexOf('CLSRST') === 0 || _txns[i]['txnid'].indexOf('CLBRFREV1') === 0) {

                    let eventId;
                    let txnId = _txns[i]['txnid'];
                    let message = _txns[i].message ?? ''
                    if (_txns[i]['txnid'].indexOf('CLSRST') === 0) {
                        eventId = (txnId).replace(/(^CLSRST1000)/gi, '')
                    } else {
                        eventId = (txnId).replace(/(^CLBRFREV1000)/gi, '')
                    }

                    const metaRegEx = /Debited due to event reset\n(\s+)(?<event_title>.*)\n(\s+)of club\n(\s+)(?<club_title>.*)/

                    const matches = metaRegEx.exec(message)
                    const groups = matches?.groups ?? {};

                    let newmessage = `Club Event Reset - (${groups?.club_title ?? `#${eventId}`})`;
                    const getMarketTitle = () => {
                        if (groups?.event_title) {
                            return `(${groups?.event_title})`
                        }
                        return ''
                    }
                    let marketObj = {
                        marketTitle: getMarketTitle(),
                    };
                    _txns[i]['marketObj'] = marketObj;
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: marketObj['marketTitle'], status: null, amount: _txns[i]['amount'], info: newmessage,
                        metadata: [{ key: 'Amount', value: _txns[i]['amount'] },
                        { key: 'Transaction ID', value: '#' + _txns[i]['txnid'] },
                        { key: 'Date', value: _txns[i]['createdat'] }]
                    }
                }
                else if (_txns[i]['txnid'].indexOf('CB') === 0 || _txns[i]['txnid'].indexOf('CLB') === 0) {

                    let eventId;
                    let txnId = _txns[i]['txnid'];
                    let message = _txns[i].message ?? ''
                    eventId = (txnId).replace(/(^(CB|CLB)1000)/gi, '')


                    // let infoArr = _txns[i]['message'].split("\n");

                    const metaRegEx = /Placed bet on\n(?<club_title>.*)\n(?<event_title>.*)\nwith option as\n(?<option_label>.*)\nfor\n₹(?<investment>.*)/
                    const matches = metaRegEx.exec(message)
                    const groups = matches?.groups ?? {};
                    let newmessage = `Invested in Club Event (#${groups?.club_title ?? eventId})`;
                    // let eventTitle = infoArr[0].replace('Market: ', '');
                    // eventTitle = eventTitle.replace('Market : ', '');
                    // let position;
                    // if (infoArr[1].includes("Y")){
                    //     position = "Yes";
                    // }else{
                    //     position = "No";
                    // }
                    const getMarketTitle = () => {
                        if (groups?.event_title && groups?.option_label) {
                            return `(${groups?.event_title}) ${groups?.option_label}`
                        }
                        return ''
                    }
                    let marketObj = {
                        marketTitle: getMarketTitle(),
                    };
                    _txns[i]['marketObj'] = marketObj;
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: marketObj['marketTitle'], status: null, amount: _txns[i]['amount'], info: newmessage,
                        metadata: [{ key: 'Amount', value: _txns[i]['amount'] },
                        { key: 'Transaction ID', value: '#' + _txns[i]['txnid'] },
                        { key: 'Date', value: _txns[i]['createdat'] }]
                    }
                }

                else if (_txns[i]['txnid'].indexOf('CLF') === 0) {

                    let eventId;
                    let txnId = _txns[i]['txnid'];
                    let message = _txns[i].message ?? ''
                    eventId = (txnId).replace(/(^(CLF)1000)/gi, '')


                    // let infoArr = _txns[i]['message'].split("\n");

                    const metaRegEx = /Club Event Trading Fee Deduction\n(?<event_title>.*)/
                    const matches = metaRegEx.exec(message)
                    const groups = matches?.groups ?? {};
                    let newmessage = `Club Event Trading Fee Deduction`;
                    // let eventTitle = infoArr[0].replace('Market: ', '');
                    // eventTitle = eventTitle.replace('Market : ', '');
                    // let position;
                    // if (infoArr[1].includes("Y")){
                    //     position = "Yes";
                    // }else{
                    //     position = "No";
                    // }
                    const getMarketTitle = () => {
                        if (groups?.event_title) {
                            return `${groups?.event_title}`
                        }
                        return ''
                    }
                    let marketObj = {
                        marketTitle: getMarketTitle(),
                    };
                    _txns[i]['marketObj'] = marketObj;
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: marketObj['marketTitle'], status: null, amount: _txns[i]['amount'], info: newmessage,
                        metadata: [{ key: 'Amount', value: _txns[i]['amount'] },
                        { key: 'Transaction ID', value: '#' + _txns[i]['txnid'] },
                        { key: 'Date', value: _txns[i]['createdat'] }]
                    }
                }
                else if (_txns[i]['txnid'].indexOf('FA') === 0) {
                    const regex = /(\w+) debited for Contest: (.*?)\n(.*)/;
                    let amount, contestName, contestType;
                    // Use the `exec` method to extract the values
                    let message = _txns[i].message ?? '';
                    const match = regex.exec(message);

                    if (match) {
                        amount = match[1];
                        contestName = match[2];
                        contestType = match[3];

                    } else {
                        console.log("No match found in the input string.");
                    }
                    _txns[i]['newmessage'] = _txns[i]['message'];
                    _txns[i]['transactionData'] = {
                        title: contestType, subtitle: contestName, status: null, amount: _txns[i]['amount'], info: null,
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('LCPM') === 0) {
                    let newmessage = 'Token points Redeemed';
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: 'Redeem Successful', subtitle: newmessage, status: 'Tokens', amount: _txns[i]['amount'], info: null,
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('LCRD') === 0) {
                    let newmessage = 'Withdraw to USDT';
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: 'Redeem Successful', subtitle: newmessage, status: 'Tokens', amount: _txns[i]['amount'], info: null,
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] }]
                    };
                }
                else {
                    _txns[i]['newmessage'] = _txns[i]['message'];
                    _txns[i]['transactionData'] = {
                        title: _txns[i]['message'], subtitle: _txns[i]['message'], status: null, amount: _txns[i]['amount'], info: _txns[i]['message'],
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] }]
                    }
                }
            } else {
                if (_txns[i]['txnid'].indexOf('PM') === 0) {
                    let newmessage = translator(`Balance Deposit`);
                    let regexp = /Payment successfully completed for (.*) credits(.*)at an exchange rate of 1(?<currency>(.*)) = (?<exchangeRate>(.*)) credits/gs
                    let matches = regexp.exec(_txns[i].message)
                    if (matches && matches?.groups?.exchangeRate) {
                        const exchangeRate = parseFloat(matches?.groups?.exchangeRate)
                        const amount = parseFloat(_txns[i].amount)
                        if (!isNaN(exchangeRate) && !isNaN(amount) && exchangeRate > 0) {
                            const exchangeValue = `${(amount / exchangeRate).toFixed(4)} ${matches?.groups?.currency ?? 'USDT'}`
                            _txns[i]['exchangeRate'] = exchangeValue
                        }
                    }
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: translator('Deposit'), subtitle: newmessage, status: translator('Success'), amount: _txns[i]['amount'], info: null,
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] }]
                    }
                }
                else if (_txns[i]['txnid'].indexOf('PRPM') === 0 || _txns[i]['txnid'].indexOf('GSTPR') === 0 || _txns[i]['txnid'].indexOf('GSTCB') === 0) {
                    _txns[i]['newmessage'] = _txns[i]['message'];
                    _txns[i]['transactionData'] = {
                        title: translator('Deposit'), subtitle: _txns[i]['message'], status: 'Success', amount: _txns[i]['amount'], info: null,
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] }]
                    }
                }
                else if (_txns[i]['txnid'].indexOf('GR') === 0) {
                    let newmessage = translator(`Referral Bonus Added`);
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: newmessage, status: null, amount: _txns[i]['amount'], info: null,
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('CB') === 0) {
                    let newmessage = translator(`Coupon Bonus Added`);
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: _txns[i].message, status: null, amount: _txns[i]['amount'], info: null,
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('RC') === 0) {
                    let newmessage = translator(`Redeem Request Cancelled`);
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: newmessage, status: null, amount: _txns[i]['amount'], info: null,
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('GT') === 0) {
                    let newmessage = translator(`Signup Bonus Added`);
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: newmessage, status: null, amount: _txns[i]['amount'], info: null,
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('LCJB') === 0) {
                    let newmessage = translator(`Joining Bonus`);
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: translator('Token points Added'), status: translator('Token points'), amount: _txns[i]['amount'], info: null,
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('BNLC') === 0) {
                    let newmessage = translator(`Referral Bonus`);
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: translator('Token points Added'), status: translator('Token points'), amount: _txns[i]['amount'], info: null,
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('RFLC') === 0) {
                    let newmessage = translator(`Referral Bonus`);
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: translator('Tokens points Added'), status: translator('Token points'), amount: _txns[i]['amount'], info: null,
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('CRLC') === 0) {
                    let newmessage = `Funds Credited`;
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: 'Deposit Credits Added', status: 'Success', amount: _txns[i]['amount'], info: null,
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('EX') === 0) {
                    // let infoArr = _txns[i]['message'].split("\n");
                    // let newmessage = `Received from Selling Shares`;
                    // let eventTitle = infoArr[0].replace('Market: ', '');
                    // eventTitle = eventTitle.replace('Market : ', '');
                    // let position, position_type;
                    // if (infoArr[1].includes("Y")){
                    //     position = "Yes";
                    //     position_type = "SELL YES";
                    // }else{
                    //     position = "No";
                    //     position_type = "SELL NO";
                    // }
                    // let avgPrice = infoArr[1].slice(infoArr[1].indexOf('Rs.') + 3, infoArr[1].indexOf('each'));
                    // let noOfShares = infoArr[1].slice(infoArr[1].indexOf('Sold') + 4, infoArr[1].indexOf('x'));

                    // let marketObj = {marketTitle : eventTitle, position : position , info : infoArr[1], avgPrice : avgPrice, noOfShares : noOfShares, positionType : position_type};
                    // _txns[i]['marketObj'] = marketObj;
                    // _txns[i]['newmessage'] = newmessage;
                    let eventId;
                    let txnId = _txns[i]['txnid'];
                    let message = _txns[i].message ?? '';

                    const metaRegEx = /Market\s*: (?<event_title>(.*))\n Sold (?<shares>(.*)) x (?<position>(.*)) \((Rs\. )?(?<amount>(.*))each\)(.*)/

                    const matches = metaRegEx.exec(message)
                    const groups = matches?.groups ?? {};


                    let newmessage = translator(`Received from Selling Shares`);
                    let eventTitle = groups?.event_title ?? ' ';
                    let position = groups?.position ?? ' ';
                    let position_type = translator('SELL') + " " + translator((position == 'Y' ? 'YES' : 'NO'));
                    let avgPrice = groups?.amount ?? ' ';
                    let noOfShares = groups?.shares ?? ' ';


                    let infoArr = _txns[i]['message'].split("\n");


                    let marketObj = { marketTitle: eventTitle, position: position, info: infoArr[1], avgPrice: avgPrice, noOfShares: noOfShares, positionType: position_type };
                    _txns[i]['marketObj'] = marketObj;
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: eventTitle, status: null, amount: _txns[i]['amount'], info: null,
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] },
                        { key: translator('All Cost & Fees'), value: _txns[i]['surcharge'].toFixed(2) }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('CN') === 0) {
                    let infoArr = _txns[i]['message'].split("\n");
                    let newmessage = translator(`Order Cancelled`);
                    let eventTitle = infoArr[0].replace('Market: ', '');
                    eventTitle = eventTitle.replace('Market : ', '');
                    let position, position_type;
                    if (infoArr[1].includes("Y")) {
                        position = translator("Yes");
                        position_type = translator("CANCELLED YES");
                    } else {
                        position = translator("No");
                        position_type = translator("CANCELLED NO");
                    }
                    let noOfShares = infoArr[1].slice(infoArr[1].indexOf('Cancelled') + 10, infoArr[1].indexOf('x'));
                    let avgPrice = infoArr[1].slice(infoArr[1].indexOf('Rs.') + 3, infoArr[1].indexOf('each'));

                    let marketObj = { marketTitle: eventTitle, position: position, info: infoArr[1], noOfShares: noOfShares, positionType: position_type, avgPrice: avgPrice, };
                    _txns[i]['marketObj'] = marketObj;
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: eventTitle, status: null, amount: _txns[i]['amount'], info: eventTitle,
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] },
                        { key: translator('All Cost & Fees'), value: _txns[i]['surcharge'].toFixed(2) }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('RFR') === 0) {
                    let newmessage = translator(`Referral Bonus Added`);
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: newmessage, status: null, amount: _txns[i]['amount'], info: null,
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('ERFR') === 0) {
                    let newmessage = translator(`Event Referral Bonus Added`);
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: newmessage, status: null, amount: _txns[i]['amount'], info: null,
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('RF1') === 0) {
                    let infoArr = _txns[i]['message'].split("\n");
                    let newmessage = translator(`Refund due to Event Cancellation`);
                    let eventTitle = infoArr[0].replace('Market: ', '');
                    eventTitle = eventTitle.replace('Market : ', '');
                    let marketObj = { marketTitle: eventTitle };
                    _txns[i]['marketObj'] = marketObj;
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: eventTitle, status: null, amount: _txns[i]['amount'], info: null,
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('RFCLB1') === 0) {
                    let infoArr = _txns[i]['message'].split("\n");
                    let newmessage = `Refund due to Club Event Cancellation`;
                    let eventTitle = infoArr[1].replace('Market: ', '');
                    eventTitle = eventTitle.replace('Market : ', '');
                    let marketObj = { marketTitle: eventTitle };
                    _txns[i]['marketObj'] = marketObj;
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: eventTitle, status: null, amount: _txns[i]['amount'], info: null,
                        metadata: [{ key: 'Amount', value: _txns[i]['amount'] },
                        { key: 'Transaction ID', value: '#' + _txns[i]['txnid'] },
                        { key: 'Date', value: _txns[i]['createdat'] }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('S1') === 0) {
                    const regexp = /Market: (?<eventTitle>(.*))\nSettled \((?<amount>(.*)) credited/gms
                    let newmessage = translator(`Received from Event Settlement`);
                    const matches = regexp.exec(_txns[i]['message']);
                    let eventTitle = matches?.groups?.eventTitle ?? '';
                    let avgPrice = matches?.groups?.amount ?? '';
                    let netAmount = avgPrice + " " + translator('Net Amount Credited');
                    let marketObj = { marketTitle: eventTitle, info: 'settled', avgPrice: avgPrice, netAmount: netAmount };

                    _txns[i]['marketObj'] = marketObj;
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: eventTitle, status: null, amount: _txns[i]['amount'], info: null,
                        metadata: [
                            { key: translator('Amount'), value: _txns[i]['amount'] },
                            { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                            { key: translator('Date'), value: _txns[i]['createdat'] },
                            { key: translator('All Cost & Fees'), value: _txns[i]['surcharge'].toFixed(2) }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('MG') === 0) {
                    let infoArr = _txns[i]['message'].split("\n");
                    let newmessage = translator(`Shares Merged for Event`);
                    const regexp = /Market : (?<eventTitle>(.*))Yes\/No tokens merged (?<noOfShares>(.*)) x \((Rs\.)?(?<avgPrice>.*) each\)/gs
                    const matches = regexp.exec(_txns[i]['message'])
                    if (matches?.groups) {
                        let groups = matches?.groups;
                        let marketObj = {
                            marketTitle: (groups?.eventTitle ?? '').trim(),
                            avgPrice: ` ${(groups?.avgPrice ?? '').trim()} `,
                            noOfShares: groups?.noOfShares
                        };
                        _txns[i]['marketObj'] = marketObj;
                        _txns[i]['transactionData'] = {
                            title: newmessage, subtitle: marketObj['marketTitle'], status: null, amount: _txns[i]['amount'], info: null,
                            metadata: [
                                { key: translator('Amount'), value: _txns[i]['amount'] },
                                { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                                { key: translator('Date'), value: _txns[i]['createdat'] },
                                { key: translator('All Cost & Fees'), value: _txns[i]['surcharge'].toFixed(2) }]
                        };

                    }
                    console.log(matches?.groups)
                    // let eventTitle = infoArr[0].replace('Market: ', '');
                    // eventTitle = eventTitle.replace('Market : ', '');
                    // let avgPrice = infoArr[1].slice(infoArr[1].indexOf('Rs.') + 3, infoArr[1].indexOf('each'));
                    // let noOfShares = infoArr[1].slice(infoArr[1].indexOf('merged') + 7, infoArr[1].indexOf('x'));

                    _txns[i]['newmessage'] = newmessage;
                }
                else if (_txns[i]['txnid'].indexOf('LTF') === 0) {
                    let infoArr = _txns[i]['message'].split("\n");
                    let newmessage = translator(`Liquidity Fee Earned`);
                    let eventTitle = infoArr[0].replace('Market: ', '');
                    eventTitle = eventTitle.replace('Market : ', '');

                    let marketObj = { marketTitle: eventTitle, info: infoArr[1] };
                    _txns[i]['marketObj'] = marketObj;
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: eventTitle, status: null, amount: _txns[i]['amount'], info: null,
                        metadata: [
                            { key: translator('Amount'), value: _txns[i]['amount'] },
                            { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                            { key: translator('Date'), value: _txns[i]['createdat'] }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('CTM') === 0) {
                    let newmessage = translator('Credited from trading marathon');
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: newmessage, status: null, amount: _txns[i]['amount'], info: null,
                        metadata: [
                            { key: translator('Amount'), value: _txns[i]['amount'] },
                            { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                            { key: translator('Date'), value: _txns[i]['createdat'] }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('LRF') === 0) {
                    let infoArr = _txns[i]['message'].split("\n");
                    let newmessage = translator(`Liquidity Refund on event`);
                    let eventTitle = infoArr[0].replace('Market: ', '');
                    eventTitle = eventTitle.replace('Market : ', '');

                    let marketObj = { marketTitle: eventTitle, info: infoArr[1] };
                    _txns[i]['marketObj'] = marketObj;
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: eventTitle, status: null, amount: _txns[i]['amount'], info: null,
                        metadata: [
                            { key: translator('Amount'), value: _txns[i]['amount'] },
                            { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                            { key: translator('Date'), value: _txns[i]['createdat'] }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('CFM') === 0) {
                    let newmessage = translator(`Credited from FM Manager Program`);
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: newmessage, status: null, amount: _txns[i]['amount'], info: null,
                        metadata: [
                            { key: translator('Amount'), value: _txns[i]['amount'] },
                            { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                            { key: translator('Date'), value: _txns[i]['createdat'] }]
                    };
                }

                else if (_txns[i]['txnid'].indexOf('TDSRF') === 0) {
                    let newmessage = translator(`TDS Refund`);
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: newmessage, status: null, amount: _txns[i]['amount'], info: null,
                        metadata: [
                            { key: translator('Amount'), value: _txns[i]['amount'] },
                            { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                            { key: translator('Date'), value: _txns[i]['createdat'] }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('CS') === 0 || _txns[i]['txnid'].indexOf('CLS') === 0) {

                    let eventId;
                    let txnId = _txns[i]['txnid'];
                    let message = _txns[i].message ?? ''
                    eventId = (txnId).replace(/(^CLS1000)/gi, '')


                    // let infoArr = _txns[i]['message'].split("\n");

                    const metaRegEx = /Settlement for club event:\n(?<club_title>.*)\nof event\n(?<event_title>.*)\nwith option\n(?<option_label>.*)\nfor investment of\n₹(?<investment>.*)/

                    const matches = metaRegEx.exec(message)
                    const groups = matches?.groups ?? {};
                    let newmessage = `Received from Club Event Settlement (${groups?.club_title ?? `#${eventId}`})`;

                    let positionType = groups?.option_label ? `Settled at ${groups?.option_label}` : ''

                    let noOfShares = (
                        parseFloat(_txns[i]?.amount ?? 0) / parseFloat(groups?.investment ?? 1)
                    ).toFixed(2) + 'x'
                    // let eventTitle = infoArr[0].replace('Market: ', '');
                    // eventTitle = eventTitle.replace('Market : ', '');
                    // let position;
                    // if (infoArr[1].includes("Y")){
                    //     position = "Yes";
                    // }else{
                    //     position = "No";
                    // }
                    const getMarketTitle = () => {
                        if (groups?.event_title && groups?.option_label) {
                            return `(${groups?.event_title}) ${groups?.option_label}`
                        }
                        return ''
                    }
                    let marketObj = {
                        marketTitle: getMarketTitle(),
                        positionType,
                        noOfShares
                    };
                    _txns[i]['marketObj'] = marketObj;
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: newmessage, status: null, amount: _txns[i]['amount'], info: null,
                        metadata: [
                            { key: 'Amount', value: _txns[i]['amount'] },
                            { key: 'Transaction ID', value: '#' + _txns[i]['txnid'] },
                            { key: 'Date', value: _txns[i]['createdat'] }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('CLBRF') === 0) {

                    let eventId;
                    let txnId = _txns[i]['txnid'];
                    let message = _txns[i].message ?? ''
                    eventId = (txnId).replace(/(^CLS1000)/gi, '')


                    // let infoArr = _txns[i]['message'].split("\n");

                    const metaRegEx = /Settlement fees for event\n(?<event_title>.*)/

                    const matches = metaRegEx.exec(message)
                    const groups = matches?.groups ?? {};
                    let newmessage = `Settlement fees for event`;

                    const getMarketTitle = () => {
                        if (groups?.event_title) {
                            return `(${groups?.event_title})`
                        }
                        return ''
                    }
                    let marketObj = {
                        marketTitle: getMarketTitle(),
                    };
                    _txns[i]['marketObj'] = marketObj;
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: newmessage, status: null, amount: _txns[i]['amount'], info: null,
                        metadata: [
                            { key: 'Amount', value: _txns[i]['amount'] },
                            { key: 'Transaction ID', value: '#' + _txns[i]['txnid'] },
                            { key: 'Date', value: _txns[i]['createdat'] }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('CLFREV1') === 0) {

                    let eventId;
                    let txnId = _txns[i]['txnid'];
                    let message = _txns[i].message ?? ''
                    eventId = (txnId).replace(/(^CLFREV1000)/gi, '')


                    // let infoArr = _txns[i]['message'].split("\n")
                    const metaRegEx = /Trading Fee Credited due to event reset\n(\s+)(?<event_title>.*)\n(\s+)of club\n(\s+)(?<club_title>.*)/

                    const matches = metaRegEx.exec(message)
                    const groups = matches?.groups ?? {};
                    let newmessage = `Club Event Reset - (${groups?.club_title ?? `#${eventId}`})`;

                    const getMarketTitle = () => {
                        if (groups?.event_title) {
                            return `(${groups?.event_title})`
                        }
                        return ''
                    }
                    let marketObj = {
                        marketTitle: getMarketTitle(),
                    };
                    _txns[i]['marketObj'] = marketObj;
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: newmessage, status: null, amount: _txns[i]['amount'], info: null,
                        metadata: [
                            { key: 'Amount', value: _txns[i]['amount'] },
                            { key: 'Transaction ID', value: '#' + _txns[i]['txnid'] },
                            { key: 'Date', value: _txns[i]['createdat'] }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('PTD') === 0 || _txns[i]['txnid'].indexOf('SPTD') === 0) {
                    _txns[i]['newmessage'] = translator('Move promotional balance');
                    _txns[i]['transactionData'] = {
                        title: translator('Move promotional balance'), subtitle: translator('Move promotional balance'), status: null, amount: _txns[i]['amount'], info: null,
                        metadata: [
                            { key: translator('Amount'), value: _txns[i]['amount'] },
                            { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                            { key: translator('Date'), value: _txns[i]['createdat'] }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('CW') === 0) {
                    const regex = /Winnings for Contest: (.+)/;
                    let contestName

                    let message = _txns[i].message ?? '';
                    const match = regex.exec(message);

                    if (match) {
                        contestName = match[1];

                    } else {
                        console.log("No match found in the input string.");
                    }
                    _txns[i]['newmessage'] = _txns[i]['message'];
                    _txns[i]['transactionData'] = {
                        title: translator('Winnings from Contest'), subtitle: contestName, status: null, amount: _txns[i]['amount'], info: null,
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('PCR') === 0) {
                    _txns[i]['newmessage'] = _txns[i]['message'];
                    _txns[i]['transactionData'] = {
                        title: _txns[i]['message'], subtitle: 'Credit Yes/No Game Wallet', status: null, amount: _txns[i]['amount'], info: null,
                        metadata: [{ key: 'Amount', value: _txns[i]['amount'] },
                        { key: 'Transaction ID', value: '#' + _txns[i]['txnid'] },
                        { key: 'Date', value: _txns[i]['createdat'] }]
                    }
                }
                else if (_txns[i]['txnid'].indexOf('LCCMP') === 0) {
                    let newmessage = _txns[i]['message'];
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: 'Tokens Reward', status: null, amount: _txns[i]['amount'], info: null,
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('CACB') === 0) {
                    let newmessage = _txns[i]['message'];
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: 'TradeX Credits Reward', status: null, amount: _txns[i]['amount'], info: null,
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] }]
                    };
                }
                else if (_txns[i]['txnid'].indexOf('REWARD') === 0) {
                    let newmessage = _txns[i]['message'];
                    _txns[i]['newmessage'] = newmessage;
                    _txns[i]['transactionData'] = {
                        title: newmessage, subtitle: 'Rewards Credited', status: 'Token points', amount: _txns[i]['amount'], info: null,
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] }]
                    };
                }
                else {
                    _txns[i]['newmessage'] = _txns[i]['message'];
                    _txns[i]['transactionData'] = {
                        title: _txns[i]['message'], subtitle: null, status: null, amount: _txns[i]['amount'], info: _txns[i]['message'],
                        metadata: [{ key: translator('Amount'), value: _txns[i]['amount'] },
                        { key: translator('Transaction ID'), value: '#' + _txns[i]['txnid'] },
                        { key: translator('Date'), value: _txns[i]['createdat'] }]
                    }
                }

            }
            if(_txns[i]['wallettype'] == 'P'){
                _txns[i]['transactionData']['status'] = 'Token points';
            }
        }

        return ReS(res, {
            transactions: _txns
        });
    } catch (err) {
        next(err);
    }
}

const getLeaders = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');

    try {
        let err, _leaders;
        var data = Object.assign({}, req.body);

        [err, _leaders] = await to(User.getLeaders(data));
        if (err) throw err;

        return ReS(res, {
            leaders: _leaders
        });
    } catch (err) {
        next(err);
    }
}

const getRedeemRequests = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    if (req.baseUrl.includes('v1')) {
        return ReE(res, messages.TRADING_NOT_ALLOWED, 405);
    }
    if (!isDashboardUser(req)) {
        res.writeStatus("401");
        return ReS(res, {
            success: true, msg: 'Unauthorized request, incident has been reported'
        });
    }
    var err, _redreemReqs;
    try {
        [err, _redreemReqs] = await to(User.getRedeemRequests(undefined, req.query));
        if (err) throw err;

        return ReS(res, { redeems: _redreemReqs })

    } catch (err) {
        next(err);
    }
}

async function checkForCashfreeBalance(redeemReq) {
    let isProcessable = false, availableBalance = 0;
    let resp = { isProcessable, availableBalance };
    try {
        let [err, resData] = await to(CommonController.getCashfreeBalance());
        logger.info(`[checkForBalance].......redeem: ${JSON.stringify(redeemReq)} resData: ${JSON.stringify(resData)} err: ${err}`);
        if (err) {
            logger.error(`[checkForBalance] Error occured while checking cashfree Balance redeem request: ${JSON.stringify(redeemReq)} error: ${err.message}`);
            return resp
        } else {
            resp['availableBalance'] = parseFloat(resData['data']['availableBalance']);
            const minCashfreeBalance = 20000
            if (resData && resData['data']['availableBalance'] && redeemReq.amount && (parseFloat(resData['data']['availableBalance']) - minCashfreeBalance) >= parseFloat(redeemReq.amount)) {
                resp['isProcessable'] = true
            } else {
                logger.error(`[checkForBalance] cashfree balance check failed for redeem request: ${JSON.stringify(redeemReq)} resData: ${JSON.stringify(resData)}`);
            }
        }
        return resp
    } catch (err) {
        logger.error(`[checkForBalance] Error occured checking for balance redeem request: ${JSON.stringify(redeemReq)} error: ${err.message}`);
        return resp
    }
}

const processRedeem = async (redeemReq) => {
    let err, resData, _redreemReqs;
    let redeem = Object.assign({}, redeemReq);
    redeem['isProcessed'] = false;
    redeem['mismatch'] = false;
    redeem['beforeBalance'] = 0;
    redeem['afterBalance'] = 0;
    redeem['message'] = '';
    let [errb, bankdetails] = await to(User.getBankDetails(redeemReq.userid));
    if (errb) {
        logger.info(`[processRedeem] Unable to fetch bank details for User: ${redeemReq.userid}, request id: ${redeemReq.id}, error: ${errb.message}`);
        redeem['message'] = `Unable to fetch bank details for User: ${redeemReq.userid}, request id: ${redeemReq.id}, error: ${errb.message}`;
        return redeem
    }
    if (typeof bankdetails === 'undefined' || typeof bankdetails.rp_fundid === 'undefined') {
        logger.info(`[processRedeem] Unable to fetch bank details for User: ${redeemReq.userid}, request id: ${redeemReq.id}, error: bank details undefined`);
        redeem['message'] = `Unable to fetch bank details for User: ${redeemReq.userid}, request id: ${redeemReq.id}, error: bank details undefined`;
        return redeem
    }
    var sT = performance.now();
    let balanceCheckResp = await checkForCashfreeBalance(redeemReq);
    redeem['beforeBalance'] = balanceCheckResp['availableBalance'];
    let isProcessable = balanceCheckResp['isProcessable'];
    var eT = performance.now();
    logger.info(`[processRedeem] User: ${redeemReq.userid}, request id: ${redeemReq.id} Cashfree Balance Check time taken: ${parseInt(eT - sT)} milliseconds `)

    if (!isProcessable) {
        logger.info(`[processRedeem] Unable to process payout for User: ${redeemReq.userid}, request id: ${redeemReq.id}, due to insufficient balance`);
        redeem['message'] = `[processRedeem] Unable to process payout for User: ${redeemReq.userid}, request id: ${redeemReq.id}, due to insufficient balance`;
        return redeem
    }
    logger.info(`[processRedeem] process payout for User: ${redeemReq.userid}, request id: ${redeemReq.id}, bankdetails data: ${JSON.stringify(bankdetails)}`);
    let userId = bankdetails.userid;
    let fcmtoken = bankdetails.fcmtoken;
    // if (err) throw err;

    let _amt = Math.floor(redeemReq.amount * 1.0 * 100) / 100;
    let uid = getUID();
    let tId = 'tr_' + (uid).toString(32) + '_' + process.env.MACHINE_ID + '_' + threadId;
    var postData = {
        "beneId": bankdetails.cg_beneid,
        "amount": _amt,
        "transferId": tId
    };
    const reqKey = `process_redeem_${redeemReq.id}`;
    const lockReqKey = `lock_process_redeem_${redeemReq.id}`
    const unlock = await lock(lockReqKey);
    let isReqInProgress = await redisCaching.getKey(reqKey);
    if (isReqInProgress) {
        logger.error(`[processRedeem]  Already processing redeem requests redeem status for User: ${redeemReq.userid}, request id: ${redeemReq.id}`);
        redeem['message'] = `Already processing redeem requests redeem status for User: ${redeemReq.userid}, request id: ${redeemReq.id}`;
        return redeem;
    }
    await redisCaching.setKey(reqKey, true, 10 * 60);
    unlock();
    let lastActiveRdeemStatus;
    [err, lastActiveRdeemStatus] = await to(User.getRedeemById(redeemReq.id));
    if (err) {
        await redisCaching.delKey(reqKey);
        logger.info(`[processRedeem] Unable to get last redeem status for User: ${redeemReq.userid}, request id: ${redeemReq.id}, error: ${err.message}`);
        redeem['message'] = `Unable to get last redeem status for User: ${redeemReq.userid}, request id: ${redeemReq.id}, error: ${err.message}`;
        return redeem
    }
    if (lastActiveRdeemStatus.length == 0 || lastActiveRdeemStatus[0]['status'] == 'C') {
        logger.info(`[processRedeem] Already processed for User: ${redeemReq.userid}, request id: ${redeemReq.id}`);
        await redisCaching.delKey(reqKey);
        redeem['message'] = `Already processed for User: ${redeemReq.userid}, request id: ${redeemReq.id}`;
        return redeem
    }
    if (lastActiveRdeemStatus[0]['status'] == 'A' && lastActiveRdeemStatus[0].transferid) {
        // Check status from cashfree
        [err, resData] = await to(CommonController.getPayoutStatusInCG(lastActiveRdeemStatus[0].transferid));
        logger.info(`[processRedeem] cashfree transfer status for User: ${redeemReq.userid} of ${_amt}, request id: ${redeemReq.id}, gateway response: ${JSON.stringify(resData)}`);
        if (err) {
            logger.info(`[processRedeem] Unable to process payout for User: ${redeemReq.userid} of ${_amt}, request id: ${redeemReq.id}, error: ${err.message}`);
            logger.error(err);
            await redisCaching.delKey(reqKey);
            redeem['message'] = `Unable to process payout for User: ${redeemReq.userid} of ${_amt}, request id: ${redeemReq.id}, error: ${err.message}`;
            return redeem
        }
        // Check if status is complete from cashfree's end
        if (resData && resData['data'] && resData['data']['transfer'] && resData['data']['transfer']['referenceId']) {
            redeem['isProcessed'] = true;
            redeem['message'] = `Withdrawal Processed!`;
            var updateRData = Object.assign({}, { id: redeemReq.id, refid: resData?.data?.transfer?.referenceId, status: 'C', pgstatus: resData?.data?.transfer?.status, pgacknowledged: !!resData?.data?.transfer?.acknowledged });
            [err, _redreemReqs] = await to(User.updateRedeemRequests(updateRData));
            if (err) {
                logger.info(`[processRedeem] Unable to process update txn details for User: ${redeemReq.userid}, request id: ${redeemReq.id}, error: ${err.message}`);
                redeem['message'] = `Unable to process update txn details for User: ${redeemReq.userid}, request id: ${redeemReq.id}, error: ${err.message}`;
                logger.error(err);
            } else {
                var msgTitle = `Withdrawal Processed!`;
                var msgBody = `Your withdrawal request submitted of ${redeemReq.amount} has been processed`;
                var jsonData = { getuser: true, 'title': msgTitle, 'type': 'N', 'body': msgBody };
                // let [errx, res] = await to(UserService.addMessageAndInform(userId, fcmtoken, jsonData));
                let _user;
                [err, _user] = await to(User.findById(redeemReq.userid));
                let partnerConfig = await Partner.getPartnerWithConfig(parseInt(_user['partner']), 'INDIA', true);
                if (_user && partnerConfig.notifications) await handleNotification({ amount: redeemReq.amount, userid: redeemReq.userid, region: 'INDIA', partner: parseInt(_user['partner']) }, "withdrawal request success");
            }
            await redisCaching.delKey(reqKey);
            return redeem;
        }
    }
    // Start redeem processing ...
    var updateRData = Object.assign({}, { id: redeemReq.id, transferid: tId });
    [err, _redreemReqs] = await to(User.updateRedeemRequests(updateRData));
    if (err) {
        logger.info(`[processRedeem] Unable to process payout for User: ${redeemReq.userid} of ${_amt}, request id: ${redeemReq.id}, error: ${err.message}`);
        logger.error(err);
        await redisCaching.delKey(reqKey);
        redeem['message'] = `Unable to process payout for User: ${redeemReq.userid} of ${_amt}, request id: ${redeemReq.id}, error: ${err.message}`;
        return redeem
    }
    logger.info(`[processRedeem] process payout for User: ${redeemReq.userid} of ${_amt}, request id: ${redeemReq.id}, gateway post data: ${JSON.stringify(postData)}`);
    var sT = performance.now();
    [err, resData] = await to(CommonController.createPayoutInCG(postData));
    var eT = performance.now();
    logger.info(`[processRedeem] User: ${redeemReq.userid}, request id: ${redeemReq.id} Cashfree Payout time taken : ${parseInt(eT - sT)} milliseconds `)

    if (err) {
        logger.info(`[processRedeem] Unable to process payout for User: ${redeemReq.userid} of ${_amt}, request id: ${redeemReq.id}, error: ${err.message}`);
        logger.error(err);
        await redisCaching.delKey(reqKey);
        redeem['message'] = `Unable to process payout for User: ${redeemReq.userid} of ${_amt}, request id: ${redeemReq.id}, error: ${err.message}`;
        return redeem
    }
    // if (err) throw err;
    logger.info(`[processRedeem] process payout for User: ${redeemReq.userid} of ${_amt}, request id: ${redeemReq.id}, gateway response: ${JSON.stringify(resData)}`);
    if (resData['status'] == 'ERROR') {
        logger.info(`[processRedeem] Unable to process payout for User: ${redeemReq.userid} of ${_amt}, request id: ${redeemReq.id}, gateway status: ${resData['status']}`);
        logger.info(resData);
        await redisCaching.delKey(reqKey);
        redeem['message'] = `Unable to process payout for User: ${redeemReq.userid} of ${_amt}, request id: ${redeemReq.id}, gateway status: ${resData['status']}`;
        return redeem
    } else if (resData['data'] && resData['data']['referenceId']) {
        redeem['isProcessed'] = true
        var updateRData = Object.assign({}, { id: redeemReq.id, refid: resData?.data?.referenceId, status: 'C', pgstatus: resData?.status, pgacknowledged: !!resData?.data?.acknowledged });
        [err, _redreemReqs] = await to(User.updateRedeemRequests(updateRData));
        if (err) {
            logger.info(`[processRedeem] Unable to process update txn details for User: ${redeemReq.userid}, request id: ${redeemReq.id}, error: ${err.message}`);
            redeem['message'] = `Unable to process update txn details for User: ${redeemReq.userid}, request id: ${redeemReq.id}, error: ${err.message}`;
            logger.error(err);
        } else {
            var msgTitle = `Withdrawal Processed!`;
            var msgBody = `Your withdrawal request submitted of ${redeemReq.amount} has been processed`;
            var jsonData = { getuser: true, 'title': msgTitle, 'type': 'N', 'body': msgBody };

            // let [errx, res] = await to(UserService.addMessageAndInform(userId, fcmtoken, jsonData));
            let _user;
            [err, _user] = await to(User.findById(redeemReq.userid));
            let partnerConfig = await Partner.getPartnerWithConfig(parseInt(_user['partner']), 'INDIA', true);
            if (_user && partnerConfig.notifications) await handleNotification({ amount: redeemReq.amount, userid: redeemReq.userid, region: 'INDIA', partner: parseInt(_user['partner']) }, "withdrawal request success");
            await UserService.sendTdsWithdrawInvoice(lastActiveRdeemStatus[0]);

        }
        await redisCaching.delKey(reqKey);
        try {
            let [err, resData] = await to(CommonController.getCashfreeBalance());
            if (err) throw err;
            const startBalance = parseFloat(balanceCheckResp['availableBalance']);
            const endBalance = parseFloat(resData['data']['availableBalance']);
            redeem['afterBalance'] = endBalance;
            const deducted = startBalance - endBalance;
            const tobededucted = _amt;
            const permissibleLimit = 2000;
            if (deducted - tobededucted > permissibleLimit) {
                redeem['mismatch'] = true;
            }
        } catch (e) {
            redeem['mismatch'] = true;
        }
        redeem['message'] = `Withdrawal Processed!`;
        return redeem
    } else {
        logger.info(`[processRedeem] Unable to process payout for User: ${redeemReq.userid} of ${_amt}, request id: ${redeemReq.id}, gateway response: ${JSON.stringify(resData)}`);
    }
    await redisCaching.delKey(reqKey);
    return redeem
}

const processRedeemHelper = async (ids) => {
    var _redreemReqs;
    let err, res;

    try {
        logger.info(`[processRedeemHelper].......ids: ${ids}`);
        [err, _redreemReqs] = await to(User.getRedeemRequests(ids));
        if (err) throw err;
        const _redreemReqIds = _redreemReqs.map(function (e) { return e.id })
        logger.info(`[processRedeemHelper].......ids to process: ${JSON.stringify(_redreemReqIds)}`)
        await CommonController.getCashFreeAccessToken();
        const responses = [];
        for (let redeemReq of _redreemReqs) {
            let response = await processRedeem(redeemReq);
            console.log(`[processRedeemHelper] Redeem request id: ${redeemReq.id}, response: ${JSON.stringify(response)}`)
            if (response.mismatch) break;
            responses.push(response);
        }
        function checkIsProcessed(redeem) {
            return redeem.isProcessed ? redeem.isProcessed : false;
        }
        const processedRedeems = responses.filter(checkIsProcessed);
        const processedIds = processedRedeems.map(function (e) { return e.id })
        logger.info(`[processRedeemHelper].......processed ids....  ${JSON.stringify(processedIds)}`)
        return processedRedeems;
    }
    catch (err) {
        logger.error(`[processRedeemHelper] Error occured while processing redeem request ids: ${ids} error: ${err.message}`);
        throw err;
    }
}


const processRedeemRequests = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    if (req.baseUrl.includes('v1')) {
        return ReE(res, messages.TRADING_NOT_ALLOWED, 405);
    }
    if (!isDashboardUser(req)) {
        res.writeStatus("401");
        return ReS(res, {
            success: true, msg: 'Unauthorized request, incident has been reported'
        });
    }
    const reqKey = `processing_redeems`;
    const lockReqKey = `lock.${reqKey}`;
    let isReqInProgress = await redisCaching.getKey(lockReqKey);
    if (isReqInProgress) {
        return ReE(res, messages.REQUEST_IN_PROGRESS, 423);
    }

    var err, _redreemReqs, ids = req.body.ids;
    if (ids.length == 0) {
        return ReE(res, `Invalid Request, Ids not selected`, 412);
    }
    const unlock = await lock(reqKey, 300000);
    try {
        logDashboardRequest(req, 'Processing redeem requests');
        [err, _redreemReqs] = await processRedeemHelper(ids);
        if (err) {
            throw err;
        }
        unlock();
        return ReS(res, { redeems: _redreemReqs });
    } catch (err) {
        unlock();
        next(err);
    }
}

const blockUnblockUsers = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    if (!isDashboardUser(req)) {
        res.writeStatus("401");
        return ReS(res, {
            success: true, msg: 'Unauthorized request, incident has been reported'
        });
    }
    var err, ress, ids = req.body.ids;
    var blocked = !(req.body.block);
    try {
        logDashboardRequest(req, 'Processing block/unblock users');
        if (ids.length === 0) return ReS(res, { message: 'Ids not selected' });

        let userList = [];

        if (blocked) {
            for (let i = 0; i < ids.length; i++) {
                userList.push(parseInt(ids[i]));
            }
            [err, ress] = await to(User.removeBlockedUser(userList));
            if (err) throw err;
        }
        else {
            for (let i = 0; i < ids.length; i++) {
                userList.push({ 'userid': ids[i] });
            }
            [err, ress] = await to(User.enterBlockedUser(userList));
            if (err) throw err;
        }
        return ReS(res, { Success: true });
    } catch (err) {
        next(err);
    }
}
const suspendUsers = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    if (!isDashboardUser(req)) {
        return ReE(res, 'Unauthorized request, incident has been reported', 401);
    }
    var err, ress, duration, ids = req.body.ids;
    if (req.body.duration) {
        duration = req.body.duration;
    } else {
        duration = CONFIG.SUSPEND_DURATION;
    }

    try {
        if (ids.length === 0) return ReE(res, 'No ids selected', 500);

        let succesfullySuspended = [];
        let unsuccessfullySuspended = [];
        let blockedAfterSuspension = [];

        for (let userId of ids) {
            const isUserBlocked = await User.isUserBlocked(userId);
            if (isUserBlocked) {
                succesfullySuspended.push({ "userid": userId, "message": "User already Blocked" });
                continue;
            }
            [err, ress] = await to(User.getFromBlockedUsers(userId));
            if (err) {
                unsuccessfullySuspended.push({ "userid": userId, "message": "Cannot fetch details from blocked_users" });
                continue;
            }
            let res;
            if (ress) {
                if (ress.suspended + 1 <= 3) {
                    let dataObj = { 'userid': userId, 'suspended': ress.suspended + 1, 'suspended_at': 'now()', 'status': 'T', 'suspenddurationinhours': duration };
                    [err, res] = await to(User.updateBlockedUsers(dataObj));
                    if (err) {
                        unsuccessfullySuspended.push({ "userid": userId, "message": "Cannot update details to blocked_users" });
                        continue;
                    }
                    succesfullySuspended.push({ "userid": res.userid, "suspendedTimes": res.suspended });

                } else {
                    let dataObj = { 'userid': userId, 'suspended': ress.suspended + 1, 'suspended_at': 'now()', 'status': 'P' };
                    [err, res] = await to(User.updateBlockedUsers(dataObj));
                    if (err) {
                        unsuccessfullySuspended.push({ "userid": userId, "message": "Cannot update details to blocked_users" });
                        continue;
                    }
                    blockedAfterSuspension.push({ "userid": res.userid, "suspendedTimes": res.suspended });

                }
            } else {
                let dataObj = { 'userid': userId, 'suspended': 1, 'suspended_at': 'now()', 'status': 'T', 'suspenddurationinhours': duration };
                [err, res] = await to(User.addSuspendedUser(dataObj));
                if (err) {
                    unsuccessfullySuspended.push({ "userid": userId, "message": "Cannot add details to blocked_users" });
                    continue;
                }
                succesfullySuspended.push({ "userid": res.userid, "suspendedTimes": res.suspended });

            }
        }

        return ReS(res, {
            success: true, msg: 'All ids processed',
            "successfully suspended": succesfullySuspended,
            "blocked after suspension": blockedAfterSuspension,
            "unsuccessfully suspended": unsuccessfullySuspended,
            "suspend duration": duration
        });
    } catch (err) {
        next(err);
    }
}

const cancelRedeemRequests = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    if (req.baseUrl.includes('v1')) {
        return ReE(res, messages.TRADING_NOT_ALLOWED, 405);
    }
    if (!isDashboardUser(req)) {
        res.writeStatus("401");
        return ReS(res, {
            success: true, msg: 'Unauthorized request, incident has been reported'
        });
    }
    var err, ids = req.body.ids;
    try {
        const data = await UserService.cancelRedeemRequest(ids);
        return ReS(res, data);
    } catch (err) {
        next(err);
    }
}

/*
const processRedeemRequests = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    var err, _redreemReqs, ids = req.body.ids;
    try {
        [err, _redreemReqs] = await to(User.getRedeemRequests(ids));
        if (err) throw err;

        for (let redeemReq of _redreemReqs) {
            // let redeemReq = _redreemReqs[i];
            let rd;
            let [errb, bankdetails] = await to(User.getBankDetails(redeemReq.userid));
            if (errb) {
                logger.info(`Unable to fetch bank details for User: ${redeemReq.userid}`);
                continue;
            }
            if (typeof bankdetails === 'undefined' || typeof bankdetails.rp_fundid === 'undefined') {
                logger.info(`Unable to fetch bank details for User: ${redeemReq.userid}`);
                continue;
            }
            let userId = bankdetails.userid;
            let fcmtoken = bankdetails.fcmtoken;
            // if (err) throw err;

            let refId = redeemReq.transactionid;
            let _amt = redeemReq.amount * 100;
            var postData = {
                "account_number": CONFIG.razorpayParams.accountNumber,
                "fund_account_id": bankdetails.rp_fundid,
                "amount": _amt,
                "currency": "INR",
                "mode": "IMPS",
                "purpose": "payout",
                "queue_if_low_balance": true,
                "reference_id": refId
            };

            [err, resData] = await to(CommonController.createPayoutInRP(postData));
            if (err) throw err;

            if (resData['error']) {
                logger.info(`Unable to process bank details for User: ${redeemReq.userid}`);
                continue;
            } else {
                var updateRData = Object.assign({}, { id: redeemReq.id, refid: resData['id'], status: 'C' });
                [err, _redreemReqs] = await to(User.updateRedeemRequests(updateRData));
                if (err) {
                    logger.info(`Unable to process update txn details for User: ${redeemReq.userid}`);
                    throw err;
                } else {
                    var msgTitle = `Withdrwal Processed!`;
                    var msgBody = `Your withdrwal request submitted of Rs ${redeemReq.amount} has been processed`;
                    var jsonData = { getuser: true, 'title': msgTitle, 'type': 'N', 'body': msgBody };
                    let [errx, res] = await to(UserService.addMessageAndInform(userId, fcmtoken, jsonData));
                }
            }
        }
        return ReS(res, { redeems: _redreemReqs });
    } catch (err) {
        next(err);
    }
}
*/

const putRedeemRequests = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    if (req.baseUrl.includes('v1')) {
        return ReE(res, messages.TRADING_NOT_ALLOWED, 405);
    }

    // console.log('here...');
    // req.user = await User.findById( 177023, false );
    // console.log(req.user);
    var err, uc, _txns, _redreemReq, _userId = req.user.id, _userRows, _user = req.user, lastRdeemStatus, lastCompletedRedReqs, lastCompletedRedReqslimit = 3, resp;
    let reqKey = `put_redeem_req_${_userId}`;
    const version = parseInt(req.headers['version']);
    const platform = req.headers['x-platform'];
    const isExemptedUser = isExemptUser(_userId);
    if (isExemptedUser) {
        return ReE(res, messages.WITHDRAW_DISABLE_FOR_MM_USERS, 405);
    }
    try {
        /*Do not Delete. Might be needed in future*/
        // const isUserAllowed = await User.isUserAllowed(_userId);
        // if (true) {
        //     return ReE(res, "Unable to raise withdraw request. Try again in sometime", 400);
        // }
        /**/
        const region = req.user.region;

        const dateIst = luxon.DateTime.now().setZone('Asia/Kolkata');
        if(region === 'INDIA') {
            if (
                (dateIst.month === 3 && dateIst.day === 30) || 
                (dateIst.month === 3 && dateIst.day === 31) ||
                (dateIst.month === 4 && dateIst.day === 1) ||
                (dateIst.month === 4 && dateIst.day === 2) ||
                (dateIst.month === 4 && dateIst.day === 3)
            ) {
                console.log("[REDEEM NOT ALLOWED YEAR END]");
                return ReE(res, messages.WITHDRAW_NOT_ALLOWED_YEAREND, 405);
            }
        }
        

        const unlock = await lock(reqKey, 60000);
        let isReqInProgress = await redisCaching.getKey(reqKey);
        if (isReqInProgress) {
            unlock();
            return ReE(res, `Your request already in progress`, 423);
        }
        await redisCaching.setKey(reqKey, true, 60);
        unlock();
        do {
            await waitTimer(100);
        } while ((await redisCaching.keys(`put_call_req_${_userId}_*`)).length > 0)

        if (req.user.kycstatus == 'I') {
            redisCaching.delKey(reqKey);
            let msg = 'Please add your KYC and Bank Details first';
            return ReE(res, msg, 422);
        }
        const _isProfileComplete = await isProfileComplete(_userId);
        if (!_isProfileComplete) {
            redisCaching.delKey(reqKey);
            return ReE(res, `Please Complete your profile first`, 402);
        }

        const isUserBlocked = await User.isUserWithdrawalBlocked(_userId);
        if (isUserBlocked && isUserBlocked == true) {
            redisCaching.delKey(reqKey);
            return ReE(res, `Due to technical maintainence withdrawal are temporarily on hold. Please try again after some time.`, 500);
        }

        let lastActiveRdeemStatus;
        [err, lastActiveRdeemStatus] = await to(User.getRedeemStatus({ 'userid': _userId, status: 'A', limit: 1 }));
        if (err) throw err;

        if (lastActiveRdeemStatus[0]) {
            redisCaching.delKey(reqKey);
            return ReE(res, 'Your last withdrawl request is already in Progress. Try again later');
        }

        [err, lastCompletedRedReqs] = await to(User.getRedeemStatus({ 'userid': _userId, status: 'C', limit: lastCompletedRedReqslimit }));
        if (err) throw err;

        if (lastCompletedRedReqs[0]) {
            var now = moment(new Date()); //todays date
            var lastRedeemTime = moment(lastCompletedRedReqs[0]['createdat']);
            var duration = moment.duration(now.diff(lastRedeemTime));

            if (duration.asDays() < 1) {
                redisCaching.delKey(reqKey);
                return ReE(res, 'You can only request once in a day. Try again later');
            }
        }


        let walletAddress = req.body.walletAddress;
        const isCrypto = (
            (req?.body?.pg === 'triplea') ||
            (req?.user?.signup_country !== 'BD' && req?.user?.signup_country !== 'PK' && req?.body?.pg !== 'direct24')
        );
        if (isCrypto) {
            const getAddValidateCryptoWallet = await RegionService?.payout?.getAddValidateCryptoWallet?.[region]
            if (getAddValidateCryptoWallet) {
                const address = await getAddValidateCryptoWallet(_user, walletAddress);
                if (!address.status) {
                    redisCaching.delKey(reqKey);
                    return ReE(res, address.msg, 402);
                } else {
                    _user['virtual_wallet_address'] = walletAddress;
                }
            }
        }


        const [errWB, walletData] = await to(User.getWalletBalance(_userId, false));
        if (errWB) {
            redisCaching.delKey(reqKey);
            throw errWB;
        }
        _user['walletData'] = walletData;
        const verifyWithdrawSource = RegionService?.payout?.verifyWithdrawSource?.[_user.signup_country] ?? RegionService?.payout?.verifyWithdrawSource?.[region];
        const verifyWithdrawSourceStatus = await verifyWithdrawSource(_user, req?.body?.pg);
        if (!verifyWithdrawSourceStatus.status) {
            redisCaching.delKey(reqKey);
            return ReE(res, verifyWithdrawSourceStatus.msg, 402);
        }
        const currency = getCurrency(req?.user?.signup_country, platform, version, req?.body?.pg);
        var data = Object.assign({}, req.body, { userid: _userId });
        const payload = {
            currency: currency,
            amount: data['amount']
        }
        if (data?.mobile) {
            payload.mobile = data.mobile
        }
        const verifyBalanceAmountStatus = await RegionService?.payout?.verifyBalanceAmount?.[region](_user, payload, platform, version);
        if (!verifyBalanceAmountStatus.status) {
            redisCaching.delKey(reqKey);
            return ReE(res, verifyBalanceAmountStatus.msg, 402);
        }
        const createPayoutOrder = RegionService?.payout?.createPayoutOrder?.[req?.user?.signup_country] ?? RegionService?.payout?.createPayoutOrder?.[region];
        const payoutResponseData = await createPayoutOrder(_user, payload, platform, version, req?.body?.pg);
        redisCaching.delKey(reqKey);
        if (!payoutResponseData.success) {
            return ReE(res, payoutResponseData.msg, 402);
        }
        return ReS(res, payoutResponseData);
    } catch (err) {
        console.log(err);
        redisCaching.delKey(reqKey);
        next(err);
    }

}

const confirmCryptoPayout = async (req, res, next) => {
    try {
        // console.log('here...');
        // req.user = await User.findById( 177023, false );
        // console.log(req.user);

        if (req.user.region == 'INDIA') {
            return ReE(res, 'Invalid request', 402);
        }
        var err, _userId = req.user.id, _user = req.user;
        const payout_reference = req.body.payout_reference;
        if (!payout_reference) {
            return ReE(res, `Invalid payout_reference`, 402);
        }
        const redeem = await User.getRedeemByRefId(payout_reference);
        if (!redeem) {
            return ReE(res, `Invalid request`, 402);
        }
        var payload = Object.assign({}, req.body);
        payload['redeemId'] = redeem.id;
        console.log(payload);
        const [errWB, walletData] = await to(User.getWalletBalance(_userId, false));
        if (errWB) {
            throw errWB;
        }
        _user['walletData'] = walletData;
        const region = req.user.region;
        const payoutResponseData = await RegionService?.payout?.confirmPayoutOrder?.[region](_user, payload);
        return ReS(res, payoutResponseData);
    } catch (error) {
        next(error);
    }
}

const cryptoPayoutHook = async (req, res, next) => {
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
            const payoutOrderStatusUpdate = RegionService?.payout?.payoutOrderStatusUpdate?.['REST_OF_WORLD'];
            const payoutUpdateResponseData = await payoutOrderStatusUpdate(signature, req.body);
            unlock();
            return ReS(res, payoutUpdateResponseData);
        } catch (err) {
            unlock();
            next(err);
        }
    } catch (error) {
        next(error);
    }
}

const getTdsBreakupOnWithdrawal = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        var userId, walletData;
        const partnerId = parseInt(req.user.partner?.id || 1);
        userId = req.user.id;
        let amountOfRedeemRequestRaised = parseFloat(req.body.amount);
        let amount = parseFloat(req.body.amount);
        let withdrawCharges = await UserService.getWithdrawalCharges(req.user, amount);
        let amountForTdsCalc = amount - withdrawCharges;

        let paymentConfig = await PaymentConfig.getConfig({
            partner: req.user?.partner?.id || 1,
            region: req.user?.region || 'INDIA'
        });
        if (req.user.partner.tds_applicable == true) {
            const tdsData = await UserService.computeTdsForUser(userId, amountForTdsCalc, walletData);

            // tdsData = {
            //     'netWinnings' : netWinnings,
            //     'tdsToBeDeducted' : tdsToBeDeducted,
            //     'withdrawalAmount' : withdrawalAmount,
            //     'cummulativeWithdrawals' : cummulativeWithdrawals,
            //     'totalAmountDeposited' : totalAmountDeposited,
            //     'initialInvestment' : initailInvestment,
            //     'winningsSufferedTds' : winningsSufferedTds
            // };
            if (tdsData && tdsData['netWinnings'] && tdsData['tdsToBeDeducted']) {
                if (tdsData['tdsToBeDeducted'] - (0.3 * amountForTdsCalc) > 1.0) {
                    tdsData['tdsToBeDeducted'] = 0.3 * amountForTdsCalc;
                }
            }

            let resArr1 = [{ "text": "A. Current Withdraw Requested", "value": (amountOfRedeemRequestRaised ?? 0).toFixed(2) },
            { "text": "B. Total Withdraw till date", "value": (tdsData?.['cummulativeWithdrawals'] ?? 0).toFixed(2) },
            { "text": "C. Previous Withdrawals on Which TDS was paid", "value": (tdsData?.['winningsSufferedTds'] ?? 0).toFixed(2) },
            { "text": "D. Opening Balance", "value": (tdsData?.['initialInvestment'] ?? 0).toFixed(2) },
            { "text": "E. Total Deposits and Cashbacks", "value": (tdsData?.['totalAmountDeposited'] ?? 0).toFixed(2) },
            { "text": "F. Total Referral Earnings", "value": (tdsData?.['referralEarnings'] ?? 0).toFixed(2) },
            { "text": "G. Withdraw Charges", "value": (withdrawCharges ?? 0).toFixed(2) },];

            if (tdsData?.['netWinnings'] <= 0) {
                tdsData['netWinnings'] = 0;
            }
            let resArr2 = [{ "text": "Net Profit Earned(A+B-C-D-E-F-G)", "value": (tdsData?.['netWinnings'] ?? 0).toFixed(2) },
            { "text": "TDS Applicable", "value": (tdsData?.['tdsToBeDeducted'] ?? 0).toFixed(2) },
            { "text": "Amount Deposited in Your Bank ", "value": ((amountOfRedeemRequestRaised ?? 0) - (tdsData?.['tdsToBeDeducted'] ?? 0) - withdrawCharges).toFixed(2) }];

            let govtRules = "As per govt regulations, TDS of 30% is applicable on net winnings at the time of withdraw.";
            let checkThisLink = 'https://tradexapp.zendesk.com/hc/en-us/articles/6465274706333-TDS-Deduction-on-the-Winning-';
            let withdrawAmount = ((amountForTdsCalc ?? 0) - (tdsData?.['tdsToBeDeducted'] ?? 0)).toFixed(2);



            return ReS(res, {
                success: true, detailsArr1: resArr1, detailsArr2: resArr2, govtRules, checkThisLink, withdrawAmount
            });
        } else {
            return ReS(res, {
                success: true
            });
        }
    } catch (error) {
        next(error);
    }
};

const getRedeemStatus = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    if (req.baseUrl.includes('v1')) {
        return ReE(res, messages.TRADING_NOT_ALLOWED, 405);
    }
    let err, redeemStatus, _txnRows, _redreemReq, _user = req.user;
    const userId = _user.id;
    try {

        [err, redeemStatus] = await to(User.getRedeemStatus({ 'userid': userId, status: 'A', limit: 1 }));
        if (err) throw err;

        [err, lastRedeem] = await to(User.getRedeemStatus({ 'userid': userId, status: ['A', 'C', 'CAN'], limit: 1 }));
        if (err) throw err;

        let lastredeem = null;

        if (lastRedeem.length > 0 && differenceInCalendarDays(new Date(), lastRedeem[0]['updatedat']) < 7) {
            lastredeem = Object.assign({ 'status': lastRedeem[0]['status'] });
            if (lastredeem['status'] == 'C') {
                lastredeem['msg'] = `Your last withdrawal of ${lastRedeem[0]['amount']} has been successfully processed.`;
            } else if (lastredeem['status'] == 'A') {
                lastredeem['msg'] = `Your withdrawal of ${lastRedeem[0]['amount']} is in processing. Funds will be credited to your account within 48 hours`;
            } else if (lastredeem['status'] == 'CAN') {
                lastredeem['msg'] = `Your previous withdrawal request of ${lastRedeem[0]['amount']} has failed. Our support team can assist with your queries`;
            }
        }

        if (redeemStatus.length > 0) {
            return ReS(res, { redeem: redeemStatus[0], 'lastredeem': lastredeem });
        } else {
            return ReS(res, { redeem: null, 'lastredeem': lastredeem });
        }


        if (redeemStatus != null && redeemStatus['link']) {
            let [pErr, poRes] = await to(CommonController.getCGStatus(redeemStatus['transactionid']));
            if (pErr) throw pErr;

            if (poRes == null) {
                return ReS(res, { redeem: null });
            }

            if (poRes['status'] == 'ERROR') {
                return ReE(res, poRes['message'], 500);
            } else {
                if (poRes['data']['cashgramStatus'] == 'ACTIVE') {
                    return ReS(res, { redeem: { 'link': poRes['data']['cashgramLink'], 'amount': redeemStatus['amount'] } });
                } else if (poRes['data']['cashgramStatus'] == 'EXPIRED') {

                    let oldTxnId = redeemStatus['transactionid'];

                    let [pErr2, poRes2] = await to(User.updateRedeemStatus({ 'refid': poRes['data']['referenceId'], 'status': 'E' }));
                    if (pErr2) throw pErr2;

                    [err, _redreemReq] = await to(User.putRedeemRequests(Object.assign({}, { 'userid': userId, 'amount': redeemStatus['amount'] }, { 'transactionid': 'tobeupdated' })));
                    if (err) throw err;

                    let txnId = 'RD' + (100000000 + parseInt(_redreemReq[0].id));

                    logger.info(`Redeem request expired for user ${userId} and oldtxnid ${oldTxnId}`);
                    logger.info(`New request raised ${userId} and txnId ${txnId}`);

                    var payoutObj = { 'txnid': txnId, 'amount': redeemStatus['amount'], name: _user.displayname || 'user', mobile: _user.mobile };
                    let [pErrN, poResN] = await to(CommonController.createPayout(payoutObj));
                    if (pErrN) throw pErrN;

                    if (poResN['status'] == 'ERROR') {
                        return ReE(res, poResN['message'], 500);
                    }

                    [err, _redreemReq] = await to(User.updateRedeemRequests({ id: _redreemReq[0].id, transactionid: txnId, 'link': poResN['data']['cashgramLink'], 'refid': poResN['data']['referenceId'] }));
                    if (err) throw err;

                    let [err2, updateTx] = await to(User.updateTransactions({ 'oldtxnid': oldTxnId, 'txnid': txnId }));
                    if (err2) throw err2;

                    return ReS(res, {
                        'redeem': _redreemReq[0]
                    });

                } else {
                    let [pErr, poRes3] = await to(User.updateRedeemStatus({ 'refid': poRes['data']['referenceId'], 'status': 'C' }));
                    if (pErr) throw pErr;

                    return ReS(res, { redeem: null });
                }
            }
        } else if (redeemStatus != null && redeemStatus['link'] == null) {
            let txnId = redeemStatus['transactionid'];
            logger.info(`Creating payout for user:  ${userId} and txnId ${txnId}`);
            var payoutObj = { 'txnid': txnId, 'amount': redeemStatus['amount'], name: _user.displayname || 'user', mobile: _user.mobile };
            let [pErrN, poResN] = await to(CommonController.createPayout(payoutObj));
            if (pErrN) throw pErrN;

            if (poResN['status'] == 'ERROR') {
                return ReE(res, poResN['message'], 500);
            }

            [err, _redreemReq] = await to(User.updateRedeemRequests({ id: redeemStatus['id'], transactionid: txnId, 'link': poResN['data']['cashgramLink'], 'refid': poResN['data']['referenceId'] }));
            if (err) throw err;

            return ReS(res, {
                'redeem': _redreemReq[0]
            });

        } else {
            return ReS(res, { redeem: null });
        }
    } catch (err) {
        next(err);
    }
}

async function getAndUpdatePGPayoutStatus(redeem) {
    let err, statusData, _redreemReqs, resData;
    let statusDataRedisKey = `pg_payout_status_${redeem['id']}`;
    let cachedData = await redisCaching.getKey(statusDataRedisKey);
    if (cachedData) {
        statusData = JSON.parse(cachedData);
    } else {
        await CommonController.getCashFreeAccessToken();
        [err, resData] = await to(CommonController.getPayoutStatusInCG(redeem['transferid']));
        logger.info(`[getAndUpdatePGPayoutStatus] redeem id : ${redeem['id']}  cashfree payout status data: ${JSON.stringify(resData)}`);
        if (err) {
            logger.info(`[getAndUpdatePGPayoutStatus] getting status from cashfree, error: ${err.message}`);
            logger.error(err);
        }
        var updateRData = Object.assign({}, { id: redeem['id'], pgstatus: resData?.data?.transfer?.status, pgacknowledged: !!resData?.data?.transfer?.acknowledged });
        [err, _redreemReqs] = await to(User.updateRedeemRequests(updateRData));
        if (err) {
            logger.info(`[getAndUpdatePGPayoutStatus] updating redeem, error: ${err.message}`);
            logger.error(err);
        }
        statusData = resData['data']['transfer'];
        await redisCaching.setKey(statusDataRedisKey, JSON.stringify(statusData), 15 * 60);
    }
    return statusData;
}

async function getPayoutStatusTripleA(redeem) {
    let statusData = {};
    if (redeem['pgstatus'] == 'done') {
        statusData['status'] = 'C'
        statusData['msg'] = `Your last withdrawal of ${redeem['amount'].toFixed(2)} has been successfully processed.`;
    } else if (redeem['pgstatus'] == 'confirm') {
        statusData['status'] = 'C'
        statusData['msg'] = `Your last withdrawal of ${redeem['amount'].toFixed(2)} has been successfully processed.`;
    } else {
        statusData['status'] = 'A'
        statusData['msg'] = `Your withdrawal of ${redeem['amount'].toFixed(2)} is in processing. Funds will be credited to your account within 48 hours`;
    }
    return statusData;
}

async function getPayoutStatusPG(redeem, translator) {
    let statusData = {};
    if (redeem['pg'] == 'triplea') {
        statusData = await getPayoutStatusTripleA(redeem);
        return statusData;
    }
    if (redeem['pgstatus'] == 'SUCCESS' && redeem['pgacknowledged']) {
        statusData['status'] = 'C'
        statusData['msg'] = translator(`Your last withdrawal of {{amount}} has been successfully processed.`, { 'amount': redeem['amount'].toFixed(2) });
    } else if (['REVERSED', 'FAILED', 'REJECTED'].includes(redeem['pgstatus'])) {
        statusData['status'] = 'A'
        statusData['msg'] = translator(`Your withdrawal of {{amount}} is in processing. Funds will be credited to your account within 48 hours`, { 'amount': redeem['amount'].toFixed(2) });
    } else if (redeem['transferid']) {
        const pgStatusData = await getAndUpdatePGPayoutStatus(redeem);
        switch (pgStatusData['status']) {
            case 'PENDING':
                statusData['status'] = 'A'
                statusData['msg'] = translator(`Your withdrawal of {{amount}} is in processing. Funds will be credited to your account within 48 hours`, { 'amount': redeem['amount'].toFixed(2) });
                break;
            case 'SUCCESS':
                if (!pgStatusData['acknowledged']) {
                    statusData['status'] = 'A'
                    statusData['msg'] = translator(`Your withdrawal of {{amount}} is in processing. Funds will be credited to your account within 48 hours`, { 'amount': redeem['amount'].toFixed(2) });
                } else {
                    statusData['status'] = 'C'
                    statusData['msg'] = translator(`Your last withdrawal of {{amount}} has been successfully processed.`, { 'amount': redeem['amount'].toFixed(2) });
                }
                break;
            default:
                statusData['status'] = 'A'
                statusData['msg'] = translator(`Your withdrawal of {{amount}} is in processing. Funds will be credited to your account within 48 hours`, { 'amount': redeem['amount'].toFixed(2) });
                break;
        }
    } else {
        statusData['status'] = 'A'
        statusData['msg'] = translator(`Your withdrawal of {{amount}} is in processing. Funds will be credited to your account within 48 hours`, { 'amount': redeem['amount'].toFixed(2) });
    }
    return statusData;
}

const getLastPaymentStatus = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    if (req.baseUrl.includes('v1')) {
        return ReE(res, messages.TRADING_NOT_ALLOWED, 405);
    }
    let err, lastRecharge = null, lastredeem = null, lastrecharge = null, lastRedeem, _user = req.user;
    const userId = _user.id;
    const platform = req.headers['x-platform'];
    try {
        let paymentStatus = [];
        let region = req.user.region || 'INDIA';
        const language = req?.user?.id !== -1 ? req?.user?.preferred_locale : 'en-IN';
        const translator = await localesService.getTranslator(language, 'wallet');
        if (req.user.kycstatus !== 'C' && region === 'INDIA' && platform === 'web') {
            return ReS(res, {
                'paymentStatus': [{
                    status: 'A',
                    message: translator('Please complete your KYC first in order to enjoy seamless trading experience'),
                    title: translator('KYC Pending')
                }]
            })
        }
        let kycstatus = {};
        [err, lastRedeem] = await to(User.getRedeemStatus({ 'userid': userId, status: ['A', 'C', 'CAN'], limit: 1 }));
        if (err) throw err;

        [err, lastRecharge] = await to(User.getLastPayment({ 'userid': userId }));
        if (err) throw err;

        if (region == 'INDIA' && platform === 'web') {

            let [errb, bankdetails] = await to(User.getBankDetails(userId));
            if (errb) {
                throw (errb)
            }
            if (typeof bankdetails === 'undefined' || typeof bankdetails.rp_fundid === 'undefined') {
                kycstatus = {
                    status: 'A',
                    message: translator('Please add a bank account first in order to request a withdrawal'),
                    title: translator('No Bank Account Found')
                };
            } else {
                kycstatus = {
                    status: 'C',
                    message: translator('Congratulations! Your account has been verified & you can now withdraw your profit instantly'),
                    title: translator('KYC Successful')
                };
            }
            let panDetails;
            const whereObj = { userid: userId, partner: parseInt(req.user.partner.id || 1) };
            [err, panDetails] = await to(User.findPanCard(whereObj));
            if (err) throw err;
            kycstatus['date'] = panDetails?.['createdat'];
            paymentStatus.push(kycstatus);
        }



        if (lastRedeem.length > 0 && differenceInCalendarDays(new Date(), lastRedeem[0]['updatedat']) < 7) {
            lastredeem = Object.assign({ 'status': lastRedeem[0]['status'] });
            lastredeem['date'] = lastRedeem[0]['updatedat'];
            if (lastredeem['status'] == 'C') {
                const pgStatusData = await getPayoutStatusPG(lastRedeem[0], translator);
                lastredeem['status'] = pgStatusData['status'];
                lastredeem['msg'] = pgStatusData['msg'];
                lastredeem['message'] = pgStatusData['msg'];
                lastredeem['title'] = translator('Withdrawal Successful');
            } else if (lastredeem['status'] == 'A') {
                lastredeem['msg'] = translator(`Your withdrawal of {{amount}} is in processing. Funds will be credited to your account within 48 hours`, { 'amount': lastRedeem[0]['amount'].toFixed(2) });
                lastredeem['message'] = translator(`Your withdrawal of {{amount}} is in processing. Funds will be credited to your account within 48 hours`, { 'amount': lastRedeem[0]['amount'].toFixed(2) });
                lastredeem['title'] = translator('Withdrawal Pending');
            } else if (lastredeem['status'] == 'CAN') {
                lastredeem['msg'] = translator(`Your previous withdrawal request of {{amount}} has failed. Our support team can assist with your queries`, { 'amount': lastRedeem[0]['amount'].toFixed(2) });
                lastredeem['message'] = translator(`Your previous withdrawal request of {{amount}} has failed. Our support team can assist with your queries`, { 'amount': lastRedeem[0]['amount'].toFixed(2) });
                lastredeem['title'] = translator('Withdraw Failed');
            }
            paymentStatus.push(lastredeem);
        }

        if (lastRecharge && differenceInCalendarDays(new Date(), lastRecharge['createdat']) < 7) {
            let currentTime = new Date();
            let lastRechargeCreatedAt = new Date(lastRecharge['createdat']);
            const timeDifferenceInMinutes = Math.floor((currentTime - lastRechargeCreatedAt) / (1000 * 60));
            if (!lastRecharge['paymentid'] && timeDifferenceInMinutes <= 10) {
                lastRecharge['status'] = 'A';
            } else if (!lastRecharge['paymentid']) {
                lastRecharge['status'] = 'CAN';
            }
            else lastRecharge['status'] = 'C';
            lastrecharge = Object.assign({ 'status': lastRecharge['status'] });
            lastrecharge['date'] = lastRecharge['createdat'];
            if (lastrecharge['status'] == 'C') {
                lastrecharge['msg'] = translator(`Your last recharge of {{amount}} has been successfully processed.`, { 'amount': lastRecharge['amount'].toFixed(2) });
                lastrecharge['message'] = translator(`Your last recharge of {{amount}} has been successfully processed.`, { 'amount': lastRecharge['amount'].toFixed(2) });
                lastrecharge['title'] = translator('Deposit Successful');
            } else if (lastrecharge['status'] == 'CAN') {
                lastrecharge['msg'] = translator(`Previous recharge request of {{amount}} has failed. Any deducted amount will be refunded within next 3-4 working days.`, { 'amount': lastRecharge['amount'].toFixed(2) });
                lastrecharge['message'] = translator(`Previous recharge request of {{amount}} has failed. Any deducted amount will be refunded within next 3-4 working days.`, { 'amount': lastRecharge['amount'].toFixed(2) });
                lastrecharge['title'] = translator('Deposit Failed');
            } else if (lastrecharge['status'] == 'A') {
                lastrecharge['msg'] = translator(`Previous recharge request of {{amount}} is in progress.`, { 'amount': lastRecharge['amount'].toFixed(2) });
                lastrecharge['message'] = translator(`Previous recharge request of {{amount}} is in progress.`, { 'amount': lastRecharge['amount'].toFixed(2) });
                lastrecharge['title'] = translator('Deposit In Progress');
            }
            paymentStatus.push(lastrecharge);
        }

        if (paymentStatus.length > 0) {
            paymentStatus.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        }

        const response = { paymentStatus: paymentStatus };
        return ReS(res, response);


    } catch (err) {
        next(err);
    }
}

const getUsers = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    if (!isDashboardUser(req)) {
        res.writeStatus("401");
        return ReS(res, {
            success: true, msg: 'Unauthorized request, incident has been reported'
        });
    }
    try {
        // const userId = req.params.id;
        let err, users;
        var dataObj = req.body;
        let _usersObj;
        [err, _usersObj] = await to(User.getUsers(dataObj));
        if (err) throw err;
        users = _usersObj.rows;
        return ReS(res, {
            users: users, total: _usersObj.total
        });
    } catch (err) {
        next(err);
    }
}

const getAddress = ws => {
    try {
        const arrayBufferToString = arrBuf => Buffer.from(arrBuf).toString('utf8')
        const address = arrayBufferToString(ws.getRemoteAddressAsText())
        return address;
    } catch (e) {
        console.log('[Get Address Error]', e.message)
        return 'No Address Found'
    }
}

const couponValidate = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    try {
        const ip = getAddress(res);
        const rateLimitterKey = `rate_limit_coupon_validate_${ip}`;
        const partnerId = Number(req.headers['x-partner-id']) || 1;
        const signup_country = req.body.signup_country || 'IN';
        let count = await redisCaching.getKey(rateLimitterKey);
        if (count && count > 5) {
            var resObj = { 'isvalid': false, 'amount': 0, 'userid': -1, 'message': 'Maximum attempts reached, please try again after 30 seconds.' };
            return ReS(res, resObj);
        } else {
            count = count ? parseInt(count) : 0
        }
        var err, users, dataObj = { 'coupon': req.body.coupon };
        [err, users] = await to(User.getFrom('users', dataObj));
        if (err) throw err;
        let isValid = false;
        var resObj = { 'isvalid': false, 'amount': 0, 'userid': -1, 'message': 'Please enter valid code' };
        if (users.length > 0 && partnerId == 1) {
            if ((users[0].signup_country == 'IN' && signup_country == 'IN') || (users[0].signup_country !== 'IN' && signup_country !== 'IN')) {
                isValid = true;
            }
            if (isValid) {
                resObj['isvalid'] = true;
                resObj['amount'] = 50;
                resObj['userid'] = users[0].id;
                resObj['message'] = 'Code has been successfully applied';
            }
        }
        await redisCaching.setKey(rateLimitterKey, count + 1, 30);
        return ReS(res, resObj);
    } catch (err) {
        next(err);
    }
}

const customCouponValidate = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');

    try {
        const platform = req.headers['x-platform'];
        const version = parseInt(req.headers['version']);

        const language = req?.user?.preferred_locale ?? 'en-IN';
        const translator = await localesService.getTranslator(language, 'wallet');

        var err, res, resAppliedCoupons, couponcode = req.body.couponcode.trim();
        let amount = req.body.amount;
        let userid = req.user.id;
        const partnerId = parseInt(req.user.partner?.id || 1);
        if (partnerId !== 1) {
            return ReS(res, { 'success': false, 'msg': translator('Not Allowed') });
        }
        let couponAppliedOnAmount = Number(req?.body?.amount);
        if (req.user.region !== 'INDIA') {
            const fromCurrency = getCurrency(req?.user?.signup_country, platform, version);
            const exchangeRate = await getExchangeRate(fromCurrency, 'INR');
            couponAppliedOnAmount = parseFloat(exchangeRate?.value) * couponAppliedOnAmount;
        }
        console.log(couponAppliedOnAmount)
        let resvalidcouponcode = await isCouponValid(couponcode, userid, couponAppliedOnAmount, req.user.region);

        if (resvalidcouponcode.success == true) {
            return ReS(res, { 'success': true, msg: resvalidcouponcode.msg, applied_msg: resvalidcouponcode.applied_msg });
        }
        else {
            return ReS(res, { 'success': false, 'msg': translator(resvalidcouponcode.msg, resvalidcouponcode?.msgParams ?? null) });
        }

    } catch (err) {
        next(err);
    }
}

const getAvailableCoupons = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    try {
        let err, resObj;
        const region = req.user.region;
        var dataObj = { 'region': region, 'isactive': true };

        [err, resObj] = await to(User.getActiveFromCouponConfig(dataObj));
        if (err) throw err;

        const modifiedResObj = resObj.map(obj => ({ ...obj, offer: obj.alternate_title }));


        return ReS(res, { 'coupons': modifiedResObj });


    } catch (err) {
        next(err);
    }
}

const isCouponValid = async (couponcode, userid, amount, region = 'INDIA') => {

    var err, res, resAppliedCoupons, logString;
    console.log(`logString - user params - {userid : ${userid}, amount : ${amount}, couponcode : ${couponcode}} `);
    try {
        var dataObj = { 'couponcode': couponcode, region: region };

        [err, res] = await to(User.getFromCouponConfig('couponconfig', dataObj));
        if (err) throw err;

        if (!res || res.length == 0) {
            console.log(`logString - error : Invalid Promo Code, couponcode : ${couponcode}, userid : ${userid} `);
            return { 'success': false, 'msg': 'Invalid Promo Code.' };
        }

        if (!(res[0].isactive)) {
            console.log(`logString - error : Not Active, couponcode : ${couponcode}, userid : ${userid} `);
            return { 'success': false, 'msg': 'Coupon Code no longer active.' };
        }
        if (res[0].min_recharge_amount > amount) {
            console.log(`logString - error : MRA exceeding, couponcode : ${couponcode}, userid : ${userid} `);
            let mra = res[0].min_recharge_amount;
            if (region !== 'INDIA') {
                const fromCurrency = process.env.NODE_ENV !== 'production' ? 'BTC' : 'USDT';
                const exchangeRate = await getExchangeRate(fromCurrency, 'INR');
                mra = (mra / parseFloat(exchangeRate?.value)).toFixed(2).toString() + ` ${fromCurrency}`;
                return { 'success': false, 'msg': `Coupon not valid for entered recharge amount` };
            }
            return { 'success': false, 'msg': `Coupon only valid for minimum recharge amount of {{mra}}`, 'msgParams': { 'mra': mra } };
        }
        if (moment(res[0].end_date).isBefore(moment())) {
            return { 'success': false, 'msg': `This coupon code has expired` };
        }
        if (moment(res[0].start_date).isAfter(moment())) {
            return { 'success': false, 'msg': `Invalid Promo Code` };
        }
        if (region.toLowerCase() !== res[0].region.toLowerCase()) {
            return { 'success': false, 'msg': `Invalid Promo Code` };
        }

        console.log(`logString - coupon params - {mra : ${res[0].min_recharge_amount}} `);

        let couponsCap = CONFIG.couponsCap;
        [err, resAppliedCoupons] = await to(User.getAppliedCouponForUser(dataObj['couponcode'], userid));
        if (err) throw err;

        console.log(`logString -resAppliedCouponsLength ${resAppliedCoupons.length}, userid : ${userid} ${couponcode}`);

        if (res[0].type === 'FR') {
            const [err1, depositDetails] = await to(User.getDepositedAmountByUserId(userid));
            if (err1) {
                logger.error(JSON.stringify(err1));
                throw err1;
            }
            if (depositDetails && (depositDetails.total_deposit > 0)) {
                console.log(`logString - error : Only Valid for first time recharge, couponcode : ${couponcode}, userid : ${userid} `);
                return { 'success': false, 'msg': `This Coupon is only valid for first time recharge` };
            } else {
                console.log(`logString - depositdetails ${depositDetails.total_deposit}, userid : ${userid}`);
            }
            const [err2, depositDetailsArchive] = await to(User.getDepositedAmountByUserIdArchive(userid));
            if (err2) {
                logger.error(JSON.stringify(err2));
                throw err2;
            }
            if (depositDetailsArchive && (depositDetailsArchive.total_deposit > 0)) {
                return { 'success': false, 'msg': `This Coupon is only valid for first time recharge` };
            } else {
                console.log(`logString -depositdetailsArchive ${depositDetailsArchive.total_deposit}, userid : ${userid} ${couponcode}`);
            }
        }
        if (res[0].type === 'OT') {
            if (resAppliedCoupons.length > 0) {
                console.log(`logString - error :  One Time coupon code, userid : ${userid}`);
                return { 'success': false, 'msg': `This is a one time Coupon` };
            }
        }
        if (res[0].type === 'MT') {
            if (resAppliedCoupons.length > couponsCap) {
                console.log(`logString - error :  Multiple Time coupon code but exceeding limit ${couponsCap}, userid : ${userid} ${couponcode}`);
                return { 'success': false, 'msg': `You have exhausted your Promo code apply limit` };
            }
        }
        console.log(`logString - coupon successfully applied, userid : ${userid}, ${couponcode}`);
        const couponAmount = res[0].value;
        const msg = `You will get ${couponAmount} Tokens`;
        const applied_msg = `You will get ${couponAmount} Tokens\nwith '${couponcode}'`;
        return { 'success': true, 'aboutCode': res[0], msg, applied_msg };
    }
    catch (err) {
        throw err;
    }
}

const updateUser = async function (req, res, next) {

    try {
        const platform = req.headers['x-platform'];
        const region = req.user.region || 'INDIA';
        const partnerId = parseInt(req.user.partner?.id || 1);
        const body = req.body;
        let currentData, ress, err, _userRows, userId = req.user.id;
        const language = req?.user?.preferred_locale ?? 'en-IN';
        const translator = await localesService.getTranslator(language, 'profile');

        // if (body.pincode && region == 'INDIA') {
        //     let err, response;

        //     [err, response] = await to(getPinCodeDetails(body.pincode));
        //     if (err) throw err;

        //     let responseData;
        //     if (response.data) {
        //         responseData = response.data;
        //     } else {
        //         return ReE(res, { success: false, message: translator('Postal Code API not working') });
        //     }
        //     if (responseData[0]['Status'] == 'Success') {
        //         const str = responseData[0]['PostOffice'][0]['State'];
        //         const arr = [];
        //         if (arr.indexOf(str) > -1) {
        //             return ReE(res, translator('Trading is not allowed in this region'), 422);
        //         }
        //     } else {
        //         return ReE(res, translator('The Pin Code entered is not valid'), 422);
        //     }
        // }

        if (body.dob) {
            const dobarray = body.dob.split("-");
            if (dobarray.length != 3) {
                return ReE(res, translator('Enter the correct date of birth format'), 422);
            }
            var year = Number(dobarray[2]);
            var month = Number(dobarray[1]) - 1;
            var day = Number(dobarray[0]);
            var today = new Date();
            var age = today.getFullYear() - year;
            if (today.getMonth() < month || (today.getMonth() == month && today.getDate() < day)) {
                age--;
            }
            if (age < 18) {
                return ReE(res, translator('You must be above 18 to trade on this platform'), 422);
            }
        }

        // let dataObj = { displayname: req.body.displayname, email: req.body.email, avatar: req.body.filepath, userid: userId };
        let dataObj = { userid: userId, 'avatar': req.body.filepath };

        let isChange = dataObj.avatar;
        let keys = ['displayname', 'email', 'ageconsent', 'howItWorks', 'dob', 'pincode', 'preferred_locale', 'signup_country'];
        for (let k of keys) {
            if (req.body[k]) {
                isChange = true;
                if (k === 'howItWorks') dataObj['howitworks'] = req.body['howItWorks'];
                else dataObj[k] = req.body[k];
                if(k === 'signup_country'){
                    dataObj['kycstatus'] = (req.body['signup_country'] == 'IN' || req.body['signup_country'] == 'CA') ? 'I' : 'C';
                }
            }
        }

        var re = /^[a-zA-Z ]+$/;
        if (!re.test(dataObj.displayname)) {
            return ReE(res, translator('Name can only have Characters and Spaces'), 422);
        }

        if (dataObj.email) {
            const respData = await verifyEmailId(userId, dataObj.email, partnerId);
            if (!respData.success) {
                return ReE(res, respData.msg, 422);
            }
        }

        [err, currentData] = await to(User.findById(userId));
        if (err) throw err;

        if (body.email && currentData.isEmailVerified && currentData.email !== body.email) {
            return ReE(res, translator('Email-id cannot be change after verification'), 422);
        }
        if (body.email && currentData.email !== body.email) {

            let isEmailVerifiedUpdate = partnerId == 1 ? false : true;
            [err, ress] = await to(User.updateEmailVerified(currentData.email, userId, isEmailVerifiedUpdate));
            if (err) throw err;

        };
        let emailPre = false, sendMail = false;
        if (typeof body.emailNotifications === 'boolean') {
            const preference = {
                userid: userId,
                preference_type: 'email',
                preference_value: body.emailNotifications ? body.emailNotifications : false,
                preference_data_type: 'boolean'
            };

            const whereObj = {
                userid: userId,
                preference_type: 'email'
            };

            [err, ress] = await to(User.updatePreferenceTable(whereObj, preference));
            if (err) throw err;

            ress = ress[0];
            emailPre = ress.preference_value === 'true' ? true : false;
            currentData['emailNotifications'] = emailPre;
            if (emailPre) {
                sendMail = true;
            }

        } else {
            let pObj;
            [err, pObj] = await to(User.getPreferenceEmail({ userid: userId, preference_type: 'email' }));
            if (err) throw err;
            emailPre = (pObj[0] && pObj[0].preference_value === 'true') ? true : false;
            currentData['emailNotifications'] = emailPre;
        }

        if (isChange) {
            [err, _userRows] = await to(User.update(dataObj, true));
            if (err) throw err;
        } else {
            return ReS(res, {
                success: true, user: currentData
            });
        }

        if (sendMail) {
            const welcome_string = Object.keys(dataObj).includes('displayname') && dataObj.displayname ? `Hey ${dataObj.displayname},` : ``;
            const dynamic_template_data = {
                welcome_string: welcome_string
            }
            const mailObject = {
                to: dataObj.email,
                subject: `Welcome to the ${req.partner.name}!`,
                dynamic_template_data: dynamic_template_data
            }
            sendEmail(mailObject);
        }

        _userRows[0]['emailNotifications'] = emailPre;

        //capture deviceuuid
        if (platform == 'ios' || platform == 'android') {
            let deviceuuid = req.body.deviceuuid;

            if (deviceuuid) {
                [err, deviceIdInfo] = await to(User.getFromDeviceId({ 'userid': userId, 'deviceuuid': deviceuuid }));
                if (err) throw err;

                if (deviceIdInfo.length == 0) {
                    [err, deviceIdInfo] = await to(User.addToDeviceId({ 'userid': userId, 'deviceuuid': deviceuuid }));
                    if (err) throw err;
                }
            }
        }
        if (req?.body?.referral_code){
            const luckycoinsconfig = await PartnerService.getPartnerServiceConfiguration(
                "luckyCoins",
                req.user
            );
            if (req?.body?.signup_country) req.user.signup_country = req?.body?.signup_country;
            const apply_coupon = await UserService.processCoupon(req.body.referral_code, req.user, luckycoinsconfig);
        }

        await updateUserRewardFlow(req.user);

        return ReS(res, {
            user: {
                ..._userRows[0],
                userid: _userRows[0]['id']
            }
        });
    } catch (err) {
        console.log('[updateUser error]', err);
        next(err);
    }

}

const addKyc = async function (req, res, next) {

    try {
        const body = req.body;
        let err, _userRows, userId = req.user.id;

        let dataObj = { name: req.body.name, number: req.body.number, photo: req.body.filepath, dob: req.body.dob, userid: userId };

        // var re = /^[a-zA-Z ]+$/;
        // if (!re.test(dataObj.name)) {
        //     return ReE(res, 'Name can only have Characters and Spaces', 422);
        // }
        [err, _userRows] = await to(User.addKyc(dataObj));
        if (err) throw err;

        logger.info(`User: ${userId}: KYC submitted`);

        return ReS(res, {
            user: _userRows[0]
        });
    } catch (err) {
        next(err);
    }

}
const verifyOTP = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    next();
}

const verifyOTPLogic = async function (req, res, userId = null) {
    // res.setHeader('Content-Type', 'application/json');
    const platform = req.headers['x-platform'];
    const partnerId = Number(req.headers['x-partner-id']) || 1;
    if (!req.body['country_code']) {
        req.body['country_code'] = '+91';
    }
    var data = req.body;
    data.mobile = String(parseInt(data?.mobile, 10));
    const reqKey = `request_otp_${data['mobile']}`;
    const unlock = await lock(reqKey, 300000);
    try {
        let err, users, tempUsers, deviceIdInfo;
        var dataObj = { 'mobile': data['mobile'], 'country_code': data['country_code'], 'partner': partnerId };

        const respData = await verifyMobileNumber(data['mobile']);
        if (!respData.success) {
            unlock();
            return ReE(res, {
                verified: false, msg: respData.msg, errorCode: CONFIG.LOGINERRORCODE.INVALIDMOBILE
            }, 422);
        }
        if (data['mobile'].startsWith("+91")) {
            dataObj['mobile'] = data['mobile'].substring(3);
        }

        [err, users] = await to(User.getTemp(dataObj));
        if (err) throw err;


        if (users.length == 0) {
            unlock();
            return ReE(res, {
                verified: false, msg: 'Please enter valid OTP', errorCode: CONFIG.LOGINERRORCODE.RETRY
            }, 422);
        }
        const attempt = users[0].attempt;
        const resent = users[0].otpsend;

        const retryLimit = CONFIG.LOGINERRORCODE.RETRYLIMIT;
        const resendLimit = CONFIG.LOGINERRORCODE.RESENDLIMIT;

        [err, tempUsers] = await to(User.updateTemp(dataObj, { attempt: attempt + 1 }, partnerId));
        if (err) throw err;

        if (resent < resendLimit && attempt + 1 >= retryLimit) {
            unlock();
            return ReE(res, {
                verified: false, msg: 'OTP has been disabled. Please request new OTP.', errorCode: CONFIG.LOGINERRORCODE.OTPDISABLED
            }, 422);
        }

        const otpGenerateTime = new Date(users[0].createdat);
        const currentTime = new Date();
        const diff = ((currentTime - otpGenerateTime) / (1000 * 60));   //minutes
        const OTPValidity = CONFIG.LOGINERRORCODE.OTPVALIDITY;
        const blockDuration = CONFIG.LOGINERRORCODE.BLOCKDURATION;  // In minutes
        let blockedTimeRemaining = blockDuration - ((currentTime - otpGenerateTime) / (1000 * 60));   //block for 30 minutes

        if (resent >= resendLimit && attempt + 1 >= retryLimit && blockedTimeRemaining > 0) {   // attempt and retry limit crossed , block for 30 min
            blockedTimeRemaining = parseInt(blockedTimeRemaining);
            unlock();
            return ReE(res, {
                verified: false, msg: `You have exceeded the max no. of attempts. Please try again later.`, errorCode: CONFIG.LOGINERRORCODE.BLOCKED
            }, 422);

        }

        if (diff >= OTPValidity) {
            unlock();
            return ReE(res, {
                verified: false, msg: `OTP has expired. Please request new OTP.`, errorCode: CONFIG.LOGINERRORCODE.OTPEXPIRE
            }, 422);
        }

        if (data['otp'] != users[0].otp) {
            unlock();
            return ReE(res, {
                verified: false, msg: 'Please enter valid OTP', errorCode: CONFIG.LOGINERRORCODE.RETRY
            }, 422);
        }

        if (data['otp'] == users[0].otp) {
            [err, tempUsers] = await to(User.updateTemp(dataObj, { verified: true }, partnerId));
            if (err) throw err;

            if (req?.user?.id !== -1 && (!req.user.is_mobile_verified || !req.user.mobile)){
                let updateuser, _msgRows, signup_country;
                let updateObj = { userid: req?.user?.id, mobile: dataObj['mobile'], mobile_code : dataObj['country_code'], is_mobile_verified : true};
                [err, _msgRows] = await to(User.getIsoFromCountryCode({ "country_code": dataObj['country_code'] }));
                if (err) throw err;
        
                if (_msgRows.length > 0 && _msgRows[0]['is_enabled'] == true) {
                    signup_country = _msgRows[0]['iso_code'];
                    updateObj['signup_country'] = signup_country;
                }
                
                [err, updateuser] = await to(User.update(updateObj, true));
                if (err) throw err;

                let level_id = UserService.getLevelPartnerCountry(signup_country, parseInt(req?.user?.partner?.id ?? 1));
                let update_level = await Level.updateUserLevel(req?.user?.id, level_id);
                await updateUserRewardFlow(req.user);

            }

            //capture deviceuuid
            if (platform == 'ios' || platform == 'android') {
                let deviceuuid = req.body.deviceuuid;
                if (deviceuuid) {
                    let whereCond = { mobile: data['mobile'] };
                    [err, _userRows] = await to(User.get('users', whereCond));
                    if (err) throw err;

                    if (_userRows.length !== 0) {
                        let userId = _userRows[0].id;

                        [err, deviceIdInfo] = await to(User.getFromDeviceId({ 'userid': userId, 'deviceuuid': deviceuuid }));
                        if (err) throw err;

                        if (deviceIdInfo.length == 0) {
                            [err, deviceIdInfo] = await to(User.addToDeviceId({ 'userid': userId, 'deviceuuid': deviceuuid }));
                            if (err) throw err;
                        }
                    }
                }
            }
            let insertLoc;
            let whereCondition = { mobile: data['mobile'], partner: partnerId };
            [err, _userRows] = await to(User.get('users', whereCondition));
            if (err) throw err;

            if (_userRows.length !== 0) {
                //insert in users_ip
                const ip = req.headers['x-forwarded-for'];
                var geo = geoip.lookup(ip);
                if (geo) {
                    [err, insertLoc] = await to(User.addToUsersIp({ 'userid': _userRows[0].id, 'ip': ip, 'location': geo['region'] + ', ' + geo['country'] }));
                    if (err) throw err;
                }
            }

            // if( userId ) {
            //     let[err, user] = await to(User.findById(userId, true));
            //     let resp = await to(User.updateMobileVerified(dataObj['mobile'], data['country_code'], userId,true));
            //
            //     const whereCond = { mobile: dataObj['mobile'], 'partner': partnerId };
            //     let[errDel, userDel] = await to(User.deleteTempUser(whereCond));
            // }

            // f
            let disclaimerInfo = data['country_code'] === "+91" ? "I acknowledge that I am not a resident of either Andhra Pradesh, Assam, Nagaland, Odisha, Sikkim or Telangana." : "I certify that I am over 18 years, and have read, understood the\nabove mentioned information.";
            unlock();
            return ReS(res, {
                verified: true, msg: 'OTP has been verified successfully', disclaimerInfo: disclaimerInfo
            });
        }
        unlock();
        return ReE(res, {
            verified: false, msg: 'Please enter valid OTP', errorCode: CONFIG.LOGINERRORCODE.RETRY
        }, 422);

    } catch (err) {
        console.log(err)
        unlock();
        next(err);
    } finally {
        unlock();
    }
}

const addMobileInfo = async function (req, res, next) {
    var userId = req.user.id;
    if (!req.body['country_code']) {
        req.body['country_code'] = '+91';
    }
    var data = req.body;
    const reqKey = `request_mobile_${data['mobile']}`;
    const unlock = await lock(reqKey, 300000);
    try {
        var dataObj = { 'mobile': data['mobile'], 'country_code': data['country_code'] };

        const respData = await verifyMobileNumber(data['mobile']);
        if (!respData.success) {
            unlock();
            return ReE(res, {
                verified: false, msg: respData.msg, errorCode: CONFIG.LOGINERRORCODE.INVALIDMOBILE
            }, 422);
        }
        let [errUser, user] = await to(User.findById(userId, true));
        let resp = await to(User.updateMobileVerified(dataObj['mobile'], dataObj['country_code'], userId, true));

        unlock();
        return ReS(res, {
            success: true, msg: 'Mobile added successfully.'
        });

    } catch (err) {
        console.log(err)
        unlock();
        next(err);
    } finally {
        unlock();
    }
}

const verifyMobileOtp = async function (req, res, next) {
    var userId = req.user.id;
    return verifyOTPLogic(req, res, userId);
}

const verifyOTPnew = async function (req, res, next) {
    return verifyOTPLogic(req, res);
}

const verifyOTPEmail = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');

    try {
        let err, users, ress;
        var data = req.body;
        var userId = req.user.id;
        const partnerId = parseInt(req.user.partner?.id || 1);
        var dataObj = { 'mobile': data['email'], 'partner': partnerId };
        const email = data['email'];
        if (req.user.id !== -1){
            const respData = await verifyEmailId(userId, email, partnerId);
            if (!respData.success) {
                return ReS(res, {
                    verified: false, success: false, msg: respData.msg, errorCode: CONFIG.LOGINERRORCODE.INVALIDMOBILE
                });
            }
        }
        [err, users] = await to(User.getTemp(dataObj));
        if (err) throw err;


        if (users.length == 0) {
            return ReS(res, {
                verified: false, msg: 'Incorrect OTP entered. Please enter valid OTP.', errorCode: CONFIG.LOGINERRORCODE.RETRY
            });
        }
        const attempt = users[0].attempt;
        const resent = users[0].otpsend;

        const retryLimit = CONFIG.LOGINERRORCODE.RETRYLIMIT;
        const resendLimit = CONFIG.LOGINERRORCODE.RESENDLIMIT;

        [err, tempUsers] = await to(User.updateTemp(dataObj, { attempt: attempt + 1 }, partnerId));
        if (err) throw err;

        if (resent < resendLimit && attempt + 1 >= retryLimit) {
            return ReS(res, {
                verified: false, msg: 'OTP has been disabled. Please request new OTP.', errorCode: CONFIG.LOGINERRORCODE.OTPDISABLED
            });
        }

        const otpGenerateTime = new Date(users[0].createdat);
        const currentTime = new Date();
        const diff = ((currentTime - otpGenerateTime) / (1000 * 60));   //minutes
        const OTPValidity = CONFIG.LOGINERRORCODE.OTPVALIDITY;
        const blockDuration = CONFIG.LOGINERRORCODE.BLOCKDURATION;  // In minutes
        let blockedTimeRemaining = blockDuration - ((currentTime - otpGenerateTime) / (1000 * 60));   //block for 30 minutes

        if (resent >= resendLimit && attempt + 1 >= retryLimit && blockedTimeRemaining > 0) {   // attempt and retry limit crossed , block for 30 min
            blockedTimeRemaining = parseInt(blockedTimeRemaining);
            return ReS(res, {
                verified: false, msg: `Account Disabled, Please try again after some time`, errorCode: CONFIG.LOGINERRORCODE.BLOCKED
            });

        }

        if (diff >= OTPValidity) {
            return ReS(res, {
                verified: false, msg: `OTP has expired. Please request new OTP.`, errorCode: CONFIG.LOGINERRORCODE.OTPEXPIRE
            });
        }

        if (data['otp'] != users[0].otp) {
            return ReS(res, {
                verified: false, msg: 'Incorrect OTP entered. Please enter valid OTP.', errorCode: CONFIG.LOGINERRORCODE.RETRY
            });
        }

        if (data['otp'] == users[0].otp) {
            [err, users] = await to(User.updateEmailVerified(dataObj.mobile, userId, true));
            if (err) throw err;

            const whereCond = { mobile: data['email'], 'partner': partnerId };
            if(req.user.id === -1){
                let tempUsers
                [err, tempUsers] = await to(User.updateTemp(whereCond, { verified: true }, partnerId));
                if (err) throw err;
                let disclaimerInfo = req.user.region === "INDIA" ? "I acknowledge that I am not a resident of either Andhra Pradesh, Assam, Nagaland, Odisha, Sikkim or Telangana." : "I certify that I am over 18 years, and have read, understood the\nabove mentioned information.";
                await updateUserRewardFlow(req.user);
                return ReS(res, {
                    verified: true, msg: 'OTP has been verified successfully', disclaimerInfo: disclaimerInfo
                });
            }

            [err, ress] = await to(User.deleteTempUser(whereCond));
            if (err) throw err;

            if(req.user.id !== -1){
                await updateUserRewardFlow(req.user);
            }

            return ReS(res, {
                verified: true, msg: 'OTP Verified'
            });
        }
        return ReS(res, {
            verified: false, msg: 'Incorrect OTP entered. Please enter valid OTP.', errorCode: CONFIG.LOGINERRORCODE.RETRY
        });

    } catch (err) {
        next(err);
    }

}

const authenticateEmail = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');

    try {
        let err, response, users;
        const partnerId = parseInt(req.user.partner?.id || 1);
        var userId = req.user.id;
        const token = req?.body?.token;
        if(!token){
            return ReS(res, {
                success: false, verified: false, msg: 'Verification failed'
            });
        }

        [err, response] = await to(googleAuth(token));
        if (err) throw err;

        const email = response?.data?.email;


        if (!response || response?.error || response?.response?.data?.error || response?.data?.error) {
            return ReS(res, {
                success: false, verified: false, msg: 'Verification failed'
            });
        } else if (email) {

            const respData = await verifyEmailId(userId, email, partnerId);
            if (!respData.success) {
                return ReS(res, {
                    verified: false, success: false, msg: respData.msg, errorCode: CONFIG.LOGINERRORCODE.INVALIDMOBILE
                });
            }

            [err, users] = await to(User.updateEmailVerified(email, userId, true));
            if (err) throw err;

            await updateUserRewardFlow(req.user);

            return ReS(res, {
                verified: true, msg: 'You have successfully verified your email!', user: users[0]
            });
        } else {
            return ReS(res, {
                success: false, verified: false, msg: 'Verification failed'
            });
        }

    } catch (err) {
        next(err);
    }
}

const verifyMobile = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');


    try {
        let mobile = req.body.mobile;
        const respData = await verifyMobileNumber(mobile);

        return ReS(res, respData);

    } catch (err) {
        next(err);
    }
}

const fetchRechargeAmount = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');

    try {
        var userId = req.user.id;
        let err, total;

        [err, total] = await to(Payments.getTotalRecharge(userId));
        if (err) throw err;

        if (total[0].total) {
            return ReS(res, total[0]);
        }
        return ReS(res, { 'total': 0 });

    } catch (err) {
        next(err);
    }
}

const createOrderCF = async function (req, res, next) {

    // res.setHeader('Content-Type', 'application/json');
    const version = parseInt(req.headers['version']);

    try {
        let err, tokenRes;
        let uid = getUID();
        let orderId = 'od_' + parseInt(uid).toString(32) + '_' + process.env.MACHINE_ID + '_' + threadId;
        const urlPrefix = CONFIG.serverURL;

        const user = req.user;
        const partnerId = parseInt(req.user.partner?.id || 1);


        // const _isProfileComplete = await isProfileComplete(user.id);
        // if (!_isProfileComplete) {
        //     return ReE(res, `Please Complete your profile first`, 403);
        // }


        let amount, couponcode;
        amount = Number(req.body.amount);
        couponcode = req.body.couponcode;


        // const _isEligibleToAdd = await isEligibleToAdd(user.id, amount);
        // if (!_isEligibleToAdd) {
        //     return ReE(res, `Your current deposit request exceed 1000 INR. Please try a lower amount or complete KYC to proceed.`, 402);
        // }
        let resvalidcouponcode;
        if (couponcode && couponcode !== "") {
            if (partnerId !== 1) {
                return ReS(res, { 'success': false, 'msg': 'Not allowed' });
            }
            resvalidcouponcode = await isCouponValid(couponcode, user.id, amount, req.user.region);

            if (resvalidcouponcode.success == true) {
                console.log('promo code applied successfully')
            }
            else {
                return ReS(res, { 'success': false, 'msg': resvalidcouponcode.msg });
            }
        }


        const dataObj = Object.assign({
            "order_id": orderId,
            "order_amount": req.body.amount,
            "order_currency": "INR",
            "return_url": `${urlPrefix}/about`,
            "notify_url": `${urlPrefix}/v2/payment/hook`,
            "customer_details": {
                "customer_id": user.id.toString(),
                "customer_email": user.email ? user.email : CONFIG.dummyCustomerEmailForPG,
                "customer_phone": user.mobile.toString()
            },
            "order_meta": {
                "return_url": `${urlPrefix}/about?cf_id={order_id}&cf_token={order_token}`,
                "notify_url": `${urlPrefix}/v2/payment/hook`
            }
        });
        console.log(dataObj);
        [err, tokenRes] = await to(CommonController.createOrderCF(dataObj));
        console.log(tokenRes);
        if (err) throw err;
        // computedSignature = tokenRes.data['cftoken'];

        var dataPObj = { 'amount': dataObj['order_amount'], orderid: orderId, userid: req.user.id };
        [err, pRows] = await to(User.addToPayments(dataPObj));

        if (couponcode && couponcode !== "") {
            var dataCObj = { 'userid': user.id, 'coupon': couponcode, 'type': resvalidcouponcode['aboutCode']['type'], 'orderid': orderId, 'isexecuted': false };
            [err, _couponRows] = await to(User.addCoupon(dataCObj));
            if (err) throw err;
        }


        var redData = Object.assign({}, { 'payment_link': tokenRes['data']['payment_link'] });

        return ReS(res, redData);

    } catch (err) {
        next(err);
    }

}
const createOrderJP = async function (req, res, next) {

    const version = parseInt(req.headers['version']);
    const platform = req.headers['x-platform'];

    if (version <= 1060 && platform !== 'web') {
        next();
    }
    if ( CONFIG.KOSTAR_BLOCKED_USERS.includes(req.user.id) ) {
        return ReE(res, "User not allowed to Deposit.", 400);
    }
    const reqKey = `payment_process_${req.user.id}`;
    try {
        console.log(req.body);
        let err;
        let uid = getUID();
        let orderId = 'od_' + parseInt(uid).toString(32) + '_' + process.env.MACHINE_ID + '_' + threadId;
        const user = req.user;
        const partnerId = parseInt(req.user.partner?.id || 1);
        if ( partnerId === 4 ) {
            return ReE(res, "Deposits are blocked for this application", 400);
        }
        let fromCurrency = req?.body?.currency ?? getCurrency(req?.user?.signup_country, platform, version, req?.body?.pg);

        const unlock = await lock(`payment_serial_${user.id}`);
        let isReqInProgress = await redisCaching.getKey(reqKey);
        if (isReqInProgress) {
            return ReE(res, `Your request already in progress`, 423);
        }
        await redisCaching.setKey(reqKey, true, 60);
        unlock();

        let couponcode = partnerId == 1 ? req.body.couponcode : undefined;

        let amountToCheck = Number(req?.body?.amount);
        let maxDeposit = Number(req?.user?.config?.maxDeposit);
        let minDeposit = Number(req?.user?.config?.minDeposit);
        if (req.user.region !== 'INDIA') {
            const exchangeRateINR = await getExchangeRate(fromCurrency, 'INR');
            amountToCheck = parseFloat(exchangeRateINR?.value) * amountToCheck;
            console.log(amountToCheck);
        }
        if (maxDeposit < amountToCheck || minDeposit > amountToCheck) {
            let maxDepositToDisplay = maxDeposit, minDepositToDisplay = minDeposit;
            if (req.user.region !== 'INDIA') {
                const exchangeRate = await getExchangeRate(fromCurrency, 'INR');
                maxDepositToDisplay = maxDeposit / parseFloat(exchangeRate?.value);
                minDepositToDisplay = minDeposit / parseFloat(exchangeRate?.value);
            }
            let msg = (maxDeposit < amountToCheck) ? `Max Deposit Per Transaction is ${maxDepositToDisplay.toFixed(2)}.` : `Minimum Deposit Per Transaction is ${minDepositToDisplay.toFixed(2)}.`
            redisCaching.delKey(reqKey);
            return ReS(res, { 'success': false, 'msg': msg });
        }

        let resvalidcouponcode;
        if (couponcode && couponcode !== "") {
            if (partnerId !== 1) {
                return ReS(res, { 'success': false, 'msg': 'Not Allowed' });
            }
            couponcode = couponcode.trim();
            let couponAppliedOnAmount = Number(req?.body?.amount);
            if (req.user.region !== 'INDIA') {
                const exchangeRate = await getExchangeRate(fromCurrency, 'INR');
                couponAppliedOnAmount = parseFloat(exchangeRate?.value) * couponAppliedOnAmount;
            }
            resvalidcouponcode = await isCouponValid(couponcode, user.id, couponAppliedOnAmount, req.user.region);
            if (resvalidcouponcode.success != true) {
                redisCaching.delKey(reqKey);
                return ReS(res, { 'success': false, 'msg': resvalidcouponcode.msg })
            }
            console.log(`Promo code ${couponcode} successfully applied for user ${req.user.id}`)
        }
        const paymentConfig = await CommonController._getPaymentConfig(partnerId, req?.user?.region);

        /**
         * TODO Create function for region
         * 1. Split logic create third party order per region 
         * 2. Update payments table
         * 3. Update coupons table
         */
        // if (!paymentConfig?.region) {
        //     redisCaching.delKey(reqKey);
        //     return ReS(res, { 'success': false, 'msg': messages.NO_PG_REGION });
        // }
        if (!(typeof RegionService?.payment?.createOrder?.[req?.user?.region] === 'function') && req?.query?.pg !== 'direct24') {
            redisCaching.delKey(reqKey);
            return ReS(res, { 'success': false, 'msg': messages.NO_PG_REGION });
        }
        let createPaymentOrder = RegionService?.payment?.createOrder?.[req?.user?.signup_country] ?? RegionService?.payment?.createOrder?.[req?.user?.region];

        // if (platform !== 'web' && req?.query?.pg !== 'direct24') {
        //     createPaymentOrder = RegionService?.payment?.createOrder?.[paymentConfig.region];
        // }

        let payload = {
            amount: Number(req?.body?.amount),
            currency: req?.body?.currency ?? (process.env.NODE_ENV === 'production' ? 'INR' : 'INR'),
            platform,
            orderId,
            networkType: req?.body?.networkType
        }
        if (req?.body?.pg && req?.body?.pg === 'paykassma') {
            payload['wallet_type'] = req?.body?.wallet_type;
        }
        if (req?.query?.pg && req?.query?.pg === 'direct24') {
            payload = { ...req.body, platform, orderId };
        }
        if (req?.body?.pg?.startsWith('linkqu') && req?.body?.mobile){
            payload['mobile'] = req?.body?.mobile;
        }
        // let onMetaUsers = [];
        // // if ((process.env.NODE_ENV === 'production' && onMetaUsers.indexOf(user.id) !== -1)) {
        // //     paymentConfig.payment_source = "ONMETA";
        // // }

        console.log(`[PAYMENT INITIATED] ${payload.amount} ${payload.currency} on ${payload.platform} platform for user ${req.user.id} of region ${paymentConfig?.region} with PG as ${paymentConfig?.payment_source}`)
        const [errco, data] = await to(createPaymentOrder(req.user, payload, version, platform, req?.query?.pg ?? req?.body?.pg));
        if (errco) throw errco;

        let deviceId = req?.body?.device_id;
        if (deviceId) {
            data.paymentData['metadata'] = { device_id: deviceId, platform: platform };
        }

        const [errp, pRows] = await to(User.addToPayments(data?.paymentData));
        if (errp) throw errp;
        if (couponcode && couponcode !== "") {
            var dataCObj = {
                'userid': user.id,
                'coupon': couponcode,
                'type': resvalidcouponcode['aboutCode']['type'],
                'orderid': data?.orderId ?? orderId,
                'isexecuted': false
            };
            [err, _couponRows] = await to(User.addCoupon(dataCObj));
            if (err) throw err;
        }

        /**
         *  Add logic for review
         */
        const depositFee = req?.user?.config?.depositFee;

        let review = {
            show: false,
        }
        if (depositFee) {
            const truncation = depositFee?.truncation ?? 'month';
            const transactionCount = await getTransactionCount(req?.user?.id, 'PM', truncation);
            const currentTransactionCount = parseInt(transactionCount, 10) + 1;
            const curTransactionCountWords = numberConverter.toWordsOrdinal(currentTransactionCount);
            // const title = '100% Cashback on GST';
            // const info = ['This is your', numberConverter.toWordsOrdinal(currentTransactionCount), 'deposit of the', truncation ].join(' ');

            let totalDeposit = amountToCheck;
            const gstPercent = CONFIG.depositConfig.INDIA.gst;
            let gst = Number((totalDeposit - totalDeposit / (1 + gstPercent / 100)).toFixed(2));

            const {
                promoWallet, depositWallet, bonusWallet
            } = RegionService.payment.getSplit(totalDeposit, (depositFee?.slabs ?? []), currentTransactionCount);

            let couponValue = 0;
            if (resvalidcouponcode?.aboutCode?.value) {
                couponValue = Number(resvalidcouponcode?.aboutCode?.value);
                if ((resvalidcouponcode?.aboutCode?.offer ?? '').toUpperCase() !== 'FLAT') {
                    couponValue = Number((couponValue / 100 * totalDeposit).toFixed(2));
                }
            }

            const metadata = [
                { key: 'Total Deposit Amount', value: totalDeposit },
                { key: 'Taxable Amount', value: totalDeposit - gst },
                { key: `GST (${gstPercent}%)`, value: gst },
                { key: 'GST Cashback', value: gst }
            ];
            if (couponValue > 0) {
                metadata.push({ key: 'Token points', value: couponValue })
            }
            metadata.push({ key: `Final Amount`, value: totalDeposit + couponValue });

            const split = [
                { key: 'In Deposit Wallet', value: depositWallet + bonusWallet },
                { key: 'Token points', value: promoWallet + couponValue }
            ];
            review = {
                ...review,
                show: !!(depositFee),
                metadata,
                gstCashbackPercent: 100,
                depositNumber: curTransactionCountWords,
                depositNumberDuration: truncation,
                split,
                curTransactionCountWords,
                // disclaimer: { title, info }
            }
            data.results = {
                ...data.results,
                review
            }
        }
        if (req?.query?.pg && req?.query?.pg === 'direct24') {
            redisCaching.delKey(reqKey);
            res.writeStatus('307 Temporary Redirect');
            res.writeHeader('Location', data.results.redirect_url);
            res.end();
            return;
        }


        redisCaching.delKey(reqKey);
        return ReS(res, data?.results);
    } catch (err) {
        console.log(err)
        redisCaching.delKey(reqKey);
        if (req?.query?.pg && req?.query?.pg === 'direct24') {
            res.writeStatus('307 Temporary Redirect');
            res.writeHeader('Location', 'https://testweb.getpredx.com/WalletSuccess?status=failure');
            res.end();
            return;
        }
        return ReE(res, err.message, 423);
    }
}

const getCFPaymentToken = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    const version = parseInt(req.headers['version']);
    try {
        let err, tokenRes;
        let uid = getUID();
        let orderId = 'od_' + parseInt(uid).toString(32) + '_' + process.env.MACHINE_ID + '_' + threadId;
        const user = req.user;


        let amount, couponcode;
        amount = Number(req.body.amount);
        couponcode = req.body.couponcode;

        // const _isEligibleToAdd = await isEligibleToAdd(user.id, amount);
        // if (!_isEligibleToAdd) {
        //     return ReE(res, `Your current deposit request exceed 1000 INR. Please try a lower amount or complete KYC to proceed.`, 402);
        // }

        let resvalidcouponcode;
        if (couponcode && couponcode !== "") {
            resvalidcouponcode = await isCouponValid(couponcode, user.id, amount, req.user.region);

            if (resvalidcouponcode.success == true) {
                console.log('promo code applied successfully')
            }
            else {
                return ReS(res, { 'success': false, 'msg': resvalidcouponcode.msg });
            }
        }

        var dataObj = Object.assign({
            "orderId": orderId,
            "orderAmount": req.body.amount,
            "orderCurrency": "INR"
        });


        let env = 'test';

        const urlPrefix = 'http://localhost:4000';

        var dObj2 = {
            'appId': env == 'prod'
                ? '128598d19520fea7f43ddabccc895821'
                : '81762ed247d4d3708fbd3059e26718',
            "orderId": orderId,
            "orderAmount": req.body.amount,
            "orderCurrency": "INR",
            'customerName': user.displayname,
            "customerPhone": user.mobile,
            "customerEmail": user.email,
            "returnUrl": `${urlPrefix}/about`,
            "notifyUrl": `${urlPrefix}/payment/hook`
        }


        var keys = Object.keys(dObj2);
        var signatureData = "";

        keys.forEach((key) => {
            // if (key != "signature") {
            signatureData += key + dObj2[key];
            // signatureData += `${key}${dObj2[key]}`;
            // }
        });
        // console.log(CONFIG.cashfreeParams.pmClientSecret);
        var computedSignature = crypto.createHmac('sha256', CONFIG.cashfreeParams.pmClientSecret).update(signatureData).digest('base64');
        // var computedSignature = crypto.createHmac('sha256', CONFIG.cashfreeParams.pmClientSecret).update(tokenData).digest('base64');
        // console.log(computedSignature);

        [err, tokenRes] = await to(CommonController.getCashFreePaymentToken(dataObj));
        if (err) throw err;
        // computedSignature = tokenRes.data['cftoken'];

        var dataPObj = { 'amount': dataObj['orderAmount'], orderid: dataObj['orderId'], userid: req.user.id };
        [err, pRows] = await to(User.addToPayments(dataPObj));

        if (couponcode && couponcode !== "") {
            var dataCObj = { 'userid': user.id, 'coupon': couponcode, 'type': resvalidcouponcode['aboutCode']['type'], 'orderid': orderId, 'isexecuted': false };
            [err, _couponRows] = await to(User.addCoupon(dataCObj));
            if (err) throw err;
        }

        var redData = Object.assign({}, tokenRes.data, { 'orderid': orderId, 'signature': computedSignature });

        return ReS(res, redData);

    } catch (err) {
        next(err);
    }

}

const updateOnMetaPaymentStatus = async function (req, res, next) {
    var onMetaOrderId = req.body['onMetaOrderId'];
    const statusData = await updatePaymentOrderStatus(onMetaOrderId);
    console.log(`updateOnMetaPaymentStatus Response data: ${JSON.stringify(statusData)}`)
    return ReS(res, {
        statusData
    });
}

const getOnMetaPaymentStatus = async function (req, res, next) {
    var err;
    var onMetaOrderId = req.body['onMetaOrderId'];
    var orderId = req.body['orderId'];
    const userId = req.user.id;
    if (!onMetaOrderId || !orderId) {
        return ReS(res, {
            success: false, msg: 'Invalid Ids'
        });
    }
    try {
        const statusData = await getPaymentOrderStatus(onMetaOrderId);
        console.log(`getOnMetaPaymentStatus Response data: ${JSON.stringify(statusData)}`)
        // In case of payment success
        if (statusData['status'] != "completed") {
            return ReS(res, {
                success: false, status: statusData['status'], msg: 'Payment not received', statusData: statusData
            });
        }
        const reqKey = `updating_payment_${orderId}`;
        const unlock = await lock(reqKey, 300000);
        try {
            [err, pRows] = await to(User.getPayment({ 'orderid': orderId }));
            if (err) throw err;
            let jsonData = { getuser: true, type: 'N', title: `Funds Added Successfully`, body: `${pRows[0].amount} added to your TradeX wallet` };
            if (pRows[0].paymentid != null) {
                unlock();
                return ReS(res, { success: true });
            }
            let data = { 'orderid': orderId, paymentid: onMetaOrderId };
            logger.info(`Payment Success for user: ${userId}, paymentid: ${onMetaOrderId}, orderid: ${orderId}`)
            var dataObj = { 'paymentid': onMetaOrderId };
            var whereObj = { 'orderid': orderId };
            [err, pRows] = await to(User.updatePayment2(whereObj, dataObj));
            if (err) throw err;

            if (pRows.length == 0) {
                unlock();
                return ReS(res, { success: true });
            }
            let amount = pRows[0]['amount'];
            let bankFee = ((CONFIG.rechargeCharges * 0.01) * amount).toFixed(2);

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
            pmTxnData['surcharge'] = bankFee;
            pmTxnData['amount'] = pmTxnData['amount'] - pmTxnData['surcharge'];
            batchTxnData.push(pmTxnData);
            const transactions = batchTxnData.map(t => ({
                ...t,
                action: TRANSACTIONS.fundsDeposit
            }))
            await UserService.executeTransactions(transactions)
            console.log('addcouponcashback called from payment hook');
            await UserService.addCouponCashbackWallet(orderId, userId, amount, (100000000 + parseInt(pRows[0]['id'])));

            if (req.user.partner.notifications == true) handleNotification({ amount: amount, userid: userId, region: req.user.region, partner: parseInt(req.user.partner.id) }, "deposit request success");
            unlock();
            return ReS(res, {
                success: true,
                status: statusData['status'],
                statusData: statusData,
                msg: `Recharge completed succesfully`
            });
        } catch (err) {
            console.log('getOnMetaPaymentStatus error', err);
            unlock();
            throw err;
        }
    } catch (err) {
        next(err);
    }
}

const paymentHook = async function (req, res, next) {

    let unlock;
    try {
        let err;
        let postData = Object.assign({
            "orderId": req.body['data']['order']['order_id'],
            "orderAmount": req.body['data']['order']['order_amount'],
            "referenceId": req.body['data']['payment']['cf_payment_id'],
            "txStatus": req.body['data']['payment']['payment_status'],
            "paymentMode": req.body['data']['payment']['payment_group'],
            "txMsg": req.body['data']['payment']['payment_message'],
            "txTime": req.body['data']['payment']['payment_time'],
        });
        console.log(`Cashfree Response Request body for orderID ${postData.orderId}: ${JSON.stringify(req.body)}`);

        function verify(ts, rawBody) {
            const body = ts + rawBody
            let test = crypto.createHmac('sha256', CONFIG.cashfreeParams.pmClientSecret).update(body).digest("base64");
            return test
        }
        const ts = req.headers["x-webhook-timestamp"];
        const signature = req.headers["x-webhook-signature"];


        const genSign = verify(ts, req.rawBody.toString());
        const matched = genSign === signature;
        console.log(`Signature match ${postData.orderId}`, genSign, signature);

        if (postData['txStatus'].toUpperCase() !== 'SUCCESS') {
            return ReS(res, {});
        }

        let orderId = postData['orderId'];
        const reqKey = `updating_payment_${orderId}`;
        unlock = await lock(reqKey, 300000);


        [err, pRows] = await to(User.getPayment({ 'orderid': orderId }));
        if (err) throw err;

        let paymentId = postData['referenceId'];
        let userId = pRows[0].userid;
        let jsonData = { getuser: true, type: 'N', title: `Funds Added Successfully`, body: `${postData['orderAmount']} added to your TradeX wallet` };

        if (pRows[0].paymentid != null) {
            unlock();
            return ReS(res, {});
        }


        let bankFee = ((CONFIG.rechargeCharges * 0.01) * postData['orderAmount']).toFixed(2);
        if (matched) {
            let data = { 'orderid': orderId, paymentid: paymentId };
            logger.info(`Payment Success for user: ${userId}, paymentid: ${data['paymentid']}, orderid: ${data['orderid']} ${data['orderid']}`)
            var dataObj = { 'paymentid': data['paymentid'] };
            var whereObj = { 'orderid': data['orderid'] };


            [err, pRows] = await to(User.updatePayment2(whereObj, dataObj));
            if (err) throw err;

            [err, pRows] = await to(User.getPayment({ 'orderid': data['orderid'], 'paymentid': data['paymentid'] }));
            if (err) throw err;

            if (pRows.length == 0) {
                unlock();
                return ReS(res, {});
            }

            let amount = pRows[0]['amount'];

            // let batchTxnData = [];

            // let txnid = 'PM' + (100000000 + parseInt(pRows[0]['id']));
            // let pmTxnData = {
            //     'userid': userId,
            //     'message': `Recharge of ${amount} completed succesfully`,
            //     'txnid': txnid,
            //     'wallettype': 'D',
            //     'type': 'CREDIT',
            //     'amount': amount
            // };

            // pmTxnData['surcharge'] = bankFee;
            // pmTxnData['amount'] = pmTxnData['amount'] - pmTxnData['surcharge'];

            // batchTxnData.push(pmTxnData);
            // const transactions = batchTxnData.map(t => ({
            //     ...t,
            //     action: TRANSACTIONS.fundsDeposit
            // }))
            // await UserService.executeTransactions(transactions)
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
            var message = `Recharge of ${depositAmount} completed Successfully`;

            // pmTxnData['surcharge'] = bankFee;

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

            let txnResp = await UserService.executeTransactions(txs, true)
            let invoice_ref = txnResp?.[0]?.transactionId ?? txnid;

            console.log('addcouponcashback called from payment hook');
            await UserService.addCouponCashbackWallet(orderId, userId, amount, (100000000 + parseInt(pRows[0]['id'])));

            [err, _user] = await to(User.findById(userId, false));
            if (err) throw err
            console.log("SENDING PAYMNET INVOICE FROM WEBHOOK", userId, amount, txnid, invoice_ref);
            sendGstInvoice(userId, amount, txnid, null, invoice_ref);
            let partnerConfig = await Partner.getPartnerWithConfig(parseInt(_user['partner']), 'INDIA', true);
            if (partnerConfig.notifications) handleNotification({ amount: amount, userid: userId, region: 'INDIA', partner: parseInt(_user['partner']) }, "deposit request success");
            // if (socketService.isOnline(userId)) {
            //     socketService.sendMsgViaSocket(userId, jsonData)
            // }
            unlock();
            return ReS(res, {});
        } else {
            throw 'Invalid Signature';
        }
    } catch (err) {
        console.log('paymentHook Error', err);
        typeof unlock === 'function' && unlock();
        return ReS(res, {});
    }
}

const cryptoPaymentUpdate = async function (req, res, next) {
    const log = (...args) => {
        console.log('[CRYPTO PAYMENT UPDATE]', ...args)
    }
    const errResponse = (msg) => {
        log(msg)
        return ReS(res, {
            success: false,
            msg,
        })
    }
    try {
        const refId = req.body['payment_reference']
        const orderId = req?.body?.webhook_data?.order_id;
        const region = req?.body?.webhook_data?.region;

        if (!refId) {
            return errResponse(`Invalid Payment Reference`);
        }
        if (!orderId) {
            return errResponse('Invalid Order id');
        }
        if (!region) {
            return errResponse('Invalid region');
        }
        const reqKey = `updating_payment_${refId}`;
        const unlock = await lock(reqKey, 300000);
        try {
            const [err, pRows] = await to(User.getPayment({ 'orderid': orderId }));
            if (err) throw err;
            const payment = pRows?.[0]
            if (!payment) {
                return errResponse('Payment not found')
            }
            const signature = req.headers['triplea-signature'];
            const payoutOrderStatusUpdate = RegionService?.payment?.paymentStatusUpdate?.[region];
            if (!payoutOrderStatusUpdate) {
                return errResponse(`Payment status update not present for region ${region}`);
            }
            const results = await payoutOrderStatusUpdate(payment, signature, req.body,)
            unlock();
            return ReS(res, results);
        } catch (err) {
            unlock();
            next(err);
        }
    } catch (error) {
        next(error);
    }
}

const paymentHookOnMeta = async function (req, res, next) {
    var err, _user;
    var postData = Object.assign({
        "orderId": req.body['metaData']['orderId'],
        "orderAmount": req.body['fiat'],
        "referenceId": req.body['orderId'],
        "txStatus": req.body['status'],
        "paymentMode": req.body['metaData']['paymentMode'],
        "txTime": req.body['createdAt'],
        "userId": parseInt(req.body['metaData']['userId'])
    });
    const orderId = postData['orderId'];
    const userId = postData['userId'];
    const onMetaOrderId = postData['referenceId'];
    const reqKey = `updating_payment_${orderId}`;
    const unlock = await lock(reqKey, 300000);
    try {
        console.log('OnMeta Webhook called ...', req.headers, req.body);
        let hmac = crypto.createHmac('sha256', CONFIG.ONMETA_CLIENT_SECRET);
        hmac.update(JSON.stringify(req.body));
        let hash = hmac.digest('hex');
        console.log('hash', hash);
        if (hash != req.headers["x-onmeta-signature"]) {
            throw "Invalid Signature";
        }
        if (postData['txStatus'] != "completed") {
            return ReS(res, {
                success: false, status: postData['txStatus'], msg: 'Payment not received yet'
            });
        }
        [err, pRows] = await to(User.getPayment({ 'orderid': orderId }));
        if (err) throw err;
        let jsonData = { getuser: true, type: 'N', title: `Funds Added Successfully`, body: `${pRows[0].amount} added to your TradeX wallet` };
        if (pRows[0].paymentid != null) {
            unlock();
            return ReS(res, { success: true });
        }
        logger.info(`Payment Success for user: ${userId}, paymentid: ${onMetaOrderId}, orderid: ${orderId}`)
        var dataObj = { 'paymentid': onMetaOrderId };
        var whereObj = { 'orderid': orderId };
        [err, pRows] = await to(User.updatePayment2(whereObj, dataObj));
        if (err) throw err;

        if (pRows.length == 0) {
            unlock();
            return ReS(res, { success: true });
        }
        let amount = pRows[0]['amount'];
        let bankFee = ((CONFIG.rechargeCharges * 0.01) * amount).toFixed(2);

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
        pmTxnData['surcharge'] = bankFee;
        pmTxnData['amount'] = pmTxnData['amount'] - pmTxnData['surcharge'];
        batchTxnData.push(pmTxnData);
        const transactions = batchTxnData.map(t => ({
            ...t,
            action: TRANSACTIONS.fundsDeposit
        }))
        await UserService.executeTransactions(transactions)
        console.log('addcouponcashback called from payment hook');
        await UserService.addCouponCashbackWallet(orderId, userId, amount, (100000000 + parseInt(pRows[0]['id'])));
        [err, _user] = await to(User.findById(userId, false));
        if (err) throw err

        handleNotification({ amount: amount, userid: userId, region: 'REST_OF_WORLD', partner: parseInt(_user['partner']) }, "deposit request success");
        unlock();
        return ReS(res, {
            success: true,
            msg: `Recharge completed succesfully`
        });
    } catch (err) {
        unlock();
        next(err);
    } finally {
        unlock();
    }
}

const paymentHookJP = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    var err, _user;

    var postData = Object.assign({
        "orderId": req.body['content']['order']['order_id'],
        "orderAmount": req.body['content']['order']['amount'],
        "referenceId": req.body['content']['order']['id'],
        "txStatus": req.body['event_name'],
        "paymentMode": req.body['content']['order']['payment_method_type'],
        "txMsg": req.body['content']['order']['payment_gateway_response']['resp_message'],
        "txTime": req.body['date_created'],
    });
    // var postData = Object.assign({
    //     "orderId": req.body['data']['order']['order_id'],
    //     "orderAmount": req.body['data']['order']['order_amount'],
    //     "referenceId": req.body['data']['payment']['cf_payment_id'],
    //     "txStatus": req.body['data']['payment']['payment_status'],
    //     "paymentMode": req.body['data']['payment']['payment_group'],
    //     "txMsg": req.body['data']['payment']['payment_message'],
    //     "txTime": req.body['data']['payment']['payment_time'],
    // });

    let orderId = postData['orderId'];
    const reqKey = `updating_payment_${orderId}`;
    const unlock = await lock(reqKey, 300000);
    try {

        var authToken = req.headers.authorization;
        authToken = authToken.slice(6);
        var b = Buffer.from(authToken, 'base64')
        let decodeString = b.toString();
        const usernamepwdArr = decodeString.split(":");

        if (usernamepwdArr[0] !== process.env.JPWEBHOOK_USERNAME || usernamepwdArr[1] !== process.env.JPWEBHOOK_PASSWORD) {
            throw "Invalid Signature";
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
            unlock();
            return ReS(res, {});
        }



        let bankFee = ((CONFIG.rechargeCharges * 0.01) * postData['orderAmount']).toFixed(2);

        if (true) {
            let data = { 'orderid': orderId, paymentid: paymentId };
            logger.info(`Payment Success for user: ${userId}, paymentid: ${data['paymentid']}, orderid: ${data['orderid']} ${data['orderid']}`)
            var dataObj = { 'paymentid': data['paymentid'] };
            var whereObj = { 'orderid': data['orderid'] };


            [err, pRows] = await to(User.updatePayment2(whereObj, dataObj));
            if (err) throw err;

            if (pRows.length == 0) {
                unlock();
                return ReS(res, {});
            }
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


            const transactions = batchTxnData.map(t => ({
                ...t,
                action: TRANSACTIONS.fundsDeposit
            }))
            await UserService.executeTransactions(transactions)

            await UserService.addCouponCashbackWallet(orderId, userId, amount, (100000000 + parseInt(pRows[0]['id'])));

            [err, _user] = await to(User.findById(userId, false));
            if (err) throw err

            handleNotification({ amount: amount, userid: userId, region: 'INDIA', partner: parseInt(_user['partner']) }, "deposit request success");
            // if (socketService.isOnline(userId)) {
            //     socketService.sendMsgViaSocket(userId, jsonData)
            // }
            unlock();
            return ReS(res, {});
        } else {
            throw 'Invalid Signature';
        }
    } catch (err) {
        unlock();
        next(err);
    } finally {
        unlock();
    }
}


const addPayment = async function (req, res, next) {

    // res.setHeader('Content-Type', 'application/json');
    let err, users, pRows, _walletData, rpRes, _pms, orderStatus, orderComplete = false, coins, _txns;
    var data = req.body;
    let userId = req.user.id;
    let paymentId = req.body.referenceId;
    var postData;
    if (req.body['orderId']) {
        postData = Object.assign({
            "orderId": req.body['orderId'],
            "orderAmount": req.body['orderAmount'],
            "referenceId": req.body['referenceId'],
            "txStatus": req.body['txStatus'],
            "paymentMode": req.body['paymentMode'],
            "txMsg": req.body['txMsg'],
            "txTime": req.body['txTime']
        });

    } else {
        postData = Object.assign({
            "orderId": req.body['order']['orderId'],
            "orderAmount": req.body['transaction']['transactionAmount'],
            "referenceId": req.body['transaction']['transactionId'],
            "txStatus": req.body['order']['status'],
            "paymentMode": req.body['order']['activePaymentMethod'],
            "txMsg": req.body['transaction']['txMsg'],
            "txTime": req.body['txTime']
        });
    }

    let orderId = postData['orderId'], amount = postData['orderAmount'];

    const reqKey = `updating_payment_${orderId}`;
    const unlock = await lock(reqKey, 300000);
    try {

        [err, pRows] = await to(User.getPayment({ 'orderid': orderId }));
        if (err) throw err;

        amount = pRows[0].amount;

        if (pRows.length > 0 && pRows[0].paymentid != null) {
            // if (usersCacheService.coins[userId]) {
            //     coins = usersCacheService.coins[userId];
            // } else {
            [err, coins] = await to(User.getEngagedCoins({ userid: userId }));
            if (err) throw err;

            // usersCacheService.coins[userId] = coins;
            // }

            [err, _txns] = await to(User.getTransactions({ 'userid': userId, limit: 2 }));
            if (err) throw err;

            unlock();
            return ReS(res, {
                user: coins, transactions: _txns, 'message': `Credits are added to your wallet`, title: 'Payment Successful'
            });
        }

        let bankFee = ((CONFIG.rechargeCharges * 0.01) * amount).toFixed(2);

        await (new Promise((resolve, reject) => {
            setTimeout(resolve, 5000)
        }));
        [err, orderStatus] = await to(CommonController.getCFOrderStatus(postData));
        paymentId = orderStatus.data['cf_order_id'];
        if (orderStatus.data['order_status'] == 'PAID') {
            orderComplete = true;
            amount = orderStatus.data['order_amount'];
        }

        /*
        if (!paymentId) {
            [err, orderStatus] = await to(CommonController.getCFOrderStatus(postData));
            paymentId = orderStatus.data['cf_order_id'];
            if (orderStatus.data['order_status'] == 'PAID') {
                orderComplete = true;
                amount = orderStatus.data['order_amount'];
            }
        } else {
            var keys = Object.keys(postData);
            var signature = req.body.signature;
            var signatureData = "";

            keys.forEach((key) => {
                if (key != "signature") {
                    signatureData += postData[key];
                }
            });

            var computedSignature = crypto.createHmac('sha256', CONFIG.cashfreeParams.pmClientSecret).update(signatureData).digest('base64');
            if (computedSignature == signature) {
                orderComplete = true;
            }
        }
        */

        if (orderComplete) {
            let data = { 'orderid': postData['orderId'], paymentid: paymentId };
            logger.info(`Payment Success for user: ${userId}, paymentid: ${data['paymentid']}, orderid: ${data['orderid']} ${data['orderid']}`)
            var dataObj = { 'paymentid': data['paymentid'] };
            var whereObj = { 'orderid': data['orderid'], 'userid': userId };
            [err, pRows] = await to(User.updatePayment2(whereObj, dataObj));
            if (err) throw err;

            [err, pRows] = await to(User.getPayment({ 'orderid': data['orderid'], 'paymentid': data['paymentid'] }));
            if (err) throw err;

            if (pRows.length == 0) {
                // [err, coins] = await to(User.getEngagedCoins({ userid: userId }));
                // if (err) throw err;

                // [err, _txns] = await to(User.getTransactions({ 'userid': userId, limit: 2 }));
                // if (err) throw err;

                // unlock();
                // return ReS(res, {
                //     user: coins, transactions: _txns, 'message': `Recharge of ${amount} completed Succefully`
                // });
            }

            let amount = pRows[0]['amount'];





            const depositFee = req?.user?.config?.depositFee;
            let depositAmount = amount;
            let promoAmount = 0;
            let bonusAmount = 0;
            if (depositFee) {
                const truncation = depositFee?.truncation ?? 'month';
                const transactionCount = await getTransactionCount(req?.user?.id, 'PM', truncation);
                const currentTransactionCount = parseInt(transactionCount, 10) + 1;
                const { depositWallet, promoWallet, bonusWallet } = RegionService.payment.getSplit(amount, depositFee?.slabs ?? [], currentTransactionCount);
                depositAmount = depositWallet;
                promoAmount = promoWallet;
                bonusAmount = bonusWallet;
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
            var message = `Recharge of ${depositAmount} completed Successfully`;

            // pmTxnData['surcharge'] = bankFee;

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

            const results = await UserService.executeTransactions(txs, true)
            const user = results?.[0]?.wallet;
            const transactions = results.map(t => t.transaction);
            console.log("addcoupon cashback called from add payment");
            await UserService.addCouponCashbackWallet(data['orderid'], userId, amount, (100000000 + parseInt(pRows[0]['id'])));

            let invoice_ref = results?.[0]?.transactionId ?? txnid;
            console.log("SENDING PAYMNET INVOICE FROM ADD PAYMEMT", userId, amount, txnid, invoice_ref);
            sendGstInvoice(userId, amount, txnid, null, invoice_ref);



            unlock();
            return ReS(res, {
                user, transactions, 'message': 'Credits are added to your wallet', title: 'Payment Successful'
            });
        } else {
            throw 'Invalid Signature';
            // [err, coins] = await to(User.getEngagedCoins({ userid: userId }));
            // if (err) throw err;

            // // usersCacheService.coins[userId] = coins;
            // // }

            // [err, _txns] = await to(User.getTransactions({ 'userid': userId, limit: 2 }));
            // if (err) throw err;

            // unlock();
            // return ReS(res, {
            //     user: coins, transactions: _txns, 'message': `Recharge of ₹${amount} completed Succefully`
            // });
        }
    } catch (err) {
        console.log('addPayment err', err);
        unlock();
        return ReE(res, 'Please try again or contact us on help@tradexapp.co', 200, 'Payment Failed');
        // next(err);
    } finally {
        // unlock();
    }

}



const addPaymentJP = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    let err, users, pRows, _walletData, rpRes, _pms, orderStatus, orderComplete = false, coins, _txns;
    var data = req.body;
    let userId = req.user.id;
    let paymentId = req.body.referenceId;
    var postData = Object.assign({
        "orderId": req.body['orderId'],
        "orderAmount": req.body['orderAmount'],
        "referenceId": req.body['referenceId'],
        "txStatus": req.body['txStatus'],
        "paymentMode": req.body['paymentMode'],
        "txMsg": req.body['txMsg'],
        "txTime": req.body['txTime'],
    });

    let orderId = postData['orderId'], amount = postData['orderAmount'];

    const reqKey = `updating_payment_${orderId}`;
    const unlock = await lock(reqKey, 300000);
    try {

        [err, pRows] = await to(User.getPayment({ 'orderid': orderId }));
        if (err) throw err;

        amount = pRows[0].amount;

        if (pRows.length > 0 && pRows[0].paymentid != null) {
            // if (usersCacheService.coins[userId]) {
            //     coins = usersCacheService.coins[userId];
            // } else {
            [err, coins] = await to(User.getEngagedCoins({ userid: userId }));
            if (err) throw err;

            // usersCacheService.coins[userId] = coins;
            // }

            [err, _txns] = await to(User.getTransactions({ 'userid': userId, limit: 2 }));
            if (err) throw err;

            if (_txns[0].txnid.substring(0, 2) == "CB") {
                _txns.shift();
            }

            unlock();
            return ReS(res, {
                user: coins, transactions: _txns, amount: amount, 'message': `Recharge of ${amount} completed Succefully`
            });
        }

        let bankFee = ((CONFIG.rechargeCharges * 0.01) * amount).toFixed(2);

        if (!paymentId) {
            [err, orderStatus] = await to(CommonController.getJPOrderPMStatus(postData['orderId']));
            paymentId = orderStatus['id'];
            if (orderStatus['status'] == 'CHARGED' && orderStatus['order_id'] == postData['orderId'] && orderStatus['amount'] == amount) {
                orderComplete = true;
                amount = orderStatus['amount'];
            }
            if ((orderStatus['status'] == 'AUTHORIZATION_FAILED' || orderStatus['status'] == 'AUTHENTICATION_FAILED') && orderStatus['order_id'] == postData['orderId'] && orderStatus['amount'] == amount) {
                let walletData;
                [err, walletData] = await to(User.getWalletBalance(userId, false));
                if (err) throw err;
                return ReS(res, { user: walletData, amount: orderStatus['amount'], 'message': "failed" });
            }
        }

        if (orderComplete) {
            let data = { 'orderid': postData['orderId'], paymentid: paymentId };
            logger.info(`Payment Success for user: ${userId}, paymentid: ${data['paymentid']}, orderid: ${data['orderid']} ${data['orderid']}`)
            var dataObj = { 'paymentid': data['paymentid'] };
            var whereObj = { 'orderid': data['orderid'], 'userid': userId };
            [err, pRows] = await to(User.updatePayment2(whereObj, dataObj));
            if (err) throw err;

            if (pRows.length == 0) {
                [err, coins] = await to(User.getEngagedCoins({ userid: userId }));
                if (err) throw err;

                [err, _txns] = await to(User.getTransactions({ 'userid': userId, limit: 2 }));
                if (err) throw err;

                unlock();
                return ReS(res, {
                    user: coins, transactions: _txns, 'message': `Recharge of ${amount} completed Succefully`
                });
            }

            let amount = pRows[0]['amount'];



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
            // walletData['coinsd'] = txnData['amount'];
            pmTxnData['surcharge'] = bankFee;
            pmTxnData['amount'] = pmTxnData['amount'] - pmTxnData['surcharge'];


            // let lastRecharge;
            // [err, lastRecharge] = await to(User.getLastRecharge(whereObj));

            // let bonusPerc = 0.0;

            // let bAmount = (lastRecharge && lastRecharge.length == 0) ? Math.floor(bonusPerc * pmTxnData['amount']) : 0;

            // if (bAmount > 0) {
            //     let gTxnid = 'GT' + (100000000 + parseInt(pRows[0]['id']));
            //     let gtTxnData = Object.assign({}, pmTxnData, { 'amount': bAmount, 'txnid': gTxnid, 'wallettype': 'D', message: `${bAmount} added to wallet as Bonus on recharge of ${amount}` });
            //     batchTxnData.push(gtTxnData);
            //     message += `. Bonus of ${bAmount} Added`;
            // }

            // [err, _txns] = await to(User.addBatchTransaction(batchTxnData));
            // if (err) throw err;

            // const transactionId = _txns[0]['id'];

            // // redisCaching.delHMKey(userId, 'userWallet');

            // let walletData = { 'coinsd': pmTxnData['amount'], 'userid': userId, 'transactionId': transactionId };
            // if (bAmount > 0) {
            //     walletData['coinsd'] += bAmount;
            // }


            // if (err) throw err;
            var message = `Recharge of ${amount} completed Succefully`;

            const results = await UserService.executeTransactions([{
                ...pmTxnData,
                action: TRANSACTIONS.fundsDeposit
            }], true)
            const user = results?.[0]?.wallet;
            const transactions = results.map(t => t.transaction);

            // if (_txns[0].txnid.substring(0, 2) == "CB") {
            //     _txns.shift();
            // }

            unlock();
            return ReS(res, {
                user, amount: amount, transactions, 'message': message
            });
        } else {
            let walletData;
            [err, walletData] = await to(User.getWalletBalance(userId, false));
            if (err) throw err;
            return ReS(res, { user: walletData, amount: amount, 'message': "pending" });
        }
    } catch (err) {
        unlock();
        next(err);
    } finally {
        unlock();
    }
}


const processCSV = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');

    try {
        let data = [], _user;
        // let inputStream = Fs.createReadStream(req.body.filepath, 'utf8');
        let rows = req.body.filepath.toString("utf-8").split('\\n');
        for (let d of rows) {
            let userid = d.split(',')[0]
            let amount = d.split(',')[1];
            let msg = d.split(',')[2];
            [err, _user] = await to(User.findById(userId));
            if (err) {
                logger.log(`User: ${userid} not fetched`);
                continue;
            }
            let { fcmtoken } = _user;

            let batchTxnData = [];

            let txnid = 'GT' + (100000000 + parseInt(id));
            let pmTxnData = {
                'userid': userId,
                'message': msg,
                'txnid': txnid,
                'wallettype': 'D',
                'type': 'CREDIT',
                'amount': amount
            };
            batchTxnData.push(pmTxnData);

            var msgTitle = `Funds added succesfully to wallet`;
            var msgBody = `${amount} Amount has been added succesfully to your wallet`;
            [err, _txns] = await to(User.addBatchTransaction(batchTxnData));
            if (err) {
                logger.log(`Transactions added failed for user: ${userId}`);
                logger.error(err);
                continue;
            }
            let walletData = { 'coinsw': amount, 'userid': userId };
            [err, _walletData] = await to(User.updateWallet(walletData));
            if (err) {
                logger.log(`Funds add to Wallet failed for user: ${userId}`);
                logger.log(err);
                continue;
            }
            var jsonData = { getuser: true, 'title': msgTitle, 'type': 'N', 'body': msgBody };
            // let [errx, res2] = await to(UserService.addMessageAndInform(userid, fcmtoken, jsonData));
            // notificationService.sendNotification(fcmtoken, jsonData, userId);
            var newUserMsgData = {
                'userid': userId,
                'fromuserid': '-1',
                'message': `${msgTitle} ${msgBody}`,
                'type': 'MSG'
            };
            [err, _msgRows] = await to(User.addMessage(newUserMsgData));
            if (err) {
                logger.log(`User: ${userid}: message table not updated`);
                continue;
            }
        }
        // inputStream
        //     .pipe(new CsvReadableStream({ parseNumbers: true, parseBooleans: true, trim: true }))
        //     .on('data', async function (row) {
        //         data.push(row);
        //     })
        //     .on('end', async function () {
        //     });

        return ReS(res, {});

    } catch (err) {
        next(err);
    }
}


const updatePayment = async function (req, res, next) {

    try {
        let err, users, pRows, _walletData, rpRes, _pms;
        var data = req.body;
        let userId = req.user.id;
        [err, _pms] = await to(CommonController.getRPOrderPMStatus(data['orderid']));
        if (err) {
            return ReS(res, { 'error': true, msg: err });
        }

        if (_pms['error']) {
            return ReS(res, { 'error': true, msg: _pms['error']['description'] });
        }
        if (_pms['count'] < 1) {
            return ReE(res, 'Invalid Payment Response');
        }

        logger.info(`Payment Success for user: ${userId}, paymentid: ${data['paymentid']}, orderid: ${data['orderid']} ${data['orderid']}`)

        var dataObj = { 'paymentid': data['paymentid'] };
        var whereObj = { 'orderid': data['orderid'], 'userid': userId };
        [err, pRows] = await to(User.updatePayment(whereObj, dataObj));
        if (err) throw err;

        let amount = pRows[0]['amount'];

        let batchTxnData = [];

        let txnid = 'PM' + (100000000 + parseInt(pRows[0]['id']));
        let pmTxnData = {
            'userid': userId,
            'message': `Recharge of ${amount} completed successfully`,
            'txnid': txnid,
            'wallettype': 'D',
            'type': 'CREDIT',
            'amount': amount
        };

        batchTxnData.push({
            ...pmTxnData,
            action: TRANSACTIONS.fundsDeposit
        });

        let bAmount = Math.floor(0.05 * amount);
        var message = `Recharge of ${amount} completed Successfully`;

        if (bAmount > 0) {
            let gTxnid = 'GT' + (100000000 + parseInt(pRows[0]['id']));
            let gtTxnData = Object.assign({}, pmTxnData, { 'amount': bAmount, 'txnid': gTxnid, 'wallettype': 'D', message: `${bAmount} added to wallet as Bonus on recharge of ${amount}` });
            batchTxnData.push({
                ...gtTxnData,
                action: TRANSACTIONS.fundsCoupon
            });
            message += `. Bonus of ${bAmount} Added`;
        }


        delete usersCacheService.coins[userId];

        var message = `Recharge of ${amount} completed Successfully`;

        const results = await UserService.executeTransactions([batchTxnData], true)
        const user = results?.[0]?.wallet;
        const transactions = results.map(t => t.transaction);

        return ReS(res, {
            user, transactions, 'message': message
        });

    } catch (err) {
        next(err);
    }
}

const upload = async (req, res, next) => {
    if (!req.file) {
        next();
        return;
    }
    _handleFile(req.file, async function (err, file) {
        if (req.body.uploadonly) {
            return ReS(res, { fileurl: file.gcsFileName })
        } else {
            req.body.filepath = file.gcsFileName;
            next();
        }
    });
}

const updateCoupon = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    try {
        if (!isDashboardUser(req)) {
            res.writeStatus("401");
            return ReS(res, {
                success: true, msg: 'Unauthorized request, incident has been reported'
            });
        }
        if (!req.body) {
            return ReE(res, `User ID and Coupon are missing in the request`, 400);
        }
        if (!req.body.userid) {
            return ReE(res, `User ID is missing`, 400);
        }

        if (!req.body.coupon) {
            return ReE(res, `Coupon code is missing`, 400);
        }

        if (/\s/g.test(req.body.coupon)) {
            return ReE(res, `Coupon code contains whitespace(s).`, 400);
        }

        const [err, _] = await to(User.updateCoupon(req.body.userid, req.body.coupon));
        if (err) throw err;
        return ReS(res, {
            success: true
        });

    } catch (err) {
        next(err);
    }
}

const deleteFcmToken = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    try {
        if (!req.user || !req.user.id) {
            return ReS(res, {
                success: false, msg: 'User ID is missing'
            });
        }
        const [err, _] = await to(User.deleteFcmToken(req.user.id));
        if (err) throw err;
        return ReS(res, {
            success: true
        });

    } catch (err) {
        next(err);
    }
}

const getConfig = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    try {
        if (!req.user || !req.user.id) {
            return ReS(res, {
                success: false, msg: 'User ID is missing'
            });
        }
        const [err, d] = await to(User.getConfig(req.user.id));

        if (err) throw err;

        const resData = lodash.merge({ is_liquidity_provider: false }, d);

        return ReS(res, {
            success: true, data: resData
        });

    } catch (err) {
        next(err);
    }
}


const addBonus = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    try {
        if (!isDashboardUser(req)) {
            res.writeStatus("401");
            return ReS(res, {
                success: true, msg: 'Unauthorized request, incident has been reported'
            });
        }

        const users = req.body.user_ids;
        const amount = req.body.bonus_amount;

        if (!Array.isArray(users) || !Array.isArray(amount) || amount.length === 0 || users.length === 0) {
            return ReE(res, 'Invalid request. user_ids and amount must be non-empty array', 400);
        }
        if (users.length !== amount.length) {
            return ReE(res, 'Invalid request. user_ids and amount must have equal number of items', 400);
        }

        for (let index = 0; index < users.length; index++) {

            const date = (new Date().toLocaleDateString()).replace(/\//g, '');
            const txnId = 'BN' + date.slice(0, -4) + 'X' + (1 + index);
            const txnData = [{
                'amount': amount[index],
                'userid': users[index],
                'type': 'CREDIT',
                'wallettype': 'D',
                'txnid': txnId,
                'message': `Chain referral weekly bonus of ${amount[index]} has been added to you wallet.`,
                'surcharge': 0
            }];
            const transactions = txnData.map(t => ({
                ...t,
                action: TRANSACTIONS.fundsCoupon
            }))
            await UserService.executeTransactions(transactions, false)
            //     [err, _txn] = await to(User.addBatchTransaction(txnData));
            //     const transactionId = _txn[0].id;

            //     const walletData = {
            //         userid: users[index],
            //         coinsd: amount[index],
            //         coinsb: amount[index],
            //         transactionId: transactionId
            //     };
        }


        return ReS(res, {
            success: true
        });

    } catch (err) {
        next(err);
    }
}

const purgeBlockedUserCache = async (req, res, next) => {
    try {
        blockedUsers = false;
        await redisCaching.delKey('blockedUsersInMemory')
        ReS(res, {
            purgedCacheFlag: true
        })
    } catch (e) {
        console.error('Error purging blocked users flag', e.message)
        ReS(res, {
            purgedCacheFlag: false,
            error: e.message
        })
    }

}

const checkIsBlockedUser = async (userId) => {
    try {
        const blockedUsersInMemory = await redisCaching.getKey('blockedUsersInMemory')
        if (!blockedUsersInMemory || !blockedUsers) {

            blockedUsers = await User.getBlockedUsers()
            blockedUsers = blockedUsers.reduce((agg, item) => ({
                ...agg, [item.id]: true
            }), {})
            await redisCaching.setKey('blockedUsersInMemory', 1, 24 * 3600)
        }
        const isUserBlocked = typeof blockedUsers === 'object' && !!blockedUsers[userId]
        return isUserBlocked
    } catch (e) {
        console.error(`Error in user block check for user ${userId} - ${e.message}`)
        return false;
    }
}

const resetKycRequest = async (req, res) => {
    try {
        if (!isDashboardUser(req)) {
            res.writeStatus("401");
            return ReS(res, {
                success: true, msg: 'Unauthorized request, incident has been reported'
            });
        }
        const id = req.body.id;
        const reason = req.body.reason;
        const name = req.body.name;
        if (!reason || reason.trim() === '') {
            return ReE(res, 'Need to provide a reset reason', "422")
        }
        if (!name || name.trim() === '') {
            return ReE(res, 'Please provide bank name for the user', "422")
        }
        const updated = await User.resetKYC(id, reason.trim(), name)
        if (!updated) {
            return ReE(res, 'Error in reset KYC', 422)
        }
        return ReS(res, {
            success: true,
            msg: 'KYC reset successfully'
        })
    } catch (e) {

    }
}

const processZDMsg = async (req, res) => {
    console.log(JSON.stringify(req['body']));
    console.log(JSON.stringify(req['query']));
    // console.log(JSON.stringify(req['body']['events'][0]['payload']));
}

const addProTraders = async (req, res, next) => {
    try {
        if (!isDashboardUser(req)) {
            res.writeStatus("401");
            return ReS(res, {
                success: true, msg: 'Unauthorized request, incident has been reported'
            });
        }
        const userids = req.body.userids;

        let [err, insertResp] = await to(User.addProTraders(userids));
        if (err) throw err;

        return ReS(res, {
            success: true,
            msg: `userids count : ${insertResp} added successfully to pro_traders`
        })
    } catch (e) {
        next(e);
    }
}

const removeProTraders = async (req, res, next) => {
    try {
        if (!isDashboardUser(req)) {
            res.writeStatus("401");
            return ReS(res, {
                success: true, msg: 'Unauthorized request, incident has been reported'
            });
        }
        const userids = req.body.userids;

        let [err, updateResp] = await to(User.removeProTraders(userids));
        if (err) throw err;

        return ReS(res, {
            success: true,
            msg: `userids count : ${updateResp} removed successfully from pro_traders`
        })
    } catch (e) {
        next(e);
    }
}
// recordOpeningBalance();


module.exports.get = get;
module.exports.getUser = getUser;
module.exports.putUser = putUser;
module.exports.updateUser = updateUser;
module.exports.addKyc = addKyc;
module.exports.getUsers = getUsers;
module.exports.login = login;
module.exports.upload = upload;
module.exports.couponValidate = couponValidate;
module.exports.getMessages = getMessages;
module.exports.getTransactions = getTransactions;
module.exports.getLeaders = getLeaders;
module.exports.putRedeemRequests = putRedeemRequests;
module.exports.confirmCryptoPayout = confirmCryptoPayout;
module.exports.cryptoPayoutHook = cryptoPayoutHook;
module.exports.getRedeemStatus = getRedeemStatus;
module.exports.getRedeemRequests = getRedeemRequests;
module.exports.getEngagedCoins = getEngagedCoins;
module.exports.verifyOTP = verifyOTP;
module.exports.verifyOTPnew = verifyOTPnew;
module.exports.verifyOTPEmail = verifyOTPEmail;
module.exports.verifyMobile = verifyMobile;
module.exports.addPayment = addPayment;
module.exports.paymentHook = paymentHook;
module.exports.updatePayment = updatePayment;
module.exports.getCFPaymentToken = getCFPaymentToken;
module.exports.createOrderCF = createOrderCF;
module.exports.addBankDetails = addBankDetails;
module.exports.addBankDetailsNew = addBankDetailsNew;
module.exports.addOnlyBankDetails = addOnlyBankDetails;
module.exports.removeBankDetails = removeBankDetails;
module.exports.getBankDetails = getBankDetails;
module.exports.getBankDetailsList = getBankDetailsList;
module.exports.payout = payout;
module.exports.updateUsers = updateUsers;
module.exports.processRedeemRequests = processRedeemRequests;
module.exports.blockUnblockUsers = blockUnblockUsers;
module.exports.cancelRedeemRequests = cancelRedeemRequests;
module.exports.processCSV = processCSV;
module.exports.processRedeemHelper = processRedeemHelper;
module.exports.deleteFcmToken = deleteFcmToken;
module.exports.getConfig = getConfig;
module.exports.fetchRechargeAmount = fetchRechargeAmount;
module.exports.updateCoupon = updateCoupon;
module.exports.authenticateEmail = authenticateEmail;
module.exports.addBonus = addBonus;
module.exports.ifscConvert = ifscConvert;
module.exports.getLastPaymentStatus = getLastPaymentStatus;
module.exports.addBankDetailsAdmin = addBankDetailsAdmin;
module.exports.rejectKycRequest = rejectKycRequest;
module.exports.suspendUsers = suspendUsers;
module.exports.createOrderJP = createOrderJP;
module.exports.addPaymentJP = addPaymentJP;
module.exports.paymentHookJP = paymentHookJP;
module.exports.customCouponValidate = customCouponValidate;
module.exports.getTdsBreakupOnWithdrawal = getTdsBreakupOnWithdrawal;
module.exports.checkIsBlockedUser = checkIsBlockedUser
module.exports.purgeBlockedUserCache = purgeBlockedUserCache;
module.exports.validateVirtualWallet = validateVirtualWallet;
module.exports.cryptoPaymentUpdate = cryptoPaymentUpdate;
module.exports.resetKycRequest = resetKycRequest;
module.exports.processZDMsg = processZDMsg;
module.exports.getOnMetaPaymentStatus = getOnMetaPaymentStatus;
module.exports.paymentHookOnMeta = paymentHookOnMeta;
module.exports.updateOnMetaPaymentStatus = updateOnMetaPaymentStatus;
module.exports.addProTraders = addProTraders;
module.exports.removeProTraders = removeProTraders;
module.exports.verifyMobileOtp = verifyMobileOtp;
module.exports.addMobileInfo = addMobileInfo;
module.exports.getAvailableCoupons = getAvailableCoupons;
