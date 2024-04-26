module.exports = {
    cashfreeParams: {
        clientId: 'CF174257CF37V1SPE6I71C14AJJ0',
        clientSecret: '2be6e6f0fa248315ab3c613ae271a2c49b8a0b97',
        url: 'https://payout-gamma.cashfree.com',
        pmClientId: '1742575a93db14f0ddb026b8e0752471',
        pmClientSecret: 'f680adb4f10204a349d785b33e10e642082dc2eb',
        pmURL: 'https://sandbox.cashfree.com',
        payoutURL: 'https://payout-gamma.cashfree.com'
    },
    decentro: {
        client_id: process.env.DECENTROCLIENT_ID,
        client_secret: process.env.DECENTROCLIENT_SECRET,
        module_secret: process.env.DECENTROMODULE_SECRET,
        provider_secret: process.env.DECENTROPROVIDER_SECRET,
        kyc_module_secret: process.env.DECENTRO_KYC_MODULE_SECRET,
        url: 'https://in.staging.decentro.tech',
        payee_account: '462520349284305399'
    },
    // decentro: {
    //     client_id: 'theox_staging',
    //     client_secret: 'KK754cUCeGb2hizScf0FZLQGI28stvDu',
    //     module_secret: 'BLIHcIJU6meu40MeiE2ZoXc707Go7h1F',
    //     provider_secret: 'aeazWoONOpVcPWOc0AJ67KFf1W2IhvIv',
    //      kyc_module_secret: 'Oq9lulk84ygaLvx2yyHsBZnvfb0bzdJR',
    //     url: 'https://in.staging.decentro.tech',
    // },
    paytmParams: {
        "MID": "OuYoRr95590921007483",
        "MERCHANTKEY": '!khcuqTvr&7F@Tos',
        "PAYTMPAYMENTURL": 'securegw.paytm.in',
        "WEBSITE": "DEFAULT"
    },
    MOEngage: {
        AppId: process.env.ME_APP_ID,
        ApiSecret: process.env.ME_API_SECRET
    },
    twilio: {
        sid: process.env.TWILIO_SID,
        token: process.env.TWILIO_TOKEN
    },
    razorpayParams: {
        key: 'rzp_test_iHzazlnT3XaHuW',
        secret: 'q3fb10ZZDeIQR27KpdqvogWM',
        accountNumber: '2323230034389407',
    },
    awsBucket: 'test-ox',
    prefix: 'X',
    solrHost: 'http://13.234.41.118:8983/solr/theox',
    serverURL: process.env.serverURL,
    newsAPIKEY: process.env.NEWSAPI_KEY,
    updateNewsInterval: '0 0 * * WED',  //scheduling every wednesday at midnight
    SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
    redis: {
        host: 'redis-caching-staging.respcp.ng.0001.aps1.cache.amazonaws.com',
        port: 6379
    },
    SUPPORT_URL: 'https://support.tradexapp.co/portal/en/newticket',
    NEWS_URL: 'https://testnews.theox.co/',
    CDAEid: [11467, 11468, 11469, 11470, 11471, 11472, 11473, 11474, 11475],
    tfEID: 12670,
    bingNewsAPIKEY: process.env.BING_NEWS_API_KEY,
    Kafka: {
        clientId: 'tradexapp',
        // brokers: ['broker:9092']
        brokers: [
            "b-1.staging2.qjup4w.c2.kafka.ap-south-1.amazonaws.com:9092",
            "b-2.staging2.qjup4w.c2.kafka.ap-south-1.amazonaws.com:9092"
        ]

    },
    MMIDs: [146, 177348],
    APIPARTNERUSERS: [179685],
    dummyCustomerEmailForPG: 'test@tradexapp.co',
    IM_KAFKA_EVENT_IDS: [12365, 12498, 12497],
    TRADING_SERVER_API_KEY: "M4HKtDYyq3h9rF9R", //process.env.TRADING_SERVER_API_KEY
    ONMETA_BASE_URL: 'https://stg.api.onmeta.in'
}
