
const { Analytics, ProbeV2, Probe, User, Partner, History, liveStats, UserPreference, Transactions, Embeddings } = require('../models');
const { to, ReE, ReS, waitTimer } = require('../services/util.service');
const https = require('https');
const axios = require('axios');
const lodash = require('lodash');
const CONFIG = require('../config/config');
const { DateTime } = require("luxon");

// const socketService = require('../services/socket.service');
const { UserService } = require('../services/user.service');
const { EventsService } = require('../services/events.service');
const { LiveStatsService } = require('../services/liveStats.service');
const { AutoSettleJob } = require('../services/cron.service');
const { getCurrentLiquidityData } = require('../msg_recv/exchange');

const { getTruePrices } = require('../utils/exchange.maths.js');

const notificationService = require('../services/notification.service');
const { redisCaching } = require('../services/cache.service');
const{ createEventEmbedding } = require('../services/embedding');

const logger = require('../services/logger.service');
const { populateHistoryBlob } = require('../controllers/populateHistory');

const probesCache = {};

const { format, differenceInCalendarDays, add, differenceInHours } = require('date-fns');

const { SolrService } = require('../services/solr.service');
const { isAnInternalUser } = require('../utils/user.util');
const { isDashboardUser } = require('../middleware/dashboard.user');
const { logDashboardRequest } = require('../services/mongodb.service');
const { EventNewsServices } = require('../services/news.service');
const eventStatusEnum = require('../utils/eventStatusEnum.util');
const { sortTypeList } = require('../utils/sort.list.util.js');
const { customizeFeeds, cleanProbesViewed } = require('../utils/customize.feeds.js');
const { LiquidityPool } = require('../models/liquidity.pool');
const LiquidityEvent = require('../models/liquidity.event');
const LiquidityUser = require('../models/liquidity.user');
const LiquidityProvider = require('../models/liquidity.provider.tradingfee.earning');
const { getCDP, getCurrentPrice, getExecutionPrice } = require('../utils/getCdp.util.js');
const { getTopNews } = require('../utils/news.utils');
const { addLeanrAcedemy } = require('../utils/learnAcademy.util');
const { marketLimitOrder } = require('../utils/marketLimitOrder.util');
const { forkPromiseForSettlement } = require('../utils/fork.settlement.js');
const { addTags, getUnapprovedCommunityEvents } = require('../models/probe');
const { getOpenCallsCachingKey, ORDER, ADD_LIQUIDITY } = require('../utils/constants');
const { modifyContracts } = require('../utils/modify.open.calls');
const { probeSettlementKeyPrefix } = require('../utils/constants');
const { cancelEvent } = require('./event.cancel.controller');
const { addLiquidity } = require("../msg_recv/add_liquidity");
const { uuid } = require("uuidv4");
const { messages } = require("../messages/messages");
const LiquidityUsers = require("../models/liquidity.user");
const { updateWalletBalance, persistTransactionData, addToTransactions } = require("../msg_recv/utils");
const TdsUsers = require('../models/tdsUsers');
const { promisify } = require('util');
const { getSellPrice, getBuyPrice, validateLiquidityFeeFactor } = require('../utils/liquidityFeeFactor.util');
const lock = promisify(require('redis-lock')(redisCaching.client));
const kafkaAdminService = require('../services/kafkaAdmin.service.js');
const UserTradingFee = require("../models/user.trading.fee");
const { getTimestamptz } = require('../utils/date.util');
const { TRANSACTIONS } = require('../utils/constants');
const { PartnerService } = require('../services/partner.service');
const Contest = require('../models/contest');
const luxon = require('luxon');
const { getUserIdClubMembers } = require('../models/club.js');

function randomIntFromInterval(min, max) { // min and max included
    return Math.floor(Math.random() * (max - min + 1) + min)
}

const addTagsToEvents = (data, maxReturn) => {

    data['subcat'] = '';

    if (data['is_price_editable'] === false) {
        // data['subcat'] += '#InstantMatch';
    }
    else if (data['parent_id'] === -1) {
        data['subcat'] += '#RangeContracts';
    }
    else if (maxReturn === 1) {
        data['subcat'] += '#0-1Scale';
    }

    if (data['tags'] && data['tags'].length > 1) {
        for (let i = 1; i < data['tags'].length; i = i + 1) {
            if (data['subcat'].length > 0) data['subcat'] += ',';
            data['subcat'] += data['tags'][i];
        }
    }
    delete data.tags;
}

const IstToUtc = (dateString) => {
    dateString = dateString.replace(/'/g, '');
    const d = new Date(dateString);
    d.setHours(d.getHours() - 5);
    d.setMinutes(d.getMinutes() - 30);
    return `'${d.toISOString()}'`;
}



const getShareLink = function (probeId, title, eventType) {
    return new Promise((resolve, reject) => {
        var postData = JSON.stringify({
            "dynamicLinkInfo": {
                "domainUriPrefix": "https://pages.tradexapp.co",
                "link": `https://web.tradexapp.co/deeplink/?probeid=${probeId}&eventtype=${eventType}`,
                "androidInfo": {
                    "androidPackageName": "com.theox",
                    "androidFallbackLink": `https://web.tradexapp.co`,
                },
                "iosInfo": {
                    "iosBundleId": "com.theox",
                    "iosFallbackLink": "https://apps.apple.com/us/app/tradex-markets/id1608795674",
                    "iosAppStoreId": "1608795674"
                },
                "socialMetaTagInfo": {
                    "socialTitle": title
                }
            }
        });

        var options = {
            hostname: 'firebasedynamiclinks.googleapis.com',
            port: 443,
            path: `/v1/shortLinks?key=${CONFIG.firebaseAPIKey}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        };
        var response = "";
        var post_req = https.request(options, function (post_res) {
            post_res.on('data', function (chunk) {
                response += chunk;
            });
            post_res.on('end', async function () {
                var jsonRes = JSON.parse(response);
                resolve(jsonRes['shortLink']);
            });
        });
        post_req.on('error', function (e) {
            reject(e);
        });
        post_req.write(postData);
        post_req.end();
    });
}
const getShareLinkUsingMetaData = function (probeId, title, eventType, metaData) {
    return new Promise((resolve, reject) => {
        var postData = JSON.stringify({
            "dynamicLinkInfo": {
                "domainUriPrefix": metaData.domainUriPrefix,
                "link": `${metaData.link}/?probeid=${probeId}&eventtype=${eventType}`,
                "androidInfo": {
                    "androidPackageName": `${metaData.androidInfo.androidPackageName}`,
                    "androidFallbackLink": `${metaData.androidInfo.androidFallbackLink}`,
                },
                "iosInfo": {
                    "iosBundleId": `${metaData.iosInfo.iosBundleId}`,
                    "iosFallbackLink": `${metaData.iosInfo.iosFallbackLink}`,
                    "iosAppStoreId": `${metaData.iosInfo.iosAppStoreId}`
                },
                "socialMetaTagInfo": {
                    "socialTitle": title
                }
            }
        });
        let firebaseAPIKey = parseInt(metaData['partner']['id']) == 1 ? CONFIG.firebaseAPIKey : process.env[`${metaData['partner']['name'].toUpperCase()}_FIREBASE_APIKEY`];
        var options = {
            hostname: 'firebasedynamiclinks.googleapis.com',
            port: 443,
            path: `/v1/shortLinks?key=${firebaseAPIKey}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        };
        var response = "";
        var post_req = https.request(options, function (post_res) {
            post_res.on('data', function (chunk) {
                response += chunk;
            });
            post_res.on('end', async function () {
                var jsonRes = JSON.parse(response);
                resolve(jsonRes['shortLink']);
            });
        });
        post_req.on('error', function (e) {
            reject(e);
        });
        post_req.write(postData);
        post_req.end();
    });
}

const generateShareLinkForActivePartners = async function (probeId, title, eventType) {
    try {
        const getActivePartnersForService = await Partner.getPartnersForService('firebase', true);

        for (let currentPartner of getActivePartnersForService) {
            let partnerId = parseInt(currentPartner['partner']);

            var partner_service_config = await PartnerService.getPartnerServiceConfig(partnerId, 'INDIA', 'firebase');

            let config = partner_service_config.config;

            if (!partner_service_config.isActive || !config.is_enabled) {
                continue;
            }
            let metaData = config.metadata;
            metaData['partner'] = partner_service_config;
            try {
                sharelink = await getShareLinkUsingMetaData(probeId, title, eventType, metaData);
                if (sharelink) await Partner.addShareLinkPartner({ 'id': probeId, 'partner': partnerId, 'sharelink': sharelink });
            } catch (err) {
                logger.error(`cannot create dynamic link for partnerId ${partnerId}`, err);
                continue;
            }
        }
    } catch (e) {
        throw e;
    }
}

const createEvent = async function (data, req) {
    var err, _probeIds, _regionIds, _tagsIds, _probes, _probeCallsOpen, _schema;
    let timezone = data?.timezone ?? 'Asia/Kolkata';
    if (data['endsat']) {
        data['endsat'] = getTimestamptz([data['endsat'], timezone].join(' '));
    }
    if (data['settledate']) {
        data['settledate'] = getTimestamptz([data['settledate'], timezone].join(' '));
    }
    if (data['start_date']) {
        const startDate = getTimestamptz([data['start_date'], timezone].join(' '));
        if ((data['endsat'] && (data['endsat'] < startDate)) ||
            (data['settledate'] && (data['settledate'] < startDate))) {
            throw new Error('Start date can not be after end date or settlement date');
        }
        data['start_date'] = startDate;
    }

    const pTitle = data['title'];
    const dOptions = data['options'];
    ['options', 'id', 'calls', 'createdat', 'keywords', 'rank'].forEach(prop => delete data[prop]);
    if (data['is_price_editable'] === false) data['auto_match'] = true;
    const _maxPool = data.max_pool ? data.max_pool : 10000;
    const _maxPlayers = data.max_players ? data.max_players : 100;
    const _bids = data.bids_per_player ? data.bids_per_player : 5;
    const maxReturn = data.Maximum_Return === '100' ? 100 : 1;
    if (!data['is_price_editable']) {
        data['max_allowed_position'] = data['max_allowed_position'] || CONFIG.INSTANT_MATCH_POSITION_MAX_ALLOWED;
    } else {
        data['max_allowed_position'] = data['max_allowed_position'] || CONFIG.CDA_POSITION_MAX_ALLOWED;
    }

    ['max_pool', 'bids_per_player', 'max_players', 'Maximum_Return'].forEach(prop => delete data[prop]);
    data['totalamount'] = maxReturn;

    addTagsToEvents(data, maxReturn);

    const liquidityPool = data['liquidity_pool'];
    delete data['liquidity_pool'];



    if (!data['is_price_editable'] && liquidityPool < 100) {
        throw new Error('Liquidity Pool cannot be smaller than 100');
    }
    if (!data['is_price_editable']) {
        data.liquidity_fee_factor = validateLiquidityFeeFactor(data.liquidity_fee_factor)
    }

    if (data?.schema) {
        _schema = data?.schema;
        if (req?.params?.fantasy_type ?? req?.body?.fantasy_type) {
            data.fantasy_type = req?.params?.fantasy_type ?? req?.body?.fantasy_type;
        }
        if (req?.params?.fantasy_id ?? req?.body?.fantasy_id) {
            data.fantasy_id = req?.params?.fantasy_id ?? req?.body?.fantasy_id;
        }

        delete data.schema;
    }
    const liveYTLinkID = data['liveYTLinkID'];
    delete data.liveYTLinkID;

    var regionsList = data?.regions ?? ['INDIA'];
    let partners = data?.partners ?? [1];
    if (Array.isArray(partners) && partners.length === 0) {
        partners = [1];
    } else if (!partners || (typeof partners === 'string' && !partners.trim())) {
        partners = [1];
    } else if (typeof partners === 'string') {
        return {
            success: false,
            message: "Invalid Partner data format"
        };
    }
    // if(!data?.partners && regionsList.findIndex(f => f === 'ASEAN') > -1) {
    //     partners = [3];
    // }
    [err, _probeIds] = await to(Probe.create(data, _schema));
    if (err) throw err;
    const _probeId = _probeIds[0];

    /* Add tournament specific data */
    // if (data.type === 'Competition') {
    //     const tournamentSpecificData = {
    //         probe_id: _probeId,
    //         max_pool: _maxPool,
    //         max_players: _maxPlayers,
    //         bids_per_player: _bids
    //     };
    //     let _;
    //     [err, _] = await to(Probe.addTournamentSpecificInfo(tournamentSpecificData));
    //     if (err) throw err;
    // }

    if (!data['is_price_editable'] && !data['is_variable_liquidity_pool']) {
        /* Create entry in new table for Automated market making */
        let _;

        const pricePerContract = maxReturn / 2;
        // logger.info(_probeId, '--', pricePerContract);
        const noOfTokens = liquidityPool / 100;

        const fixedLiqPoolUserId = process.env.NODE_ENV === 'production' ? 433061 : 89;

        [err, _] = await to(LiquidityPool.add(_probeId, noOfTokens, pricePerContract));
        if (err) {
            logger.error(err);
            logger.error("Could not create liquidity pool for probeid : " + _probeId);
        }
        let reqId = uuid();
        //await updateWalletBalance(fixedLiqPoolUserId, liquidityPool, undefined, reqId, ORDER);
        const transactionLogs = [];
        transactionLogs.push(
            await addToTransactions(
                { probeid: _probeId, noofcontracts: noOfTokens }, maxReturn, undefined, pTitle,
                fixedLiqPoolUserId, liquidityPool, undefined, ADD_LIQUIDITY, undefined,
                0, reqId
            )
        );
        // await persistTransactionData(transactionLogs, reqId);
        await UserService.executeTransactions(transactionLogs);
    } else if (!data['is_price_editable'] && data['is_variable_liquidity_pool']) {
        const pranavUserId = process.env.NODE_ENV === 'production' ? 396569 : 89
        let requestParameters = {
            maxReturn: maxReturn,
            probeId: _probeId,
            userId: pranavUserId,
            totalAmount: liquidityPool,
            probeTitle: pTitle,
            fantasyType: data?.fantasy_type,
            fantasyId: data?.fantasy_id,
        };
        let [errLP, addLiquidutyResp] = await to(addLiquidity(requestParameters, uuid(), _schema));
        if (errLP) {
            logger.error(errLP);
            logger.error("Could not create liquidity pool for probeid : " + _probeId);
        }
    }

    if( _schema !== 'fantasy' ) {
        let embeddingtext = data.title;
        if( data.live_stats_props ) {
            if( data.live_stats_props.tournament_name ) {
                embeddingtext = `${embeddingtext} in ${data.live_stats_props.tournament_name}`;
            }
            if( data.live_stats_props.team_a ) {
                embeddingtext = `${embeddingtext} between ${data.live_stats_props.team_a} and ${data.live_stats_props.team_b}`;
            }
        }
        logger.info(`Embeddings: Final text: ${embeddingtext}`);
        let titleEmbedding = await createEventEmbedding(embeddingtext);
        // logger.info(`Embeddings: embedded text: ${titleEmbedding}`);
        // console.log(titleEmbedding.embeddings);
        let payload = {
            item_id: _probeId,
            application: `Prediction`,
            embedding: JSON.stringify( titleEmbedding.embeddings.map( i => parseFloat(i) ) ),
            model_name: 'bge-m3',
            locale: 'en-in',
            property: 'title',
            original_text: embeddingtext,
        };
        logger.info(`Embeddings: DB payload: ${titleEmbedding}`);
        console.log(payload);
        let embRes = await Embeddings.addEmbeddingDB(payload);
        logger.info(`Embeddings: embedding added: ${embRes}`);
    }

    /* Live stats */
    const liveStatsParams = {
        probeId: _probeId,
        link: data.source,
        live_stats_type: data.live_stats_type,
        live_stats_para: data.live_stats_props
    }
    let _liveStatResp;
    [err, _liveStatResp] = await to(liveStats.create(liveStatsParams));
    if (err) throw err;
    if (data['auto_settle']) {

        AutoSettleJob(data.settledate.sql, _probeId);
    }

    /* Generate and add share link for the event */
    let eventType = data.type, sharelink;
    if (data['parent_id'] === -1) {
        eventType = 'clubbed';
    }
    try {
        if ((data.fantasy_id) || (data.fantasy_type)) {
            let contestinfo = await Contest.getContestById(data.fantasy_id, 'fantasy');
            if (contestinfo.length <= 0) {
                throw new Error("No contest found. Cannot create dynamic link");
            }
            contestinfo = contestinfo[0];
            sharelink = await EventsService.getShareLinkContest(data.fantasy_id, contestinfo.title);
        } else {
            sharelink = await getShareLink(_probeId, pTitle, eventType);
            await generateShareLinkForActivePartners(_probeId, pTitle, eventType);
        }
    } catch (e) {
        logger.error('Cannot create dynamic link')
        logger.error(e)
    }
    const dataToUpdate = { 'id': _probeId, 'sharelink': sharelink };
    [err, _probes] = await to(Probe.update(dataToUpdate, _schema));
    if (err) throw err;

    var tagsData = [];
    var tagsList = data.keywords ? data.keywords.split(',') : [];
    for (var i = 0; i < tagsList.length; i++) {
        if (tagsList[i].length > 0) {
            tagsData.push({ 'probeid': _probeId, 'tag': tagsList[i] });
        }
    }

    if (tagsData.length > 0) {
        [err, _tagsIds] = await to(Probe.addTags(tagsData, null, _schema));
        if (err) throw err;
        if (!_schema) {
            await EventNewsServices.updateNews(_probeId);
        }
    }

    var regionsData = [];
    for (var i = 0; i < regionsList.length; i++) {
        if (regionsList[i].length > 0) {
            regionsData.push({ 'probeid': _probeId, 'region': regionsList[i] });
        }
    }
    if (regionsData.length > 0) {
        [err, _regionIds] = await to(Probe.addRegions(regionsData, _probeId, _schema));
        if (err) throw err;
    }

    await Probe.addProbesPartner(_probeId, partners.join(','), _schema);

    let _probeOptions = [], _probeOptionIds = [];

    for (var i = 0; i < dOptions.length; i++) {
        if (dOptions[i].text.length == 0) {
            continue;
        }
        let data = Object.assign({}, dOptions[i]);
        delete data.id;
        data['probeid'] = _probeId;
        _probeOptions.push(data);

    }
    if (_probeOptions.length > 0) {
        [err, _probeOptionIds] = await to(Probe.addProbeOtions(_probeOptions, _schema));
        if (err) throw err;
    }

    /* No need to cache parent clubbed events */
    if (!data['parent_id'] || (data['parent_id'] && data['parent_id'] !== -1)) {
        const default_value = parseFloat(parseFloat((maxReturn / 2).toString()).toFixed(2));
        const eventInfoObject = { 'volume': 0, 'lastcall': { 'coins': default_value, 'callvalue': 'Y' }, 'created_at': Date.now() };
        redisCaching.setHMKey(_probeId, 'eventInfoMap', JSON.stringify(eventInfoObject))     // Put the event in the eventInfoMap
        const eventCpObject = { currentPrice: { yCP: default_value, nCP: default_value, newYCP: default_value, newNCP: default_value } };
        redisCaching.setHMKey(_probeId, 'eventCpMap', JSON.stringify(eventCpObject));        // Put the event in event CP Map
    }
    redisCaching.client.eval(`return redis.call('del', 'defaultKey', unpack(redis.call('keys', ARGV[1])))`, 0, `liveevents_*`, (err, res) => {
        if (err) {
            logger.error('livevents cache not cleared')
        }
    })
    // return _probeId;
    return {
        success: true,
        probeId: _probeId
    };
}
// generateShareLinkForActivePartners(1234, 'Hello there', 'clubbed');
const create = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    if (req.baseUrl.includes('v1')) {
        return ReE(res, messages.TRADING_NOT_ALLOWED, 405);
    }
    try {
        if (!isDashboardUser(req)) {
            res.writeStatus("401");
            return ReS(res, {
                success: true, msg: 'Unauthorized request, incident has been reported'
            });
        } else {
            if (!req.user.is_internal && req.user.regions) {
                req.body['regions'] = req.user.regions.split(',');
            }
            if (!req.user.is_internal && req.user.partners) {
                req.body['partners'] = req.user.partners.split(',');
            }
        }
        var dbUserId = req.user.id;
        var err, _probeIds, _regionIds, _tagsIds, _probes, _probeCallsOpen, _schema;
        var data = Object.assign({}, req.body, { createdby: dbUserId });
        /*
        machine's timezne is UTC, for events dashboard users enter time in IST
        convert the incoming values for endsat and settledate to UTC
        */
        try {
            const resp = await createEvent(data, req);
            if (resp.success === false) {
                return ReE(res, {
                    success: false, message: resp.message
                });
            }
            logger.info(`Event ${resp.probeId} created by user ${req.user.id}`);
            return ReS(res, {
                success: true, probeid: resp.probeId
            });
        } catch (err) {
            next(err);
        }
    } catch (e) {
        next(e);
    }
}

const createBulk = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    if (req.baseUrl.includes('v1')) {
        return ReE(res, messages.TRADING_NOT_ALLOWED, 405);
    }
    try {
        if (!isDashboardUser(req)) {
            res.writeStatus("401");
            return ReS(res, {
                success: true, msg: 'Unauthorized request, incident has been reported'
            });
        }
        var err, _probeIds = [], _regionIds, _tagsIds, _probes, _probeCallsOpen, _schema;
        var data = Object.assign({}, req.body);
        /*
        machine's timezne is UTC, for events dashboard users enter time in IST
        convert the incoming values for endsat and settledate to UTC
        */
        try {
            for (let e of data['events']) {
                const resp = await createEvent(e, req);
                if (resp.success === false) {
                    return ReE(res, {
                        success: false, messages: resp.message
                    });
                }
                _probeIds.push(resp.probeId);
            }
            return ReS(res, {
                success: true, ids: _probeIds
            });
        } catch (err) {
            next(err);
        }
    } catch (e) {
        next(e);
    }
}

const update = async function (req, res, next) {
    if (!isDashboardUser(req)) {
        res.writeStatus("401");
        return ReS(res, {
            success: true, msg: 'Unauthorized request, incident has been reported'
        });
    }
    if (req.baseUrl.includes('v1')) {
        return ReE(res, messages.TRADING_NOT_ALLOWED, 405);
    }
    // res.setHeader('Content-Type', 'application/json');
    var data = {};
    data = Object.assign({}, req.body);
    logger.info(`${data['id']} ${JSON.stringify(req.body)} Update Request received from user ${req.user.id}`);

    let _schema = 'public';
    if (data?.domain) {
        _schema = data?.domain;
    }
    const REDIS_KEY = `${_schema}.PROBES_UPDATE`;

    try {

        const unlock = await lock(`probe_update_${data['id']}`, 60000);
        var isUpdating = false;
        const isADashboardUser = true;
        const serializedData = await redisCaching.getHMKey(data['id'], REDIS_KEY);
        if (serializedData) {
            try {
                isUpdating = serializedData === 'true';
            } catch (e) {
                // ignore
            }
        }
        if (isUpdating) {
            logger.error(` ${data['id']} isUpdating = true`);
            unlock();
            return ReE(res, 'A request is already in process', 400);
        }

        await redisCaching.setHMKey(data['id'], REDIS_KEY, 'true');

        unlock();

        if (data['status'] == eventStatusEnum.COMPLETE && !data['correctvalue']) {
            redisCaching.delHMKey(data['id'], REDIS_KEY);
            return ReE(res, 'Invalid Request', 500);
        }

        var err, _probeRows, _probeCalls, _regionIds, _txns, _probeId = data['id'], _walletData, _probeCallsOpen, _probesObject;

        [err, _probesObject] = await to(Probe.getProbes({ 'probeid': _probeId, 'status': `'A','I','C','CAN','RST','F','H'`, 'isDashboardUser': isADashboardUser }, 1000, _schema));
        _probeRows = _probesObject.rows;

        let timezone = data?.timezone ?? _probeRows[0]?.timezone
        if (data['endsat']) {
            data['endsat'] = getTimestamptz([data['endsat'], timezone].join(' '));
        }
        if (data['settledate']) {
            data['settledate'] = getTimestamptz([data['settledate'], timezone].join(' '));
        }
        if (data['start_date']) {
            // const startDate = IstToUtc(data['start_date']);
            const startDate = getTimestamptz([data['start_date'], timezone].join(' '));

            if ((data['endsat'] && (data['endsat'] < startDate)) ||
                (data['settledate'] && (data['settledate'] < startDate))) {
                throw new Error('Start date can not be after end date or settlement date');
            }
            data['start_date'] = startDate;
        }

        if (data.regions && (Array.isArray(data.regions) && data.regions.length > 0)) {
            var regionsData = [];
            var regionsList = req?.body?.regions ?? [];
            for (var i = 0; i < regionsList.length; i++) {
                if (regionsList[i].length > 0) {
                    regionsData.push({ 'probeid': _probeId, 'region': regionsList[i] });
                }
            }
            [err, _regionIds] = await to(Probe.addRegions(regionsData, _probeId, _schema));
            if (err) throw err;
        }

        if (data.partners && (Array.isArray(data.partners) && data.partners.length > 0)) {
            await Probe.updateProbesPartner(_probeId, data.partners.join(','), _schema);
        }

        let eventStatus = _probeRows[0].status;

        delete probesCache[_probeId];

        delete data.options;

        logger.info('Updating Event: ' + _probeId + 'on ' + data['status']);

        //Disable live stats

        await redisCaching.delHMKey(_probeId, 'eventLiveStatsYT');
        await redisCaching.delHMKey(_probeId, 'eventLiveStatsCrypto');
        await redisCaching.delHMKey(_probeId, 'eventLiveStatsTwitter');
        await redisCaching.delHMKey(_probeId, 'eventLiveStatsCricket');
        redisCaching.delKey(`event_${_probeId}`);
        redisCaching.client.eval(`return redis.call('del', 'defaultKey', unpack(redis.call('keys', ARGV[1])))`, 0, `liveevents_*`, (err, res) => {
            if (err) {
                logger.error('livevents cache not cleared')
            }
        })

        if (data['correctvalue'] && data['status'] == eventStatusEnum.COMPLETE && eventStatus == eventStatusEnum.COMPLETE && _probeRows[0].correctvalue != data['correctvalue']) {
            logger.info(`Resettling Event ${data['id']} : Not trigerred due to change`);
            return ReE(res, 'Resettle the event first', 400);
        }



        // [err, _probeRows] = await to(Probe.update(data));
        // if (err) throw err;

        if (data.keywords && data.keywords != _probesObject.rows[0].keywords) {
            const keywords = []
            const newsKeywords = data.keywords.split(',');
            for (let i = 0; i < newsKeywords.length; i++) {
                if (newsKeywords[i]) {
                    keywords.push({ 'probeid': _probeId, 'tag': newsKeywords[i] });
                }
            }
            [err, _] = await to(Probe.addTags(keywords, _probeId, _schema));
            if (err) {
                logger.error('Error occurred while updating keywords for event id : ' + _probeId);
            }
            let newsDataRedisKey = `news_data_event_${_probeId}`;
            logger.info(`Deleting news from cache for event - ${_probeId}`);
            await redisCaching.delKey(newsDataRedisKey);
            logger.info(`Deleting news from database for event - ${_probeId}`);
            [err, _] = await to(Probe.deleteInfoRequests(_probeId));
            if (err) {
                throw err;
            }
        }

        if (data['status'] == eventStatusEnum.COMPLETE) {
            let newsDataRedisKey = `news_data_event_${_probeId}`;
            logger.info(`Deleting news from cache for event - ${_probeId}`);
            await redisCaching.delKey(newsDataRedisKey);
            logger.info(`Deleting news from database for event - ${_probeId}`);
            [err, _] = await to(Probe.deleteInfoRequests(_probeId));
            if (err) {
                throw err;
            }
        }

        // SolrService.updateSolrDocument(_probeRows[0]).catch((e) => logger.error(e)); //update document in solr as well

        delete probesCache[_probeId];

        let _probeTitle = _probeRows[0].title;

        let userData = {};

        if (!data['is_price_editable']) {
            data.liquidity_fee_factor = validateLiquidityFeeFactor(data.liquidity_fee_factor)
        }

        if (data['status'] == eventStatusEnum.RESET) {
            await handleEventReset(data['type'], data['id'], _probeTitle, data['is_price_editable'], _schema);
            if (_schema === 'public') {
                await UserTradingFee.deleteUnprocessedOnCancel(_probeId);
            }
            redisCaching.delHM('userWallet');
            [err, _probeRows] = await to(Probe.update(data, _schema));
            if (err) throw err;
            res['data'] = { success: true };
            redisCaching.delHMKey(data['id'], REDIS_KEY);

            return ReS(res, {
                success: true
            });
        }
        let sFee = CONFIG.settlementCharges;


        if (data['status'] == eventStatusEnum.CANCELLED || data['status'] == eventStatusEnum.INACTIVE) {
            if (eventStatus == eventStatusEnum.CANCELLED || eventStatus == eventStatusEnum.INACTIVE) {
                redisCaching.delHMKey(data['id'], REDIS_KEY);
                return ReS(res, {
                    success: true
                });
            }
            let _fData = { ...data, status: 'F' };
            [err, _probeRows] = await to(Probe.update(_fData, _schema));
            if (err) throw err;
            logger.info(`Settling Event ${data['id']} : ${_probeTitle} for Cancellation`);
            /* Remove the event from caches after cancellation */
            redisCaching.delHMKey(data['id'], 'eventInfoMap');
            redisCaching.delHMKey(data['id'], 'eventCpMap');
            await cancelEvent(data['id'], _schema);

        } else if (data['status'] == eventStatusEnum.COMPLETE) {

            if (eventStatus === eventStatusEnum.COMPLETE || eventStatus === eventStatusEnum.CANCELLED) {
                logger.info(`Settling Event ${data['id']} : Already event in status ${eventStatus}`);
                return ReE(res, `Already event in status ${eventStatus}`, 400);
            }
            // let [err, settleRows] = await to(Transactions.getSettlementTransations(_probeId, _schema));
            // let settleRowCount = parseInt(settleRows[0].count);
            // if (settleRowCount > 0) {
            //     logger.info(`Settling Event ${data['id']} : Not trigerred due to settlement row already exist in transactions`);
            //     return ReE(res, 'Event already settled', 400);
            // }

            if (data['correctvalue']) {

                logger.info(`Settling Event ${data['id']} : ${_probeTitle} for value: ${data['correctvalue']}`);

                let _fData = { ...data, status: 'F' };
                [err, _probeRows] = await to(Probe.update(_fData, _schema));
                if (err) throw err;

                if (data['type'] == 'Bet') {
                    data['settlement'] = true;
                    await waitTimer(5000);
                    var rx = await forkPromiseForSettlement(data, eventStatus, _probeTitle, _schema);
                    // redisCaching.delHMKey(data['id'], REDIS_KEY);
                    logger.info(`Settling Event ${data['id']}, rx:  ${rx}`);
                    let resp = JSON.parse(rx)
                    if (resp['status'] === 'error') {
                        logger.error(resp['message']);
                        await redisCaching.delKey(probeSettlementKeyPrefix + _probeId)
                        return ReS(res, { success: false });
                    }
                    [err, probeNotifKey] = await to(redisCaching.getKey(probeSettlementKeyPrefix + _probeId));
                    if (err) throw err;
                    var output = JSON.parse(probeNotifKey);
                    await redisCaching.delKey(probeSettlementKeyPrefix + _probeId)
                    logger.info(`Settling Event ${data['id']}, output:  ${output}`);

                    logger.info(`Settling Event ${data['id']}, notifying to users`);
                    let notifArray = output || [];
                    for (let i = 0; i < notifArray.length; i++) {
                        let { userId, fcmToken, ...jsonData } = notifArray[i];
                        logger.info(`Settling Event ${data['id']}, userId: ${userId}`);
                        logger.info(`Settling Event ${data['id']}, userId: ${fcmToken}`);
                        // UserService.addMessageAndInform(userId, fcmToken, jsonData);
                    }

                    logger.info(`Settling Event ${data['id']}, All notification done`);
                    // kafkaAdminService.deleteTopic(data['id']);
                } else if (data['type'] == 'Competition') {
                    const callsData = { 'probeid': _probeId, 'tournament': true };
                    let title, msgBody, jsonData, userData = {};

                    /* Grouping the calls*/
                    [err, _probeCalls] = await to(Probe.getProbeCallsWithUsers(callsData));
                    let groupingObject = {}, callDiff, keys = [];
                    for (let i = 0; i < _probeCalls.length; i++) {
                        callDiff = Math.abs(parseFloat(_probeCalls[i].callvalue) - parseFloat(data['correctvalue']));
                        if (!(callDiff in groupingObject)) {
                            groupingObject[callDiff] = [];
                            keys.push(callDiff);
                        }
                        groupingObject[callDiff].push(i);
                    }
                    keys.sort((a, b) => (a - b));
                    /* Ranking the bets based on proximity with the correctValue*/
                    let rankArray = [];
                    for (let i = 0; i < keys.length; i++)
                        for (let j = 0; j < groupingObject[keys[i]].length; j++)
                            rankArray.push(groupingObject[keys[i]][j]);

                    /* Fetch tournament related data */
                    [err, tournamentSpecificInfo] = await to(Probe.getTournamentSpecificInfo(_probeId));
                    if (err) throw err;
                    const max_pool = tournamentSpecificInfo['max_pool'];
                    const participation_count = tournamentSpecificInfo['max_players'];
                    const spots_filled = _probeCalls.length;

                    if (_probeCalls === undefined || spots_filled === 0) {
                        res['data'] = { success: true };
                        return ReS(res, { success: true });
                    }

                    /* Distribution of max_pool */
                    switch (true) {
                        case (participation_count == 1):
                            if (spots_filled == 1)
                                await modifyProbeCall(_probeCalls, 0, 1, max_pool);
                            break;
                        case (participation_count == 2):
                            if (spots_filled == 1 || spots_filled == 2)
                                await modifyProbeCall(_probeCalls, rankArray[0], 1, max_pool);
                            break;
                        case (participation_count == 3):
                            if (spots_filled == 1)
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.75, max_pool);
                            else {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.75, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.25, max_pool);
                            }
                            break;
                        case (participation_count == 4):
                            if (spots_filled == 1)
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.75, max_pool);
                            else {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.70, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.30, max_pool);
                            }
                            break;
                        case (participation_count >= 5 && participation_count < 10):
                            if (spots_filled == 1)
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.60, max_pool);
                            else if (spots_filled == 2) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.60, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.30, max_pool);
                            } else {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.60, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.30, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.10, max_pool);
                            }
                            break;
                        case (participation_count >= 10 && participation_count < 20):
                            if (spots_filled == 1)
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.50, max_pool);
                            else if (spots_filled == 2) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.50, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.30, max_pool);
                            } else if (spots_filled == 3) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.50, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.30, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.10, max_pool);
                            } else {
                                const limit = Math.min(spots_filled, 5);
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.50, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.30, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.10, max_pool);
                                for (let i = 3; i < limit; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.05, max_pool);
                            }
                            break;
                        case (participation_count >= 20 && participation_count < 50):
                            if (spots_filled == 1)
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.50, max_pool);
                            else if (spots_filled == 2) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.50, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.20, max_pool);
                            } else if (spots_filled == 3) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.50, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.20, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.10, max_pool);
                            } else if (spots_filled > 3 && spots_filled <= 5) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.50, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.20, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.10, max_pool);
                                for (let i = 3; i < spots_filled; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.05, max_pool);
                            } else {
                                const limit = Math.min(spots_filled, 10);
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.50, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.20, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.10, max_pool);
                                for (let i = 3; i < 5; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.05, max_pool);
                                for (let i = 5; i < limit; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.02, max_pool);
                            }
                            break;
                        case (participation_count >= 50 && participation_count < 100):
                            if (spots_filled == 1)
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.40, max_pool);
                            else if (spots_filled == 2) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.40, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.20, max_pool);
                            } else if (spots_filled == 3) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.40, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.20, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.10, max_pool);
                            } else if (spots_filled > 3 && spots_filled <= 5) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.40, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.20, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.10, max_pool);
                                for (let i = 3; i < spots_filled; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.05, max_pool);
                            } else if (spots_filled > 5 && spots_filled <= 10) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.40, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.20, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.10, max_pool);
                                for (let i = 3; i < 5; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.05, max_pool);
                                for (let i = 5; i < spots_filled; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.02, max_pool);
                            } else {
                                const limit = Math.min(spots_filled, 20);
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.40, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.20, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.10, max_pool);
                                for (let i = 3; i < 5; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.05, max_pool);
                                for (let i = 5; i < 10; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.02, max_pool);
                                for (let i = 10; i < limit; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.01, max_pool);
                            }
                            break;
                        case (participation_count >= 100 && participation_count < 200):
                            if (spots_filled == 1)
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.30, max_pool);
                            else if (spots_filled == 2) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.30, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.20, max_pool);
                            } else if (spots_filled == 3) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.30, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.20, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.10, max_pool);
                            } else if (spots_filled > 3 && spots_filled <= 5) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.30, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.20, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.10, max_pool);
                                for (let i = 3; i < spots_filled; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.05, max_pool);
                            } else if (spots_filled > 5 && spots_filled <= 10) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.30, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.20, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.10, max_pool);
                                for (let i = 3; i < 5; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.05, max_pool);
                                for (let i = 5; i < spots_filled; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.02, max_pool);
                            } else if (spots_filled > 10 && spots_filled <= 20) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.30, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.20, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.10, max_pool);
                                for (let i = 3; i < 5; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.05, max_pool);
                                for (let i = 5; i < 10; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.02, max_pool);
                                for (let i = 10; i < spots_filled; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.01, max_pool);
                            } else {
                                const limit = Math.min(spots_filled, 50);
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.30, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.20, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.10, max_pool);
                                for (let i = 3; i < 5; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.05, max_pool);
                                for (let i = 5; i < 10; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.02, max_pool);
                                for (let i = 10; i < 20; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.01, max_pool);
                                for (let i = 20; i < limit; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0033, max_pool);
                            }
                            break;
                        case (participation_count >= 200 && participation_count < 500):
                            if (spots_filled == 1)
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.25, max_pool);
                            else if (spots_filled == 2) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.25, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.15, max_pool);
                            }
                            else if (spots_filled == 3) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.25, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.15, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.10, max_pool);
                            }
                            else if (spots_filled > 3 && spots_filled <= 5) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.25, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.15, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.10, max_pool);
                                for (let i = 3; i < spots_filled; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.05, max_pool);
                            }
                            else if (spots_filled > 5 && spots_filled <= 10) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.25, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.15, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.10, max_pool);
                                for (let i = 3; i < 5; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.05, max_pool);
                                for (let i = 5; i < spots_filled; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.02, max_pool);
                            }
                            else if (spots_filled > 10 && spots_filled <= 20) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.25, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.15, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.10, max_pool);
                                for (let i = 3; i < 5; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.05, max_pool);
                                for (let i = 5; i < 10; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.02, max_pool);
                                for (let i = 10; i < spots_filled; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.01, max_pool);
                            }
                            else if (spots_filled > 20 && spots_filled <= 50) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.25, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.15, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.10, max_pool);
                                for (let i = 3; i < 5; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.05, max_pool);
                                for (let i = 5; i < 10; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.02, max_pool);
                                for (let i = 10; i < 20; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.01, max_pool);
                                for (let i = 20; i < spots_filled; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0033, max_pool);
                            }
                            else {
                                const limit = Math.min(spots_filled, 100);
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.25, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.15, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.10, max_pool);
                                for (let i = 3; i < 5; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.05, max_pool);
                                for (let i = 5; i < 10; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.02, max_pool);
                                for (let i = 10; i < 20; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.01, max_pool);
                                for (let i = 20; i < 50; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0033, max_pool);
                                for (let i = 50; i < limit; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.002, max_pool);
                            }
                            break;
                        case (participation_count >= 500 && participation_count < 1000):
                            if (spots_filled == 1)
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.25, max_pool);
                            else if (spots_filled == 2) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.25, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.15, max_pool);
                            } else if (spots_filled == 3) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.25, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.15, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.10, max_pool);
                            } else if (spots_filled > 3 && spots_filled <= 5) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.25, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.15, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.10, max_pool);
                                for (let i = 3; i < spots_filled; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.05, max_pool);
                            } else if (spots_filled > 5 && spots_filled <= 10) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.25, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.15, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.10, max_pool);
                                for (let i = 3; i < 5; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.05, max_pool);
                                for (let i = 5; i < spots_filled; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.02, max_pool);
                            } else if (spots_filled > 10 && spots_filled <= 20) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.25, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.15, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.10, max_pool);
                                for (let i = 3; i < 5; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.05, max_pool);
                                for (let i = 5; i < 10; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.02, max_pool);
                                for (let i = 10; i < spots_filled; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0075, max_pool);
                            } else if (spots_filled > 20 && spots_filled <= 50) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.25, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.15, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.10, max_pool);
                                for (let i = 3; i < 5; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.05, max_pool);
                                for (let i = 5; i < 10; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.02, max_pool);
                                for (let i = 10; i < 20; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0075, max_pool);
                                for (let i = 20; i < spots_filled; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0025, max_pool);
                            } else if (spots_filled > 50 && spots_filled <= 100) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.25, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.15, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.10, max_pool);
                                for (let i = 3; i < 5; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.05, max_pool);
                                for (let i = 5; i < 10; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.02, max_pool);
                                for (let i = 10; i < 20; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0075, max_pool);
                                for (let i = 20; i < 50; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0025, max_pool);
                                for (let i = 50; i < spots_filled; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0015, max_pool);
                            } else {
                                const limit = Math.min(spots_filled, 200);
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.25, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.15, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.10, max_pool);
                                for (let i = 3; i < 5; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.05, max_pool);
                                for (let i = 5; i < 10; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.02, max_pool);
                                for (let i = 10; i < 20; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0075, max_pool);
                                for (let i = 20; i < 50; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0025, max_pool);
                                for (let i = 50; i < 100; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0015, max_pool);
                                for (let i = 100; i < limit; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.00075, max_pool);
                            }
                            break;
                        case (participation_count >= 1000):
                            if (spots_filled == 1)
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.25, max_pool);
                            else if (spots_filled == 2) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.25, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.15, max_pool);
                            } else if (spots_filled == 3) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.25, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.15, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.075, max_pool);
                            } else if (spots_filled > 3 && spots_filled <= 5) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.25, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.15, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.075, max_pool);
                                for (let i = 3; i < spots_filled; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0375, max_pool);
                            } else if (spots_filled > 5 && spots_filled <= 10) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.25, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.15, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.075, max_pool);
                                for (let i = 3; i < 5; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0375, max_pool);
                                for (let i = 5; i < spots_filled; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.015, max_pool);
                            } else if (spots_filled > 10 && spots_filled <= 20) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.25, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.15, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.075, max_pool);
                                for (let i = 3; i < 5; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0375, max_pool);
                                for (let i = 5; i < 10; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.015, max_pool);
                                for (let i = 10; i < spots_filled; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0075, max_pool);
                            } else if (spots_filled > 20 && spots_filled <= 50) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.25, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.15, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.075, max_pool);
                                for (let i = 3; i < 5; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0375, max_pool);
                                for (let i = 5; i < 10; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.015, max_pool);
                                for (let i = 10; i < 20; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0075, max_pool);
                                for (let i = 20; i < spots_filled; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0025, max_pool);
                            } else if (spots_filled > 50 && spots_filled <= 100) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.25, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.15, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.075, max_pool);
                                for (let i = 3; i < 5; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0375, max_pool);
                                for (let i = 5; i < 10; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.015, max_pool);
                                for (let i = 10; i < 20; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0075, max_pool);
                                for (let i = 20; i < 50; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0025, max_pool);
                                for (let i = 50; i < spots_filled; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0015, max_pool);
                            } else if (spots_filled > 100 && spots_filled <= 200) {
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.25, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.15, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.075, max_pool);
                                for (let i = 3; i < 5; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0375, max_pool);
                                for (let i = 5; i < 10; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.015, max_pool);
                                for (let i = 10; i < 20; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0075, max_pool);
                                for (let i = 20; i < 50; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0025, max_pool);
                                for (let i = 50; i < 100; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0015, max_pool);
                                for (let i = 100; i < spots_filled; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.00075, max_pool);
                            } else {
                                const limit = Math.min(spots_filled, 500);
                                await modifyProbeCall(_probeCalls, rankArray[0], 0.25, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[1], 0.15, max_pool);
                                await modifyProbeCall(_probeCalls, rankArray[2], 0.075, max_pool);
                                for (let i = 3; i < 5; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0375, max_pool);
                                for (let i = 5; i < 10; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.015, max_pool);
                                for (let i = 10; i < 20; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0075, max_pool);
                                for (let i = 20; i < 50; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0025, max_pool);
                                for (let i = 50; i < 100; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.0015, max_pool);
                                for (let i = 100; i < 200; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.00075, max_pool);
                                for (let i = 200; i < limit; i++)
                                    await modifyProbeCall(_probeCalls, rankArray[i], 0.00015, max_pool);
                            }
                            break;
                        default:
                            break;
                    }

                    /* Calculate amtToReturn to each user */
                    for (let i = 0; i < _probeCalls.length; i++) {
                        const userId = _probeCalls[i]['userid'];
                        if (!userData[userId]) userData[userId] = { amtToReturn: 0 };
                        userData[userId]['amtToReturn'] += _probeCalls[i]['returns'];
                    }

                    /* Do entries in the transaction table, update wallet and send notifications */
                    for (let user_id in userData) {
                        let [err, fcmToken] = await to(User.findFCMTokenByUserId(user_id));
                        if (err) throw err;
                        const amount = userData[user_id]['amtToReturn'].toFixed(2);
                        if (amount != 0) {
                            const txnId = 'S' + (100000000 + parseInt(_probeId));
                            const sMsg = `Tournament: ${_probeTitle}\nSettled (${amount} credited)`;
                            const txnData = { 'amount': amount, 'userid': user_id, 'type': 'CREDIT', 'wallettype': 'D', 'txnid': txnId, 'message': sMsg };
                            [err, _txns] = await to(User.addTransaction(txnData));
                            if (err) throw err;

                            const walletData = { 'coinsd': amount, 'userid': user_id };
                            [err, _walletData] = await to(User.updateWallet(walletData));
                            if (err) throw err;

                            title = `Congratulations, You won!`;
                            msgBody = `Tournament '${_probeTitle}' finished. You won ${amount}!`;
                            jsonData = { 'probeid': _probeId, 'title': title, 'type': 'N', 'body': msgBody };
                            // UserService.addMessageAndInform(user_id, fcmToken, jsonData);
                        } else {
                            title = `You lost!`;
                            msgBody = `Tournament '${_probeTitle}' finished! Better luck next time`;
                            jsonData = { 'probeid': _probeId, 'title': title, 'type': 'N', 'body': msgBody };
                            // UserService.addMessageAndInform(user_id, fcmToken, jsonData);
                        }
                    }

                    /* Update tournament_rank in probecalls table*/
                    for (let i = 0; i < rankArray.length; i++) {
                        _probeCalls[rankArray[i]].tournament_rank = i + 1;
                        [err, _] = await to(Probe.updateCallTournamentRank(_probeCalls[rankArray[i]]));
                        if (err) throw err;
                    }

                    await redisCaching.delHMKey(_probeId, 'eventInfoMap');        // Remove the event from redis hashmap after settling the event
                }
            }
            logger.info(`Settling Event ${data['id']}, wait start`);
            await waitTimer(500);
            logger.info(`Settling Event ${data['id']}, wait end`);
            await forkPromiseForHistoryBlob(req.body.id, eventStatus, _schema);
            logger.info(`Settling Event ${data['id']}, History updated`);
        }

        [err, _probeRows] = await to(Probe.update(data, _schema));
        if (err) throw err;

        // redisCaching.delHM('userWallet');
        res['data'] = { success: true };
        redisCaching.delHMKey(data['id'], REDIS_KEY);

        return ReS(res, {
            success: true
        });
    } catch (err) {
        console.log("[ERROR IN UPDATE]", err)
        // redisCaching.delHMKey(data['id'], REDIS_KEY);
        next(err);
    } finally {

    }
}

const forkPromiseForHistoryBlob = async (eventId, eventStatus, schema = 'public') => {
    // let [err, historyRows] = await to(History.getHistoryEvent(eventId, schema));
    // let historyRowCount = parseInt(historyRows[0].count);
    // if (historyRowCount > 0) {
    //     logger.info(`History Event ${eventId} : Not trigerred due to history row already exist in history`);
    //     return ReE(res, 'History already populated', 400);
    // }
    await populateHistoryBlob(eventId, eventStatus, schema);
    //await getClosedEventFromDB();
    // return new Promise((resolve, reject) => {
    //     const child = fork('controllers/populateHistory.js');
    //     child.on("message", function (message) {
    //         resolve(message);
    //     });
    //     child.on('error', function (e) {
    //         console.log('error');
    //         console.log(e);
    //     })
    //     child.send(JSON.stringify({  eventId: eventId }));
    // });
}

const getProbes = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        var err, _probeRows;
        var data = req.body;
        const _isDashboardUser = isDashboardUser(req);
        data['isDashboardUser'] = _isDashboardUser;
        data['isInternalTestUser'] = await isAnInternalUser(req);
        if (_isDashboardUser) {
            data['isDashboardInternaluser'] = req.user.is_internal
            data['dashboardUserId'] = req.user.id
        }

        const t1 = Date.now();
        let _prefRes;
        const partnerId = Number(req.headers['x-partner-id']) || 1;
        // if (req.user && req.user.id && req.user.id != -1) {
        //     [err, _prefRes] = await to(UserPreference.getPreference(req.user.id));
        //     if (err) throw err;
        // }
        // if (_prefRes && req.user.id != -1)
        //     cleanProbesViewed(_prefRes, req.user.id);

        /* If user has no preference and no probes viewed show the markets to him sorted by volume */
        let isNewUser = false;
        if ((data['isDashboardUser'] === undefined || data['isDashboardUser'] === false) && (!data['sortingType'] || data['sortingType'] == sortTypeList[0].Id) && _prefRes && _prefRes.length !== 0 && _prefRes[0].probes_viewed === null && _prefRes[0].category_preference === null) {
            isNewUser = true;
            req.body['sortingType'] = sortTypeList[0].Id;
        }
        if (!req.body['sortingType']) req.body['sortingType'] = sortTypeList[0].Id;

        let _probesObject, _hashtagsObj;
        let isSingleProbe = !!data['probeid'];
        if (data['probeid']) {
            if (Array.isArray(data['probeid'])) {
                for (let i = 0; i < data['probeid'].length; i++) {
                    if (isNaN(parseInt(data['probeid'][i]))) {
                        return ReE(res, messages.INVALID_REQUEST, 400);
                    };
                }
            } else if (isNaN(parseInt(data['probeid']))) {
                return ReE(res, messages.INVALID_REQUEST, 400);
            }
        }
        data['partnerId'] = partnerId ? partnerId : 1;
        // data['region'] = req?.user?.region ? req.user.region : null;
        data['region'] = 'INDIA';
        data['region'] = req?.user?.region ?? req?.region ?? 'INDIA';
        data.partnerId = req?.user?.partner?.id ?? 1;
        // data['region'] = 'INDIA';

        if (req.fantasy) {
            data['fantasy'] = req.fantasy
        }

        const noOfRowsToFetch = _isDashboardUser ? 100 : 100;
        logger.info(`Dashboard user rowsfetch: ${noOfRowsToFetch}, _isDashboardUser: ${_isDashboardUser}`);
        [err, _probesObject] = await to(Probe.getProbes(data, noOfRowsToFetch, req?.domain, req?.user?.id));
        if (err) throw err;

        if (partnerId != 1) {
            const queryKey3 = `[GET PROBES] partnerExcludeCategories user: ${req.user.id}:  ${new Date().toLocaleString()}`;
            if (!isSingleProbe)
                console.time(queryKey3);
            const partnerExcludeCategories = await Partner.getCategories(partnerId);
            const filteredRows = _probesObject.rows.filter(probe => {
                let status = partnerExcludeCategories.findIndex(i => i.category == probe.category && i.subcategory == null) != -1
                if (status) {
                    return false;
                }
                return partnerExcludeCategories.findIndex(i => i.subcategory && i.subcategory.includes(probe.subcategory) && i.category == probe.category) === -1
            });
            _probesObject.rows = filteredRows;
            if (!isSingleProbe)
                console.timeEnd(queryKey3);
        }

        _probeRows = _probesObject.rows;
        // Check guaranteed private events for user
        if (req?.domain !== 'fantasy' && !data['probeid'] && !data['isDashboardUser'] && !CONFIG.EXCLUDE_LIST_INTERNAL_USERS.includes(req.user.id)) {
            // NO need to check in case of single probeid
            const queryKey4 = `[GET PROBES] filterGPE user: ${req.user.id}:  ${new Date().toLocaleString()}`;
            if (!isSingleProbe)
                console.time(queryKey4);
            _probeRows = await filterGPE(_probesObject.rows, req.user.id, partnerId);
            if (!isSingleProbe)
                console.timeEnd(queryKey4);
        }
        if (data['probeid'] && _probeRows.length > 0 && partnerId !== 1) {
            const partnerShareLink = await Partner.getShareLinkForPartner(partnerId, data['probeid']);
            _probeRows[0]['sharelink'] = partnerShareLink;
        }
        if (data['probeid'] && _probeRows.length > 0 && req?.domain === 'fantasy') {
            const contests = await Contest.getLiveContests(req?.user?.id, 1, 0, Number(req.fantasy.fantasy_id));
            _probeRows[0]['fantasy'] = {
                'contest_title': contests?.[0]?.title ?? null,
                'prize_pool': contests?.[0]?.prize_pool ?? null,
                'contest_id': Number(contests?.[0]?.id) ?? null,
                'disablesell': contests?.[0]?.disablesell ?? false
            }
        }

        // if ((!data['sortingType'] || data['sortingType'] == sortTypeList[1].Id) && (data['isDashboardUser'] === undefined || data['isDashboardUser'] === false) && _prefRes && _prefRes.length !== 0 && isNewUser === false) {
        //     if (_prefRes[0].category_preference == null) _prefRes[0].category_preference = [];
        //     if (_prefRes[0].probes_viewed == null) _prefRes[0].probes_viewed == [];

        //     await customizeFeeds(_prefRes[0].category_preference, _prefRes[0].probes_viewed, _probeRows);
        //     _probeRows = lodash.reverse(lodash.orderBy(_probeRows, ['weight'], ['asc']));

        // }
        if (!_isDashboardUser) {
            const queryKey5 = `[GET PROBES] closedParentEventsFiltered user: ${req.user.id}:  ${new Date().toLocaleString()}`;
            if (!isSingleProbe)
                console.time(queryKey5);
            const closedParentEventsFiltered = _probeRows.filter(probe => {
                let child_events = _probeRows.filter(p => {
                    return p.parent_id == probe.id
                })
                return !(probe.parent_id < 0 && child_events.length == 0)
            });
            if (!isSingleProbe)
                console.timeEnd(queryKey5);
            _probeRows = closedParentEventsFiltered;
            const queryKey6 = `[GET PROBES] getUserGroups user: ${req.user.id}:  ${new Date().toLocaleString()}`;
            if (!isSingleProbe)
                console.time(queryKey6);
            if (req.user.id) {
                const userGroups = await User.getUserGroups(req.user.id);
                if (userGroups && userGroups.length) {
                    var userBlockEventsFiltered = _probeRows.filter(function (probe) {
                        let probeExcludedGroups = probe?.probe_type_props?.exclude_group_names ?? [];
                        let intersection = userGroups.filter(item => probeExcludedGroups.includes(item))
                        return !intersection.length
                    })
                    _probeRows = userBlockEventsFiltered
                }
            }
            if (!isSingleProbe)
                console.timeEnd(queryKey6);
        }


        const clubbedHashtags = _probeRows.map(function (e) { return (e.parent_id <= 1 && e.hashtags) ? e.hashtags : [] })
        let hashtags = [...new Set([].concat.apply([], clubbedHashtags))];
        var prioritytags = hashtags.filter(function (el) {
            const ipl_tags = CONFIG.IPL_TAGS.filter(tag => el.toLowerCase().includes(tag.toLowerCase()));
            return ipl_tags.length ? true : false;
        });
        hashtags = [...new Set([...prioritytags, ...hashtags])];

        const queryKey7 = `[GET PROBES] getHashtags user: ${req.user.id}:  ${new Date().toLocaleString()}`;
        if (!isSingleProbe)
            console.time(queryKey7);
        
        if (!isSingleProbe)
            [err, _hashtagsObj] = await to(Probe.getHashtags(data['region'], req?.user?.partner?.id ?? 1));
        
        if (!_hashtagsObj) {
            _hashtagsObj = [];
        }
        if (!isSingleProbe)
            console.timeEnd(queryKey7);

        const tDiff = (Date.now() - t1) / 1000;
        console.log(`[GET PROBES] Time taken to fetch Events: ${tDiff} seconds`);
        const queryKey11 = `[GET PROBES] price, topnew academy, ml order user: ${req.user.id}:  ${new Date().toLocaleString()}`;
        if (!isSingleProbe)
            console.time(queryKey11);
        let resp = await getCurrentPrice(_probeRows, data, req?.domain);

        resp = await getTopNews(_probeRows);
        resp = await addLeanrAcedemy(_probeRows);
        resp = await marketLimitOrder(_probeRows, req?.domain, partnerId);
        if (!isSingleProbe)
            console.timeEnd(queryKey11);

        const queryKey8 = `[GET PROBES] dateTime Update user: ${req.user.id}:  ${new Date().toLocaleString()}`;
        if (!isSingleProbe)
            console.time(queryKey8);
        const customFormatter = (dt, knownValues, impliedValues) => {

            const tokens = {
                day: 'dd',
                month: 'MMM',
                year: 'yyyy',
                offset: 'ZZZZ',
                hour: 'HH:mm',
            }

            let formatOptions;
            const tokensKey = ['day', 'month', 'year', 'hour', 'minute'];
            const formatter = tokensKey.filter(k => knownValues.hasOwnProperty(k)).map(k =>
                tokens[k]
            ).join(' ');
            return dt.toFormat(formatter);
        };

        resp = resp.map(t => {
            return {
                ...t,
                title: String(t?.title ?? '').toLocaleFormat(
                    t.start_date, t.timezone, req?.headers?.['x-user-timezone'] ?? t.timezone,
                    false,
                    customFormatter
                ),
                resolution: isSingleProbe ? String(t?.resolution ?? '').toLocaleFormat(
                    t.start_date, t.timezone, req?.headers?.['x-user-timezone'] ?? t.timezone,
                    false
                ) : t?.resolution,

            }
        });
        if (!isSingleProbe)
            console.timeEnd(queryKey8);
        const queryKey9 = `[GET PROBES] WeightedSort user: ${req.user.id}:  ${new Date().toLocaleString()}`;
        if (!isSingleProbe)
            console.time(queryKey9);
        if (req?.domain && req?.domain == "fantasy") {
            resp = resp.map((item) => {
                if (item.live_chat_link === null) {
                    item.live_chat_link = CONFIG.FANTASY_LIVE_CHAT_LINK;
                }
                return item;
            });
        }
        const weightedSort = (arr, weightMap) => {
            const n = arr.length;
            /** n/2[2a + (n – 1)d] */
            const a = 11;
            const rankSize = n / 2 * (2 * a + (n - 1) * 1);
            let rankedArr = arr.map((k, i) => ({ ...k, _index: i, _rank: 0, _tip: '' }));

            const res = weightMap.reduce((agg, { fn, w, tip }) => {
                agg = agg.sort((a, b) => fn(a, b)).map((item, i) => ({
                    ...item,
                    _rank: item._rank + (a + n - (i + 1)) * w / rankSize,
                    _tip: [item._tip, tip(item)].join('|')
                }));
                return agg;
            }, rankedArr).sort((a, b) => b._rank - a._rank);
            return res;
        }
        const getPolarity = p => 100 - Math.abs(50 - p.yCP) - Math.abs(50 - p.nCP);
        const weightMap = [{
            fn: (a, b) => {
                const durationA = differenceInHours(new Date(), new Date(a.start_date), {
                    roundingMethod: 'ceil'
                }) || 1;
                const durationB = differenceInHours(new Date(), new Date(b.start_date), {
                    roundingMethod: 'ceil'
                }) || 1;
                return b.volume / durationB - a.volume / durationA;
            },
            w: 0.4,
            tip: (a) => {
                const durationA = differenceInHours(new Date(), new Date(a.start_date), {
                    roundingMethod: 'ceil'
                }) || 1;
                return `Volume:${a.volume} Duration:${durationA}`;
            }
        },
        {
            fn: (a, b) => getPolarity(b) - getPolarity(a),
            w: 0.3,
            tip: (a) => `Polarity: ${getPolarity(a)}`
        }, {
            fn: (a, b) => new Date(b.start_date.valueOf()) - new Date(a.start_date.valueOf()),
            w: 0.3,
            tip: (a) => `Start Date:${a.start_date}`
        }];
        const tokenWeightMap = [{
            fn: (a, b) => {
                    const durationA = differenceInHours(new Date(), new Date(a.start_date), {
                        roundingMethod: 'ceil'
                    }) || 1;
                    const durationB = differenceInHours(new Date(), new Date(b.start_date), {
                        roundingMethod: 'ceil'
                    }) || 1;
                    return b.volume / durationB - a.volume / durationA;
                },
            w: 0.05,
            tip: () => {return ''}
            }, 
            {
                fn: (a, b) => getPolarity(b) - getPolarity(a),
                w: 0.05,
                tip: (a) => `Polarity: ${getPolarity(a)}`
            }, {
                fn: (a, b) => new Date(b.start_date.valueOf())  - new Date(a.start_date.valueOf()),
                w: 0.9,
                tip: (a) => `Start Date:${a.start_date}`
            }];
        if( "probe_type" in data ) {
            // resp = resp.filter(function (event) {
            //     return event.probe_type === data["probe_type"];
            // });

            if (data?.probe_type === 'promo') {
                /**
                 * Implement Sorting Algorithm
                 * 40% of Vol + 30% of Start Date + 30% of Polarity
                 */
                resp = weightedSort(resp, tokenWeightMap);
            }
        } 
        // else if ( !data['probeid'] && !_isDashboardUser) {
        //     resp = resp.filter(function (event) {
        //         return event.probe_type !== 'promo';
        //     });
        // }
        if ( !isSingleProbe && (!data['sortingType'] || ( data['sortingType'] && ( data['sortingType'] === sortTypeList[0].Id ) ) ) ){
            let tradeEventsProbecalls, tradeEventsHistory, tradeEventsFinal = [];
            logger.info(`Embedding: starts`);
            let avgEmbedding;
            if( req?.user?.id && req?.user?.id > 0 ) {
                tradeEventsProbecalls = await Embeddings.getLast10TradedProbesFromProbecalls(req?.user?.id, req?.domain);
                logger.info(`Embedding: past trades from probecalls: ${JSON.stringify(tradeEventsProbecalls)}`);

                tradeEventsHistory = await Embeddings.getLast10TradedProbesFromHistory(req?.user?.id, req?.domain);
                logger.info(`Embedding: past trades from history: ${JSON.stringify(tradeEventsHistory)}`);

                if( tradeEventsProbecalls && tradeEventsProbecalls.length > 0) {
                    tradeEventsFinal = tradeEventsProbecalls;
                }
                logger.info(`Embedding: past trades final list after probes: ${JSON.stringify(tradeEventsFinal)}`);
                if( tradeEventsHistory && tradeEventsHistory.length > 0 ) {
                    tradeEventsFinal = tradeEventsFinal.concat(tradeEventsHistory);
                }
                tradeEventsFinal = tradeEventsFinal.filter((obj, index) => {
                    return index === tradeEventsFinal.findIndex(o => obj.probeid === o.probeid);
                });

                logger.info(`Embedding: past trades final after unique filtering: ${JSON.stringify(tradeEventsFinal)}`);
                tradeEventsFinal = tradeEventsFinal.sort((a,b) => b.createdat.getTime() - a.createdat.getTime());
                logger.info(`Embedding: past trades final list after sorting: ${JSON.stringify(tradeEventsFinal)}`);

                if( tradeEventsFinal && tradeEventsFinal.length > 10 ) {
                    tradeEventsFinal = tradeEventsFinal.slice(0, 10);
                }
                logger.info(`Embedding: past trades final list: ${JSON.stringify(tradeEventsFinal)}`);
                tradeEventsFinal = tradeEventsFinal.map(item => item.probeid);
                logger.info(`Embedding: past trades final list after filtering: ${JSON.stringify(tradeEventsFinal)}`);
                avgEmbedding = await Embeddings.getAvgEmbeddingFromLastTradedEvents(tradeEventsFinal, req?.domain);
                logger.info(`Embedding: avgEmbedding: ${avgEmbedding}`);
            }
            if( avgEmbedding && 'avg' in avgEmbedding && avgEmbedding.avg ) {
                avgEmbedding = avgEmbedding.avg;
                console.log(avgEmbedding);
                let probeIdArr = resp.map(item => item.id);
                logger.info(`Embedding: probeIdArr: ${probeIdArr}`);
                let probeRankList = await Embeddings.getProbesRankCosineEmbedding(avgEmbedding, probeIdArr, req?.domain);
                console.log(probeRankList);
                let probeRankMap = probeRankList.reduce(
                    (obj, item) => Object.assign(obj, { [item.item_id]: item.rank }), {});
                console.log(probeRankMap);
                resp = resp.map((item) => {
                    item.rank = probeRankMap[item.id]??-1;
                    return item;
                });
                resp.sort((a,b) => b.rank - a.rank);
                probeIdArr = resp.map(item => item.id);
                logger.info(`Embedding: probeIdArr: ${probeIdArr}`);
            } else {
                if(data?.probe_type === 'promo') {
                    resp = weightedSort(resp, tokenWeightMap);
                } else {
                    resp = weightedSort(resp, weightMap);
                }
            }
            resp.sort((a, b) => {
                if (a.probe_type === 'promo' && b.probe_type !== 'promo') {
                    return -1;
                }
                if (a.probe_type !== 'promo' && b.probe_type === 'promo') {
                    return 1;
                }
                return 0;
            });
        }
        //put all CDA events at top for mymaster partnerId 10 for staging, 6 for prod
        if ((!data['sortingType'] || (data['sortingType'] && (data['sortingType'] === sortTypeList[0].Id))) && partnerId == 6) {
            resp.sort((a, b) => {
                if (a.is_price_editable && !b.is_price_editable) {
                    return -1;
                }
                if (!a.is_price_editable && b.is_price_editable) {
                    return 1;
                }
                return 0;
            });
        }
        if (!isSingleProbe)
            console.timeEnd(queryKey9);

        const queryKey10 = `[GET PROBES] Default Set AMOUNT user: ${req.user.id}:  ${new Date().toLocaleString()}`;
        if (!isSingleProbe)
            console.time(queryKey10);
        let contest_balance;
        const walletData = await User.getWalletBalance(req?.user?.id, false);
        let promo_wallet = walletData?.coinsp;
        let normal_wallet = (req.user.id !== -1) ? (walletData.coinsd + walletData.coinsw + walletData.coinsb) : null;
        if (req?.domain === 'fantasy' && req.user.id !== -1) {
            contest_balance = await Contest.getContestUserBalance(req.fantasy.fantasy_id, req?.user?.id, 'fantasy', true);
        }



        let defaultBuyAmount = req?.user?.config?.defaultBuyAmount ?? '2000';
        let defaultNoOfShares = req?.user?.config?.defaultNoOfShares ?? '50';
        if (req?.domain !== 'fantasy') {
            resp = resp.map((item) => {
                if (item.probe_type === 'promo') {
                    item.defaultBuyAmount = '' + Math.ceil(Math.min(item?.max_allowed_position , Math.max(item?.newYCP, item?.newNCP, 0.1 * promo_wallet)));
                } else {
                    item.defaultBuyAmount = '' + Math.ceil(Math.min(item?.max_allowed_position , Math.max(item?.newYCP, item?.newNCP, 0.1 * normal_wallet)));
                }
                item.defaultNoOfShares = '' + Math.min(parseInt(item?.max_allowed_position / 50, 10), defaultNoOfShares);

                return item;
            });
        } else {
            resp = resp.map((item) => {

                item.defaultBuyAmount = '' + Math.ceil(Math.min(item?.max_allowed_position ,Math.max(item?.newYCP, item?.newNCP, 0.1 * (contest_balance?.['coins'] ?? 1000))));
                item.defaultNoOfShares = '' + Math.min(parseInt(item?.max_allowed_position / 50, 10), defaultNoOfShares);

                return item;
            });
        }
        if (!isSingleProbe)
            console.timeEnd(queryKey10);
        let dbResp = resp
        if (_isDashboardUser) {
            if (parseFloat(data['yCP']) == 10) {
                dbResp = lodash.filter(dbResp, function (o) {
                    return o.yCP <= 10;
                });
            } else if (parseFloat(data['yCP']) == 90) {
                dbResp = lodash.filter(dbResp, function (o) {
                    return o.yCP >= 90;
                });
            }
            // if (data['tag']) {
            //     dbResp = lodash.filter(dbResp, function (o) {
            //         return o.hashtags && o.hashtags.indexOf(data['tag']) > -1;
            //     });
            // }
            // if (data['subcat']) {
            //     dbResp = lodash.filter(dbResp, function (o) {
            //         return o.subcategory && o.subcategory.indexOf(data['subcat']) > -1;
            //     });
            // }
        }
        let response;
        // if (partnerId === 6 || partnerId === 10) {
        //     resp = resp.filter( item => !(item.category === 'Sports' && !item.is_price_editable));
        // }
        // if (partnerId === 5) {
        //     resp = resp.filter( item => 
        //         ( item.endsat && (new Date(item.endsat) - Date.now()) / (1000 * 60 * 60 * 24) <= 14) &&
        //         ( luxon.DateTime.now().setZone('Asia/Kolkata')?.hour > 6 )
        //     );
        // }
        //build subsubcat array from hashtags and sort accordingly
        let subsubcatArr = [];
        if (req?.body?.hashtags){
            resp.forEach(obj => {
                if (obj.subsubcat && Array.isArray(obj.subsubcat)) {
                  obj.subsubcat.forEach(item => {
                    if (item && !subsubcatArr.includes(item)) { // Check for non-empty and uniqueness
                      subsubcatArr.push(item);
                    }
                  });
                }
              });
            subsubcatArr.push('All');
            var subsubcat_service_config = await PartnerService.getPartnerServiceConfig(1, 'INDIA', 'subsubcat');
            let subsubcat_preference = subsubcat_service_config?.config;
            if (subsubcatArr && subsubcatArr.length > 0 && subsubcat_preference) {
                subsubcatArr.sort((a, b) => {
                    let indexA = subsubcat_preference.indexOf(a);
                    let indexB = subsubcat_preference.indexOf(b);
    
                    if (indexA !== -1 && indexB !== -1) {
                      return indexA - indexB;
                    }
                    else if (indexA !== -1) {
                      return -1;
                    }
                    else if (indexB !== -1) {
                      return 1;
                    }
                    else {
                      return 0;
                    }
                  });
            }
        }
        if (_isDashboardUser) response = { success: true, probes: dbResp, total: _probesObject.total, unsettledEventsCount: _probesObject.unsettledEventCount, unsettledEvents: _probesObject.unsettledEvents };
        else {
            response = { success: true, probes: resp, total: _probeRows.length, hashtags: hashtags, newHashtags: _hashtagsObj, subsubcatArr};
            if (CONFIG.APIPARTNERUSERS.includes(req?.user?.id)) {
                /** Exclude Private Internal and Token Events */
                response.probes = response.probes.filter(i => {
                    return !(
                        i.is_private ||
                        i.is_internal ||
                        i.probe_type === 'promo'
                    )
                })
            }
            response.probes = response.probes.map(i => {
                delete i.add_coins_link;
                delete i.auto_match;
                delete i.auto_settle;
                delete i.correctproptionid;
                delete i.createdby;
                delete i.description;
                delete i.entryfee;
                delete i.expiry_seconds;
                delete i.is_internal;
                delete i.is_private;
                delete i.keywords;
                delete i.learn_title;
                delete i.learn_url;
                delete i.liquidity_fee_factor;
                delete i.live_stats_props;
                delete i.live_stats_type;
                delete i.marketresolutionguidelines;
                delete i.marketresolutionno;
                delete i.marketresolutionnotes;
                delete i.marketresolutionopeningline;
                delete i.marketresolutionyes;
                delete i.max_allowed_position;
                delete i.max_trade_amount;
                delete i.partners;
                delete i.portfolioNCP;
                delete i.portfolioYCP;
                delete i.probe_type_props;
                delete i.proptionsid;
                delete i.regions;
                delete i.settle_threshold;
                delete i.settlement_description;
                delete i.show_in_all;
                delete i._tip;
                delete i._rank;
                delete i._index;
                delete i.updatedat;
                delete i.trending;
                return i;
            })
            if (!isSingleProbe) {
                response.probes = response.probes.map(i => {
                    if (!CONFIG.APIPARTNERUSERS.includes(req?.user?.id)) {
                        delete i.resolution;
                    }
                    delete i.correctvalue;
                    delete i.full_rules;
                    delete i.live_chat_link;
                    delete i.news;
                    delete i.news_available;
                    delete i.settlement_proof;
                    delete i.widget_url;
                    delete i.widget_title;
                    return i;
                })
            }
        }
        return ReS(res, response, 200, req?.user);
    } catch (err) {
        next(err);
    }
}

const getProbesMM = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        var err, _probeRows = [];
        var data = req.body;
        const t1 = Date.now();
        let _probesObject;
        if (data['marketid']) {
            if (Array.isArray(data['marketid'])) {
                for (let i = 0; i < data['marketid'].length; i++) {
                    if (isNaN(parseInt(data['marketid'][i]))) {
                        return ReE(res, messages.INVALID_REQUEST, 400);
                    };
                }
            } else if (isNaN(parseInt(data['marketid']))) {
                return ReE(res, messages.INVALID_REQUEST, 400);
            }
            data['probeid'] = data['marketid'];
        }
        [err, _probesObject] = await to(Probe.getProbesMM(data));
        if (err) throw err;

        _probeRows = _probesObject.rows;

        // Check guaranteed private events for user
        const clubbedHashtags = _probesObject.rows.map(function (e) { return (e.parent_id <= 1 && e.hashtags) ? e.hashtags : [] })
        let hashtags = [...new Set([].concat.apply([], clubbedHashtags))];
        var prioritytags = hashtags.filter(function (el) {
            const ipl_tags = CONFIG.IPL_TAGS.filter(tag => el.toLowerCase().includes(tag.toLowerCase()));
            return ipl_tags.length ? true : false;
        });
        hashtags = [...new Set([...prioritytags, ...hashtags])];
        const tDiff = (Date.now() - t1) / 1000;
        logger.info(`Time taken to fetch MM Events: ${tDiff} seconds`);
        let resp = await getCurrentPrice(_probeRows, data);
        let response = { success: true, markets: resp, total: _probeRows.length, hashtags: hashtags }
        return ReS(res, response);
    } catch (err) {
        next(err);
    }
}


const filterGPE = async (events, userId) => {
    try {
        let nonPrivateEvents = events.filter(function (event) {
            return event.is_private == false;
        });
        // Private event not enabled, show users only non private event
        if (!CONFIG.GPE_ENABLED) {
            return nonPrivateEvents;
        }

        const isUserEligible = await Probe.isUserExistInPrivateEventUsers(userId)
        // If user is not eligible return non private events
        if (!isUserEligible) {
            return nonPrivateEvents;
        }

        const activePrivateEvents = events.filter(function (event) {
            return event.is_private == true && event.parent_id == 0;
        });

        // Check if user reached maximum allowed private events
        let tradedPrivateEvents = await Probe.getUserPrivateEventProbeCalls(userId)
        const alreadyTradedPrivateEventIds = tradedPrivateEvents.map(function (e) { return e.probeid })

        // Check if user exists in custom plg events
        let userCustomPrivateEvents = await Probe.getUserCustomPrivateEvents(userId)
        const userCustomPrivateEventIds = userCustomPrivateEvents.map(function (e) { return e.probeid })
        let eligibleCustomEvents = []
        for (let i = 0; i < activePrivateEvents.length; i++) {
            const event = activePrivateEvents[i]
            if (userCustomPrivateEventIds.includes(event.id)) {
                let tradeCount = await Probe.getUserCustomPrivateEventTradeCount(userId, event.id);
                if (tradeCount < CONFIG.MAX_ALLOWED_RETENTION_PRIVATE_EVENTS_COUNT) {
                    eligibleCustomEvents.push(event);
                }
            }
        }
        if (eligibleCustomEvents.length) {
            return [...eligibleCustomEvents, ...nonPrivateEvents]
        }
        if (userCustomPrivateEventIds.length || (alreadyTradedPrivateEventIds.length >= CONFIG.MAX_ALLOWED_PRIVATE_EVENTS_COUNT)) {
            return nonPrivateEvents;
        }
        if (activePrivateEvents.length) {
            const customPrivateEvents = await Probe.getCustomPrivateEvents(activePrivateEvents)
            const customPrivateEventIds = customPrivateEvents.map(function (e) { return e.probeid })
            const eligiblePrivateEvents = await getUserPrivateEvents(activePrivateEvents, alreadyTradedPrivateEventIds, customPrivateEventIds, userId)
            return [...eligiblePrivateEvents, ...nonPrivateEvents]
        }
        return events
    } catch (err) {
        logger.error(`Error in filtering private events for userId: ${userId} Stacktrace: ${JSON.stringify(err)}`);
        return events
    }
}

const getUserPrivateEvents = async function (privateEvents, alreadyTradedPrivateEventIds, customPrivateEventIds, userId) {
    try {
        let eligibleEvents = []
        privateEvents = lodash.orderBy(privateEvents, ['id'], ['desc'])
        let activePrivateEventIds = privateEvents.map(function (e) { return e.id })
        let leftPrivateEventCount = CONFIG.MAX_ALLOWED_PRIVATE_EVENTS_COUNT - alreadyTradedPrivateEventIds.length
        for (let i = 0; i < activePrivateEventIds.length; i++) {
            const event = privateEvents[i]
            if (!customPrivateEventIds.includes(event.id) && !alreadyTradedPrivateEventIds.includes(event.id) && eligibleEvents.length < leftPrivateEventCount) {
                eligibleEvents.push(event)
            }
        }
        return eligibleEvents
    } catch (err) {
        logger.error(`Error in getting eligible GPE for userId: ${userId} Stacktrace: ${JSON.stringify(err)}`);
        return []
    }
}

const getProbesAll = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        let _probesObject;
        [err, _probesObject] = await to(Probe.getProbes({}));
        if (err) throw err;

        return ReS(res, {
            success: true, markets: _probesObject.rows, probes: _probesObject.rows, total: _probesObject.total
        });
    } catch (err) {
        next(err);
    }
}
const addUserToPrivateEvent = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        if (!isDashboardUser(req)) {
            res.writeStatus("401");
            return ReS(res, {
                success: true, msg: 'Unauthorized request, incident has been reported'
            });
        }
        const payloadObj = req.body;
        let userArray = [];
        let errorArray = [];
        let successArray = [];
        let _probesObject;

        for (const probe_id in payloadObj) {

            [err, _probesObject] = await to(Probe.getProbeById(probe_id, ['is_private'], true));
            if (err) throw err;
            if (!_probesObject['is_private']) {
                errorArray.push(parseInt(probe_id));
                continue;
            }

            for (let i = 0; i < payloadObj[probe_id].length; i++) {
                userArray.push({ "probeid": parseInt(probe_id), "userid": payloadObj[probe_id][i] });
            }
            successArray.push(parseInt(probe_id));
        }

        [err, enterUsers] = await to(Probe.addBatchUsersToPrivateEvent(userArray));
        if (err) throw err;

        if (enterUsers) {
            console.log("all ids processed");
        }

        return ReS(res, {
            success: true, successlogs: successArray, failurelogs: errorArray
        });
    } catch (err) {
        next(err);
    }
}

const getTournaments = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        const data = req.body;
        data['isInternalTestUser'] = await isAnInternalUser(req);
        const [err, _tournamentRows] = await to(Probe.getTournaments(data));
        if (err) throw err;
        return ReS(res, {
            success: true, tournaments: _tournamentRows
        });
    } catch (err) {
        throw err;
    }
}
const getLastTradesInfo = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {

        const probeid = req.body.probeid;
        let err, latestTrades;

        [err, latestTrades] = await to(Probe.getLastTrades(probeid));
        if (err) throw err;

        return ReS(res, {
            success: true, trades: latestTrades
        });
    } catch (err) {
        throw err;
    }
}

const getLeaderboard = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        const data = req.body;
        const [err, _probeCallRows] = await to(Probe.getLeaderboard(data));
        if (err) throw err;
        return ReS(res, {
            success: true, tournaments: _probeCallRows
        });
    } catch (err) {
        throw err;
    }
}

const searchProbes = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        let err, _probeIds;
        [err, _probeIds] = await to(SolrService.searchDocuments(req.query.keywords));
        if (err) throw err;
        if (_probeIds && _probeIds.length > 0) {
            req.body['probeid'] = _probeIds;
            return getProbes(req, res, next);

        } else {
            // res.setHeader('Content-Type', 'application/json');
            return ReS(res, {
                success: true, probes: [], total: 0
            });
        }
    } catch (err) {
        next(err);
    }
}

const getMyTournamentParticipations = async function (req, res, next) {
    try {
        let err, _tournamentRows, userId = req.user.id;
        let pageNo = req.body.page;
        const limit = req.body.limit | undefined;
        const data = Object.assign({}, req.body, { 'userid': userId, limit });
        [err, _tournamentRows] = await to(ProbeV2.getMyTournamentsParticipation(data));
        if (err) throw err;
        return ReS(res, {
            success: true, probes: _tournamentRows
        });
    } catch (e) {
        next(err);
    }

}

const getMyBetsV2 = async function (req, res, next) {
    req.body['api_version'] = 'v2';
    next();
}



const getMyBets = async function (req, res, next) {

    // res.setHeader('Content-Type', 'application/json');
    try {
        var err, _probeRows, userId = req.user.id;
        let pageNo = req.body.page;
        const apiVersion = req.body.api_version;
        const limit = req.body.limit | undefined;
        var data = Object.assign({}, req.body, { 'userid': userId, limit });
        // var t1 = Date.now();

        if (data['eventsStatus']) {
            const status = data['eventsStatus'].split(",");
            if (status && status.includes("'C'")) {
                // const [er, dd] = await to(User.getReferralEligibility(userId));
                // if (er) throw er;

                return ReS(res, {
                    success: true,
                    probes: [{ id: 1 }],
                    liquidity: []
                });
            }
            const statusArray = ['A', 'F', 'CAN', 'I', 'C', 'RST'];
            for (let i = 0; i < status.length; i++) {
                if (!(statusArray.indexOf(status[i][1]) > -1)) {
                    return ReE(res, messages.INVALID_REQUEST, 400);
                }
            }
        }


        [err, _probeRows] = await to(apiVersion === 'v2' ? ProbeV2.getMyBetsV2(data) : ProbeV2.getMyBets(data, true));
        if (err) throw err;
        _probeRows = await getCurrentPrice(_probeRows);
        let participationStatus = ['A', 'F', 'C'];

        if (typeof _probeRows !== 'undefined' && _probeRows.length > 0) {
            let lastBidIndex = _probeRows.length - 1;
            if (participationStatus.indexOf(_probeRows[lastBidIndex].status) > -1) {
                redisCaching.setHMKey(userId, 'callsMap', true);
            }
            //calculate average price of yes/no matched contracts
            _calculateAveragePrice(_probeRows);
            //END -- calculate average price of yes/no matched contracts

            // calculate execution price for instant match for total yes and no contacts
            _probeRows = await getExecutionPrice(_probeRows);
            let veryLowHoldingEvents = [];
            _probeRows = _probeRows.map(probeRow => {
                let currentPriceYes, currentPriceNo
                if (!(probeRow['is_price_editable'])) {
                    currentPriceYes = probeRow.execution_price_yes;
                    currentPriceNo = probeRow.execution_price_no;
                } else {
                    currentPriceYes = probeRow.currentPrice.yCP;
                    currentPriceNo = probeRow.currentPrice.nCP;
                }
                let investment = 0.0;
                let totalCurrentValue = 0.0;
                let profitOrLoss = 0.0;
                if (currentPriceNo === undefined && currentPriceYes === undefined) {
                    veryLowHoldingEvents.push(probeRow);
                } else {
                    for (const call of probeRow.calls) {
                        if (call.rank === -1 && call.status === 'H') {
                            investment += (call.noofcontracts * call.lastprice)
                            const currentPrice = call.callvalue === 'Y' ? currentPriceYes : currentPriceNo;
                            totalCurrentValue += (call.noofcontracts * currentPrice);
                        } else if (call.rank === 0 && call.status === 'A' && call.callvalue === 'Y' &&
                            currentPriceYes !== undefined) {
                            investment += (call.noofcontracts * call.coins);
                            totalCurrentValue += (call.noofcontracts * currentPriceYes);
                        } else if (call.rank === 0 && call.status === 'A' && call.callvalue === 'N' &&
                            currentPriceNo !== undefined) {
                            investment += (call.noofcontracts * call.coins);
                            totalCurrentValue += (call.noofcontracts * currentPriceNo);
                        } else if (call.rank === -1 && call.status === 'A') {
                            investment += (call.noofcontracts * call.coins);
                            totalCurrentValue += (call.noofcontracts * call.coins);
                        }
                    }
                    if (investment && totalCurrentValue && investment > 0 && totalCurrentValue > 0) {
                        profitOrLoss = ((totalCurrentValue - investment) / investment) * 100;
                    }
                    profitOrLoss = (profitOrLoss > 0 ? '+' + parseFloat(profitOrLoss.toFixed(2)) : parseFloat(profitOrLoss.toFixed(2))) + '%'
                    probeRow['summary'] = [
                        {
                            field: "Investment",
                            value: `${parseFloat(investment.toFixed(2))}`
                        },
                        {
                            field: "Present Value",
                            value: `${parseFloat(totalCurrentValue.toFixed(2))}`
                        },
                        {
                            field: "Profit/Loss",
                            value: profitOrLoss
                        }
                    ];

                    probeRow['current_value'] = parseFloat(totalCurrentValue);
                }
                probeRow['yCP'] = parseFloat(probeRow.currentPrice.yCP);
                probeRow['nCP'] = parseFloat(probeRow.currentPrice.nCP);
                // probeRow['execution_price_yes'] = parseFloat(probeRow.currentPrice.yCP);
                // probeRow['execution_price_no'] = parseFloat(probeRow.currentPrice.nCP);
                return probeRow;
            });

            for (let item of veryLowHoldingEvents) {
                lodash.remove(_probeRows, {
                    id: item.id
                });
            }
        }
        let liqResp = await getUserLiquidityBets(userId);

        return ReS(res, {
            success: true,
            probes: _probeRows,
            liquidity: liqResp
        });
    } catch (err) {
        logger.error(err);
        next(err);
    }
}

const getLeadership = async function (req, res, next) {
    const userId = req.user.id;
    const data = req.body;
    const probeid = parseInt(data.probeid);
    const reqKey = `leadershipBoard_${probeid}`;
    let cachedObj = await redisCaching.getKey(reqKey);

    if (cachedObj) {
        logger.info(`Leadership board for probe: ${probeid} returning from Cache: ${cachedObj}`);
        return ReS(res, {
            success: true,
            result: JSON.parse(cachedObj),
            user: req.user,
            source: 'cache'
        });
    }

    let [err, result] = await to(ProbeV2.getLeadershipProbes(probeid));

    if (!result || result.length === 0) {
        res.err = err;
        return ReE(res, messages.INVALID_REQUEST, 400);
    }
    for (let i = 0; i < result.length; i++) {
        result[i].rank = i + 1;
    }
    await redisCaching.setKey(reqKey, JSON.stringify(result), 5);
    logger.info(`Leadership board for probe: ${probeid} returning from DB: ${cachedObj}`);
    return ReS(res, {
        success: true,
        result: result,
        user: req.user,
        source: 'db'
    });
}

const getMyBetsV3 = async function (req, res, next) {
    try {
        // res.setHeader('Content-Type', 'application/json');
        const userId = req.user.id;
        const partnerId = Number(req?.user?.partner?.id ?? 1);
        const data = req.body;
        if (data['eventsStatus']) {
            const status = data['eventsStatus'].split(",");
            if (status && status.includes("'C'")) {
                // const [er, dd] = await to(User.getReferralEligibility(userId));
                // if (er) throw er;

                return ReS(res, {
                    success: true,
                    probes: [{ id: 1 }],
                    liquidity: []
                });
            }
            const statusArray = ['A', 'F', 'CAN', 'I', 'C', 'RST'];
            for (let i = 0; i < status.length; i++) {
                if (!(statusArray.indexOf(status[i][1]) > -1)) {
                    return ReE(res, messages.INVALID_REQUEST, 400);
                }
            }
        }
        const schema = req?.domain ?? 'public';
        let probes = [];
        if (schema === 'fantasy') {
            probes = await Contest.getAllContestEvents(req?.fantasy?.fantasy_id, 'fantasy', true);
            if (probes.length == 0) {
                return ReS(res, {
                    success: true,
                    probes: [],
                    liquidity: [],
                    user: req.user
                });
            }
            probes = probes.map(p => p.id);
        }
        const query1 = `MYBETS DB QUERY ${userId} ${new Date().toLocaleString()}`;
        console.time(query1);
        if ('probeid' in data && data['probeid']) {
            if (Array.isArray(data['probeid']) && data['probeid'].length > 0) {
                probes = data['probeid'];
            } else if (typeof data['probeid'] === 'number') {
                probes = [data['probeid']];
            }
        }
        let [err, trades] = await to(ProbeV2.getMyBetsV3(userId, schema, probes));
        console.timeEnd(query1)
        if (err) throw err;

        const query2 = `MYBETS CURRENT PRICE ${userId} ${new Date().toLocaleString()}`;
        console.time(query2);
        trades = await getCurrentPrice(trades, {}, schema);
        console.timeEnd(query2);

        const query3 = `MYBETS EXECUTION PRICE ${userId} ${new Date().toLocaleString()}`;
        console.time(query3);
        trades = await getExecutionPrice(trades, schema);
        console.timeEnd(query3);

        const query4 = `MYBETS MARKETLIMIT ORDER ${userId} ${new Date().toLocaleString()}`;
        console.time(query4);
        trades = await marketLimitOrder(trades, schema, partnerId);
        console.timeEnd(query4);

        let contest_balance;
        const walletData = await User.getWalletBalance(req?.user?.id, false);
        let promo_wallet = walletData?.coinsp;
        let normal_wallet = (walletData.coinsd + walletData.coinsw + walletData.coinsb);
        if (req?.domain === 'fantasy') {
            contest_balance = await Contest.getContestUserBalance(req.fantasy.fantasy_id, req?.user?.id, 'fantasy', true);
        }


        let defaultBuyAmount = req?.user?.config?.defaultBuyAmount ?? 100;
        let defaultNoOfShares = req?.user?.config?.defaultNoOfShares ?? 1;

        trades = trades.map(trade => {
            let sell_price_yes, sell_price_no, newSellPriceYes, newSellPriceNo;
            let defaultBuyAmountCalculation = trade.probe_type === "promo"
                ?  Math.min(trade?.max_allowed_position ,Math.max( trade.newYCP, trade.newNCP , 0.1 * promo_wallet))
                :  Math.min(trade?.max_allowed_position ,Math.max( trade.newYCP, trade.newNCP , 0.1 * normal_wallet));

            if (trade.is_price_editable) {
                sell_price_yes = 100 - trade.nCP;
                sell_price_no = 100 - trade.yCP;
                newSellPriceYes = trade.portfolioNCP === null ? null : 100 - trade.newNCP;
                newSellPriceNo = trade.portfolioYCP === null ? null : 100 - trade.newYCP;
                return {
                    ...trade,
                    sell_price_yes,
                    sell_price_no,
                    newSellPriceYes,
                    newSellPriceNo,
                    defaultBuyAmount: '' + Math.ceil(defaultBuyAmountCalculation),
                    defaultNoOfShares: '' + Math.min(parseInt(trade?.max_allowed_position / 50, 2) ?? 100, defaultBuyAmount),
                }
            }
            return {
                ...trade,
                sell_price_yes: trade.execution_price_yes,
                sell_price_no: trade.execution_price_no,
                newSellPriceYes: trade.execution_price_yes,
                newSellPriceNo: trade.execution_price_no,
                defaultBuyAmount: '' + Math.ceil(defaultBuyAmountCalculation),
                defaultNoOfShares: '' + Math.min(parseInt(trade?.max_allowed_position / 50, 2) ?? 100, defaultBuyAmount),
            }
        })

        if (schema === 'fantasy') {
            let contests = await Contest.getContestById(Number(req.fantasy.fantasy_id), schema);
            let disablesell = contests?.[0]?.disablesell ?? false;
            trades = trades.map(trade => {
                let defaultBuyAmountCalculation =  Math.min(trade?.max_allowed_position , Math.max( trade.newYCP, trade.newNCP, 0.1 * (contest_balance?.['coins'] ?? 1000)));
                return {
                    ...trade,
                    defaultBuyAmount: '' + Math.ceil(defaultBuyAmountCalculation),
                    disablesell: disablesell
                };
            });
        }
        let liqResp = [];
        let d = new Date().valueOf()
        // console.time(`LIQ RES 1 ${d}`)
        // liqResp = await getUserLiquidityBets(userId);
        // console.timeEnd(`LIQ RES 1 ${d}`)


        const [errConfig, config] = await to(User.getConfig(req.user.id));

        if (!errConfig && config && config?.is_liquidity_provider) {
            console.time(`LIQ RES 2 ${userId} ${d}`)
            console.log("Getting Liquidity user portfolio for - ", req.user.id)
            liqResp = await LiquidityUser.getUserLiquidityPortfolio(userId);
            liqResp = await marketLimitOrder(liqResp, schema, partnerId);
            console.timeEnd(`LIQ RES 2 ${userId} ${d}`)
        }

        // let _user;
        // if (CONFIG.MMIDs.indexOf(userId) === -1) {
        //     [err, _user] = await to(User.findById(userId, true, false));
        // }
        return ReS(res, {
            success: true,
            probes: trades,
            liquidity: liqResp,
            user: req.user
        });
    } catch (err) {
        // logger.error(err);
        console.log(err)
        next(err);
    }
}

const getUserLiquidityBets = async function (userId) {
    const finalResp = [];
    // let allUserActiveLiquidity = await LiquidityUser.getAllUserLiquidityActiveProbes(userId);
    let probeDetails = await LiquidityUser.getPortfolioDisplayLiqDetails(userId)
    const probeLiqMap = new Map();
    for (let userLiq of probeDetails) {
        if (probeLiqMap.get(userLiq['probe_id']) === undefined) {
            probeLiqMap.set(userLiq['probe_id'], [userLiq]);
        } else {
            probeLiqMap.get(userLiq['probe_id']).push(userLiq);
        }
    }
    for (let [probeId, liqList] of probeLiqMap) {
        try {
            let [err, liquidity] = await to(LiquidityEvent.getLatestRow(parseInt(probeId), true));
            let cont = false;
            if (!(liquidity[0]['liquidity_pool_price'] > 0)) {
                continue;
            }
            let resp = {
                id: liqList[0]['id'],
                createdat: liqList[0]['createdat'],
                start_date: liqList[0]['start_date'],
                settledate: liqList[0]['settledate'],
                endsat: liqList[0]['endsat'],
                totalamount: liqList[0]['totalamount'],
                is_price_editable: liqList[0]['is_price_editable'],
                type: liqList[0]['type'],
                imageurl: liqList[0]['imageurl'],
                title: liqList[0]['title'],
                resolution: liqList[0]['resolution'],
                source: liqList[0]['source'],
                is_variable_liquidity_pool: liqList[0]['is_variable_liquidity_pool'],
            };
            resp.probeId = probeId;

            let currUserLiq = await LiquidityUsers.getUserCurrentLiquidityForProbe(userId, probeId);
            resp.currentTotalLiqToken = currUserLiq[0]['total_liquidity_tokens_count'];
            resp.investedTotalAmount = (liqList[0]['added_amount'] / liqList[0]['added_token_count']) *
                (resp.currentTotalLiqToken);
            resp.investedLiqTokenCount = resp.currentTotalLiqToken;
            if (resp.investedLiqTokenCount !== 0) {
                resp.investedLiqTokenPrice = resp.investedTotalAmount / resp.investedLiqTokenCount;
            } else {
                resp.investedLiqTokenPrice = 0;
            }
            resp.removedTokenCount = liqList[0]['removed_token_count'];
            resp.currLiqPrice = liquidity[0]['liquidity_token_price'];

            const [errLp, idArray] = await to(LiquidityProvider.getProviderTotalTradingFeeForEvent(userId, probeId));
            if (idArray['liquidity_fee'] === null || idArray['liquidity_fee'] === undefined) {
                resp.tradingFeeLiquidityTokens = 0;
            } else {
                resp.tradingFeeLiquidityTokens = idArray['liquidity_fee'];
            }

            if (!(currUserLiq[0]['total_liquidity_tokens_count'] >= 0) ||
                parseFloat(resp.currentTotalLiqToken.toFixed(2)) === 0) {
                continue;
            }
            resp.currentTotalAmount = (resp.currentTotalLiqToken) * resp.currLiqPrice;
            if (resp.investedTotalAmount !== 0) {
                resp.profitOrLoss = ((resp.currentTotalAmount - resp.investedTotalAmount) / resp.investedTotalAmount) * 100;
            }
            resp.yCP = liquidity[0]['price_per_contract_yes'];
            resp.nCP = liquidity[0]['price_per_contract_no'];
            finalResp.push(resp);
        } catch (e) {
            logger.error(e)
        }
    }
    return finalResp;
}

const _calculateAveragePrice = function (_probeRows) {
    for (const _probeRow of _probeRows) {
        if (_probeRow.calls.length > 0) {
            let yesTotalPrice = 0.0;
            let yesContracts = 0;
            let noTotalPrice = 0.0;
            let noContracts = 0;

            for (const call of _probeRow.calls) {
                if (call.rank === 0 && call.status === 'A') {
                    if (call.callvalue === 'Y') {
                        yesTotalPrice += (call.noofcontracts * call.coins);
                        yesContracts += call.noofcontracts;
                    } else if (call.callvalue === 'N') {
                        noTotalPrice += (call.noofcontracts * call.coins);
                        noContracts += call.noofcontracts;
                    }
                }
            }
            if (yesContracts > 0 && yesTotalPrice > 0 && parseFloat(yesContracts.toFixed(1)) >= 0.1) {
                _probeRow['avg_price_matched_contract_yes'] = parseFloat(yesTotalPrice / yesContracts);
                _probeRow['total_matched_contract_yes'] = parseFloat(yesContracts);
            }
            if (noContracts > 0 && noTotalPrice > 0 && parseFloat(noContracts.toFixed(1)) >= 0.1) {
                _probeRow['avg_price_matched_contract_no'] = parseFloat(noTotalPrice / noContracts);
                _probeRow['total_matched_contract_no'] = parseFloat(noContracts);
            }
        }
    }
}

const getMyBetsCP = async function (req, res, next) {

    // res.setHeader('Content-Type', 'application/json');

    try {

        var err;

        let eventIds = req.body.eventids.split(',');

        let cpAr = [], _yCalls = [], _nCalls = [];

        for (let z = 0; z < eventIds.length; z++) {

            const eventId = eventIds[z];
            const CPexistsInCache = await redisCaching.doesKeyExistinHM(eventId, 'eventCpMap');

            let [errx, p] = await to(Probe.getProbeById(eventId, ['totalamount',
                'is_price_editable', 'is_variable_liquidity_pool']));
            if (errx) throw err;

            let yCP, nCP;

            if (p.is_price_editable) {
                let maxReturn = parseFloat(parseFloat((p.totalamount).toString()).toFixed(2));


                if (CPexistsInCache) {
                    let cachedObj = await redisCaching.getHMKey(eventId, 'eventCpMap');
                    cachedObj = JSON.parse(cachedObj);
                    if (!cachedObj['currentPrice'] || !cachedObj['currentPrice']['yCP'] || !cachedObj['currentPrice']['nCP']) {
                        yCP = parseFloat(parseFloat((p.totalamount / 2).toString()).toFixed(2));
                        nCP = parseFloat(parseFloat((p.totalamount / 2).toString()).toFixed(2))
                    } else {
                        yCP = cachedObj.currentPrice.yCP;
                        nCP = cachedObj.currentPrice.nCP;
                    }
                } else {
                    // [err, _yCalls] = await to(ProbeV2.getProbeCallsOpen2({ probeid: eventId, callvalue: 'Y', userid: -1 }, maxReturn));
                    // if (err) throw err;
                    // [err, _nCalls] = await to(ProbeV2.getProbeCallsOpen2({ probeid: eventId, callvalue: 'N', userid: -1 }, maxReturn));
                    // if (err) throw err;

                    // let cdpArr = getCDP(lodash.cloneDeep(_yCalls), lodash.cloneDeep(_nCalls), maxReturn);
                    // yCP = cdpArr[0], nCP = cdpArr[1];
                    const d = new Date().valueOf();
                    console.time(`CDA Current getMyBetsCP ${d}`)
                    const [err, resp] = await to(ProbeV2.getCDACurrentPrice(eventId));
                    if (err) throw err;
                    yCP = resp?.[0]?.yCP ?? 50;
                    nCP = resp?.[0]?.nCP ?? 50;
                    console.timeEnd(`CDA Current getMyBetsCP ${d}`)

                }
            } else if (p.is_variable_liquidity_pool === false) {
                let px = await getTruePrices(eventId);
                yCP = px['yPrice'];
                nCP = px['nPrice'];
            } else {
                let px = await getCurrentLiquidityData(eventId, true);
                yCP = px.priceYes;
                nCP = px.priceNo;
            }
            cpAr.push({ eventid: eventId, yCP: yCP, nCP: nCP });
        }
        return ReS(res, {
            success: true, cps: cpAr
        });
    } catch (err) {
        logger.error(err);
        next(err);
    }
}

const deleteCallOpen = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        var data = req.body;
        var _openOrders, _delOrder;
        var _data = Object.assign({}, { 'probeid': data['probeid'], 'userid': data['userid'], 'callvalue': data['callvalue'], 'coins': data['coins'] });
        [err, _openOrders] = await to(Probe.getProbeCallsOpen(_data));
        if (_openOrders.length == 0) {
            return ReS(res, {
                success: true, status: 'FILLED'
            });
        } else {
            [err, _delOrder] = await to(Probe.deleteCallOpen(_data));
            return ReS(res, {
                success: true, status: 'FILLED'
            });
        }
    } catch (err) {
        next(err);
    }

}

const getProbeCalls = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');

    try {
        var err, _probeCalls;
        let data = Object.assign({}, req.body);

        if (typeof data['userid'] === 'undefined' && req.user) {
            data['userid'] = req.user.id;
        }

        [err, _probeCalls] = await to(Probe.getProbeCalls(data));

        if (err) throw err;

        return ReS(res, {
            success: true, calls: _probeCalls
        });
    } catch (err) {
        next(err);
    }
}

const getProbeStats = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');

    try {
        var err, stats;
        let data = Object.assign({}, req.body);

        if (err) throw err;

        stats = { traders: 79, volume: '1234', yes_price: 45, no_price: 56 }

        return ReS(res, Object.assign({ success: true }, stats));
    } catch (err) {
        next(err);
    }
}

const updateUserPreference = async (req, eventId) => {
    try {
        if (process.env.IS_REPLICA === "true") {
            return;
        }
        if (req.user && req.user.id && req.user.id !== -1) {
            const userId = req.user.id;
            let err, _prefRes, _;
            [err, _prefRes] = await to(UserPreference.getPreference(userId));
            if (err) throw err;

            if (_prefRes.length === 0)
                _prefRes = [{ probes_viewed: null, category_preference: null }];

            let probes_viewed = _prefRes[0].probes_viewed;
            if (probes_viewed === null)
                probes_viewed = [];
            if (probes_viewed && probes_viewed.indexOf(eventId) === -1) {
                probes_viewed.push(eventId);
                const dataObj = {
                    userid: userId,
                    probes_viewed: JSON.stringify(probes_viewed)
                };
                [err, _] = await to(UserPreference.updateProbesViewed(dataObj));
                if (err) throw err;
            }
        }
    } catch (e) {
        logger.error(`User preference is not updated. Stacktrace: ${JSON.stringify(e)}`);
    }
}

const getProbeCallsOpen = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        const userId = req.user.id;
        let _probeCalls = [], _pStatRows, _yCalls, _nCalls, resData;
        let data = Object.assign({}, req.body);
        let eventId = parseInt(data['probeid']);
        const partnerId = Number(req.headers['x-partner-id']) || 1;

        // updateUserPreference(req, eventId);

        let _schema = 'public';
        if (req?.domain) {
            _schema = req?.domain;
        }
        let cacheKey = getOpenCallsCachingKey(eventId, _schema);

        let err, redisReply, isLiveStatsEvent;
        [err, redisReply] = await to(redisCaching.getKey(cacheKey));
        if (err) throw err;
        if (redisReply) {
            resData = JSON.parse(redisReply);
            resData['invested_amount'] = null;
            if (userId !== -1) {
                const [err, investedData] = await to(ProbeV2.getInvestedAmount(userId, eventId, _schema));
                if (err) {
                    logger.error(`Getting invested amount. Stacktrace: ${JSON.stringify(err)}`);
                } else if (Array.isArray(investedData) && investedData.length > 0) {
                    resData['invested_amount'] = investedData[0]['invested'] ? parseFloat((investedData[0]['invested']).toFixed(2)) : null;
                }
            }
            if (resData['volume']) {
                resData['volume'] = parseFloat((resData['volume']).toFixed(2));
            }
            resData.live = false;
            resData.liveCard = false;

            // resData.isLiveStatsEvent = await Probe.getIsLiveStatsEvent(eventId);

            if (!data.liveCardDisable && resData.isLiveStatsEvent) {
                const live = await Probe.getLatestLiveStats(eventId)
                resData.live = live;
                const liveCard = await Probe.getLatestLiveStatsNew(eventId);
                resData.liveCard = liveCard;
            }

            let timeSeriesData = [];

            [err, timeSeriesData] = await to(ProbeV2.getTimeSeries({ 'eventId': eventId }, _schema));
            if (err) { logger.error(`Error occured while fetching timeseries data`); }
            resData.timeSeriesData = timeSeriesData;

            // let liquidity_fee_factor = resData?.liquidity_fee_factor
            // if(!resData.liquidity_fee_factor && resData?.liquidity_fee_factor !== 0) {
            //     const [errProbe, resProbe] = await to(Probe.getProbeById(eventId, ['liquidity_fee_factor'], true));
            //     if (errProbe) throw errProbe;
            //     liquidity_fee_factor = resProbe?.liquidity_fee_factor
            // }
            // if(liquidity_fee_factor || liquidity_fee_factor === 0) {
            //     const buyPrices = getBuyPrice(resData.yCP, resData.nCP, liquidity_fee_factor);
            //     const sellPrices = getSellPrice(resData.yCP, resData.nCP, liquidity_fee_factor);
            //     resData = {
            //         ...resData,
            //         ...buyPrices,
            //         ...sellPrices,
            //     }
            // }

            if (
                (process.env.NODE_ENV === 'production' && partnerId === 6) ||
                (process.env.NODE_ENV !== 'production' && partnerId === 10) ||
                (process.env.NODE_ENV === 'production' && partnerId === 5) ||
                (process.env.NODE_ENV !== 'production' && partnerId === 3)
            ) {
                resData.types = ['L', 'M'];
                resData.tradeTypes = { 'buy': ['L', 'M'], 'sell': ['L', 'M'] }
            }

            if (resData['invested_amount'] === 0) {
                resData['invested_amount'] = null;
            }

            return ReS(res, Object.assign({ success: true, }, resData));
        }
        let maxReturn, resObj;

        [err, resObj] = await to(Probe.getProbeById(eventId, ['totalamount', 'is_price_editable',
            'is_variable_liquidity_pool', 'is_private', 'liquidity_fee_factor', 'hashtags', 'live_stats_props'], true, _schema));
        if (err) throw err;

        // do we really need this?
        if (!resObj || !resObj.totalamount) {
            resData = { calls: [], traders: 0, volume: 0.0, yes_price: 0.0, no_price: 0.0, 'biddingEnabled': true, 'timeSeriesData': [] };
            return ReS(res, Object.assign({ success: true }, resData));
        }

        maxReturn = parseFloat((resObj.totalamount).toFixed(2));

        _yCalls = [];
        _nCalls = [];

        let yCP = 50, nCP = 50, newYCP, newNCP;
        let liquidity = undefined;
        let slippageFactor = undefined;
        let types, tradeTypes;

        if (resObj && resObj['is_price_editable'] == true) {
            let err;
            [err, _yCalls] = await to(ProbeV2.getProbeCallsOpen2({ probeid: eventId, callvalue: 'Y', userid: -1 }, maxReturn, true, _schema));
            if (err) throw err;
            [err, _nCalls] = await to(ProbeV2.getProbeCallsOpen2({ probeid: eventId, callvalue: 'N', userid: -1 }, maxReturn, true, _schema));
            if (err) throw err;
            const [errPr, resp] = await to(ProbeV2.getCDABestPrice(eventId, true, _schema));
            if (errPr) throw errPr;
            yCP = resp?.[0]?.yCP ?? 50;
            nCP = resp?.[0]?.nCP ?? 50;
            newYCP = resp?.[0]?.newYCP ?? null;
            newNCP = resp?.[0]?.newNCP ?? null;

            if (!resp?.[0]?.portfolioNCP || !resp?.[0]?.portfolioYCP) {
                //mymaster staging 10, prod 6
                types = ['L'];
                tradeTypes = (partnerId !== 6 && partnerId !== 5) ? { 'buy': ['L'], 'sell': ['M', 'L'] } : { 'buy': ['L', 'M'], 'sell': ['L', 'M'] };
            }
            else {
                //mymaster staging 10, prod 6
                types = (partnerId !== 6 && partnerId !== 5) ? ['M', 'L'] : ['L', 'M'];
                tradeTypes = (partnerId !== 6 && partnerId !== 5) ? { 'buy': ['M', 'L'], 'sell': ['M', 'L'] } : { 'buy': ['L', 'M'], 'sell': ['L', 'M'] };
            }


        } else if (resObj['is_variable_liquidity_pool'] === false) {
            let px = await getTruePrices(eventId);
            yCP = px['yPrice'];
            nCP = px['nPrice'];
            newYCP = yCP;
            newNCP = nCP;
            await redisCaching.setHMKey(eventId, 'eventCpMap', JSON.stringify({ 'currentPrice': { yCP: yCP, nCP: nCP } }));
        } else {
            let px = await getCurrentLiquidityData(eventId, true, req.domain);
            yCP = px.priceYes;
            nCP = px.priceNo;
            newYCP = yCP;
            newNCP = nCP;
            liquidity = px.liqPoolPrice;
            let liqConst = px.liqPoolConstant;
            if (liqConst <= CONFIG.SLIPPAGE_FACTOR_MIN_CONST) {
                slippageFactor = 0.00;
            } else if (liqConst >= CONFIG.SLIPPAGE_FACTOR_MAX_CONST) {
                slippageFactor = 10.00;
            } else {
                let logMin = Math.log10(CONFIG.SLIPPAGE_FACTOR_MIN_CONST);
                let logMax = Math.log10(CONFIG.SLIPPAGE_FACTOR_MAX_CONST);
                slippageFactor = parseFloat((10 - (10 * (Math.log10(liqConst) - logMin)) / (logMax - logMin))).toFixed(2);
                slippageFactor = parseFloat(slippageFactor);
            }
            await redisCaching.setHMKey(eventId, 'eventCpMap', JSON.stringify({ 'currentPrice': { yCP, nCP, newNCP, newYCP } }));
        }

        // const isEntryPresent = await CurrentPrice.doesCurrentPriceExist(eventId);
        // if (isEntryPresent === true)
        //     await CurrentPrice.updateLatestCpYes({ eventId: eventId, latest_cp_yes: yCP });

        [err, _pStatRows] = await to(ProbeV2.getProbeCallsStats(data, true, _schema));
        if (err) throw err;

        let vCount = 0, tCount = 0;
        for (let idx = 0; idx < _pStatRows.length; idx++) {
            tCount += parseInt(_pStatRows[idx]['traders']);
            vCount += parseFloat(parseFloat(_pStatRows[idx]['sum'].toString()).toFixed(2));
        }
        vCount = parseFloat(parseFloat((vCount).toString()).toFixed(2));
        _probeCalls = _probeCalls.concat(_yCalls);
        _probeCalls = _probeCalls.concat(_nCalls);

        let timeSeriesData, _liveStats, _liveStatsNew;
        let timeSeriesDataCached = await redisCaching.getKey(`timeseries_${eventId}`)
        if (timeSeriesDataCached) {
            timeSeriesData = JSON.parse(timeSeriesDataCached);
        } else {
            [err, timeSeriesData] = await to(ProbeV2.getTimeSeries({ 'eventId': eventId }, _schema));
            if (err) { logger.error(`Error occured while fetching timeseries data`); }
            if (timeSeriesData) {
                redisCaching.setKey(`timeseries_${eventId}`, JSON.stringify(timeSeriesData), 60)
            }
        }

        if (timeSeriesData === undefined) timeSeriesData = [];

        [err, _liveStats] = await to(liveStats.getLiveStats(eventId));
        if (err) { logger.error(`Error occured while fetching livestats data`); }

        let investedAmount = null;
        if (userId !== -1) {
            const [err, investedData] = await to(ProbeV2.getInvestedAmount(userId, eventId, req.domain));
            if (err) {
                logger.error(`Getting invested amount. Stacktrace: ${JSON.stringify(err)}`);
            } else if (Array.isArray(investedData) && investedData.length > 0) {
                investedAmount = investedData[0]['invested'] ? parseFloat((investedData[0]['invested']).toFixed(2)) : null;
            }
        }
        let live = false;
        let liveCard = false;
        [err, isLiveStatsEvent] = await to(Probe.getIsLiveStatsEvent(eventId));
        if (err) {
            console.log("ERROR in isLiveStatsEvent Query", err.message)
        }
        if (!data.liveCardDisable && isLiveStatsEvent) {
            live = await Probe.getLatestLiveStats(eventId)
            liveCard = await Probe.getLatestLiveStatsNew(eventId);
        }


        let prices = {};
        if (!resObj.is_price_editable) {
            const liquidity_fee_factor = (resObj?.liquidity_fee_factor ?? 0.5)
            const buyPrices = getBuyPrice(yCP, nCP, liquidity_fee_factor);
            const sellPrices = getSellPrice(yCP, nCP, liquidity_fee_factor);
            prices = {
                ...buyPrices,
                ...sellPrices,
            }
        }

        let liveView = resObj?.live_stats_props?.live_yt_link ?? null;

        resData = {
            eventId,
            calls: _probeCalls,
            traders: tCount,
            volume: vCount,
            yes_price: yCP,
            no_price: nCP,
            yCP: yCP,
            nCP: nCP,
            newYCP,
            newNCP,
            ...prices,
            live,
            liveCard,
            isLiveStatsEvent,
            biddingEnabled: true,
            is_private: resObj.is_private || false,
            timeSeriesData: timeSeriesData,
            liveStats: (_liveStats) ? _liveStats : [],
            invested_amount: investedAmount == 0 ? null : investedAmount,
            liquidity: parseFloat(parseFloat(liquidity).toFixed(2)),
            volatility_factor: slippageFactor,
            volatility_title: 'Volatility Factor',
            volatility_max_value: 10,
            types,
            tradeTypes,
            liveView
        };

        let lastPriceObj = await redisCaching.getHMKey(eventId, 'eventLastCpMap');
        if (typeof lastPriceObj === 'string') {
            lastPriceObj = JSON.parse(lastPriceObj);
            resData['lastYCP'] = (lastPriceObj && lastPriceObj['currentPrice']['yCP']) ? lastPriceObj['currentPrice']['yCP'] : 50;
            resData['lastNCP'] = (lastPriceObj && lastPriceObj['currentPrice']['nCP']) ? lastPriceObj['currentPrice']['nCP'] : 50;
        }

        redisCaching.setKey(cacheKey, JSON.stringify(resData), 60 * 60);

        return ReS(res, Object.assign({ success: true }, resData));
    } catch (err) {
        logger.error(err);
        next(err);
    }
}

const getProbeCallsOpenMM = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        const userId = req.user.id;
        let _probeCalls = [], _pStatRows, _yCalls, _nCalls, resData;
        let data = Object.assign({}, req.body);

        let eventId = parseInt(data['marketid']);
        let cacheKey = getOpenCallsCachingKey(eventId, "public");

        // updateUserPreference(req, eventId);

        let err, redisReply, isLiveStatsEvent;
        [err, redisReply] = await to(redisCaching.getKey(cacheKey));
        if (err) throw err;
        if (redisReply) {
            console.log('redisReply')
            resData = JSON.parse(redisReply);
            resData['invested_amount'] = null;
            if (userId !== -1) {
                const [err, investedData] = await to(ProbeV2.getInvestedAmount(userId, eventId));
                if (err) {
                    logger.error(`Getting invested amount. Stacktrace: ${JSON.stringify(err)}`);
                } else if (Array.isArray(investedData) && investedData.length > 0) {
                    resData['invested_amount'] = investedData[0]['invested'] ? parseFloat((investedData[0]['invested']).toFixed(2)) : null;
                }
            }
            if (resData['volume']) {
                resData['volume'] = parseFloat((resData['volume']).toFixed(2));
            }
            // let rData = Object.assign({}, )
            let rData = lodash.pick(resData, 'eventId', 'calls', 'volume', 'yCP', 'nCP', 'invested_amount')
            // resData = {
            //     eventId,
            //     calls: _probeCalls,
            //     volume: vCount,
            //     yCP: yCP,
            //     nCP: nCP,
            //     invested_amount: investedAmount
            // };
            return ReS(res, Object.assign({ success: true }, rData));
        }
        let maxReturn = 100, resObj;

        _yCalls = [];
        _nCalls = [];

        let yCP = 50, nCP = 50, newYCP, newNCP;

        if (true) {
            let err;
            [err, _yCalls] = await to(ProbeV2.getProbeCallsOpen2({ probeid: eventId, callvalue: 'Y', userid: -1 }, maxReturn, true));
            if (err) throw err;
            [err, _nCalls] = await to(ProbeV2.getProbeCallsOpen2({ probeid: eventId, callvalue: 'N', userid: -1 }, maxReturn, true));
            if (err) throw err;
            const [errPr, resp] = await to(ProbeV2.getCDABestPrice(eventId));
            if (errPr) throw errPr;
            yCP = resp?.[0]?.yCP ?? 50;
            nCP = resp?.[0]?.nCP ?? 50;
            newYCP = resp?.[0]?.newYCP ?? null;
            newNCP = resp?.[0]?.newNCP ?? null;



        }

        // const isEntryPresent = await CurrentPrice.doesCurrentPriceExist(eventId);
        // if (isEntryPresent === true)
        //     await CurrentPrice.updateLatestCpYes({ eventId: eventId, latest_cp_yes: yCP });

        [err, _pStatRows] = await to(ProbeV2.getProbeCallsStats({ probeid: eventId }, true, "public"));
        if (err) throw err;

        let vCount = 0, tCount = 0;
        for (let idx = 0; idx < _pStatRows.length; idx++) {
            vCount += parseFloat(parseFloat(_pStatRows[idx]['sum'].toString()).toFixed(2));
        }
        vCount = parseFloat(parseFloat((vCount).toString()).toFixed(2));
        _probeCalls = _probeCalls.concat(_yCalls);
        _probeCalls = _probeCalls.concat(_nCalls);


        let investedAmount = 0;
        if (userId !== -1) {
            const [err, investedData] = await to(ProbeV2.getInvestedAmount(userId, eventId, true));
            if (err) {
                logger.error(`Getting invested amount. Stacktrace: ${JSON.stringify(err)}`);
            } else if (Array.isArray(investedData) && investedData.length > 0) {
                investedAmount = investedData[0]['invested'] ? parseFloat((investedData[0]['invested']).toFixed(2)) : null;
            }
        }


        let prices = {};

        resData = {
            eventId,
            calls: _probeCalls,
            volume: vCount,
            yCP: yCP,
            nCP: nCP,
            invested_amount: investedAmount
        };

        return ReS(res, Object.assign({ success: true }, resData));
    } catch (err) {
        logger.error(err);
        next(err);
    }
}


const getBonusLimit = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    let { eventid } = req.body, userId = req.user.id;

    let [err, bonusLimit] = await to(EventsService.getBonusLimit(userId, eventid));

    return ReS(res, { 'bonusLimit': 0 });
}

const fetchNews = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');

    try {
        var err, newsData, insertIds;
        let data = Object.assign({}, req.body);
        let responseData = [];
        let limit = 3;
        let offset = ((data.page || 1) - 1) * limit;

        let qData = { 'probeid': data.probeid, 'limit': limit, 'offset': offset };

        let newsDataRedisKey = `news_data_event_${data.probeid}`;
        let cachedNewsData = await redisCaching.getKey(newsDataRedisKey);
        if (cachedNewsData) {
            logger.info(`fetchNews from cache for event Id  : ${data.probeid},  news data: ${cachedNewsData}`)
            return ReS(res, {
                success: true, content: JSON.parse(cachedNewsData)
            });
        }
        let reqKey = `fetch_news_rapid_api_req_${data.probeid}`;
        const unlock = await lock(reqKey, 300000);
        cachedNewsData = await redisCaching.getKey(newsDataRedisKey);
        if (cachedNewsData) {
            logger.info(`fetchNews from cache for event Id  : ${data.probeid}, news data: ${cachedNewsData}`)
            unlock();
            return ReS(res, {
                success: true, content: JSON.parse(cachedNewsData)
            });
        }
        // Read news data from database
        [err, newsData] = await to(Probe.getEventNews(qData));
        if (err) {
            unlock();
            throw err;
        }
        logger.info(`fetchNews from database for event Id  : ${data.probeid}, news data: ${JSON.stringify(newsData)} `)
        if (newsData.length == 0) {
            // News not found in database, getting data from rapid api
            var keywords;
            [err, keywords] = await to(Probe.getTags(data.probeid));
            if (err) {
                unlock();
                throw err;
            }
            if (!keywords || keywords.length == 0) {
                unlock();
                return ReS(res, {
                    success: true, content: [], status: 'ERROR', message: 'Unable to fetch News right now'
                });
            }
            logger.info(`getRequestsFromRapidAPIG for event Id  : ${data.probeid}, keywords : ${JSON.stringify(keywords)}`);
            [err, newsData] = await to(getRequestsFromRapidAPIG(keywords));
            // if (err) throw err;
            if (err) {
                unlock();
                return ReS(res, {
                    success: true, content: newsData, status: 'ERROR', message: 'Unable to fetch News right now'
                });
            }

            if (newsData.length == 0) {
                // Caching empty news result for 12 hours to avoid multiple calls to rapid api
                await redisCaching.setKey(newsDataRedisKey, JSON.stringify(newsData), 60 * 60 * 12);
                unlock();
            }
            const rowsToInsert = [];
            for (let j = 0; j < newsData.length; j++) {
                rowsToInsert.push({ 'probeid': data.probeid, data: newsData[j] });
            }

            if (rowsToInsert.length > 0) {
                [err, newsData] = await to(Probe.putInfoRequests(rowsToInsert));
                if (err) {
                    unlock();
                    logger.info(err);
                }
            }
        }
        if (newsData.length > 0) {
            responseData = newsData.map(chunk => {
                const jsonData = JSON.parse(chunk.data);
                if (jsonData && jsonData.name && jsonData.url) {
                    return {
                        data: {
                            url: jsonData.url,
                            title: jsonData.name,
                            description: jsonData.description,
                            published_at: jsonData.datePublished || "",
                            image: jsonData.image && jsonData.image.thumbnail && jsonData.image.thumbnail.contentUrl ?
                                jsonData.image.thumbnail.contentUrl :
                                "",
                            source: Array.isArray(jsonData.provider) && jsonData.provider.length > 0 && jsonData.provider[0].name ?
                                jsonData.provider[0].name :
                                ""
                        }
                    };
                }
            });
            await redisCaching.set(newsDataRedisKey, JSON.stringify(responseData.slice(0, 3)));
            unlock();
        }
        return ReS(res, {
            success: true, content: responseData.slice(0, 3)
        });
    } catch (err) {
        next(err);
    }
}

const updateNews = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');

    if (req.body.data && req.body.data.probeid) {
        EventNewsServices.updateNews(req.body.data.probeid)
    } else {
        return ReE(res, 'Invalid Request', 400);
    }

    return ReS(res, {
        success: true
    });
};

var getRequestsFromRapidAPIG = async function (qData) {
    let keywords = qData[0].keywords;
    const options = {
        method: 'GET',
        url: 'https://bing-news-search1.p.rapidapi.com/news/search',
        params: {
            sortBy: 'date',
            q: keywords,
            freshness: 'Week',
            count: 10,
            safeSearch: 'Off'
        },
        headers: {
            'x-bingapis-sdk': 'true',
            'x-rapidapi-host': 'bing-news-search1.p.rapidapi.com',
            'x-search-location': 'india',
            'accept-language': 'en-us',
            'x-rapidapi-key': CONFIG.newsAPIKEY
        }
    };
    try {
        let res = (await axios.request(options)).data.value;
        logger.info(`getRequestsFromRapidAPIG options  : ${JSON.stringify(options)}, result : ${JSON.stringify(res)}`);
        return res
    }
    catch (e) {
        throw e;
    }
}

const addToTrendingEventList = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    try {
        let data = Object.assign({}, req.body);
        const [err, resp] = await to(Probe.addToTrending(data.id));
        if (err) throw err;
        return ReS(res, {
            success: true, id: resp[0]
        });
    } catch (e) {
        next(e);
    }
}

const updateTrendingEventRank = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    try {
        let data = Object.assign({}, req.body);
        const [err, resp] = await to(Probe.setTrendingEventRank(data));
        if (err) throw err;
        return ReS(res, {
            success: true
        });
    } catch (e) {
        next(e);
    }
}

const removeFromTrendingEventList = async (req, res, next) => {
    // res.setHeader('Content-Type', 'application/json');
    try {
        let data = Object.assign({}, req.body);
        const [err, _] = await to(Probe.deleteFromTrending({ id: data.id, rank: data.rank }));
        if (err) throw err;
        return ReS(res, {
            success: true
        });
    } catch (e) {
        next(e);
    }
}

const convertEventToPrivate = async (req, res, next) => {
    try {
        if (!isDashboardUser(req)) {
            res.writeStatus("401");
            return ReS(res, {
                success: true, msg: 'Unauthorized request, incident has been reported'
            });
        }
        let data = Object.assign({}, req.body);
        const probeid = data.probeid;
        logger.info(`convertEventToPrivate Probeid: ${JSON.stringify(probeid)}`);
        const [err, _] = await to(Probe.markEventsAsPrivate(probeid));
        if (err) throw err;
        return ReS(res, {
            success: true
        });
    } catch (e) {
        next(e);
    }
}

const convertEventToPublic = async (req, res, next) => {
    try {
        if (!isDashboardUser(req)) {
            res.writeStatus("401");
            return ReS(res, {
                success: true, msg: 'Unauthorized request, incident has been reported'
            });
        }
        let data = Object.assign({}, req.body);
        const probeid = data.probeid;
        logger.info(`convertEventToPublic Probeid: ${JSON.stringify(probeid)}`);
        const [err, _] = await to(Probe.markEventsAsPublic(probeid));
        if (err) throw err;
        return ReS(res, {
            success: true
        });
    } catch (e) {
        next(e);
    }
}

const haltProbes = async function (req, res, next) {
    try {
        if (!isDashboardUser(req)) {
            res.writeStatus("401");
            return ReS(res, {
                success: true, msg: 'Unauthorized request, incident has been reported'
            });
        }
        let data = Object.assign({}, req.body);
        const probeids = data.probeids;
        logger.info(`haltProbes Probeids: ${JSON.stringify(probeids)}`);
        const [err, _] = await to(Probe.haltProbes(probeids));
        if (err) throw err;
        return ReS(res, {
            success: true
        });
    } catch (e) {
        next(e);
    }
}

const unhaltProbes = async function (req, res, next) {
    try {
        if (!isDashboardUser(req)) {
            res.writeStatus("401");
            return ReS(res, {
                success: true, msg: 'Unauthorized request, incident has been reported'
            });
        }
        let data = Object.assign({}, req.body);
        const probeids = data.probeids;
        logger.info(`haltProbes Probeids: ${JSON.stringify(probeids)}`);
        const [err, _] = await to(Probe.unhaltProbes(probeids));
        if (err) throw err;
        return ReS(res, {
            success: true
        });
    } catch (e) {
        next(e);
    }
}

const handleEventReset = async (eventType, eventId, probeTitle, is_price_editable, schema = 'public') => {
    try {
        logger.info(`Settling Event ${eventId} : ${probeTitle} for Resetting Event`);

        let _, settlementRows, err, tdsResp, delTxn, results;
        [err, settlementRows] = await to(Probe.getTransactionSettlements(eventId, schema));

        const getAction = txnid => {
            switch (true) {
                case txnid.indexOf('SPTD'):
                    return TRANSACTIONS.reverseMovePromoBalance;
                case txnid.indexOf('SRF'):
                    return TRANSACTIONS.reverseRefundOpenOrder;
                default:
                    return TRANSACTIONS.eventReset
            }
        }
        let fantasy_id, fantasy_type;
        if (schema === 'fantasy') {
            const data = await Probe.getFantasyTypeByProbeId(eventId);
            fantasy_id = data?.fantasy_id;
            fantasy_type = data?.fantasy_type;
        }

        const txnData = settlementRows.map(v => ({ ...v, probeid: eventId, fantasy_type, fantasy_id, action: getAction(v.txnid) }));

        console.log('----------------------------------');
        console.log(JSON.stringify(txnData));
        console.log('----------------------------------');
        [err, results] = await to(UserService.executeTransactions(txnData, true, null, schema));
        if (err) {
            logger.info(`Event Reset ${eventId} : error while resetting event, ${err.message}`);
        }
        // for (let settlement of settlementRows) {
        //     let sUId = settlement.userid
        //     let walletData = { 'userid': sUId, 'coinsd': 0 }
        //     if (settlement.wallettype == 'W') {
        //         walletData['coinsw'] = (settlement.amount - settlement.surcharge).toFixed(2)
        //     }
        //     if (settlement.wallettype == 'D') {
        //         walletData['coinsd'] = (settlement.amount - settlement.surcharge).toFixed(2)
        //     }
        //     if (settlement.wallettype == 'B') {
        //         walletData['coinsb'] = (settlement.amount - settlement.surcharge).toFixed(2)
        //     }

        //     logger.info(`Event Reset Event : ${eventId} userId : ${sUId} :: 
        //                 Wallet winning amount :::  coinsd = ${walletData['coinsd']} coinsw = ${walletData['coinsw']} coinsb = ${walletData['coinsb']}`);

        //     [err, tdsResp] = await to(TdsUsers.getTdsData({ user_id: sUId, probe_id: eventId, earning_type: 'settlement' }));
        //     if (err) {
        //         logger.info(`Event Reset Event : ${eventId} userId : ${sUId} :: Error getting TDS for user: ${sUId}`);
        //     }
        //     let txnId = settlement.id;
        //     if (tdsResp.length > 0) {
        //         const amonut = tdsResp[0].tax_deducted;
        //         logger.info(`Event Reset Event : ${eventId} userId : ${sUId} :: TDS Refund : ${amonut}`);
        //         const txnidToRemove = tdsResp[0].txnid_tds_id;

        //         [err, delTxn] = await to(User.deleteTransaction({ 'id': txnidToRemove }));
        //         if (err) logger.info(`Event Reset Event : ${eventId} userId : ${sUId} :: Error while deleting TDS transaction`);

        //         walletData['coinsd'] = walletData['coinsd'] - amonut;
        //     } else {
        //         logger.info(`Event Reset Event : ${eventId} userId : ${sUId} :: No TDS was paid by user`);
        //     }

        //     walletData['transactionId'] = txnId;

        //     logger.info(`Event Reset Event : ${eventId} userId : ${sUId} :: 
        //                 Wallet amount after TDS :::  coinsd = ${walletData['coinsd']} coinsw = ${walletData['coinsw']} coinsb = ${walletData['coinsb']}`);

        //     const [errP, _walletData] = await to(User.updateWallet(walletData, -1, 'debit'));
        //     if (errP) {
        //         logger.info(`Event Reset Event : ${eventId} userId : ${sUId} :: error while updating user wallet`);
        //     }

        //     let dataObj = { 'id': txnId }, errTxn;
        //     [errTxn, delTxn] = await to(User.deleteTransaction(dataObj));
        //     if (errTxn) {
        //         logger.info(`Event Reset Event : ${eventId} userId : ${sUId} :: error while deleting transaction entry`);
        //     }

        //     const [errMsg, delMsg] = await to(User.deleteMessage(sUId, probeTitle));


        //     if (errMsg) {
        //         logger.info(`Event Reset Event : ${eventId} userId : ${sUId} :: error while deleting messages entry`);
        //     }
        // }

        // Delete TDS entries in database for settlement of event
        // logger.info(`Event Reset ${eventId} : deleting TDS entries from tds_users`);
        // const [errTDS, delTds] = await to(TdsUsers.deleteTDS({ probe_id: eventId, earning_type: 'settlement' }));
        // if (errTDS) {
        //     logger.info(`Event Reset : Error while delete TDS entry for event : ${eventId}`);
        // }

        // Remove event from closed portfolio (History)
        const [errH, delHis] = await to(History.removeFromHistory(eventId, schema));
        if (errH) {
            logger.info(`Event Reset ${eventId} : error while deleting history entry`);
        }

        // Remove from liquidity_events if exist
        if (!is_price_editable) {
            const [lpEventsErr, lpEventRow] = await to(LiquidityEvent.getLatestRow(eventId, true, schema));
            if (lpEventsErr) {
                logger.info(`Event Reset ${eventId} : error while fetching liquidity entry`);
                throw lpEventsErr;
            }
            if (lpEventRow.length > 0) {
                const idToRemove = lpEventRow[0].id;
                const [lpDelErr, lpDelRow] = await to(LiquidityEvent.deleteLiquidityRow({ 'id': idToRemove }, schema));
                if (lpDelErr) {
                    logger.info(`Event Reset ${eventId} : error while deleting liquidity entry`);
                    throw lpDelErr;
                }
            }
        }


        if (eventType === `Bet`) {
            [err, _] = await to(Probe.resetCallsRank(eventId, schema));
        }
    } catch (err) {
        throw err;
    }
}

const modifyProbeCall = async (probeCalls, index, fraction, maxPool) => {
    try {
        probeCalls[index].rank = 1;
        probeCalls[index].returns = maxPool * fraction;
        [err, modifiedProbeCall] = await to(Probe.updateCall(probeCalls[index]));
    } catch (err) {
        throw err;
    }
}

const getLiveStats = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        var data = req.body;

        let _liveStats;
        [err, _liveStats] = await to(liveStats.getLiveStats(data.probeId));
        if (err) throw err;

        return ReS(res, {
            success: true, response: _liveStats
        });
    } catch (err) {
        next(err);
    }
}

const getCrickeMatchesList = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        var data = req.body;

        let matches;
        [err, matches] = await to(LiveStatsService.getCricketMathesByDate(data.date));
        if (err) throw err;

        matches = matches.data.results;
        let _list = [];
        for (let i = 0; i < matches.length; i++) {
            _list.push(`${matches[i].id} - ${matches[i].match_title}`);
        }
        return ReS(res, {
            success: true, list: _list
        });
    } catch (err) {
        next(err);
    }
}


const getProbeIdFromDesc = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        //description, status and category
        if (!isDashboardUser(req)) {
            res.writeStatus("401");
            return ReS(res, {
                success: true, msg: 'Unauthorized request, incident has been reported'
            });
        }
        var data = Object.assign({}, req.body);

        let [err, probeid] = await to(Probe.getProbeIdFromDesc(data));
        if (err) throw err;

        return ReS(res, {
            success: true, probeid: probeid['array'].length > 0 ? probeid['array'] : -1
        });
    } catch (err) {
        next(err);
    }
}

const addMMData = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {

        if (!isDashboardUser(req)) {
            res.writeStatus("401");
            return ReS(res, {
                success: true, msg: 'Unauthorized request, incident has been reported'
            });
        }

        let err, _, stratObj;
        let data = Object.assign({}, req.body);

        [err, stratObj] = await to(Probe.insertMMdata(data));
        if (err) throw err;


        return ReS(res, {
            success: true, stratObj
        });
    } catch (err) {
        next(err);
    }
}

const getMMData = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {

        if (!isDashboardUser(req)) {
            res.writeStatus("401");
            return ReS(res, {
                success: true, msg: 'Unauthorized request, incident has been reported'
            });
        }
        const probeid = req.query.probeid;
        let err, _, stratObj;

        [err, stratObj] = await to(Probe.getMMdata(probeid));
        if (err) throw err;


        return ReS(res, {
            success: true, stratObj
        });
    } catch (err) {
        next(err);
    }
}

const updateMMData = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {

        if (!isDashboardUser(req)) {
            res.writeStatus("401");
            return ReS(res, {
                success: true, msg: 'Unauthorized request, incident has been reported'
            });
        }

        let err, _, stratObj, updateObj = {};
        let data = Object.assign({}, req.body);

        if (typeof data.is_mm_started !== 'undefined') {
            updateObj['is_mm_started'] = data.is_mm_started;
        }
        if (typeof data.pids !== 'undefined') {
            updateObj['pids'] = data.pids;
        }
        if (typeof data.is_mm !== 'undefined') {
            updateObj['is_mm'] = data.is_mm;
        }
        if (typeof data.ifyes !== 'undefined') {
            updateObj['ifyes'] = data.ifyes;
        }
        if (typeof data.ifno !== 'undefined') {
            updateObj['ifno'] = data.ifno;
        }
        if (typeof data.oddsyes !== 'undefined') {
            updateObj['oddsyes'] = data.oddsyes;
        }
        if (typeof data.oddsno !== 'undefined') {
            updateObj['oddsno'] = data.oddsno;
        }
        if (typeof data.process !== 'undefined') {
            updateObj['process'] = data.process;
        }
        if (typeof data.txpnl !== 'undefined') {
            updateObj['txpnl'] = data.txpnl;
        }
        if (typeof data.bfpnl !== 'undefined') {
            updateObj['bfpnl'] = data.bfpnl;
        }
        if (typeof data.netpnl !== 'undefined') {
            updateObj['netpnl'] = data.netpnl;
        }
        updateObj['updatedat'] = 'now()';

        [err, stratObj] = await to(Probe.updateMMdata(data.probeid, updateObj));
        if (err) throw err;


        return ReS(res, {
            success: true, stratObj
        });
    } catch (err) {
        next(err);
    }
}

const createUserEvent = async (req, res) => {
    const log = args => console.log(`[USER CREATE EVENT] ${req?.user?.id}`, ...args);
    const reqKey = `USER_CREATE_EVENT_${req?.user?.id}`;
    const unlock = await lock(reqKey, 60000);
    let probeId;
    try {
        /**
         * User can create event
         */

        const userId = req?.user?.id;
        let isCreateEnabled = req?.body?.probe_type == 'normal' ?
            true :
            CONFIG.CREATE_EVENT_USERS.findIndex(i => i === userId) > -1;
        const error = msg => {
            unlock();
            log("ERROR", msg);
            return ReE(res, msg, 400, 'Create event failed', msg);
        }
        if (!isCreateEnabled) {
            return error('Not authorized to create Event');
        }
        let days = parseInt(req?.body?.duration?.days ?? req?.body?.duration?.day);
        if (isNaN(days) || days <= 0) {
            return error('Invalid value for duration');
        }

        let title = (req?.body?.title ?? '').trim();
        if (!title || title === '') {
            return error('Invalid or empty title');
        }

        function isValidUrl(string) {
            try {
                new URL(string);
                return true;
            } catch (e) {
                return false;
            }
        }

        let sos = (req?.body?.source_of_settlement ?? '').trim();
        if (!sos || sos === '') {
            sos = "https://www.google.com";
        }

        if (sos && !isValidUrl(sos)) {
            const encodedString = encodeURIComponent(sos);
            sos = `https://www.google.com/search?q=${encodedString}`;
        }

        let invest_amount = parseFloat(req?.body?.invest_amount);
        if (isNaN(invest_amount)) {
            return error('Invalid value for investment amount');
        }

        let invest_option = (req?.body?.invest_option ?? '');
        if (!invest_option || ['Y', 'N'].indexOf(invest_option) < 0) {
            return error('Invalid value for investment option');
        }

        let probe_type = (req?.body?.probe_type ?? 'promo').toLowerCase();
        if (!probe_type || ['normal', 'promo'].indexOf(probe_type) < 0) {
            return error('Invalid value for probe type');
        }

        let start_date = luxon.DateTime.now().minus({
            seconds: 30
        });
        let endsat = start_date.plus({
            days,
        });
        let settledate = endsat.plus({
            hours: 1,
        });
        const timezone = req?.headers?.['x-user-timezone'] ?? 'Asia/Calcutta';
        start_date = start_date.setZone(timezone).toFormat('yyyy-MM-dd HH:mm:ss');
        endsat = endsat.setZone(timezone).toFormat('yyyy-MM-dd HH:mm:ss');
        settledate = settledate.setZone(timezone).toFormat('yyyy-MM-dd HH:mm:ss');
        let subtitle = (req?.user?.displayname ?? '').trim();
        if (!subtitle || subtitle === '') {
            let email = req?.user?.email;
            const parts = email.split('@');
            if (parts.length !== 2) {
                subtitle = email;
            }
          
            const [localPart, domainPart] = parts;
            let maskedLocalPart = localPart;
          
            if (localPart.length > 1) {
              maskedLocalPart = localPart[0] + '*'.repeat(localPart.length - 1);
            }
          
            subtitle =  `${maskedLocalPart}@${domainPart}`;
        }

        const data = {
            "id": 0,
            "title": title,
            "subtitle": subtitle,
            "description": "",
            "resolution": "The outcome will be determined by our internal team of experts",
            "full_rules": null,
            "type": "Bet",
            "imageurl": "", "videourl": "",
            "entryfee": 10, "proptionsid": -1,
            "keywords": "", "source": sos,
            "start_date": `'${start_date}'`,
            "endsat": `'${endsat}'`,
            "createdby": userId,
            "settledate": `'${settledate}'`,
            "options": [{ "text": "YES", "id": -9999, "odds": 0 }, { "text": "NO", "id": -9998, "odds": 0 }],
            "category": 'Community Events',
            "subcategory": "", "subsubcat": "", "hashtags": "", "tags": [" "],
            "correctproptionid": -1, "correctvalue": "",
            "status": "F",
            "calls": [],
            "createdat": "",
            "tips": [],
            "settlement_description": `${invest_option}@${invest_amount}`,
            "is_internal": false,
            "is_private": false,
            "is_price_editable": true,
            "is_variable_liquidity_pool": false,
            "auto_match": false,
            "max_pool": 0, "max_players": 0, "bids_per_player": 0, "Maximum_Return": "100",
            "live_stats_type": " ", "live_stats_props": " ", "settlement_proof": "",
            "alternate_title": "", "parent_id": 0, "auto_settle": false, "settle_threshold": -1,
            "widget_url": null, "widget_title": null, "learn_url": null, "learn_title": "",
            "tooltip": "",
            "max_allowed_position": 5000,
            "liquidity_fee_factor": 2, "range": probe_type === 'normal' ? 50 : 1,
            "regions": [], "partners": ["1"],
            "timezone": timezone ?? "Asia/Calcutta",
            "probe_type": probe_type ?? "promo",
            "max_trade_amount": null,
            "liquidity_pool": 5000
        }
        const result = await createEvent(data, req);
        probeId = result?.probeId;
        
        unlock();
        return ReS(res, {
            probeId,
            message: `Event successfully created`,
        })

    } catch (e) {
        unlock();
        // if(e?.response?.data) {
        //     return ReS(res, {
        //         probeId, 
        //         message: `Event successfully created, but could not place your trade due to ${e?.response?.data?.message}`,
        //     })
        // }
        log("ERROR", e.message);
        return ReE(res, e.message);
    }
}

const getCommunityEvents = async (req, res) => {
    const log = (...args) => console.log(`[GET COMMUNITY EVENTS] ${req?.user?.id}`, ...args);
    try {
        if (!isDashboardUser(req)) {
            return ReE(res, 'Not authorized to get community events', 403);
        }
        const probes = await getUnapprovedCommunityEvents();
        return ReS(res, { probes });
    } catch (e) {
        log('Error', e.message);
        return ReE(res, e.message, 400);
    }
}

const approveCommunityEvent = async (req, res) => {
    const log = (...args) => console.log(`[APPROVE COMMUNITY EVENTS] ${req?.user?.id}`, ...args);
    try {
        if (!isDashboardUser(req)) {
            return ReE(res, 'Not authorized to approve community events', 403);
        }
        if (!req?.body?.probeId || isNaN(parseInt(req?.body?.probeId))) {
            throw Error('Incorrect probeId')
        }
        if (!req?.body?.approve || ['A', 'R'].indexOf((req?.body?.approve ?? '').toUpperCase()) < 0) {
            throw Error('Incorrect approval status')
        }
        let status = 'A';
        let description = `Approved by ${req?.user?.id} at ${new Date().toLocaleString()}`;
        if (req?.body?.approve.toUpperCase() !== 'A') {
            status = 'CAN';
            description = `Rejected by ${req?.user?.id} at ${new Date().toLocaleString()}`;
        }
        const probe = await Probe.approveCommunityEvent({
            probeId: parseInt(req?.body?.probeId),
            status,
            description
        });

        /**  Place Initial Trade fro invested amount */
        if (status === 'A') {
            const [invest_option, invest_amount] = probe.settlement_description.split('@');
            await waitTimer(1000);
            const tradePayload = {
                "appVersion": 1086,
                "callvalue": invest_option,
                "coins": invest_amount / (invest_amount / 50),
                "noofcontracts": invest_amount / 50,
                "probeid": probe.id,
                "proptionid": 9,
                "ptype": "bet",
                "tradeType": "Buy",
                "preventSlippage": false,
                "islimit": true,
                "orderamount": 5000
            }
            const token = await User.getTempJWT(probe.createdby);

            const params = {
                url: 'http://server:4000/v2/probe/putcall',
                data: tradePayload,
                headers: {
                    Authorization: token
                },
                method: 'POST',
            }
            let tradeAPIResponse = await axios(params);

            let[err, _probesObject] = await to(Probe.getProbeById(parseInt(req?.body?.probeId), ['title'], true));
            if (err) throw err;
            let titleEmbedding = await createEventEmbedding(_probesObject['title']);
            let payload = {
                item_id: parseInt(req?.body?.probeId),
                application: `Prediction`,
                embedding: JSON.stringify( titleEmbedding.embeddings.map( i => parseFloat(i) ) ),
                model_name: 'bge-m3',
                locale: 'en-in',
                property: 'title',
                original_text: _probesObject['title'],
            };
            let embRes = await Embeddings.addEmbeddingDB(payload);
            log("INFO", embRes);

            tradeAPIResponse = tradeAPIResponse.data;
            if (tradeAPIResponse.success) {
                return ReS(res, {
                    id: parseInt(req?.body?.probeId),
                    message: 'Event successfully approved and trade placed'
                })
            }

            return ReS(res, {
                id: parseInt(req?.body?.probeId),
                message: `Event successfully created, but could not place your trade due to ${tradeAPIResponse.message}`,
            })
        }

        return ReS(res, {
            id: parseInt(req?.body?.probeId),
            message: 'Event successfully rejected'
        });
    } catch (e) {
        if (e?.response?.data) {
            return ReS(res, {
                message: `Event successfully created, but could not place your trade due to ${e?.response?.data?.error}`,
            })
        }
        log('Error', e.message);
        return ReE(res, e.message, 400);
    }
}
const transactionByOrderId = async function (req, res, next) {
    try {
        // if (!isDashboardUser(req)) {
        //     res.writeStatus("401");
        //     return ReS(res, {
        //         success: true, msg: 'Unauthorized request, incident has been reported'
        //     });
        // }
        // { order_ids : [  “order1”, “order2", “order3” ] }
        const orderIdArray = req?.body?.order_ids ?? [];
        if (orderIdArray.length > 0) {
            const { detailsArray, rows } = await Probe.getDetailsOrderId(orderIdArray);
            const probes = rows.reduce((agg, item) => {
                const { totalamount,
                    is_variable_liquidity_pool,
                    is_price_editable, probeid } = item;
                return {
                    ...agg,
                    [item.probeid]: {
                        id: probeid,
                        totalamount,
                        is_variable_liquidity_pool,
                        is_price_editable
                    }
                }
            }, {});
            let probesObj = Object.keys(probes).map(k => probes[k]);
            probesObj = await getCurrentPrice(probesObj, {}, 'public');
            const orderKeys = Object.keys(detailsArray);
            for (let i = 0; i < orderKeys.length; i++) {
                let orders = detailsArray[orderKeys[i]];
                for (let j = 0; j < orders.length; j++) {
                    let order = orders[j];
                    let price = probesObj.find(p => p.id === order.probeid);
                    orders[j] = {
                        ...price,
                        ...order,
                    }
                }
                detailsArray[orderKeys[i]] = orders;

            }
            return ReS(res, {
                detailsArray
            })
        }
        return ReE(res, 'Invalid Input');

    } catch (e) {
        next(e);
    }
}
const resultByProbeId = async function (req, res, next) {
    try {
        // if (!isDashboardUser(req)) {
        //     res.writeStatus("401");
        //     return ReS(res, {
        //         success: true, msg: 'Unauthorized request, incident has been reported'
        //     });
        // }
        // { order_ids : [  “order1”, “order2", “order3” ] }
        const probeId = Number(req?.body?.probeid);

        const resultForProbe = await Probe.resultByProbeId(probeId);
        return ReS(res, {
            resultForProbe
        })

    } catch (e) {
        next(e);
    }
}

module.exports.getProbes = getProbes;
module.exports.getProbesAll = getProbesAll;
module.exports.getTournaments = getTournaments;
module.exports.getLeaderboard = getLeaderboard;
module.exports.getMyBets = getMyBets;
module.exports.getMyBetsV2 = getMyBetsV2;
module.exports.getMyTournamentParticipations = getMyTournamentParticipations;
module.exports.getMyBetsCP = getMyBetsCP;
module.exports.create = create;
module.exports.createBulk = createBulk;
module.exports.update = update;
module.exports.getProbeCalls = getProbeCalls;
module.exports.getProbeCallsOpen = getProbeCallsOpen;
module.exports.fetchNews = fetchNews;
module.exports.deleteCallOpen = deleteCallOpen;
module.exports.getBonusLimit = getBonusLimit;
module.exports.getProbeStats = getProbeStats;
module.exports.addToTrendingEventList = addToTrendingEventList;
module.exports.removeFromTrendingEventList = removeFromTrendingEventList;
module.exports.updateTrendingEventRank = updateTrendingEventRank;
module.exports.searchProbes = searchProbes;
module.exports.getRequestsFromRapidAPIG = getRequestsFromRapidAPIG;
module.exports.updateNews = updateNews;
module.exports.getLiveStats = getLiveStats;
module.exports.getCrickeMatchesList = getCrickeMatchesList;
module.exports.forkPromiseForSettlement = forkPromiseForSettlement;
module.exports.getLastTradesInfo = getLastTradesInfo;
module.exports._calculateAveragePrice = _calculateAveragePrice;
module.exports.getUserLiquidityBets = getUserLiquidityBets;
module.exports.getMyBetsV3 = getMyBetsV3;
module.exports.getLeadership = getLeadership;
module.exports.addUserToPrivateEvent = addUserToPrivateEvent;
module.exports.getProbeIdFromDesc = getProbeIdFromDesc;
module.exports.getProbesMM = getProbesMM;
module.exports.getProbeCallsOpenMM = getProbeCallsOpenMM;
module.exports.addMMData = addMMData;
module.exports.getMMData = getMMData;
module.exports.updateMMData = updateMMData;
module.exports.convertEventToPrivate = convertEventToPrivate;
module.exports.convertEventToPublic = convertEventToPublic;
module.exports.haltProbes = haltProbes;
module.exports.unhaltProbes = unhaltProbes;
module.exports.createUserEvent = createUserEvent;
module.exports.getCommunityEvents = getCommunityEvents;
module.exports.approveCommunityEvent = approveCommunityEvent;
module.exports.transactionByOrderId = transactionByOrderId;
module.exports.resultByProbeId = resultByProbeId;
