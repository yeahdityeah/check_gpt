
const { User, Banner, PaymentConfig, Category, Location, Partner } = require('../models');
const History = require('../models/history');
const { to, ReE, ReS } = require('../services/util.service');
const https = require('https');
const axios = require('axios');
const { sendSmsFn, sendSMSViaTwilio, sms_config_helper } = require('../services/sms.service');
const { PartnerService } = require('../services/partner.service');
const { RegionService } = require('../services/region');
const { sortTypeList } = require('../utils/sort.list.util.js');
const CONFIG = require('../config/config');
const cfSdk = require('cashfree-sdk');
const { Cashgram } = cfSdk.Payouts;
const { format, add } = require('date-fns');
const logger = require('../services/logger.service');
const { redisCaching } = require('../services/cache.service');
const { tutorial, newTutorial } = require('../utils/tutorial.util');
const { verifyMobileNumber, verifyEmailId } = require('../utils/mobile.utils');
const { getLatestVersion } = require('../utils/build.version');
const { UserService } = require('../services/user.service');
const { resolve } = require('path');
const { messages } = require('../messages/messages');
const { sendEmailFn } = require('../services/emailverification.service');
const { sendEmailPortfolio, sendLuckyCoinsPortfolio } = require('../services/sendEmailPortfolio');
const { sendinvoiceviamail } = require('../services/sendinvoiceviamail.service');
const { getPinCodeDetails } = require('../services/blocked_pinCode.service');
const { isDashboardUser } = require('../middleware/dashboard.user');
const { sendWhatsappCustomMessage } = require('../services/notification.service');
const { getCurrency } = require("../services/exchange.service");
const Paykassma = require("../services/paykassma.service");
const UserController = require("./user.controller")
const url = require("url");
const { CLUB_EVENT_CATEGORIES } = require('../config/config');
var geoip = require('geoip-lite');
const { isBetaUser } = require('../utils/beta.users');
const { localesService } = require('../services/locale/index.js');
const { getBankCodesd24 } = require('../services/direct24.service');
const { sendOtpViaWhatsapp } = require('../services/whatsapp.service.js');
require('dotenv').config();



cfSdk.Init({
    Payouts: {
        ENV: CONFIG.cashfreeParams.env || 'TEST',
        ClientID: CONFIG.cashfreeParams.clientId,
        ClientSecret: CONFIG.cashfreeParams.clientSecret
    }
})

var cashFreeAccessToken = '';
var cashFreeAccessTokenForKYC = '';

const ipMap = {}

async function _getPaymentConfig(partnerId, region = 'INDIA') {
    let paymentConfig = false;
    try {
        const paymentConfigKey = partnerId + '_' + region;
        paymentConfig = await redisCaching.getPaymentConfig(paymentConfigKey);
        paymentConfig.withdrawal_limit_min = parseFloat(paymentConfig.withdrawal_limit_min);
        paymentConfig.withdrawal_limit_max = parseFloat(paymentConfig.withdrawal_limit_max);
        paymentConfig.withdraw_enabled = paymentConfig.withdraw_enabled !== "false";
        paymentConfig.add_funds_enabled = paymentConfig.add_funds_enabled !== "false";
        paymentConfig.recharge_charges = parseFloat(paymentConfig.recharge_charges);
        paymentConfig.withdraw_charges = parseFloat(paymentConfig.withdraw_charges);
        paymentConfig.settlement_charges = parseFloat(paymentConfig.settlement_charges);
        paymentConfig.bonus_percentage = parseFloat(paymentConfig.bonus_percentage);
        paymentConfig.bonus_amount = parseFloat(paymentConfig.bonus_amount);
        paymentConfig.decentro_enable = paymentConfig.decentro_enable === "true";
        paymentConfig.payment_source = paymentConfig.payment_source;
    } catch (e) {

    }
    if (!paymentConfig) {

        const [err, res] = await to(PaymentConfig.getConfig({ partner: partnerId, region, is_active: true }));
        if (err) {
            throw err;
        }
        paymentConfig = res[0];
        // redisCaching.updatePaymentConfig(Object.assign({}, paymentConfig), region);
    }
    return paymentConfig;
}

async function _getCategories(isDashboardUser, region, partnerId) {
    const [err, res] = await to(Category.getCategories(100, 0, isDashboardUser, region, partnerId));
    if (err) {
        throw err;
    }
    for (let i = 0; i < res.length; i++) {
        if (res[i].text === "Sports" && res[i].subcategory && res[i].subcategory.length) {
            const subcategory = res[i].subcategory;

            var prioritysubcats = subcategory.filter(function (el) {
                if (region == 'INDIA') {
                    const ipl_tags = CONFIG.INDIA_PRIORITY_SUBCAT.filter(tag => el.toLowerCase().includes(tag.toLowerCase()));
                    return ipl_tags.length ? true : false;
                } else {
                    const intl_priority_subcat = CONFIG.INTERNATIONAL_PRIORITY_SUBCAT.filter(tag => el.toLowerCase().includes(tag.toLowerCase()));
                    return intl_priority_subcat.length ? true : false;
                }
            });
            res[i].subcategory = [...new Set([...prioritysubcats, ...subcategory])];
        }
    }
    if (partnerId != 1) {
        const categories = await Partner.getCategories(partnerId);
        let result = res.reduce((agg, item) => {
            if (categories.findIndex(i => i.subcategory == null && i.category == item.text) > -1) {
                return agg
            }
            let newSc = [];
            if (item.subcategory) {
                newSc = item.subcategory.filter(b => {
                    return categories.findIndex(i => i.subcategory.includes(b) && item.text == i.category) === -1
                })
            }
            return agg.concat({
                ...item,
                subcategory: newSc
            });
        }, []);
        return result;
    }
    return res;
}

async function _getBanners(partnerId) {
    const [err, res] = await to(Banner.getBanners(100, 0, { 'partnerId': partnerId }));
    if (err) {
        throw err;
    }
    return res.map(banner => {
        return {
            text: banner.banner_text,
            imgurl: banner.image_url,
            goto: banner.link || null,
            type: banner.type,
            action: banner.action,
            regions: banner.regions
        }
    });
}

const getConfig = async function (req, res, next) {

    let userId = -1, region, partner, country;
    if (req && req.user && req.user.id) {
        userId = req.user.id;
        // region = req.user.region || 'INDIA';
    }
    region = await RegionService.getRequestRegion(req);
    country = await RegionService.getRequestCountry(req);
    // res.setHeader('Content-Type', 'application/json');
    try {
        const partnerId = Number(req.headers['x-partner-id']) || 1;
        const platform = req.headers['x-platform'] || 'android';
        const ip = req.headers['x-forwarded-for'];
        
        const userAppVersion = typeof req.query.app_version === 'string' ? parseInt(req.query.app_version) : req.query.app_version;
        const version = req?.headers?.['version'] ?? userAppVersion;
        const isAllLang = req?.query?.isAllLang ?? false;

        const language = req?.user?.preferred_locale ?? 'en-IN';
        const translator = await localesService.getTranslator(language, 'contest');
        // const currentBuildNumber = getBuildVersion(platform, userId, userAppVersion); // VERY IMPORTANT: please maintain history in the ```appVersions``` array if you're changing the value

        let buildVersion = await getLatestVersion(platform, ip, partnerId, region, true);
        // if(isBetaUser(userId) && platform == 'android') {
        //     buildVersion = {
        //         version: 1084,
        //         change_logs: ['New design interface', 'Fantasy game to play and win big'],
        //         is_force_update: false
        //     }
        // }
        const currentBuildNumber = buildVersion?.version;
        const changeLogs = buildVersion?.change_logs || []; //getChangeLogs(buildVersion?.version, userAppVersion);
        // logic for handling optional and force update
        const app_force_update = buildVersion?.is_force_update; //isForceUpdate(req, currentBuildNumber);
        const sortingArray = [];
        for (let s of sortTypeList)
            sortingArray.push(Object.assign({}, s));

        const paymentConfig = await _getPaymentConfig(partnerId, req?.user?.region ?? 'INDIA');
        let banners = await _getBanners(partnerId);

        if (!userAppVersion || userAppVersion < 1025) {
            banners.push({ text: 'NEW UPDATE AVAILABLE - Download Now', imgurl: '', goto: CONFIG.serverURL + '/getapp', type: 'INFO' });
        }
        if (userId === -1) banners = [];

        banners = banners.filter(b =>
            (b?.regions ?? []).indexOf(region) !== -1)
        var cat_service_config = await PartnerService.getPartnerServiceConfig(partnerId, region, 'categories');
        let cat_preference = cat_service_config?.config;
        const cat = await _getCategories(false, region, partnerId);
        if (cat && cat.length > 0 && cat_preference) {
            // let index = cat.findIndex(x => x.text === "Finance");
            // if (index >= 0) {
            //     cat.unshift(cat.splice(index, 1)[0]);
            // }
            // let indexNews = cat.findIndex(x => x.text === "News");
            // if (indexNews >= 0) {
            //     cat.push(cat.splice(indexNews, 1)[0]);
            // }
            // let indexSports = cat.findIndex(x => x.text === "Sports");
            // if (indexSports >= 0) {
            //     cat.unshift(cat.splice(indexSports, 1)[0]);
            // }
            cat.sort((a, b) => {
                const indexA = cat_preference.indexOf(a.text);
                const indexB = cat_preference.indexOf(b.text);

                if (indexA === -1) return 1;
                if (indexB === -1) return -1;

                return indexA - indexB;
            });
        }
        // const [err1, depositDetails] = await to(User.getDepositedAmountByUserId(userId));
        // if (err1) {
        //     logger.error(JSON.stringify(err1));
        //     throw err1;
        // }
        let maxWithdrawalLimit = CONFIG.redeemRequestUpperLimit;
        if (userAppVersion < 1058) {
            maxWithdrawalLimit = UserService.getWithdrawalLimit(userId)
        }
        // if (UserService.restrictWithdrawLimit(userId)) {
        //     maxWithdrawalLimit = 5000;
        // } else if (depositDetails && depositDetails.hasOwnProperty('total_deposit') && depositDetails.total_deposit >= 100000) {
        //     maxWithdrawalLimit = CONFIG.redeemRequestPremiumUpperLimit;
        // }
        let err, cachedCountries, countries, ip_country;
        [err, cachedCountries] = await to(redisCaching.getKey(`live_countries`));
        if (!err && cachedCountries) {
            countries = JSON.parse(cachedCountries);
        } else {
            countries = await Location.getCountries();
            if (countries.length) {
                await redisCaching.setKey(`live_countries`, JSON.stringify(countries), 1 * 60 * 60);
            }
        }
        // if(req?.user?.id === -1) {
        //     countries = countries.filter( c => ( c.iso_code === 'IN' || c.iso_code === 'PK' ) );
        // }
        
        let whatsapp_otp_enabled;
        const selectedCountry = countries.find(c => c.iso_code === country);
        whatsapp_otp_enabled = selectedCountry ? selectedCountry.whatsapp_otpless_enabled : false;
        // if (partnerId !== 1){
        //     countries = countries.filter(obj=> obj.region == "INDIA");
        //     countries[0]['whatsapp_enabled'] = false;
        // }
        if (ip) {
            var geo = geoip.lookup(ip);
            if (geo) {
                ip_country = geo['country'];
            }
        }
        console.log("IP CAPTURED", ip, ip_country);
        partner = await PartnerService.getPartner(partnerId, region, true);
        let isProTrader = await UserService.isProTrader(userId);

        const isNewFlow = (platform === 'web' || (platform === 'android' && version >= 1086) || (platform === 'ios' && version >= 1087)) && req?.user?.id != -1
        console.log(isNewFlow, "NEW FLOW");
        const loginOptions = countries.find(c => c.iso_code === country);
        switch(true) {
            case platform === 'web':
                loginOptions.apple_enabled = false;
                loginOptions.gmail_enabled = true;
                loginOptions.email_enabled = true;
                loginOptions.sms_enabled = true;
                break;
            case platform === 'android' && version >= 1095:  
                loginOptions.gmail_enabled = true;
                loginOptions.email_enabled = true;
                loginOptions.sms_enabled = true;              
                loginOptions.apple_enabled = false;
                break;
            case platform === 'ios' && version > 1097:
                loginOptions.gmail_enabled = true;
                loginOptions.email_enabled = true;
                loginOptions.sms_enabled = true;              
                loginOptions.apple_enabled = true;
                break;
            case platform === 'android' && region !== 'INDIA' && version > 1091:
                loginOptions.sms_enabled = false;
                loginOptions.gmail_enabled = true;
                loginOptions.email_enabled = false;
                break;
            case platform === 'android' && region !== 'INDIA' && version <= 1091:
                loginOptions.sms_enabled = true;
                loginOptions.gmail_enabled = false;
                loginOptions.email_enabled = false;
                break;
            case platform === 'ios' && region !== 'INDIA' && version <= 1093:
                loginOptions.sms_enabled = true;
                loginOptions.gmail_enabled = false;
                loginOptions.apple_enabled = false;
                loginOptions.email_enabled = false;
                break;
            case platform === 'ios' && region !== 'INDIA' && version > 1093:
                loginOptions.sms_enabled = false;
                loginOptions.gmail_enabled = true;
                loginOptions.apple_enabled = true;
                loginOptions.email_enabled = false;
                break;
        }
        var login_service_config = await PartnerService.getPartnerServiceConfig(partnerId, region, 'loginOptions');
        let login_preference = login_service_config?.config ?? ["sms_enabled","gmail_enabled","apple_enabled","email_enabled","apple_enabled"];
        let filteredPreferences, availableOptions;
        if(loginOptions){
            availableOptions = Object.keys(loginOptions).filter(key => 
                loginOptions[key] === true && login_preference.includes(key)
            );
        }
        if (login_preference) {
            filteredPreferences = login_preference.filter(pref => 
                availableOptions.includes(pref)
            );
        }
        loginOptions['loginOrder'] = login_preference ? filteredPreferences : availableOptions;

        countries = countries.map(c => ({ ...c, gmail_enabled: false }));
        let resObj = {
            partner,
            otp_preference: ['SMS', 'WHATSAPP'],
            countries,
            ip_country: ip_country,
            categories: cat,
            minBuildNumber: currentBuildNumber,
            appVersion: currentBuildNumber,
            withdrawalLimit: { min: 200, max: maxWithdrawalLimit },
            bonusPerc: 0, //paymentConfig.bonus_percentage,
            bonusPerc2: 0,
            withdrawEnabled: paymentConfig.withdraw_enabled,
            addFundsEnabled: paymentConfig.add_funds_enabled,

            uxCamEnabled: false,
            rechargeCharges: paymentConfig.recharge_charges,
            withdrawCharges: 5,
            settlementCharges: paymentConfig.settlement_charges,
            bonusAmount: '10', //paymentConfig.bonus_amount.toString(),
            refereeBonus: CONFIG.refereeBonus,
            referralBonus: CONFIG.referralBonus,
            banners: banners,
            sortingOptions: sortingArray,
            app_force_update,
            cancelEnabled: true,
            sellEnabled: true,
            appEnabled: Boolean(!process.env.UNDER_MAINTENANCE),
            uxCamKey: CONFIG.ux_cam_key,
            takeRate: 0.25,
            TfDiscount: { amount: 250, percentage: 50 },
            TfDiscountText: "50% off on trading fees for trade value below ₹100 and above ₹250",
            imTradingFeeToolTip: `${partner.name} charges 1% of the amount as trading fee for orders that get an Instant Match.`,
            cdaTradingFeeToolTip: `${partner.name} charges 1% of the amount as trading fee for orders that get an Instant Match.\nNo trading fee is charged for pending orders that wait for a match.`,
            imTradingFeePercentage: CONFIG.takeRatePercentage, // trading fee for instant matched events
            newTakeRate: CONFIG.takeRate, // trading fee for CDA events
            supportUrl: CONFIG.SUPPORT_URL,
            faqURL: 'https://tradexapp.zendesk.com/hc/en-us',
            changeLogs: changeLogs,
            academyLink: 'https://academy.tradexapp.co/',
            decentroEnable: paymentConfig.decentro_enable,
            howItWorlsMax: CONFIG.TUTORIALMAX,
            privacyPolicy: req?.user?.partner?.links?.privacyPolicy ?? (region == 'INDIA' ? 'https://support.tradexapp.co/portal/en/kb/articles/privacy' : 'https://tradexapp.zendesk.com/hc/en-us/articles/11486286634525'),
            cancellationPolicy: region == 'INDIA' ? 'https://tradexapp.zendesk.com/hc/en-us/articles/7198048834461-Cancellations-Refund-Policy' : 'https://tradexapp.zendesk.com/hc/en-us/articles/11486291260957',
            termsAndCondition: req?.user?.partner?.links?.termsAndConditions ?? (region == 'INDIA' ? 'https://support.tradexapp.co/portal/en/kb/articles/terms-conditions' : 'https://support.tradexapp.co/portal/en/kb/articles/terms-conditions'),
            antiMoneyLaundering: req?.user?.partner?.links?.antiMoneyLaundering ?? (region == 'INDIA' ? 'https://support.tradexapp.co/portal/en/kb/articles/anti-money-laundering-policy' : 'https://tradexapp.zendesk.com/hc/en-us/articles/11486300079261'),
            marketContributors: 'https://www.tradexapp.co/marketcontributors',
            telegramLink: req?.user?.partner?.links?.telegramLink ?? 'https://t.me/OXprediction',
            NewsURL: CONFIG.NEWS_URL,
            // mobikwikOffer: region === 'INDIA' ? CONFIG.MOBIKWIK_IMAGE_URL : null,
            mobikwikOffer: null,
            howToTradeVideo: CONFIG.HOW_TO_TRADE_VID[`${region}`],
            hTTVideoKey: CONFIG.HOW_TO_TRADE_VID[`${region}`],
            slippageAcademy: "https://tradexmarkets.zohodesk.in/portal/en/kb/articles/how-do-i-prevent-slippage",
            tdsWithdraw: 'Please note that TDS of 30% on net winnings + ₹5 (bank charges) is applicable for each withdrawal request.',
            showtimer: true,
            timerstart: 3600000,
            slippage: { slpTxt: "Execution price might vary by approx (+/-) 5", slpType: "unlimited" },
            tfCDASell: {
                feeMain: '',
                feeAddnlLimit: ``,
                feeAddnlMarket: ``
            },
            tfCDABuy: {
                feeMain: ``,
                feeAddnl: ''
            },
            tfIMBuy: {
                feeMain: ``,
                feeAddnl: ''
            },
            tfIMSell: {
                feeMain: ``,
                feeAddnl: ''
            },
            tfMergeShare: { feeMain: `` },
            clubEventCategories: CONFIG.CLUB_EVENT_CATEGORIES,
            withdrawalConfig: {
                INDIA: CONFIG?.withdrawalConfig?.INDIA,
                ASEAN: isNewFlow && CONFIG.withdrawalConfig[req?.user?.signup_country] ?
                    CONFIG.withdrawalConfig[req?.user?.signup_country] : CONFIG?.withdrawalConfig?.ASEAN,
                REST_OF_WORLD: isNewFlow && CONFIG.withdrawalConfig[req?.user?.signup_country] ?
                    CONFIG.withdrawalConfig[req?.user?.signup_country] : CONFIG?.withdrawalConfig?.REST_OF_WORLD,
                BD: isNewFlow && CONFIG.withdrawalConfig[req?.user?.signup_country] ?
                    CONFIG.withdrawalConfig[req?.user?.signup_country] : CONFIG?.withdrawalConfig?.REST_OF_WORLD,
                PK: isNewFlow && CONFIG.withdrawalConfig[req?.user?.signup_country] ?
                    CONFIG.withdrawalConfig[req?.user?.signup_country] : CONFIG?.withdrawalConfig?.REST_OF_WORLD
            },
            depositConfig: {
                INDIA: CONFIG?.depositConfig?.INDIA,
                ASEAN: isNewFlow && CONFIG.depositConfigCountry[req?.user?.signup_country] ?
                    CONFIG.depositConfigCountry[req?.user?.signup_country] : CONFIG?.depositConfig?.ASEAN,
                REST_OF_WORLD: isNewFlow && CONFIG.depositConfigCountry[req?.user?.signup_country] ?
                    CONFIG.depositConfigCountry[req?.user?.signup_country] : CONFIG?.depositConfig?.REST_OF_WORLD,
                BD: isNewFlow && CONFIG.depositConfigCountry[req?.user?.signup_country] ?
                    CONFIG.depositConfigCountry[req?.user?.signup_country] : CONFIG?.depositConfig?.REST_OF_WORLD,
                PK: isNewFlow && CONFIG.depositConfigCountry[req?.user?.signup_country] ?
                    CONFIG.depositConfigCountry[req?.user?.signup_country] : CONFIG?.depositConfig?.REST_OF_WORLD,
                CANADA: isNewFlow && CONFIG.depositConfigCountry[req?.user?.signup_country] ?
                    CONFIG.depositConfigCountry[req?.user?.signup_country] : CONFIG?.depositConfig?.CANADA,
                presets: isNewFlow && CONFIG.depositConfigCountry[req?.user?.signup_country] ?
                    CONFIG.depositConfigCountry[req?.user?.signup_country]?.presets : CONFIG?.depositConfig?.REST_OF_WORLD.presets,
            },
            isProTrader,
            pages: {
                is_fantasy_enabled: partnerId === 1 && (
                    platform === 'web' ||
                    platform === 'android' ||
                    (platform === 'ios' && version > 1097)
                ),
            },
            contestConfig: {
                howItWorks: {
                    info: [translator("Put your coins on different events."),
                    translator("If you are right? Win more coins, else lose some."),
                    translator("At the end, we'll turn your coins into real money in your wallet. Simple and fun!")],
                    disclaimer: [translator("Coins will expire at the end of contest and will be converted into real money.")],
                    video: 'https://youtube.com/shorts/Zgwbj7Y00EE?si=YDFJSaVlInACShLq',
                    videoWeb: 'https://youtube.com/shorts/Zgwbj7Y00EE?si=YDFJSaVlInACShLq',
                    videoApp: 'Zgwbj7Y00EE?si=YDFJSaVlInACShLq'
                },
                showPerformanceTab: true,
                discordLink: 'https://discord.gg/a7Xwyspbse'
            },
            supportedLocales: (!isAllLang) ? localesService.localesConfig.supportedLocales.filter(locale => locale.key !== 'pt-PT') : localesService.localesConfig.supportedLocales,
            isLiveTradeShow: false,
            liveTradeUrl: 'https://academy.tradexapp.co/',
            whatsapp_otp_enabled,
            loginOptions,
            feeLink : 'https://support.tradexapp.co/portal/en/home'
        };
        // if (platform == 'ios' && userAppVersion > 1056) {
        //     resObj['minBuildNumber'] = "-1"
        // }
        if (isNewFlow && (req?.user?.signup_country === 'PK' || req?.user?.signup_country === 'BD')) {
            const currency = getCurrency(req?.user?.signup_country, platform, version);
            let pgObj = await Paykassma.getAvailableWallets(req?.user, { currency });
            if (pgObj && pgObj[`label`] === 'Paykassma') {
                resObj['depositConfig'][`${req?.user?.signup_country}`]['pg'] = [pgObj];
            }
        }
        console.log(`userid ${userId} region ${region} resObj[mobikwikOffer] ${resObj['mobikwikOffer']}`);
        if (userId !== -1) {
            if (UserService.restrictWithdrawLimit(userId)) {
                resObj.withdrawalLimit.max = 5000;
            }
            await User.setUpdatedAt(userId)
        }
        return ReS(res, resObj);
    } catch (error) {
        next(error);
    }
}

const getTutorialList = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    const version = parseInt(req.headers['version']);
    try {

        return ReS(res, newTutorial);

    } catch (error) {
        next(error);
    }
}

const isAppAllowd = async (req, res, next) => {
    next();
    //     // res.setHeader('Content-Type', 'application/json');

    //     let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    //     ip = `${ip}`;
    //     ip = ip.split(":")[0];
    //     const blockedStates = ['assam', 'andhra pradesh', 'nagaland', 'odisha', 'sikkim', 'telangana', 'delhi'];
    //     async function getResponse() {
    //         return new Promise(async (resolve, reject) => {
    //             if (ip === '127.0.0.1') {
    //                 resolve(true);
    //             } else {
    //                 try {
    //                     let isIpAllowed = await redisCaching.getHMKey(ip, 'ipAllowedMap');
    //                     if (isIpAllowed && isIpAllowed === "true") {
    //                         resolve(true);
    //                     } else {
    //                         const options = {
    //                             method: 'GET',
    //                             url: `https://ip-geolocation-and-threat-detection.p.rapidapi.com/${ip}`,
    //                             headers: {
    //                                 'X-RapidAPI-Key': CONFIG.ipWhoIsRapidApiKey,
    //                                 'X-RapidAPI-Host': CONFIG.ipWhoIsRapidApiHost
    //                             }
    //                         };
    //                         axios.request(options).then(function (response) {
    //                             logger.info(response.message);
    //                             if (response.status === 200) {
    //                                 const region = response.data?.location?.region?.name;
    //                                 if(!region) reject(`unable to fetch region`);
    //                                 const isAllowed = blockedStates.indexOf(region.toLowerCase()) == -1;
    //                                 redisCaching.setHMKey(ip, 'ipAllowedMap', isAllowed);
    //                                 resolve(isAllowed);
    //                             } else {
    //                                 isA
    //                                 reject('unable to fetch region')
    //                             }

    //                         }).catch(function (error) {
    //                             reject(error);
    //                         })
    //                     }
    //                 } catch (e) {
    //                     reject(e);
    //                 }
    //             }
    //         });
    //     }
    //     try {
    //         var isAllowed = await getResponse();
    //         // const isAllowed = blockedStates.indexOf(r['region'].toLowerCase()) == -1;
    //         if (isAllowed) {
    //             next()
    //         } else {
    //             return ReE(res, { message: messages.TRADING_BLOCKED }, 400);
    //         }
    //         // return ReS(res, { isAllowed, isAllowed });
    //     } catch (e) {
    //         return ReE(res, { 'error': true, msg: e });
    //     }
}

const getCashFreeAccessToken = async function (partnerId = 1) {

    const partner = await PartnerService.getPartner(partnerId);

    var config = {
        headers: {
            'X-Client-Id': partnerId == 1 ? CONFIG.cashfreeParams.clientId : process.env[`${partner.name.toUpperCase()}_CLIENT_ID`],
            'X-Client-Secret': partnerId == 1 ? CONFIG.cashfreeParams.clientSecret : process.env[`${partner.name.toUpperCase()}_CLIENT_SECRET`]
        }
    }

    return new Promise((resolve, reject) => {
        return axios
            .post(`${CONFIG.cashfreeParams.url}/payout/v1/authorize`, {}, config)
            .then(res => {
                if (res.data['status'] == 'SUCCESS') {
                    cashFreeAccessToken = res.data['data'].token;
                    verifyCashFreeAccessToken();
                }
                resolve(res);
            })
            .catch(error => {
                logger.error(`error from cahsfree while fetching tokens - ${error}`)
                reject(error);
            })
    });
}

// const getCashFreeAccessTokenForKYC = async function () {

//     var config = {
//         headers: {
//             'X-Client-Id': CONFIG.cashfreeKYCParams.clientId,
//             'X-Client-Secret': CONFIG.cashfreeKYCParams.clientSecret
//         }
//     }

//     return new Promise((resolve, reject) => {
//         return axios
//             .post(`${CONFIG.cashfreeKYCParams.url}/payout/v1/authorize`, {}, config)
//             .then(res => {
//                 if (res.data['status'] == 'SUCCESS') {
//                     cashFreeAccessTokenForKYC = res.data['data'].token;
//                     verifyCashFreeAccessTokenForKYC();
//                 }
//                 resolve(res);
//             })
//             .catch(error => {
//                 logger.error(`error from cahsfree while fetching tokens - ${error}`)
//                 reject(error);
//             })
//     });
// }

const createOrderCF = async function (dataObj) {
    var config = {
        headers: {
            'x-api-version': '2022-09-01',
            'x-client-id': CONFIG.cashfreeParams.pmClientId,
            'x-client-secret': CONFIG.cashfreeParams.pmClientSecret
        }
    }
    logger.info(dataObj);
    try {
        var data = await axios.post(`${CONFIG.cashfreeParams.pmURL}/pg/orders`, dataObj, config);

        return data;
    } catch (e) {
        throw e.response || e;
    }
}

const getCFOrderStatus = async function (dataObj) {
    var config = {
        headers: {
            'x-api-version': '2022-09-01',
            'x-client-id': CONFIG.cashfreeParams.pmClientId,
            'x-client-secret': CONFIG.cashfreeParams.pmClientSecret
        }
    }
    try {
        // var data = await axios.post(`${CONFIG.cashfreeParams.pmURL}/api/v2/cftoken/order`, dataObj, config);
        var data = await axios.get(`${CONFIG.cashfreeParams.pmURL}/pg/orders/${dataObj['orderId']}`, config);

        return data;
    } catch (e) {
        throw e.response || e;
    }
}

const getCashFreePaymentToken = async function (dataObj) {
    var config = {
        headers: {
            'x-client-id': CONFIG.cashfreeParams.pmClientId,
            'x-client-secret': CONFIG.cashfreeParams.pmClientSecret
        }
    }
    try {
        var data = await axios.post(`${CONFIG.cashfreeParams.pmURL}/api/v2/cftoken/order`, dataObj, config);
        return data;
    } catch (e) {
        throw e;
    }
}

const createPayout = async function (dataObj) {
    const date = add(new Date(), { days: 4 });
    var dateStr = format(date, 'yyyy/MM/dd');
    var remarks = 'Please use this link before expiry';

    const response = await Cashgram.CreateCashgram({
        cashgramId: dataObj['txnid'],
        amount: dataObj['amount'],
        name: dataObj['name'],
        phone: dataObj['mobile'],
        linkExpiry: dateStr,
        remarks: remarks,
        notifyCustomer: 0
    });
    return response;

}

const getCGStatus = async function (refid) {
    const response = await Cashgram.GetCashgramStatus({
        cashgramId: refid
    });
    return response;
}

const verifyCashFreeAccessToken = async function () {
    var config = {
        headers: {
            'Authorization': `Bearer ${cashFreeAccessToken}`
        }
    }
    return new Promise((resolve, reject) => {
        axios
            .post(`${CONFIG.cashfreeParams.url}/payout/v1/verifyToken`, {}, config)
            .then(res => {
                resolve(res);
            })
            .catch(error => {
                reject(error);
            })
    });

}

// const verifyCashFreeAccessTokenForKYC = async function () {
//     var config = {
//         headers: {
//             'Authorization': `Bearer ${cashFreeAccessTokenForKYC}`
//         }
//     }
//     return new Promise((resolve, reject) => {
//         axios
//             .post(`${CONFIG.cashfreeKYCParams.url}/payout/v1/verifyToken`, {}, config)
//             .then(res => {
//                 resolve(res);
//             })
//             .catch(error => {
//                 reject(error);
//             })
//     });

// }

const sendOTP = async function (req, res, next) {
    const testNumbers = [
        '0000000001', '0000000002', '0000000003', '0000000004', '0000000005', '0000000006', '0000000007', '0000000008', '0000000009', '0000000010',
    ];
    var testMobiles = ['1234567890', '1234567899', '9990000000', '0981865825', '0548784634', '1931196164', '1764561901', '3200000000', '1234567555', '1234432188', '1234432192', '1234432162', '1234432166', '1212123434', '1234432111'];
    if (process.env.NODE_ENV !== 'production') {
        testMobiles.concat(...testNumbers);
    }
    try {
        // res.setHeader('Content-Type', 'application/json');
        const partnerId = Number(req.headers['x-partner-id']) || 1;
        let region = await RegionService.getRequestRegion(req);
        req.partner = await PartnerService.getPartner(partnerId, region, true);
        var err, _userRows, smsSent, whatsappSent, _msgRows, signup_country;
        const source = req.body.source || 'sms';
        const country_code = req.body.country_code || '+91';
        const mobile = String(parseInt(req.body.mobile || 0, 10));

        var randomFixedInteger = function (length) {
            return Math.floor(Math.pow(10, length - 1) + Math.random() * (Math.pow(10, length) - Math.pow(10, length - 1) - 1));
        }

        const respData = await verifyMobileNumber(mobile);
        if (!respData.success) {
            return ReE(res, {
                verified: false, success: false, msg: respData.msg, errorCode: CONFIG.LOGINERRORCODE.INVALIDMOBILE, disableOTPSend: false
            }, 422);
        }

        if (mobile.startsWith(country_code)) {
            mobile = mobile.substring(country_code.length);
        }

        [err, _msgRows] = await to(User.getIsoFromCountryCode({ "country_code": country_code }));
        if (err) throw err;

        if (_msgRows.length > 0 && _msgRows[0]['is_enabled'] == true) {
            signup_country = _msgRows[0]['iso_code'];
            region = _msgRows[0]['region'];
        } else {
            return ReE(res, 'Service not available in this country', 422);
        }

        const userId = await User.getUserByMobile(mobile, signup_country, partnerId);
        if (req?.user?.id !== -1 && !isNaN(parseInt(userId, 10)) && (parseInt(req.user.id) !== parseInt(userId))){
            return ReE(res, {
                verified: false, success: false, msg: `Mobile already linked to another account`,
            }, 422);
        }

        if (!isNaN(parseInt(userId, 10))) {
            const isUserBlocked = await UserController.checkIsBlockedUser(userId)
            if (isUserBlocked) {
                return ReE(res, {
                    verified: false, success: false, msg: `Your account has been blocked due to suspicious activity. If you think this has been done in error, please contact us at mail@tradexapp.co`,
                }, 422);
            }
        }


        let testotp = (process.env.NODE_ENV == 'production') ? 322187 : 311278;
        let otpDigits = 6;

        let tempUsers, otpSent = 0;
        const otpSendLimit = CONFIG.LOGINERRORCODE.RESENDLIMIT;

        [err, tempUsers] = await to(User.getTemp({ 'mobile': mobile, 'country_code': country_code, 'partner': partnerId }));
        if (err) throw err;

        if (tempUsers && tempUsers.length > 0) {
            otpSent = tempUsers[0].otpsend;
            const blockDuration = CONFIG.LOGINERRORCODE.BLOCKDURATION;

            const otpGenerateTime = new Date(tempUsers[0].createdat);
            const currentTime = new Date();

            let diff = blockDuration - ((currentTime - otpGenerateTime) / (1000 * 60));
            if (otpSent >= otpSendLimit) {
                if (diff > 0) {
                    diff = parseInt(diff);
                    return ReE(res, {
                        verified: false, success: false, msg: `Too many failed attempts, kindly retry after 30 mins `, errorCode: CONFIG.LOGINERRORCODE.BLOCKED, disableOTPSend: otpSent + 1 >= otpSendLimit
                    }, 422);
                } else {
                    // User Unblocked after 30 minutes , now sentOtp count starts from 0
                    otpSent = 0;
                }

            }

            const resendDuration = CONFIG.LOGINERRORCODE.RESENDDURATION;
            diff = (currentTime - otpGenerateTime) / 1000;   //seconds
            if (diff < resendDuration) {   // 3 minutes gap at lease between 2 send OTP
                return ReE(res, {
                    verified: false, success: false, msg: `Please wait for ${resendDuration} seconds before requesting new OTP`, errorCode: CONFIG.LOGINERRORCODE.RESENDBEFORETIME, disableOTPSend: otpSent + 1 >= otpSendLimit
                }, 422);
            }

        }
        var otp = randomFixedInteger(otpDigits);
        if (testMobiles.indexOf(mobile) > -1) {
            smsSent = { 'success': true, messageid: 'test' };
            otp = testotp;
        } else {

            if (source == 'sms') {
                const smsServiceResponse = await sms_config_helper(mobile, otp, country_code, region, req)
                if (!smsServiceResponse.success) {
                    return ReE(res, {
                        verified: false, success: false, msg: smsServiceResponse.message, errorCode: CONFIG.LOGINERRORCODE.INVALIDMOBILE, disableOTPSend: false
                    }, 422);
                }
                smsSent = true;
            } else if (source == 'whatsapp') {
                if (partnerId != 1) {
                    return ReE(res, {
                        verified: false, success: false, msg: `Service Blocked`,
                    }, 422);
                }
                [err, whatsappSent] = await to(sendOtpViaWhatsapp(otp, country_code, mobile, req?.partner?.name));
                // [err, whatsappSent] = await to(sendWhatsappCustomMessage("otp_verification", mobile, 'user_otp', 'otp verification', [otp.toString()], country_code));
                if (!whatsappSent.success) {
                    logger.info(`Whatsapp failed from AiSensy`);
                    return ReE(res, {
                        verified: false, success: false, msg: whatsappSent.errorMessage, errorCode: CONFIG.LOGINERRORCODE.INVALIDMOBILE, disableOTPSend: false
                    }, 422);
                    throw new Error(`Whatsapp failed from AiSensy`);
                }
            }
        }
        if (smsSent || whatsappSent) {
            var dataObj = { 'mobile': mobile, 'otp': otp, 'messageid': null, 'otpsend': otpSent + 1, 'source': source, 'country_code': country_code, 'partner': partnerId };
            [err, _userRows] = await to(User.addToTemp(dataObj));
            return ReS(res, {
                success: 'true', disableOTPSend: otpSent + 1 >= otpSendLimit
            });
        }
    } catch (err) {
        next(err);
    }
}
const sendOTPEmail = async function (req, res, next) {

    try {
        // res.setHeader('Content-Type', 'application/json');
        const partnerId = Number(req.headers['x-partner-id']) || 1;
        var err, _userRows, emailSent, errorMessage;
        var randomFixedInteger = function (length) {
            return Math.floor(Math.pow(10, length - 1) + Math.random() * (Math.pow(10, length) - Math.pow(10, length - 1) - 1));
        }
        var email = req.body.email;
        var userId = req.user.id;
        if (req.user.id !== -1){
            const respData = await verifyEmailId(userId, email, partnerId);
            if (!respData.success) {
                return ReS(res, {
                    verified: false, success: false, error: respData.msg, msg: respData.msg, errorCode: CONFIG.LOGINERRORCODE.INVALIDMOBILE
                });
            }
        }

        let otpDigits = req.user.id == -1 ? 6 : 4;
        let tempUsers, otpSent = 0;
        const otpSendLimit = CONFIG.LOGINERRORCODE.RESENDLIMIT;

        [err, tempUsers] = await to(User.getTemp({ 'mobile': email, 'partner': partnerId }));
        if (err) throw err;

        if (tempUsers && tempUsers.length > 0) {
            otpSent = tempUsers[0].otpsend;
            const blockDuration = CONFIG.LOGINERRORCODE.BLOCKDURATION;

            const otpGenerateTime = new Date(tempUsers[0].createdat);
            const currentTime = new Date();

            let diff = blockDuration - ((currentTime - otpGenerateTime) / (1000 * 60));
            if (otpSent >= otpSendLimit) {
                if (diff > 0) {
                    diff = parseInt(diff);
                    errorMessage = `Verification Disabled, please try after some time. `;
                    return ReS(res, {
                        verified: false, success: false, error: errorMessage, msg: errorMessage
                    });
                } else {
                    // User Unblocked after 30 minutes , now sentOtp count starts from 0
                    otpSent = 0;
                }

            }

            const resendDuration = CONFIG.LOGINERRORCODE.RESENDDURATION;
            diff = (currentTime - otpGenerateTime) / 1000;   //seconds
            if (diff < resendDuration) {   // 3 minutes gap at lease between 2 send OTP
                errorMessage = `Please wait for ${resendDuration} seconds before requesting new OTP`;
                return ReS(res, {
                    verified: false, success: false, error: errorMessage, msg: errorMessage, errorCode: CONFIG.LOGINERRORCODE.RESENDBEFORETIME, disableOTPSend: otpSent + 1 >= otpSendLimit
                });
            }

        }
        var otp = randomFixedInteger(otpDigits);

        [err, emailSent] = await to(sendEmailFn(email, otp, req.user));
        if (emailSent.success == false) {
            return ReE(res, emailSent.message, 422);
        }

        emailSent = true;
        if (emailSent) {
            var dataObj = { 'mobile': email, 'otp': otp, 'otpsend': otpSent + 1, 'partner': partnerId };
            [err, _userRows] = await to(User.addToTemp(dataObj));
            return ReS(res, {
                success: 'true', disableOTPSend: otpSent + 1 >= otpSendLimit
            });
        } else {
            errorMessage = `Email verification failed, try again later or contact support`;
            return ReS(res, { success: false, error: errorMessage, msg: errorMessage });
        }

    } catch (err) {
        next(err);
    }
}

const sendPort = async function (req, res, next) {

    try {
        if (!isDashboardUser(req)) {
            res.writeStatus("401");
            return ReS(res, {
                success: true, msg: 'Unauthorized request, incident has been reported'
            });
        }
        // res.setHeader('Content-Type', 'application/json');

        let userId = req.body.id;
        let ress = await sendEmailPortfolio();
        let ress1 = await sendLuckyCoinsPortfolio();
        if (ress && ress1) {
            return ReS(res, {
                success: 'true', useridsEmailed: ress
            });
        }
        return ReS(res, {
            success: 'false, could not perform the job'
        });


    } catch (err) {
        next(err);
    }
}

const sendinvoice = async function (req, res, next) {

    try {
        // if (!isDashboardUser(req)) {
        //     res.writeStatus("401");
        //     return ReS(res, {
        //         success: true, msg: 'Unauthorized request, incident has been reported'
        //     });
        // }
        // res.setHeader('Content-Type', 'application/json');
        let ress = await sendinvoiceviamail();
        if (ress) {
            return ReS(res, {
                success: 'true', useridsEmailed: ress
            });
        }
        return ReS(res, {
            success: 'false, could not perform the job'
        });


    } catch (err) {
        next(err);
    }
}

const createRPOrder = async function (req, res, next) {
    try {
        // res.setHeader('Content-Type', 'application/json');
        var err, rpRes, pRows;
        var rcptId = 'RCPT.' + req.user.id + '.' + parseInt(Date.now() / 1000);
        var dataObj = { 'amount': (req.body.amount * 100).toString(), 'currency': 'INR', 'receipt': rcptId };

        return ReE(res, `Not processing requests at the moment. Please try after sometime`, 500);

        [err, rpRes] = await to(creatOrderInRP(dataObj));
        if (err) {
            logger.info(err.toString());
            return ReS(res, { 'error': true, msg: err });
        }

        if (rpRes['error']) {
            logger.info(rpRes['error']);
            return ReS(res, { 'error': true, msg: rpRes['error']['description'] });
        }

        var dataPObj = { 'amount': rpRes['amount'] / 100, orderid: rpRes['id'], userid: req.user.id };
        [err, pRows] = await to(User.addToPayments(dataPObj));

        if (err) {
            logger.info(err.toString());
            return ReS(res, { 'error': true, msg: err });
        }
        return ReS(res, dataPObj);

    } catch (e) {
        next(e);
    }
}

var creatOrderInRP = async function (postData) {
    return new Promise((resolve, reject) => {
        var authHeader = 'Basic ' + new Buffer.from(CONFIG.razorpayParams.key + ':' + CONFIG.razorpayParams.secret).toString('base64');
        var options = {
            "method": "POST",
            "hostname": "api.razorpay.com",
            "port": 443,
            "path": "/v1/orders",
            "headers": {
                'Authorization': authHeader,
                "content-type": "application/json"
            }
        };

        var req = https.request(options, function (res) {
            var response = "";
            res.on('data', chunk => {
                response += chunk;
            });
            res.on('end', () => {
                try {
                    var data = JSON.parse(response);
                    resolve(data);
                } catch (e) {
                    reject(err);
                }
            });
            res.on('error', (err) => {
                reject(err);
            });
        });

        req.write(JSON.stringify(postData));
        req.end();
    });
}
const createOrderJP = async function (dataObj) {

    logger.info(dataObj);
    try {
        const apiKey = process.env.JUSPAY_KEY;
        const merchantId = process.env.JUSPAY_MID;
        const clientId = process.env.JUSYPAY_CID;
        const authorization = "Basic " + Buffer.from(apiKey + ":").toString("base64");
        const juspayUrl = (process.env.NODE_ENV === 'production') ? 'https://api.juspay.in/session' : 'https://sandbox.juspay.in/session';
        var config = {
            headers: {
                'Authorization': authorization,
                'x-merchantid': merchantId,
                'Content-Type': 'application/json'
            }
        }
        var data = await axios.post(juspayUrl, dataObj, config);

        return data;
    } catch (e) {
        throw e.response || e;
    }
}
var getJPOrderPMStatus = async function (orderId) {
    return new Promise((resolve, reject) => {
        const apiKey = process.env.JUSPAY_KEY;
        const authorization = "Basic " + Buffer.from(apiKey + ":").toString("base64");
        const juspayHost = (process.env.NODE_ENV === 'production') ? 'api.juspay.in' : 'sandbox.juspay.in';
        var options = {
            "method": "GET",
            "hostname": juspayHost,
            "path": `/orders/${orderId}`,
            "headers": {
                'Authorization': authorization,
                "content-type": "application/json",
                'x-merchantid': "tradexapp"
            }
        };
        var req = https.request(options, function (res) {
            var response = "";
            res.on('data', chunk => {
                response += chunk;
            });
            res.on('end', () => {
                let data;
                try {
                    data = JSON.parse(response);
                    resolve(data);
                } catch (e) {
                    console.log('getJPOrderPMstatus error', response, e.message);
                    reject(e);
                }
            });
            res.on('error', (err) => {
                reject(err);
            });
        });

        req.end();

    });
}

const getCashfreeBalance = async function () {
    var config = {
        headers: {
            'Authorization': `Bearer ${cashFreeAccessToken}`,
            'Content-Type': 'application/json'
        }
    }
    logger.info(`[getCashfreeBalance].......cashfree config: ${JSON.stringify(config)}, url: ${CONFIG.cashfreeParams.url}/payout/v1.2/getBalance`);
    return new Promise((resolve, reject) => {
        axios
            .get(`${CONFIG.cashfreeParams.url}/payout/v1.2/getBalance`, config)
            .then(res => {
                try {
                    logger.info(`[getCashfreeBalance].......cashfree response: ${JSON.stringify(res.data)}`);
                    resolve(res.data);
                } catch (e) {
                    logger.error(`[getCashfreeBalance].......cashfree error: ${e.message}`);
                    reject(e);
                }
            })
            .catch(error => {
                logger.error(`[getCashfreeBalance].......cashfree error: ${error.message}`);
                reject(error);
            })
    });
}

async function getPayoutStatusInCG(transferId) {
    var config = {
        headers: {
            'Authorization': `Bearer ${cashFreeAccessToken}`,
            'Content-Type': 'application/json'
        },
        params: {
            transferId: transferId
        }
    }
    logger.info(`[getPayoutStatusInCG].......transferId: ${transferId}, cashfree config: ${JSON.stringify(config)}, url: ${CONFIG.cashfreeParams.url}/payout/v1.2/getTransferStatus`);
    return new Promise((resolve, reject) => {
        axios
            .get(`${CONFIG.cashfreeParams.url}/payout/v1.1/getTransferStatus`, config)
            .then(res => {
                try {
                    logger.info(`[getPayoutStatusInCG].......cashfree response: ${JSON.stringify(res.data)}`);
                    resolve(res.data);
                } catch (e) {
                    logger.error(`[getPayoutStatusInCG].......cashfree error: ${e.message}`);
                    reject(e);
                }
            })
            .catch(error => {
                logger.error(`[getPayoutStatusInCG].......cashfree error: ${error.message}`);
                reject(error);
            })
    });
}

const createPayoutInCG = async function (postData) {
    var config = {
        headers: {
            'Authorization': `Bearer ${cashFreeAccessToken}`,
            'Content-Type': 'application/json'
        }
    }
    return new Promise((resolve, reject) => {
        axios.post(`${CONFIG.cashfreeParams.url}/payout/v1/requestTransfer`, postData, config)
            .then(res => {
                try {
                    resolve(res.data);
                } catch (e) {
                    reject(e);
                }
            })
            .catch(error => {
                reject(error);
            })
    });
}

const createPayoutInRP = async function (postData) {
    return new Promise((resolve, reject) => {
        var authHeader = 'Basic ' + new Buffer.from(CONFIG.razorpayParams.key + ':' + CONFIG.razorpayParams.secret).toString('base64');
        var options = {
            "method": "POST",
            "hostname": "api.razorpay.com",
            "port": 443,
            "path": "/v1/payouts",
            "headers": {
                'Authorization': authHeader,
                "content-type": "application/json"
            }
        };
        var req = https.request(options, function (res) {
            var response = "";
            res.on('data', chunk => {
                response += chunk;
            });
            res.on('end', () => {
                try {
                    var data = JSON.parse(response);
                    resolve(data);
                } catch (e) {
                    reject(err);
                }
            });
            res.on('error', (err) => {
                reject(err);
            });
        });
        req.write(JSON.stringify(postData));
        req.end();
    });
}


const validatePAN = async function (postData, partnerId) {
    const partner = await PartnerService.getPartner(partnerId);
    await getCashFreeAccessToken()
    var config = {
        headers: {
            'client_id': partnerId == 1 ? CONFIG.decentro.client_id : process.env[`${partner.name.toUpperCase()}_DECENTRO_CLIENT_ID`],
            'client_secret': partnerId == 1 ? CONFIG.decentro.client_secret : process.env[`${partner.name.toUpperCase()}_DECENTRO_CLIENT_SECRET`],
            'module_secret': partnerId == 1 ? CONFIG.decentro.kyc_module_secret : process.env[`${partner.name.toUpperCase()}_DECENTRO_KYC_MODULE_SECRET`],
            'Content-Type': 'application/json'
        }
    }
    return new Promise((resolve, reject) => {
        axios
            .post(`${CONFIG.decentro.url}/kyc/public_registry/validate`, postData, config)
            .then(res => {
                try {
                    resolve(res.data);
                } catch (e) {
                    reject(e);
                }
            })
            .catch(error => {
                reject(error);
            })
    });
}
const validatePANCF = async function (postData, partnerId) {

    const partner = await PartnerService.getPartner(partnerId);

    var config = {
        headers: {
            'x-client-id': partnerId == 1 ? CONFIG.cashfreeParams.clientId : process.env[`${partner.name.toUpperCase()}_CLIENT_ID`],
            'x-client-secret': partnerId == 1 ? CONFIG.cashfreeParams.clientSecret : process.env[`${partner.name.toUpperCase()}_CLIENT_SECRET`],
            'x-api-version': '2022-10-26',
            'Content-Type': 'application/json'
        }
    }
    const urlPrefix = process.env.NODE_ENV === 'production' ? 'https://api.cashfree.com/verification' : 'https://sandbox.cashfree.com/verification';
    return new Promise((resolve, reject) => {
        axios

            .post(`${urlPrefix}/pan`, postData, config)

            .then(res => {
                try {
                    resolve(res.data);
                } catch (e) {
                    reject(e);
                }
            })
            .catch(error => {
                reject(error);
            })
    });
}
const validateBankAccount = async function (postData, logString, partnerId) {

    const partner = await PartnerService.getPartner(partnerId);
    var config = {
        headers: {
            'client_id': process.env[`${partner.name.toUpperCase()}_DECENTRO_CLIENT_ID`],
            'client_secret': process.env[`${partner.name.toUpperCase()}_DECENTRO_CLIENT_SECRET`],
            'module_secret': process.env[`${partner.name.toUpperCase()}_DECENTRO_ACCOUNTS_MODULE_SECRET`],
            'provider_secret': process.env[`${partner.name.toUpperCase()}_DECENTRO_ACCOUNTS_PROVIDER_SECRET`],
            'Content-Type': 'application/json'
        }
    }
    return new Promise((resolve, reject) => {
        axios
            .post(`${CONFIG.decentro.url}/core_banking/money_transfer/validate_account`, postData, config)
            .then(res => {
                try {
                    console.log(logString + JSON.stringify(res.data));
                    resolve(res.data);
                } catch (e) {
                    console.log(logString + 'Decentro API failed *** ');
                    reject(e);
                }
            })
            .catch(error => {
                //logger.error(JSON.stringify(error));
                console.log(logString + 'Decentro API failed *** ');
                console.log(logString);
                reject(error);
            })
    });
}
const validateBankAccountCF = async function (postData, logString, partnerId) {

    // if (partnerId !== 1) return {status : 'failure'};
    console.log(logString + JSON.stringify(postData));
    await getCashFreeAccessToken(partnerId);
    var config = {
        headers: {
            'Authorization': `Bearer ${cashFreeAccessToken}`,
            'Content-Type': 'application/json',
            'accept': 'application/json'
        }
    }
    const params = new url.URLSearchParams(postData);
    const urlPrefix = process.env.NODE_ENV === 'production' ? 'https://payout-api.cashfree.com' : 'https://payout-gamma.cashfree.com';
    return new Promise((resolve, reject) => {
        axios
            .get(`${urlPrefix}/payout/v1.2/validation/bankDetails?${params}`, config)
            .then(res => {
                try {
                    console.log(logString + JSON.stringify(res.data));
                    resolve(res.data);
                } catch (e) {
                    console.log(logString + 'Cashfree API failed *** ');
                    reject(e);
                }
            })
            .catch(error => {
                console.log(logString + 'Cashfree API failed *** ');
                reject(error);
            })
    });
}
const addBeneficiaryInCG = async function (postData, partnerId) {
    await getCashFreeAccessToken(parseInt(partnerId));
    var config = {
        headers: {
            'Authorization': `Bearer ${cashFreeAccessToken}`
        }
    }
    return new Promise((resolve, reject) => {
        axios.post(`${CONFIG.cashfreeParams.url}/payout/v1/addBeneficiary`, postData, config)
            .then(res => {
                try {
                    resolve(res.data);
                } catch (e) {
                    reject(e);
                }
            })
            .catch(error => {
                reject(error);
            })
    });
}

const removeBeneficiaryInCG = async function (postData, partnerId) {
    await getCashFreeAccessToken(parseInt(partnerId));
    var config = {
        headers: {
            'Authorization': `Bearer ${cashFreeAccessToken}`
        }
    }
    return new Promise((resolve, reject) => {
        axios.post(`${CONFIG.cashfreeParams.url}/payout/v1/removeBeneficiary`, postData, config)
            .then(res => {
                try {
                    resolve(res.data);
                } catch (e) {
                    reject(e);
                }
            })
            .catch(error => {
                reject(error);
            })
    });
}


const addContactInRP = async function (postData) {
    return new Promise((resolve, reject) => {
        var authHeader = 'Basic ' + new Buffer.from(CONFIG.razorpayParams.key + ':' + CONFIG.razorpayParams.secret).toString('base64');
        var options = {
            "method": "POST",
            "hostname": "api.razorpay.com",
            "port": 443,
            "path": "/v1/contacts",
            "headers": {
                'Authorization': authHeader,
                "content-type": "application/json"
            }
        };
        var req = https.request(options, function (res) {
            var response = "";
            res.on('data', chunk => {
                response += chunk;
            });
            res.on('end', () => {
                try {
                    var data = JSON.parse(response);
                    resolve(data);
                } catch (e) {
                    reject(err);
                }
            });
            res.on('error', (err) => {
                reject(err);
            });
        });
        req.write(JSON.stringify(postData));
        req.end();
    });
}

const addFundAccountInRP = async function (postData) {
    return new Promise((resolve, reject) => {
        var authHeader = 'Basic ' + new Buffer.from(CONFIG.razorpayParams.key + ':' + CONFIG.razorpayParams.secret).toString('base64');
        var options = {
            "method": "POST",
            "hostname": "api.razorpay.com",
            "port": 443,
            "path": "/v1/fund_accounts",
            "headers": {
                'Authorization': authHeader,
                "content-type": "application/json"
            }
        };
        var req = https.request(options, function (res) {
            var response = "";
            res.on('data', chunk => {
                response += chunk;
            });
            res.on('end', () => {
                resolve(JSON.parse(response));
            });
            res.on('error', (err) => {
                reject(err);
            });
        });
        req.write(JSON.stringify(postData));
        req.end();
    });
}

var getRPOrderPMStatus = async function (orderId) {
    return new Promise((resolve, reject) => {
        var authHeader = 'Basic ' + new Buffer.from(CONFIG.razorpayParams.key + ':' + CONFIG.razorpayParams.secret).toString('base64');
        var options = {
            "method": "GET",
            "hostname": "api.razorpay.com",
            "port": 443,
            "path": `/v1/orders/${orderId}/payments`,
            "headers": {
                'Authorization': authHeader,
                "content-type": "application/json"
            }
        };
        var req = https.request(options, function (res) {
            var response = "";
            res.on('data', chunk => {
                response += chunk;
            });
            res.on('end', () => {
                resolve(JSON.parse(response));
            });
            res.on('error', (err) => {
                reject(err);
            });
        });

        req.end();
    });
}

const getFAQs = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');

    /**
     * What is deposit balance?
        The deposit balance reflects the total funds you've added, while any deposited balance not used for investment cannot be withdrawn.
    What is winnings balance?
        Winnings from different events are credited to your winnings balance, and they can be withdrawn.
    What is bonus balance?
        Promotional cashbacks from promo codes are credited to your bonus wallet balance, and any winnings from bonus are credited to your winnings balance.
     */
    const partnerId = Number(req.headers['x-partner-id']) || 1;
    const [err, partner] = await to(PartnerService.getPartner(partnerId, null, false));
    if (err) {
        throw new Error(err)
    }
    const language = req?.user?.id !== -1 ? req?.user?.preferred_locale : 'en-IN';
    const translator = await localesService.getTranslator(language, 'wallet');
    const INDIA = {
        'wallet': [
            { q: translator('Are my funds secured?'), a: translator('Your funds are 100% secure.') },
            { q: translator('How is TDS calculated?'), a: translator('As per the new TDS (Tax deducted at source) law, effective 1st April 2023, tax will be deducted at 30% of your net winnings at the time of withdrawal.') },
            { q: translator('What is deposit balance?'), a: translator('The deposit balance reflects the total funds you\'ve added, while any deposited balance not used for investment cannot be withdrawn.') },
            { q: translator('What is earnings balance?'), a: translator('Winnings from different events are credited to your earnings balance, and they can be withdrawn') },
            { q: translator('What is a Token point?'), a: translator('Token point is a new coin for use on Tradex platform, offering users a novel way to trade, participate in contests, and earn rewards without spending real money. Earned through activities or referrals, Token points can be traded, converted into credits, or withdrawn as USDT, enriching your trading experience.') },
            { q: translator('What are new GST changes?'), a: translator('As per new govt guidelines mandate 28% GST to be charged on every deposit. After deposit, you can trade as much as you want without any additional GST\n\n- Recharge Amount = 100\n- Deposit = 78.125\n- GST (28% of Deposit) = 21.875') },
            { q: translator('What is recharge cashback?'), a: translator('We are offering cashback on a recharge amount which will be deposited in your deposit or promotional wallet. Cashback can only be used to trade on events but can not be withdrawn.') },
            { q: translator('In what cases cashback will not be given?'), a: translator('Cashback is not applicable on repetitive withdrawals and recharges. Cashback amount will not be processed in this case and is subject to be expired in real time.') },
            { q: translator('Platform fee updates'), a: translator('Platform fee is on your net profits and sell value which vary from user to user. In case you are found converting your deposit cash into winnings by buying and selling at the same price, you will be charged 1% extra platform fee. For details please visit FAQ on profile section.') }
        ],
        'refer': [
            { q: translator('What is refer and earn program?'), a: translator(`Refer & Earn is an initiative that encourages {{partner}} users to invite new (never used {{partner}} App before) users to start using {{partner}} App and get monetary benefits`, { 'partner': partner.name }) },
            { q: translator('How to redeem my earned token points?'), a: translator('Your token points are added directly in your token points balance. You can redeem directly from the wallet section or it will be auto credited to your TradeX balance at the end of each month.') },
            { q: translator('Why am I not getting referral earnings?'), a: translator('Your friend might not be trading frequently. Referral earnings are related to your friend\'s trading volume. The more they trade, the more you earn. Please check with your friends if they are trading regularly.') },]
    }
    const REST_OF_WORLD = {
        'wallet': [
            { q: translator('Are my funds secured?' ), a: translator('Your funds are 100% secure.' ) },
            { q: translator('What is deposit balance?' ), a: translator(`The deposit balance reflects the total funds you've added, while any deposited balance not used for investment cannot be withdrawn.` ) },
            { q: translator('What is earnings balance?' ), a: translator(`Winnings from different events are credited to your earnings balance, and they can be withdrawn` ) },
            { q: translator('What is a Token point?' ), a: translator(`Token point is a new coin for use on Tradex platform, offering users a novel way to trade, participate in contests, and earn rewards without spending real money. Earned through activities or referrals, Token points can be traded, converted into credits, or withdrawn as USDT, enriching your trading experience.` ) },
            { q: translator('What is Expiry date of Bonus cash ?'), a: translator('The expiration deadline for unused bonus cash is set at 60 days. Any bonus cash that remains unused beyond this 60-day period will expire.')}
        ],
        'refer': [
            { q: translator('What is refer and earn program?'), a: translator(`Refer & Earn is an initiative that encourages {{partner}} users to invite new (never used {{partner}} App before) users to start using {{partner}} App and get monetary benefits`, { 'partner': partner.name }) },
            { q: translator('How to redeem my earned token points?'), a: translator('Your token points are added directly in your token points balance. You can redeem directly from the wallet section or it will be auto credited to your TradeX balance at the end of each month.') },
            { q: translator('Why am I not getting referral earnings?'), a: translator('Your friend might not be trading frequently. Referral earnings are related to your friend\'s trading volume. The more they trade, the more you earn. Please check with your friends if they are trading regularly.') },]
    }
    const data = {
        'wallet': [ 
            { q: translator('What are new GST changes?'), a: translator(`As per new govt guidelines mandate 28% GST to be charged on every deposit. After deposit, you can trade as much as you want without any additional GST\n\n- Recharge Amount = 100\n- Deposit = 78.125\n- GST (28% of Deposit) = 21.875` ) },
            { q: translator('What is recharge cashback?'), a: translator(`We are offering cashback on a recharge amount which will be deposited in your deposit or promotional wallet. Cashback can only be used to trade on events but can not be withdrawn.` ) },
            { q: translator('In what cases cashback will not be given?' ), a: translator(`Cashback is not applicable on repetitive withdrawals and recharges. Cashback amount will not be processed in this case and is subject to be expired in real time.` ) },
            { q: translator('Platform fee updates' ), a: translator(`Platform fee is on your net profits and sell value which vary from user to user. In case you are found converting your deposit cash into winnings by buying and selling at the same price, you will be charged 1% extra platform fee. For details please visit FAQ on profile section.` ) },
            { q: translator('How is TDS calculated?' ), a: translator(`As per the new TDS (Tax deducted at source) law, effective 1st April 2023, tax will be deducted at 30% of your net winnings at the time of withdrawal.` ) },
            { q: translator('What is deposit balance?' ), a: translator(`The deposit balance reflects the total funds you've added, while any deposited balance not used for investment cannot be withdrawn.` ) },
            { q: translator('What is earnings balance?' ), a: translator(`Winnings from different events are credited to your earnings balance, and they can be withdrawn.` ) },
            { q: translator('What is Token point?' ), a: translator(`Token point is a new coin for use on Tradex platform, offering users a novel way to trade, participate in contests, and earn rewards without spending real money. Earned through activities or referrals, Token points can be traded, converted into credits, or withdrawn as USDT, enriching your trading experience.` ) },
            { q: translator('What is Expiry date of Bonus cash ?'), a: translator('The expiration deadline for unused bonus cash is set at 60 days. Any bonus cash that remains unused beyond this 60-day period will expire.')}
        ],
        'refer': [
            { q: translator('What is refer and earn program?'), a: translator(`Refer & Earn is an initiative that encourages {{partner}} users to invite new (never used {{partner}} App before) users to start using {{partner}} App and get monetary benefits`, { 'partner': partner.name }) },
            { q: translator('How to redeem my earned token points?'), a: translator('Your token points are added directly in your token points balance. You can redeem directly from the wallet section or it will be auto credited to your TradeX balance at the end of each month.') },
            { q: translator('Why am I not getting referral earnings?'), a: translator('Your friend might not be trading frequently. Referral earnings are related to your friend\'s trading volume. The more they trade, the more you earn. Please check with your friends if they are trading regularly.') },],
        INDIA, REST_OF_WORLD, ASEAN: REST_OF_WORLD, PK: REST_OF_WORLD, BD: REST_OF_WORLD
    }
    if (parseInt(partner.id) == 4) {
        //remove tds faq for predx
        data['wallet'].splice(1, 1);
        data['INDIA']['wallet'].splice(1, 1);
    }

    if (req?.user?.id !== -1 && req?.user?.region !== 'INDIA') {
        data['wallet'] = REST_OF_WORLD['wallet'];
    }

    return ReS(res, {
        success: true, data

    });
}

const isPinBlocked = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        const region = req.user.region || 'INDIA';
        if (region != 'INDIA') {
            return ReS(res, { success: true, isPinBlocked: false, isPinValid: true });
        }
        const pinCode = req.body.pinCode;

        let err, response;

        [err, response] = await to(getPinCodeDetails(pinCode));
        if (err) throw err;

        let responseData;
        if (response.data) {
            responseData = response.data;
        } else {
            return ReS(res, { success: false, message: 'Postal Code API not working' });
        }
        if (responseData[0]['Status'] == 'Success') {
            const str = responseData[0]['PostOffice'][0]['State'];
            const arr = [];
            if (arr.indexOf(str) > -1) {
                return ReS(res, { success: true, isPinBlocked: true, isPinValid: true });
            } else {
                return ReS(res, { success: true, isPinBlocked: false, isPinValid: true });
            }

        } else {
            return ReS(res, { success: true, isPinBlocked: true, isPinValid: false });
        }

    } catch (err) {
        next(err);
    }
}

const getExchangeRate = async (req, res, next) => {
    const user = req?.user;
    const platform = req.headers['x-platform'];
    const version = parseInt(req.headers['version']);
    const language = user?.preferred_locale ?? 'en-IN';
    const translator = await localesService.getTranslator(language, 'wallet');
    const signUpCountry = user?.signup_country ?? 'IN';
    const fromCurrency = req?.body?.currency ?? req?.query?.currency ?? getCurrency(signUpCountry, platform, version);
    const [err, result] = await to(RegionService.getExchangeRate(fromCurrency, CONFIG.CURRENCIES.INR));
    if (err) throw err;

    result.from = translator(result.from);
    return ReS(res, { success: true, result });
}

const getHistoryTournaments = async (req, res, next) => {
    try {
        // res.setHeader('Content-Type', 'application/json');
        let err, page = 1, limit = 10, _historyRows, count = 0;
        const userid = req.user.userid;
        if (req.body.probeid) {
            const probeid = req.body.probeid;
            [err, _historyRows] = await to(History.getHistory(probeid, userid));
            if (err) return ReS(res, {
                success: false
            });
            count = _historyRows.length;
        }
        else {
            let _tempHistoryRows;
            _historyRows = [];
            if (req.body.page && req.body.limit) {
                page = req.body.page;
                limit = req.body.limit;
            }
            const start_idx = (page - 1) * limit, end_idx = page * limit;
            [err, _tempHistoryRows] = await to(History.getClosedEventForUserTournaments(userid));
            if (err) return ReS(res, {
                success: false
            });
            count = _tempHistoryRows.length;
            for (let i = start_idx; i < Math.min(end_idx, count); i++)
                _historyRows.push(_tempHistoryRows[i]);
        }
        return ReS(res, {
            success: true,
            historyRows: _historyRows,
            total: count,
            page: page,
            limit: limit
        });
    } catch (err) {
        next(err);
    }
}
getCashFreeAccessToken();

const getRegions = async (req, res) => {
    try {
        const regions = await Location.getRegions();
        return ReS(res, {
            regions,
        })
    } catch (e) {
        return ReE(res, e.message, 500)
    }
}

const getPartners = async (req, res) => {
    try {
        const partners = await PartnerService.getPartners();
        return ReS(res, {
            partners,
        });
    } catch (e) {
        return ReE(res, e.message, 500)
    }
}

const getBankCodes = async function (req, res, next) {
    const country = req.query.country;
    try {
        const bankCodes = await getBankCodesd24(country);
        const modifiedBankCodes = bankCodes.map(bank => {
            return {
                key: bank.code,
                label: bank.name,
            };
        });

        return ReS(res, { "options": modifiedBankCodes });

    } catch (error) {
        next(error);
    }
}

const getUpdateconfigAskX = async function (req, res, next) {
    const country = req.query.country;
    try {
        const askxConfig = await PartnerService.getPartnerServiceConfiguration(
            "askxConfig",
            {partner : {id : 1}, signup_country : 'IN', region : 'INDIA'}
        );

        return ReS(res, askxConfig?.config);

    } catch (error) {
        next(error);
    }
}

module.exports.getRegions = getRegions;
module.exports.getConfig = getConfig;
module.exports.sendOTP = sendOTP;
module.exports.sendOTPEmail = sendOTPEmail
module.exports.createRPOrder = createRPOrder;
module.exports.createOrderCF = createOrderCF;
module.exports.getCFOrderStatus = getCFOrderStatus;
module.exports.getCashFreeAccessToken = getCashFreeAccessToken;
module.exports.createPayout = createPayout;
module.exports.getCGStatus = getCGStatus;
module.exports.getCashFreePaymentToken = getCashFreePaymentToken;
module.exports.getRPOrderPMStatus = getRPOrderPMStatus;
module.exports.addFundAccountInRP = addFundAccountInRP;
module.exports.addContactInRP = addContactInRP;
module.exports.createPayoutInRP = createPayoutInRP;
module.exports.createPayoutInCG = createPayoutInCG;
module.exports.addBeneficiaryInCG = addBeneficiaryInCG;
module.exports.removeBeneficiaryInCG = removeBeneficiaryInCG;
module.exports.validatePAN = validatePAN;
module.exports.isPinBlocked = isPinBlocked;
module.exports.validateBankAccount = validateBankAccount;
module.exports.getHistoryTournaments = getHistoryTournaments;
module.exports.getTutorialList = getTutorialList;
module.exports.getFAQs = getFAQs;
module.exports.isAppAllowd = isAppAllowd;
module.exports.sendPort = sendPort;
module.exports.sendinvoice = sendinvoice;
module.exports.createOrderJP = createOrderJP;
module.exports.getJPOrderPMStatus = getJPOrderPMStatus;
module.exports._getPaymentConfig = _getPaymentConfig;
module.exports.validatePANCF = validatePANCF;
module.exports.validateBankAccountCF = validateBankAccountCF;
module.exports.getCashfreeBalance = getCashfreeBalance;
module.exports.getPayoutStatusInCG = getPayoutStatusInCG;
module.exports.getExchangeRate = getExchangeRate;
//module.exports.getClosedEvent = getClosedEvent;
module.exports.getPartners = getPartners;
module.exports.getBankCodes = getBankCodes;
module.exports.getUpdateconfigAskX = getUpdateconfigAskX;