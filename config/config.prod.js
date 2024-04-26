require('dotenv').config();
module.exports = {
    cashfreeParams: {
        pmClientId: process.env.PM_CLIENT_ID,
        pmClientSecret: process.env.PM_CLIENT_SECRET,
        pmURL: 'https://api.cashfree.com',
        clientId: process.env.CLIENT_ID,
        clientSecret: process.env.CLIENT_SECRET,
        url: 'https://payout-api.cashfree.com',
        payoutURL: 'https://payout-api.cashfree.com',
        env: 'PRODUCTION'
    },
    cashfreeKYCParams: {
        clientId: process.env.CF_KYC_CLIENTID,
        clientSecret: process.env.CF_KYC_CLIENTSECRET,
        url: 'https://payout-api.cashfree.com'
    },
    decentro: {
        client_id: process.env.DECENTROCLIENT_ID,
        client_secret: process.env.DECENTROCLIENT_SECRET,
        module_secret: process.env.DECENTROMODULE_SECRET,
        provider_secret: process.env.DECENTROPROVIDER_SECRET,
        kyc_module_secret: process.env.DECENTRO_KYC_MODULE_SECRET,
        url: 'https://in.decentro.tech',
        payee_account: '462520349284305399'
    },
    MOEngage: {
        AppId: process.env.ME_APP_ID,
        ApiSecret: process.env.ME_API_SECRET
    },
    razorpayParams: {
        key: process.env.RAZORPAY_KEY,
        secret: process.env.RAZORPAY_SECRET,
        accountNumber: process.env.RAZORPAY_ACCNO,
    },
    twilio: {
        sid: process.env.TWILIO_SID,
        token: process.env.TWILIO_TOKEN
    },
    awsBucket: 'theox-files',
    prefix: 'P',
    solrHost: 'http://3.142.187.141:8983/solr/theox',
    serverURL: process.env.serverURL,
    mongo_password: 'YOwkP74OsGXByJ8c',
    newsAPIKEY: process.env.NEWSAPI_KEY,
    updateNewsInterval: '0 */8 * * *',  //Scheduling Every 8 hours
    SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
    redis: {
        host: 'redis-caching-production-ro.respcp.ng.0001.aps1.cache.amazonaws.com',
        port: 6379
    },
    bingNewsAPIKEY: process.env.BING_NEWS_API_KEY,
    SUPPORT_URL: 'https://support.tradexapp.co/portal/en/newticket',
    NEWS_URL: 'https://news.tradexapp.co/',
    CDAEid: [19199, 19092, 19202, 19304, 19312, 19443, 19474, 19433, 21505, 21506, 21507, 21508],
    tfEID: 13101,
    Kafka: {
        clientId: 'tradexapp',
        brokers: [
            'b-1.prod.kcf4zv.c2.kafka.ap-south-1.amazonaws.com:9092',
            'b-2.prod.kcf4zv.c2.kafka.ap-south-1.amazonaws.com:9092',
            'b-3.prod.kcf4zv.c2.kafka.ap-south-1.amazonaws.com:9092']

    },
    MMIDs: [193297, 31038, 122426, 433061, 431470, 603727, 396569, 1446960, 1970715, 2155498, 2155513, 2155521, 2110607, 2110631, 2166779, 2166792, 2166800, 2166802],
    APIPARTNERUSERS: [],
    dummyCustomerEmailForPG: 'queries@tradexapp.co',
    IM_KAFKA_EVENT_IDS: [12394, 12486, 12501, 12502, 12554, 12709, 12726, 12727, 12624, 12656, 9970, 6977, 11563, 12623, 11768, 5978, 11562, 11766, 10717, 10727, 10726, 8783, 11767, 6481, 11755, 11764, 6480, 10002, 12283, 11762, 8758, 11504, 6482, 10716, 10515, 10715, 5749, 8782, 6646, 12272, 12278, 12093, 11757, 12655, 12713],
    TRADING_FEE_EXEMPT_USERS: (process.env?.TRADING_FEE_EXEMPT_USERS ?? '').split(','),
    TRADING_SERVER_API_KEY: process.env.TRADING_SERVER_API_KEY,
    ONMETA_BASE_URL: 'https://api.onmeta.in',
    CREATE_EVENT_USERS: [25020, 29645],
    CREATE_NORMAL_EVENT_USERS: [19, 146, 25020, 29645, 2560823, 2458110, 2730549],
    chatbotUsers: [177018,25020,29645,19]
}