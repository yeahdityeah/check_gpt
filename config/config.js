require('dotenv').config();
let CONFIG = {}; //Make this global to use all over the application
CONFIG.force_app_update_secret = process.env.FORCE_APP_UPDATE_SECRET
CONFIG.environment = process.env.NODE_ENV || 'development';
CONFIG.port = process.env.PORT || '4000';
CONFIG.db_dialect = process.env.DB_DIALECT || 'mysql';
CONFIG.db_host = process.env.DB_HOST || 'localhost';
CONFIG.db_port = process.env.DB_PORT || '3306';
CONFIG.db_name = process.env.DB_NAME || 'name';
CONFIG.db_user = process.env.DB_USER || 'root';
CONFIG.db_password = process.env.DB_PASSWORD || 'db-password';
CONFIG.jwt_encryption = process.env.JWT_ENCRYPTION || 'mistake';
CONFIG.jwt_encryption_v2 = process.env.AUTH_ENCRYPTION_KEY || 'mistake';
CONFIG.jwt_expiration = process.env.JWT_EXPIRATION || '10000d';
CONFIG.jwt_temp_expiration = 30000;
CONFIG.amqp_host = process.env.AMQP_HOST || 'amqp://guest:guest@localhost';
CONFIG.videoPlugin = 'agora';
CONFIG.solrHost = 'http://localhost:8983/solr/theox';
CONFIG.ux_cam_key = 'a7plzfsep5z6ckq';
CONFIG.SENDGRID_API_KEY = '';
CONFIG.CREATE_EVENT_USERS = [177018, 177073];
CONFIG.CREATE_NORMAL_EVENT_USERS = [177018, 177073];
CONFIG.referralLeakIds = [177018, 507821, 1899877, 1027730, 615408, 155727, 2589240, 2606915, 560748, 399998, 2609082, 1931112, 1042335, 638245, 1115748, 2470992, 160894, 279680, 559927, 489416, 655634, 156038, 1078674, 31038, 29, 2571975, 271009, 298730, 269008, 536880, 385519, 796134, 38950, 790884, 800006, 2641030, 2634648, 721661, 1283830, 276412, 2626601, 464137, 164745, 409238, 255560, 1578885, 585676, 404442, 2569597, 325334, 141255, 2599532, 1096015, 145401, 1472677, 1914295, 2591818, 251532, 2229049, 719835, 2572265, 2616218, 1011844, 1278203, 263114, 41210, 2569875, 1272168, 418905, 264583, 1388783, 2593311, 2326614, 2595084, 571466, 460502, 360103, 1091292, 304501, 2599067, 542319, 184988, 347638, 650653, 554477, 402099, 130917, 411981, 140885, 266157, 288576, 177899, 337275, 433673, 1078943, 2612674, 4577, 2580649, 473187, 458634, 2584591, 2616813, 2593690, 1171331, 2606989, 2235610, 2246878, 2473090, 340470, 405872, 2500500];

const PARTNER_STAGING_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxEkpV2cXRBeoJfKVkSjk
dbZz4a/5yW5XgMgf7PdOcH/rx6ET2+xQC/ci+zKegA/LdBNrmkTyy/v4g75haN6A
+h3hHTGSi/ESX3jrdljDsR5OfkTMrkiDHZmEFf2i2nE4jNc6tJMe78hYxz265s88
J/9eq0mr5El+fo7eWD0Xy/bTqT7royNe+K8mptcY+lMO4H15DlZMNRQENSN9sRcw
jjZAfbxr+Io5T8c8Tlqbjbl6is4ztult0HzUUReeMBGJSvay2as9pyN9JzttL1d4
+BqbuCtB8HON8KzvDh44H5qPXpYM9eRVxekd3A5K67mj6p1FEvak7J5asUljFDau
7wIDAQAB
-----END PUBLIC KEY-----`;

const PARTNER_STAGING_PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEAxEkpV2cXRBeoJfKVkSjkdbZz4a/5yW5XgMgf7PdOcH/rx6ET
2+xQC/ci+zKegA/LdBNrmkTyy/v4g75haN6A+h3hHTGSi/ESX3jrdljDsR5OfkTM
rkiDHZmEFf2i2nE4jNc6tJMe78hYxz265s88J/9eq0mr5El+fo7eWD0Xy/bTqT7r
oyNe+K8mptcY+lMO4H15DlZMNRQENSN9sRcwjjZAfbxr+Io5T8c8Tlqbjbl6is4z
tult0HzUUReeMBGJSvay2as9pyN9JzttL1d4+BqbuCtB8HON8KzvDh44H5qPXpYM
9eRVxekd3A5K67mj6p1FEvak7J5asUljFDau7wIDAQABAoIBAQCJeB/fGdFenB7k
rNf5eSVAF89i8cdEPuZDyGUrpiymd8De6D4rWX7aUnSKb3I4iFdabTuAKOfO2yK6
yfwY4TR9d62wr4ZOQkE24k4ubY5onqwknPSo3xoNAfZTHHcQ/Bi58wcnbp5NGwiq
Sd57RgqAjMZ1ujwLvzk7U73/GJJxAqt5IddDcIIK58ZB2LIEKKtVzHes3i0cj905
Cjy68ACDOiFWhv3aPP+OlBSDmye4T6BaIljjs/TStOYc+dzZECUHoG61prCiEWsW
yp97JhFIPDYQ8952+SlY0flmhQGvepfl3NNkxTvfXd12JpfX2ONvP1ApFIxom3zn
9/Fo06ABAoGBAPEeQYYfl8TfcwLvwA5hBmb8iovvuYeV9w1F4LPE8b+x+ElLxnAO
p2Hj4lVMLQhz5bsMX9EnDn2CRm9bRtU5Ex7iTypBURYPflpT6WDMB9OKwQDXlu1G
YlD/dY4tHjb4329crK4NFNAcLgvEW9542xLFkN+xImVxda9hrnNiBpABAoGBANBm
ihMfOvdDINZAfbe6zKfmIurs/v+ay9u6cJNQAbQbRPZQ2kR7EA8jGV/oSKEKvPi2
41D/i3fSsg2mu5u+P61Sql1z9mq37sY/4y8CLp6gZGgnp0T7O5BKvnUx4dLd5h0w
NMKH3u3XUoiB8oUWZYSIh4tNFo+wkbkyQHqZNj7vAoGAPhtuA09F95ca9+mrjcie
Lo7kXRE9t9gAD/Is5AFZx+ferXqQPbL4mHVrik8Z1nCL/zc7wxMNX3TcEbjwMOIH
s8/VVmwGp+kLwdaVabKEXZADEOV3YdzcXELBFAM5Ii3O18+GRzrlXomzrqJAi7iT
rW0oWQY2duzXxHojxmK8kAECgYBG0PFOeihRaZA4/gU6b9GnpD5tUkd8mB959SrY
BDHv/+w5P1RMPP1CB41R198GSl3Yrl0kYxIDj6dNmEDcNZPx08tsokE0FnifCYqr
qLQq1xoHgqIGgNDGwX9i16aDP0A43u6uw/jvHWJAXNgKfYfVt4dHwNRP05JROlBK
2NFkJQKBgQCEoZBAWvXBOVJSTO0Dnh+8awDY/gLQNy/hdEcBSuWMiq83vXsRyWLZ
JaoCxnKk7bG1y4LiQcYBBTQRfrNeQ13msbWfpTLsQHLHFZ9HWPL0gU0ivyaE+/QE
NANOZ9torGLK0qR2eguzW3k0EMOTByFoedvjWZaOkan6NHZS8iBbPA==
-----END RSA PRIVATE KEY-----`;

CONFIG.PARTNER_METAONE_PUBLIC_KEY = (process.env.PARTNER_METAONE_PUBLIC_KEY || PARTNER_STAGING_PUBLIC_KEY).replace(/@@@/g, '\n');

CONFIG.PARTNER_METAONE_PRIVATE_KEY = (process.env.PARTNER_METAONE_PRIVATE_KEY || PARTNER_STAGING_PRIVATE_KEY).replace(/@@@/g, '\n');

CONFIG.PARTNER_MYMASTER11_PUBLIC_KEY = (process.env.PARTNER_MYMASTER11_PUBLIC_KEY || PARTNER_STAGING_PUBLIC_KEY).replace(/@@@/g, '\n');

CONFIG.PARTNER_MYMASTER11_PRIVATE_KEY = (process.env.PARTNER_MYMASTER11_PRIVATE_KEY || PARTNER_STAGING_PRIVATE_KEY).replace(/@@@/g, '\n');

var envConfig = {};

switch (CONFIG.environment) {
    case 'production':
        envConfig = require('./config.prod.js');
        break;
    case 'staging':
    case 'development':
        envConfig = require('./config.test.js');
        break;
    default:
        envConfig = require('./config.test.js');
        break;

}

CONFIG.cashfreeParams = {
    clientId: 'CF174257CF37V1SPE6I71C14AJJ0',
    clientSecret: '2be6e6f0fa248315ab3c613ae271a2c49b8a0b97',
    url: 'https://payout-gamma.cashfree.com',
    pmClientId: '81762ed247d4d3708fbd3059e26718',
    pmClientSecret: 'f74060fa76115046bef25de9d89eb350e46a771c',
    pmURL: 'https://sandbox.cashfree.com',
    payoutURL: 'https://payout-gamma.cashfree.com'
};

CONFIG.cashfreeKYCParams = {
    clientId: process.env.CF_KYC_CLIENTID,
    clientSecret: process.env.CF_KYC_CLIENTSECRET,
    url: 'https://payout-api.cashfree.com'
};

CONFIG.twilio = {
    sid: process.env.TWILIO_SID,
    token: process.env.TWILIO_TOKEN
};

CONFIG.MOEngage = {
    AppId: process.env.ME_APP_ID,
    ApiSecret: process.env.ME_API_SECRET
};

CONFIG.chatbotUsers = [177018];
CONFIG.APIPARTNERUSERS = [179685];


// CONFIG.decentro = {
//     // 'url': 'https://in.staging.decentro.tech',
//     // 'url': 'https://in.decentro.tech',
//     'client_id': 'theox_prod',
//     'client_secret': 'wBMwThGIggs8Kbw0sGjzW2OAlwT52cxM',
//     'kyc_module_secret': 'Oq9lulk84ygaLvx2yyHsBZnvfb0bzdJR'
// };


for (let key in envConfig) {
    CONFIG[key] = envConfig[key];
}

// CONFIG['Kafka']['brokers'] = process.env.KAFKA_HOSTS.split(',')

if (CONFIG.environment === 'development') {
    CONFIG.redis = {
        host: '127.0.0.1',
        port: 6379
    };
}
// CONFIG.baseServerURL = 'http://3.138.41.179';
// CONFIG.serverURL = 'http://3.138.41.179/v3';
CONFIG.tradingFeeBaseUrl = 'http://trading-server:9002/fee/calculate';
CONFIG.embeddingUrl = 'http://embedding-recommendation:8000/addProbeEmbedding';

CONFIG.msg91Key = process.env.MSG91_KEY;

CONFIG.firebaseAPIKey = process.env.FIREBASE_APIKEY;

CONFIG.zoom = { APIKey: process.env.ZOOM_APIKEY, APISecret: process.env.ZOOM_APISECRET };

CONFIG.deductions = {
    withdraw: { amount: 3.25 },
    recharge: { amount: 2.25 },
    settlement: { perc: 0.05 }
};

CONFIG.liveStatsAPI = {
    youtubeApiKey: process.env.YOUTUBE_APIKEY,
    twitterAuthToken: process.env.TWITTER_AUTHTOKEN,
    cricketApiKey: process.env.CRICKET_APIKEY
};

CONFIG.settlementCharges = 0.1;
CONFIG.rechargeCharges = 0;
CONFIG.withdrawCharges = 5;

CONFIG.referralBonus = 10;
CONFIG.refereeBonus = 10;
CONFIG.joiningBonus = 10;
CONFIG.couponsCap = 5;
CONFIG.redeemRequestUpperLimit = 10000;
CONFIG.redeemRequestPremiumUpperLimit = 10000;
CONFIG.redeemRequestLowerLimit = 200;
CONFIG.redeemAutoPRocessLimit = 2000;
CONFIG.redeemPremiumAutoPRocessLimit = 2000;
CONFIG.cashbackUpperLimit = 1000;

CONFIG.MAX_REFERRAL_EARN_LIMIT = 1000000;
CONFIG.REFERRAL_PERCENTAGE = 25;
CONFIG.REFERRER_PROMO_AMOUNT = 50;
CONFIG.REFERREE_PROMO_AMOUNT = 100;
CONFIG.REFERRAL_PERCENTAGE_NEW = 19;
CONFIG.REFERRAL_END_DATE_MS = 1736063588000;
CONFIG.REFERRAL_STARTING_USERID = 23800;

CONFIG.takeRate = [{ range: [0, 100], fee: 1 }];
CONFIG.takeRatePercentage = 1;

CONFIG.MIN_ADD_LIQUIDITY = 500;
CONFIG.MAX_ADD_LIQUIDITY = 10000000;

CONFIG.MIN_REMOVE_LIQUIDITY = 1;
CONFIG.MAX_REMOVE_LIQUIDITY = 10000000;

CONFIG.TRADING_FEE_TO_LP_MULTIPLIER = 0.5;

CONFIG.REQUEST_TERMINATION_THRESHOLD = 55000;
CONFIG.INSTANT_MATCH_POSITION_MAX_ALLOWED = 5000;
CONFIG.CDA_POSITION_MAX_ALLOWED = 10000;
CONFIG.PROMO_MOVEMENT_PERCENT = 1;

CONFIG.TDS_DEDUCT_PERCENTAGE = 0;
CONFIG.TDS_DEDUCT_THRESHHOLD = 10000;

CONFIG.SLIPPAGE_FACTOR_MIN_CONST = 1;
CONFIG.SLIPPAGE_FACTOR_MAX_CONST = 4000000;

CONFIG.LOGINERRORCODE = { RETRY: 100, RESEND: 101, BLOCKED: 102, MOBILEINVALID: 103, RESENDBEFORETIME: 104, OTPEXPIRE: 105, OTPDISABLED: 106, INVALIDMOBILE: 107, RETRYLIMIT: 3, BLOCKDURATION: 30, RESENDLIMIT: 3, RESENDDURATION: 30, OTPVALIDITY: 3 }; // BLOCK duration = 5 min , resend duration 30 sec, otpValidity = 3 min

CONFIG.SUSPEND_DURATION = 24;
CONFIG.GPE_ENABLED = true;
CONFIG.MAX_ALLOWED_PRIVATE_EVENTS_COUNT = 2;
CONFIG.MAX_ALLOWED_RETENTION_PRIVATE_EVENTS_COUNT = 10;
CONFIG.EXCLUDE_LIST_INTERNAL_USERS = [122426, 31038, 193297, 433061, 29645, 603727, 396569, 977627, 1970715];
CONFIG.TIMESTAMP_TDS_LIVE = '2024-03-31 18:30:00.000000';

CONFIG.KOSTAR_BLOCKED_USERS = [2519859, 2549498, 2519271, 2545450, 2561613, 2519977, 2510667, 2520811, 2538346, 2520592, 2520640, 2545716, 2520691, 2561801, 2548960, 2519841];

CONFIG.PREVENTSLIPPAGE = {
    allowedSlippage: 4,
}
CONFIG.MOBIKWIK_IMAGE_URL = 'assets/icons/mobikwik.png';
CONFIG.IPL_TAGS = ['Chennai','Mumbai','Delhi','Hyderabad','Lucknow','Punjab','Gujarat','Rajasthan','Bengaluru','Kolkata', 'T20 League 2024', 'IND', 'AUS', 'ENG', 'PAK'];
CONFIG.INDIA_PRIORITY_SUBCAT = ['World Cup', 'World', 'ASIA CUP 2023', 'Chennai','Mumbai','Delhi','Hyderabad','Lucknow','Punjab','Gujarat','Rajasthan','Bengaluru','Kolkata','T20 League 2024', 'IND', 'AUS', 'ENG', 'PAK'];
CONFIG.INTERNATIONAL_PRIORITY_SUBCAT = ['FOOTBALL'];
CONFIG.CLUB_EVENT_CATEGORIES = [
    {text:'finance',image_url:'assets/icons/club/finance.svg'},
    {text:'sports',image_url:'assets/icons/club/sports.svg'},
    {text:'news',image_url:'assets/icons/club/news.svg'},
    {text:'politics',image_url:'assets/icons/club/politics.svg'},
    {text:'media',image_url:'assets/icons/club/media.svg'},
]

CONFIG.CURRENCIES = {
    INR: 'INR',
    USDT: 'USDT',
    BTC: 'BTC',
    BDT: "BDT", // 'BDT' coinmarketcap id for BDT bangladesi taka, 
    PKR: 'PKR', // 'PKR' coinmarketcap id for Pakistani Rupee,
    USD: 'USD',
    IDR: 'IDR'
}
CONFIG.CURRENCIES_PLACEHOLDER = {
    BDT: "Enter Amount in TAKA",
    PKR: "Enter Amount in PKR",
    USDT: "Enter amount in USDT",
    INR: "Enter amount",
    BTC : "Enter amount in BTC",
    CAD : "Enter amount in CAD"
}

CONFIG.LOCALES_MAPPING = {
    "en-IN" : "enIN",
    "bn-BD" : "bnBD"
}

CONFIG.withdrawalConfig = {
    'INDIA': {
        withdrawCharges : 5,
        redeemRequestUpperLimit : 10000,
        redeemRequestLowerLimit: 200,
        enablePromoCode: true,
        pgArray: ['cashfree'],
        pg: [
            {
                value: 'cashfree',
                label: 'Cashfree',
                withdrawCharges : 5,
                redeemRequestUpperLimit : 10000,
                redeemRequestLowerLimit: 200,
                enablePromoCode: true,
                isKycRequired: true
            }
        ]
    },
    'REST_OF_WORLD': {
        disclaimers: [{
            text: 'We support ERC20 & TRC20 networks. For details please refer this.',
            link: 'https://academy.tradexapp.co/',
            linkText: 'refer this'
        }, {
            text: 'Once wallet address gets verified, you won’t be able to change that.'
        }],
        gatewayFees: '1%',
        withdrawCharges : 0,
        redeemRequestUpperLimit : 10000,
        redeemRequestLowerLimit: 1000,
        enablePromoCode: false,
        pgArray: ['triplea'],
        pg : [
            {
                value: 'triplea',
                label: 'Crypto',
                disclaimers: [{
                    text: 'We support ERC20 & TRC20 networks. For details please refer this.',
                    link: 'https://academy.tradexapp.co/',
                    linkText: 'refer this'
                }, {
                    text: 'Once wallet address gets verified, you won’t be able to change that.'
                }],
                gatewayFees: '1%',
                withdrawCharges : 0,
                redeemRequestUpperLimit : 10000,
                redeemRequestLowerLimit: 1000,
                enablePromoCode: false,
                icon : 'assets/icons/triplea.png',
                selectedIcon : 'assets/icons/triplea_white.png',
                currency : process.env.NODE_ENV !== 'production' ? 'BTC' : 'USDT',
                currencyIcon: `assets/icons/${process.env.NODE_ENV !== 'production' ? 'BTC' : 'USDT'}.png`,
                isKycRequired: false
            }
        ]
    },
    ASEAN: {
        disclaimers: [{
            text: 'We support ERC20 & TRC20 networks. For details please refer this.',
            link: 'https://academy.tradexapp.co/',
            linkText: 'refer this'
        }, {
            text: 'Once wallet address gets verified, you won’t be able to change that.'
        }],
        gatewayFees: '1%',
        withdrawCharges : 0,
        redeemRequestUpperLimit : 10000,
        redeemRequestLowerLimit: 1000,
        enablePromoCode: false,
        pgArray: ['triplea'],
        pg : [
            {
                value: 'triplea',
                label: 'Crypto',
                disclaimers: [{
                    text: 'We support ERC20 & TRC20 networks. For details please refer this.',
                    link: 'https://academy.tradexapp.co/',
                    linkText: 'refer this'
                }, {
                    text: 'Once wallet address gets verified, you won’t be able to change that.'
                }],
                gatewayFees: '1%',
                withdrawCharges : 0,
                redeemRequestUpperLimit : 10000,
                redeemRequestLowerLimit: 1000,
                enablePromoCode: false,
                icon : 'assets/icons/triplea.png',
                selectedIcon : 'assets/icons/triplea_white.png',
                currency : process.env.NODE_ENV !== 'production' ? 'BTC' : 'USDT',
                currencyIcon: `assets/icons/${process.env.NODE_ENV !== 'production' ? 'BTC' : 'USDT'}.png`,
                isKycRequired: false
            }
        ]
    },
    BD: {
        disclaimers: [{
            text: 'Amount will be credited to bkash wallet associated with your registered mobile number'
        }],
        withdrawCharges : 0,
        redeemRequestUpperLimit : 10000,
        redeemRequestLowerLimit: 1000,
        enablePromoCode: false,
        pgArray: ['paykassma', 'triplea'],
        pg: [
        {
            value: 'paykassma',
            label: 'Cards/Wallets',
            disclaimers: [{
                text: 'Amount will be credited to bkash wallet associated with your registered mobile number'
            }],
            gatewayFees: '0%',
            withdrawCharges : 0,
            redeemRequestUpperLimit : 10000,
            redeemRequestLowerLimit: 1000,
            enablePromoCode: false,
            icon : 'assets/icons/d24.png',
            selectedIcon : 'assets/icons/d24_white.png',
            currency : 'BDT',
            currencyIcon: `assets/icons/BDT.png`,
            isKycRequired: false
        },
        {
            value: 'triplea',
            label: 'Crypto',
            disclaimers: [{
                text: 'We support ERC20 & TRC20 networks. For details please refer this.',
                link: 'https://academy.tradexapp.co/',
                linkText: 'refer this'
            }, {
                text: 'Once wallet address gets verified, you won’t be able to change that.'
            }],
            gatewayFees: '1%',
            withdrawCharges : 0,
            redeemRequestUpperLimit : 10000,
            redeemRequestLowerLimit: 1000,
            enablePromoCode: false,
            icon : 'assets/icons/triplea.png',
            selectedIcon : 'assets/icons/triplea_white.png',
            currency : process.env.NODE_ENV !== 'production' ? 'BTC' : 'USDT',
            currencyIcon: `assets/icons/${process.env.NODE_ENV !== 'production' ? 'BTC' : 'USDT'}.png`,
            isKycRequired: false
        },
     ]
    },
    PK: {
        disclaimers: [{
            text: 'Amount will be credited to easypaisa wallet associated with your registered mobile number'
        }],
        withdrawCharges : 0,
        redeemRequestUpperLimit : 10000,
        redeemRequestLowerLimit: 1000,
        enablePromoCode: false,
        pgArray: ['paykassma', 'triplea'],
        pg: [
        {
            value: 'paykassma',
            label: 'Cards/Wallets',
            disclaimers: [{
                text: 'Amount will be credited to easypaisa wallet associated with your registered mobile number'
            }],
            gatewayFees: '0%',
            withdrawCharges : 0,
            redeemRequestUpperLimit : 10000,
            redeemRequestLowerLimit: 1000,
            enablePromoCode: false,
            icon : 'assets/icons/d24.png',
            selectedIcon : 'assets/icons/d24_white.png',
            currency : 'PKR',
            currencyIcon: `assets/icons/PKR.png`,
            isKycRequired: false
        },
        {
            value: 'triplea',
            label: 'Crypto',
            disclaimers: [{
                text: 'We support ERC20 & TRC20 networks. For details please refer this.',
                link: 'https://academy.tradexapp.co/',
                linkText: 'refer this'
            }, {
                text: 'Once wallet address gets verified, you won’t be able to change that.'
            }],
            gatewayFees: '1%',
            withdrawCharges : 0,
            redeemRequestUpperLimit : 10000,
            redeemRequestLowerLimit: 1000,
            enablePromoCode: false,
            icon : 'assets/icons/triplea.png',
            selectedIcon : 'assets/icons/triplea_white.png',
            currency : process.env.NODE_ENV !== 'production' ? 'BTC' : 'USDT',
            currencyIcon: `assets/icons/${process.env.NODE_ENV !== 'production' ? 'BTC' : 'USDT'}.png`,
            isKycRequired: false
        },
     ]
    },
    'CANADA': {
        pgArray : ['triplea', 'direct24'],
        pg: [{
            value: 'triplea',
            label: 'Crypto',
            disclaimers: [{
                text: 'We support ERC20 & TRC20 networks. For details please refer this.',
                link: 'https://academy.tradexapp.co/',
                linkText: 'refer this'
            }, {
                text: 'Once wallet address gets verified, you won’t be able to change that.'
            }],
            gatewayFees: '1%',
            withdrawCharges : 0,
            redeemRequestUpperLimit : 10000,
            redeemRequestLowerLimit: 1000,
            enablePromoCode: false,
            icon : 'assets/icons/triplea.png',
            selectedIcon : 'assets/icons/triplea_white.png',
            currency : process.env.NODE_ENV !== 'production' ? 'BTC' : 'USDT',
            currencyIcon: `assets/icons/${process.env.NODE_ENV !== 'production' ? 'BTC' : 'USDT'}.png`,
            isKycRequired : false
        },  {
            value: 'direct24',
            label: 'Cards/Wallets',
            disclaimers: [],
            icon : 'assets/icons/d24.png',
            selectedIcon : 'assets/icons/d24_white.png',
            currency : 'CAD',
            currencyIcon: `assets/icons/CAD.png`,
            redeemRequestUpperLimit : 10000,
            redeemRequestLowerLimit: 1000,
            isKycRequired : true,
            fields: [ {
                key: 'document_type',
                label: 'Document Type',
                validations: {
                    required: true,
                },
                isDropdown: true,
                isAsync: false,
                values: [{'key' : 'HC', 'label' : 'Healthcard'}, {'key' : 'PASS', 'label' : 'Passport'}, {'key' : 'DL', 'label' : 'Driving License'}],
                messages: {
                    placeholder: 'Choose a Document Type',
                }
            },{
                key: 'document_id',
                label: 'Card Number',
                validations: {
                    required: true,
                    pattern: '\\d{10}',
                },
                messages: {
                    placeholder: 'Enter Card number',
                    required: 'Card number cannot be empty',
                    pattern: 'Please enter a valid Card number',
                }
            }, {
                key: 'beneficiary_name',
                label: 'First Name',
                validations: {
                    required: true,
                },
                messages: {
                    placeholder: 'Enter first name',
                    required: 'First name cannot be empty',
                }
            }, {
                key: 'beneficiary_lastname',
                label: 'Last Name',
                validations: {
                    required: true,
                },
                messages: {
                    placeholder: 'Enter last Name',
                    required: 'Last name cannot be empty',
                }
            }, {
                key: 'bank_code',
                label: 'Bank Code',
                validations: {
                    required: true,
                },
                isDropdown: true,
                isAsync: true,
                values: 'direct24/bank_codes?country=CA',
                validations: {
                    required: true,
                },
                messages: {
                    placeholder: 'Choose a bank',
                },
                dependents: {
                    10000: {
                        fields: [{
                            key: 'email',
                            label: 'Email',
                            readOnly: true,
                        }]
                    },
                    all: {
                        fields: [{
                            key: 'bank_account',
                            label: 'Bank Account',
                            validations: {
                                required: true,
                                pattern: '^\\d{3,16}$',
                            },
                            messages: {
                                placeholder: 'Enter bank account number',
                                required: 'Bank account number cannot be empty',
                                pattern: 'Please enter a valid bank account number ',
                            }
                        }, {
                            key: 'bank_branch',
                            label: 'Bank Branch',
                            validations: {
                                required: true,
                                pattern: '^[\\s\\S]{5}$',
                            },
                            messages: {
                                placeholder: 'Enter 5 character bank branch code',
                                required: 'Bank branch code cannot be empty',
                                pattern: 'Please enter a valid bank branch code',
                            }
                        }]
                    }
                }
            }]
        }]
    },
}
CONFIG.depositConfig = {
    "REST_OF_WORLD": {
        disclaimers: [{
            text: 'We support ERC20 & TRC20 networks. For details please refer this.',
            link: 'https://academy.tradexapp.co/',
            linkText: 'refer this'
        }, {
            text: '*All your deposits will be processed in USDT only. Actual rates may vary during the time of transaction.'
        }],
        gatewayFees: '1%',
        networkTypes: {
            options: [
                { value: 'BINANCE', label: 'Pay with Binance Pay' },
                { value: 'TRC20', label: 'USDT TRC20 Network' },
                { value: 'ERC20', label: 'USDT ERC20 Network' },
            ],
            default: 'BINANCE'
        },
        enablePromoCode: true,
        presets: ["50", "100", "200", "500"],
        pg: [{
            label: "Triple A",
            value: 'triplea', 
            fields: [{
                label: 'Select Network Type',
                key: 'networkType',
                options: [
                    { value: 'BINANCE', label: 'Pay with Binance Pay' },
                    { value: 'TRC20', label: 'USDT TRC20 Network' },
                    { value: 'ERC20', label: 'USDT ERC20 Network' },
                ],
                type: 'select',
                default: 'BINANCE'
            }]
        }]
    },    
    "ASEAN": {
        disclaimers: [{
            text: 'We support ERC20 & TRC20 networks. For details please refer this.',
            link: 'https://academy.tradexapp.co/',
            linkText: 'refer this'
        }, {
            text: '*All your deposits will be processed in USDT only. Actual rates may vary during the time of transaction.'
        }],
        gatewayFees: '1%',
        networkTypes: {
            options: [
                { value: 'BINANCE', label: 'Pay with Binance Pay' },
                { value: 'TRC20', label: 'USDT TRC20 Network' },
                { value: 'ERC20', label: 'USDT ERC20 Network' },
            ],
            default: 'BINANCE'
        },
        enablePromoCode: true,
        presets: ["50", "100", "200", "500"],
        pg: [{
            label: "Triple A",
            value: 'triplea', 
            fields: [{
                label: 'Select Network Type',
                key: 'networkType',
                options: [
                    { value: 'BINANCE', label: 'Pay with Binance Pay' },
                    { value: 'TRC20', label: 'USDT TRC20 Network' },
                    { value: 'ERC20', label: 'USDT ERC20 Network' },
                ],
                type: 'select',
                default: 'BINANCE'
            }]
        }]
    },  
    "INDIA": {
        gst: 28,
        enablePromoCode: true,
        presets: ["100", "500", "1000", "5000"],
        knowMore : 'https://support.tradexapp.co/portal/en/kb/articles/28-gst-related-changes'
    },
    BD: {
        disclaimers: [ {
            text: '*All your deposits will be processed in TAKA only. Actual rates may vary during the time of transaction.'
        }],
        enablePromoCode: true, 
        presets: ["400", "700", "1000", "2000"]
    },
    PK: {
        disclaimers: [ {
            text: '*All your deposits will be processed in PKR only. Actual rates may vary during the time of transaction.'
        }],
        enablePromoCode: true, 
        presets: ["500", "1000", "2000", "5000"]
    }
}

// CONFIG.depositConfigNew = {
//     "REST_OF_WORLD": {
//         pg: [{
//             label: "Triple A",
//             value: 'triplea', 
//             fields: [{
//                 label: 'Select Network Type',
//                 key: 'networkType',
//                 options: [
//                     { value: 'BINANCE', label: 'Pay with Binance Pay' },
//                     { value: 'TRC20', label: 'USDT TRC20 Network' },
//                     { value: 'ERC20', label: 'USDT ERC20 Network' },
//                 ],
//                 type: 'select',
//                 default: 'BINANCE'
//             }],
//             disclaimers: [{
//                 text: 'We support ERC20 & TRC20 networks. For details please refer this.',
//                 link: 'https://academy.tradexapp.co/',
//                 linkText: 'refer this'
//             }, {
//                 text: '*All your deposits will be processed in USDT only. Actual rates may vary during the time of transaction.'
//             }],
//             gatewayFees: '1%',
//             networkTypes: {
//                 options: [
//                     { value: 'BINANCE', label: 'Pay with Binance Pay' },
//                     { value: 'TRC20', label: 'USDT TRC20 Network' },
//                     { value: 'ERC20', label: 'USDT ERC20 Network' },
//                 ],
//                 default: 'BINANCE'
//             },
//             enablePromoCode: true,
//             presets: ["50", "100", "200", "500"],
//             icon : 'assets/icons/triplea.png',
//             selectedIcon : 'assets/icons/triplea_white.png',
//             currency : process.env.NODE_ENV !== 'production' ? 'BTC' : 'USDT',
//             currencyIcon: `assets/icons/${process.env.NODE_ENV !== 'production' ? 'BTC' : 'USDT'}.png`,
//             currencyPlaceholder : CONFIG.CURRENCIES_PLACEHOLDER[`${process.env.NODE_ENV !== 'production' ? 'BTC' : 'USDT'}`]
//         }]
//     },    
//     "ASEAN": {
//         pg: [{
//             label: "Triple A",
//             value: 'triplea', 
//             fields: [{
//                 label: 'Select Network Type',
//                 key: 'networkType',
//                 options: [
//                     { value: 'BINANCE', label: 'Pay with Binance Pay' },
//                     { value: 'TRC20', label: 'USDT TRC20 Network' },
//                     { value: 'ERC20', label: 'USDT ERC20 Network' },
//                 ],
//                 type: 'select',
//                 default: 'BINANCE'
//             }],
//             disclaimers: [{
//                 text: 'We support ERC20 & TRC20 networks. For details please refer this.',
//                 link: 'https://academy.tradexapp.co/',
//                 linkText: 'refer this'
//             }, {
//                 text: '*All your deposits will be processed in USDT only. Actual rates may vary during the time of transaction.'
//             }],
//             gatewayFees: '1%',
//             networkTypes: {
//                 options: [
//                     { value: 'BINANCE', label: 'Pay with Binance Pay' },
//                     { value: 'TRC20', label: 'USDT TRC20 Network' },
//                     { value: 'ERC20', label: 'USDT ERC20 Network' },
//                 ],
//                 default: 'BINANCE'
//             },
//             enablePromoCode: true,
//             presets: ["50", "100", "200", "500"],
//             icon : 'assets/icons/triplea.png',
//             selectedIcon : 'assets/icons/triplea_white.png',
//             currency : process.env.NODE_ENV !== 'production' ? 'BTC' : 'USDT',
//             currencyIcon: `assets/icons/${process.env.NODE_ENV !== 'production' ? 'BTC' : 'USDT'}.png`,
//             currencyPlaceholder : CONFIG.CURRENCIES_PLACEHOLDER[`${process.env.NODE_ENV !== 'production' ? 'BTC' : 'USDT'}`]
//         }]
//     },  
//     "INDIA": {
//             pg: [{
//             label: "Cashfree",
//             value: 'cashfree',
//             disclaimers: [],
//             gst: 28,
//             enablePromoCode: true,
//             presets: ["100", "500", "1000", "5000"],
//             knowMore : 'https://tradexapp.zendesk.com/hc/en-us/articles/13937721931677-28-GST-Related-changes-detail-Click-here-to-view-',
//             currency : 'INR',
//             currencyIcon: `assets/icons/INR.png`,
//             currencyPlaceholder : CONFIG.CURRENCIES_PLACEHOLDER[`INR`],
//             isGSTScreenShow: true
//         }
//     ]
//     },
//     BD: {
//         pg: [{
//             label: "Cards/Wallets",
//             value: 'paykassma',
//             disclaimers: [ {
//                 text: '*All your deposits will be processed in TAKA only. Actual rates may vary during the time of transaction.'
//             }],
//             enablePromoCode: true, 
//             presets: ["400", "700", "1000", "2000"],
//             icon : 'assets/icons/paykassma.png',
//             currency : 'BDT',
//             currencyIcon: `assets/icons/BDT.png`,
//             currencyPlaceholder : CONFIG.CURRENCIES_PLACEHOLDER[`BDT`]
//         },
//         {
//             label: "Crypto",
//             value: 'triplea', 
//             fields: [{
//                 label: 'Select Network Type',
//                 key: 'networkType',
//                 options: [
//                     { value: 'BINANCE', label: 'Pay with Binance Pay' },
//                     { value: 'TRC20', label: 'USDT TRC20 Network' },
//                     { value: 'ERC20', label: 'USDT ERC20 Network' },
//                 ],
//                 type: 'select',
//                 default: 'BINANCE'
//             }],
//             disclaimers: [{
//                 text: 'We support ERC20 & TRC20 networks. For details please refer this.',
//                 link: 'https://academy.tradexapp.co/',
//                 linkText: 'refer this'
//             }, {
//                 text: '*All your deposits will be processed in USDT only. Actual rates may vary during the time of transaction.'
//             }],
//             gatewayFees: '1%',
//             networkTypes: {
//                 options: [
//                     { value: 'BINANCE', label: 'Pay with Binance Pay' },
//                     { value: 'TRC20', label: 'USDT TRC20 Network' },
//                     { value: 'ERC20', label: 'USDT ERC20 Network' },
//                 ],
//                 default: 'BINANCE'
//             },
//             enablePromoCode: true,
//             presets: ["50", "100", "200", "500"],
//             icon : 'assets/icons/triplea.png',
//             selectedIcon : 'assets/icons/triplea_white.png',
//             currency : process.env.NODE_ENV !== 'production' ? 'BTC' : 'USDT',
//             currencyIcon: `assets/icons/${process.env.NODE_ENV !== 'production' ? 'BTC' : 'USDT'}.png`,
//             currencyPlaceholder : CONFIG.CURRENCIES_PLACEHOLDER[`${process.env.NODE_ENV !== 'production' ? 'BTC' : 'USDT'}`]
//         }]
        
//     },
//     PK: {
//         pg: [{
//             label: "Cards/Wallets",
//             value: 'paykassma',
//             disclaimers: [ {
//                 text: '*All your deposits will be processed in PKR only. Actual rates may vary during the time of transaction.'
//             }],
//             enablePromoCode: true, 
//             presets: ["400", "700", "1000", "2000"],
//             icon : 'assets/icons/paykassma.png',
//             currency : 'PKR',
//             currencyIcon: `assets/icons/PKR.png`,
//             currencyPlaceholder : CONFIG.CURRENCIES_PLACEHOLDER[`PKR`]
//         },
//         {
//             label: "Crypto",
//             value: 'triplea', 
//             fields: [{
//                 label: 'Select Network Type',
//                 key: 'networkType',
//                 options: [
//                     { value: 'BINANCE', label: 'Pay with Binance Pay' },
//                     { value: 'TRC20', label: 'USDT TRC20 Network' },
//                     { value: 'ERC20', label: 'USDT ERC20 Network' },
//                 ],
//                 type: 'select',
//                 default: 'BINANCE'
//             }],
//             disclaimers: [{
//                 text: 'We support ERC20 & TRC20 networks. For details please refer this.',
//                 link: 'https://academy.tradexapp.co/',
//                 linkText: 'refer this'
//             }, {
//                 text: '*All your deposits will be processed in USDT only. Actual rates may vary during the time of transaction.'
//             }],
//             gatewayFees: '1%',
//             networkTypes: {
//                 options: [
//                     { value: 'BINANCE', label: 'Pay with Binance Pay' },
//                     { value: 'TRC20', label: 'USDT TRC20 Network' },
//                     { value: 'ERC20', label: 'USDT ERC20 Network' },
//                 ],
//                 default: 'BINANCE'
//             },
//             enablePromoCode: true,
//             presets: ["50", "100", "200", "500"],
//             icon : 'assets/icons/triplea.png',
//             selectedIcon : 'assets/icons/triplea_white.png',
//             currency : process.env.NODE_ENV !== 'production' ? 'BTC' : 'USDT',
//             currencyIcon: `assets/icons/${process.env.NODE_ENV !== 'production' ? 'BTC' : 'USDT'}.png`,
//             currencyPlaceholder : CONFIG.CURRENCIES_PLACEHOLDER[`${process.env.NODE_ENV !== 'production' ? 'BTC' : 'USDT'}`]
//         }]
//     },    
//     "CANADA": {
//         pg: [{
//             label: "Crypto",
//             value: 'triplea', 
//             fields: [{
//                 label: 'Select Network Type',
//                 key: 'networkType',
//                 options: [
//                     { value: 'BINANCE', label: 'Pay with Binance Pay' },
//                     { value: 'TRC20', label: 'USDT TRC20 Network' },
//                     { value: 'ERC20', label: 'USDT ERC20 Network' },
//                 ],
//                 type: 'select',
//                 default: 'BINANCE'
//             }],
//             disclaimers: [{
//                 text: 'We support ERC20 & TRC20 networks. For details please refer this.',
//                 link: 'https://academy.tradexapp.co/',
//                 linkText: 'refer this'
//             }, {
//                 text: '*All your deposits will be processed in USDT only. Actual rates may vary during the time of transaction.'
//             }],
//             gatewayFees: '1%',
//             networkTypes: {
//                 options: [
//                     { value: 'BINANCE', label: 'Pay with Binance Pay' },
//                     { value: 'TRC20', label: 'USDT TRC20 Network' },
//                     { value: 'ERC20', label: 'USDT ERC20 Network' },
//                 ],
//                 default: 'BINANCE'
//             },
//             enablePromoCode: true,
//             presets: ["50", "100", "200", "500"],
//             icon : 'assets/icons/triplea.png',
//             selectedIcon : 'assets/icons/triplea_white.png',
//             currency : process.env.NODE_ENV !== 'production' ? 'BTC' : 'USDT',
//             currencyIcon: `assets/icons/${process.env.NODE_ENV !== 'production' ? 'BTC' : 'USDT'}.png`,
//             currencyPlaceholder : CONFIG.CURRENCIES_PLACEHOLDER[`${process.env.NODE_ENV !== 'production' ? 'BTC' : 'USDT'}`]
//         },
//         {
//             label: "Cards/Wallets",
//             value: 'direct24',
//             disclaimers: [{
//                 text: '*All your deposits will be processed in CAD only. Actual rates may vary during the time of transaction.'
//             }],
//             enablePromoCode: true,
//             presets: ["50", "100", "200", "500"],
//             icon : 'assets/icons/d24.png',
//             selectedIcon : 'assets/icons/d24_white.png',
//             currency : 'CAD',
//             currencyIcon: `assets/icons/CAD.png`,
//             currencyPlaceholder : CONFIG.CURRENCIES_PLACEHOLDER[`CAD`]
//         }]
//     },
// }

CONFIG.depositConfigCountry = {
    BD: {
        disclaimers: [{
            text: '*All your deposits will be processed in TAKA only. Actual rates may vary during the time of transaction.'
        }],
        enablePromoCode: true, 
        presets: ["400", "700", "1000", "2000"]
    },
    PK: {
        disclaimers: [{
            text: '*All your deposits will be processed in PKR only. Actual rates may vary during the time of transaction.'
        }],
        enablePromoCode: true, 
        presets: ["500", "1000", "2000", "5000"]
    }
}
// CONFIG.depositConfigPartnerRegion = {
//     "4" :{
//         "INDIA" : {
//             pg: [{
//                 label: "Paykassma",
//                 value: 'paykassma',
//                 disclaimers: [ {
//                     text: '*All your deposits will be processed in INR only. Actual rates may vary during the time of transaction.'
//                 }],
//                 enablePromoCode: true, 
//                 presets: ["400", "700", "1000", "2000"],
//                 icon : 'assets/icons/paykassma.png',
//                 currency : 'INR',
//                 currencyIcon: `assets/icons/INR.png`,
//                 currencyPlaceholder : CONFIG.CURRENCIES_PLACEHOLDER[`INR`]
//             }]
//         },
//         "PK" : {
//             pg: [{
//                 label: "Paykassma",
//                 value: 'paykassma',
//                 disclaimers: [ {
//                     text: '*All your deposits will be processed in PKR only. Actual rates may vary during the time of transaction.'
//                 }],
//                 enablePromoCode: true, 
//                 presets: ["400", "700", "1000", "2000"],
//                 icon : 'assets/icons/paykassma.png',
//                 currency : 'PKR',
//                 currencyIcon: `assets/icons/PKR.png`,
//                 currencyPlaceholder : CONFIG.CURRENCIES_PLACEHOLDER[`PKR`]
//             }]
//         },
//         "BD" : {
//             pg: [{
//                 label: "Paykassma",
//                 value: 'paykassma',
//                 disclaimers: [ {
//                     text: '*All your deposits will be processed in BDT only. Actual rates may vary during the time of transaction.'
//                 }],
//                 enablePromoCode: true, 
//                 presets: ["400", "700", "1000", "2000"],
//                 icon : 'assets/icons/paykassma.png',
//                 currency : 'BDT',
//                 currencyIcon: `assets/icons/BDT.png`,
//                 currencyPlaceholder : CONFIG.CURRENCIES_PLACEHOLDER[`BDT`]
//             }]
//         }
//     },
//     "4" :{
//         "INDIA" : {
//             pg: [{
//                 label: "Paykassma",
//                 value: 'paykassma',
//                 disclaimers: [ {
//                     text: '*All your deposits will be processed in INR only. Actual rates may vary during the time of transaction.'
//                 }],
//                 enablePromoCode: true,
//                 presets: ["400", "700", "1000", "2000"],
//                 icon : 'assets/icons/paykassma.png',
//                 currency : 'INR',
//                 currencyIcon: `assets/icons/INR.png`,
//                 currencyPlaceholder : CONFIG.CURRENCIES_PLACEHOLDER[`INR`]
//             }]
//         },
//         "PK" : {
//             pg: [{
//                 label: "Paykassma",
//                 value: 'paykassma',
//                 disclaimers: [ {
//                     text: '*All your deposits will be processed in PKR only. Actual rates may vary during the time of transaction.'
//                 }],
//                 enablePromoCode: true,
//                 presets: ["400", "700", "1000", "2000"],
//                 icon : 'assets/icons/paykassma.png',
//                 currency : 'PKR',
//                 currencyIcon: `assets/icons/PKR.png`,
//                 currencyPlaceholder : CONFIG.CURRENCIES_PLACEHOLDER[`PKR`]
//             }]
//         },
//         "BD" : {
//             pg: [{
//                 label: "Paykassma",
//                 value: 'paykassma',
//                 disclaimers: [ {
//                     text: '*All your deposits will be processed in BDT only. Actual rates may vary during the time of transaction.'
//                 }],
//                 enablePromoCode: true,
//                 presets: ["400", "700", "1000", "2000"],
//                 icon : 'assets/icons/paykassma.png',
//                 currency : 'BDT',
//                 currencyIcon: `assets/icons/BDT.png`,
//                 currencyPlaceholder : CONFIG.CURRENCIES_PLACEHOLDER[`BDT`]
//             }]
//         }
//     }
// }

CONFIG.withdrawalConfigPartnerRegion = {
    "4" :{
        "INDIA" : {
            pgArray : ['paykassma'],
            pg: [{
                value: 'paykassma',
                label: 'Paykassma',
                disclaimers: [{
                    text: 'Amount will be credited to wallet associated with your registered mobile number'
                }],
                gatewayFees: '0%',
                withdrawCharges : 0,
                redeemRequestUpperLimit : 10000,
                redeemRequestLowerLimit: 1,
                enablePromoCode: false,
                icon : 'assets/icons/d24.png',
                selectedIcon : 'assets/icons/d24_white.png',
                currency : 'INR',
                currencyIcon: `assets/icons/INR.png`,
                isKycRequired : false
            }]
        },
        "BD" : {
            pgArray : ['paykassma'],
            pg: [{
                value: 'paykassma',
                label: 'Paykassma',
                disclaimers: [{
                    text: 'Amount will be credited to bkash wallet associated with your registered mobile number'
                }],
                gatewayFees: '0%',
                withdrawCharges : 0,
                redeemRequestUpperLimit : 10000,
                redeemRequestLowerLimit: 1000,
                enablePromoCode: false,
                icon : 'assets/icons/d24.png',
                selectedIcon : 'assets/icons/d24_white.png',
                currency : 'BDT',
                currencyIcon: `assets/icons/BDT.png`,
                isKycRequired : false
            }]
        },
        "PK" : {
            pgArray : ['paykassma'],
            pg: [{
                value: 'paykassma',
                label: 'Paykassma',
                disclaimers: [{
                    text: 'Amount will be credited to easypaisa wallet associated with your registered mobile number'
                }],
                gatewayFees: '0%',
                withdrawCharges : 0,
                redeemRequestUpperLimit : 10000,
                redeemRequestLowerLimit: 1000,
                enablePromoCode: false,
                icon : 'assets/icons/d24.png',
                selectedIcon : 'assets/icons/d24_white.png',
                currency : 'PKR',
                currencyIcon: `assets/icons/PKR.png`,
                isKycRequired : false
            }]
        }
    },
    "4" :{
        "INDIA" : {
            pgArray : ['paykassma'],
            pg: [{
                value: 'paykassma',
                label: 'Paykassma',
                disclaimers: [{
                    text: 'Amount will be credited to wallet associated with your registered mobile number'
                }],
                gatewayFees: '0%',
                withdrawCharges : 0,
                redeemRequestUpperLimit : 10000,
                redeemRequestLowerLimit: 1,
                enablePromoCode: false,
                icon : 'assets/icons/d24.png',
                selectedIcon : 'assets/icons/d24_white.png',
                currency : 'INR',
                currencyIcon: `assets/icons/INR.png`,
                isKycRequired : false
            }]
        },
        "BD" : {
            pgArray : ['paykassma'],
            pg: [{
                value: 'paykassma',
                label: 'Paykassma',
                disclaimers: [{
                    text: 'Amount will be credited to bkash wallet associated with your registered mobile number'
                }],
                gatewayFees: '0%',
                withdrawCharges : 0,
                redeemRequestUpperLimit : 10000,
                redeemRequestLowerLimit: 1000,
                enablePromoCode: false,
                icon : 'assets/icons/d24.png',
                selectedIcon : 'assets/icons/d24_white.png',
                currency : 'BDT',
                currencyIcon: `assets/icons/BDT.png`,
                isKycRequired : false
            }]
        },
        "PK" : {
            pgArray : ['paykassma'],
            pg: [{
                value: 'paykassma',
                label: 'Paykassma',
                disclaimers: [{
                    text: 'Amount will be credited to easypaisa wallet associated with your registered mobile number'
                }],
                gatewayFees: '0%',
                withdrawCharges : 0,
                redeemRequestUpperLimit : 10000,
                redeemRequestLowerLimit: 1000,
                enablePromoCode: false,
                icon : 'assets/icons/d24.png',
                selectedIcon : 'assets/icons/d24_white.png',
                currency : 'PKR',
                currencyIcon: `assets/icons/PKR.png`,
                isKycRequired : false
            }]
        }
    }
}

CONFIG.HOW_TO_TRADE_VID = {
    ASEAN : "https://www.youtube.com/watch?v=4DhMqYNbF_4",
    REST_OF_WORLD : "https://www.youtube.com/watch?v=4DhMqYNbF_4",
    BD : "https://www.youtube.com/watch?v=luzJel0OxE8",
    PK : "https://www.youtube.com/watch?v=luzJel0OxE8",
    INDIA : "https://www.youtube.com/watch?v=luzJel0OxE8"
}
CONFIG.TRIPLEA_LOCAL_CURRENCY = process.env.NODE_ENV == 'production'? 'INR':'INR'
CONFIG.TRIPLEA_CRYPTO_CURRENCY = process.env.NODE_ENV == 'production'? 'USDT':'testBTC'
CONFIG.TRIPLEA_ACCOUNT_ID = process.env.TRIPLEA_ACCOUNT_ID
CONFIG.TRIPLEA_CLIENT_ID = process.env.TRIPLEA_CLIENT_ID
CONFIG.TRIPLEA_CLIENT_SECRET = process.env.TRIPLEA_CLIENT_SECRET
CONFIG.TRIPLEA_ACCOUNT_MKEY = process.env.TRIPLEA_ACCOUNT_MKEY
CONFIG.TRIPLEA_WEBHOOK_SECRET = process.env.TRIPLEA_WEBHOOK_SECRET
CONFIG.TRIPLEA_TRANSACTION_FEE_PERCENT = 1
CONFIG.ONMETA_API_KEY = process.env.ONMETA_API_KEY
CONFIG.ONMETA_RECEIVER_ADDRESS =  "0x0aa237EF851Df90ff2044Fc2C78B257467146e4C"
CONFIG.ONMETA_URLS = {
    userLogin: '/v1/users/login',
    createOrder: '/v1/orders/create',
    fetchOrderStatus: '/v1/orders/status',
    createOffRampOrder: '/v1/offramp/orders/create',
    updateTransactionHash: '/v1/offramp/orders/txnhash',
    bankAccountLink: '/v1/users/account-link',
    getBankStatus : '/v1/users/get-bank-status'
}
CONFIG.ONMETA_CLIENT_SECRET = process.env.ONMETA_CLIENT_SECRET
CONFIG.timelineMinPoints = process.env.NODE_ENV !== 'production' ? 20 : 20
CONFIG.timelineMaxPoints = process.env.NODE_ENV !== 'production' ? 100 : 100
CONFIG.FANTASY_LIVE_CHAT_LINK = "https://t.me/+qv9dg1DyskJhZTVl";
CONFIG.MAX_REFUND_TRADING_FEE = 10000;
CONFIG.DEBIT_TRADING_FEE_USERID = process.env.NODE_ENV !== 'production' ? 177018 : 2183119;
CONFIG.EXCLUDE_SURCHARGE_ID = 119278048;
CONFIG.BONUS_CREDIT_REBATE_PERCENT = 10;
CONFIG.TRANSACTION_ID_PAYKASSMA_PAYMENT_COUNT = 119743095;
CONFIG.MAX_REFUND_LUCKY_COINS = 100000;
CONFIG.DEBIT_LUCKY_COINS_USERID = process.env.NODE_ENV == 'production' ? 603727 : 176918;
CONFIG.EXCLUDE_USERIDS_COINSP_CALC = process.env.NODE_ENV == 'production' ? [603727] : [177018];


module.exports = CONFIG;


