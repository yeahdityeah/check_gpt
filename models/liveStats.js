const fs = require('fs');
const path = require('path');
const { to, waitTimer } = require('../services/util.service');
const { redisCaching } = require('../services/cache.service');
const { getProbeById } = require('../models/probe');
const axios = require('axios');
const { LiveStatsService } = require('../services/liveStats.service');
const { outcomeEventYoutubeTwitter } = require('../models/autoSettle');
const logger = require('../services/logger.service');

const GmtToIst = (dateString) => {
    const d = new Date(dateString);
    d.setHours(d.getHours() + 5);
    d.setMinutes(d.getMinutes() + 30);
    const date_IST = new Date(d).toDateString();

    const time_IST = new Date(d).toLocaleTimeString();

    return `${date_IST} ${time_IST}`;
}

const sourcAPI = {
    youtube_doc: 'https://developers.google.com/youtube/v3/docs/videos/list?apix_params=%7B%22part%22%3A%5B%22statistics%22%5D%2C%22id%22%3A%5B%22hcMzwMrr1tE%22%5D%7D#http-request',
    crypto_doc: 'https://docs.coindcx.com/?javascript#candles',
    twitter_doc: 'https://developer.twitter.com/en/docs/twitter-api/metrics'
}

const liveStats = {
    create: async function (dataObj) {
        try {
            if (!dataObj.live_stats_type || dataObj.live_stats_type === ' ') {
                return null;
            }
            let err, res;
            if (dataObj.live_stats_type === 'Youtube') {
                [err, res] = await to(this.createYoutubeStats(dataObj));
                if (err) throw err;
            }
            else if (dataObj.live_stats_type === 'Bitcoin' || dataObj.live_stats_type === 'Ethereum') {
                [err, res] = await to(this.createCryptoStats(dataObj));
                if (err) throw err;
            }
            else if (dataObj.live_stats_type === 'Twitter') {
                [err, res] = await to(this.createTwitterStats(dataObj));
                if (err) throw err;
            }
            else if (dataObj.live_stats_type === 'Cricket') {
                [err, res] = await to(this.createCricketStats(dataObj));
                if (err) throw err;
            }
            return res;
        } catch (err) {
            throw err;
        }
    },

    createYoutubeStats: async function (dataObj) {
        try {
            let err, res;
            [err, res] = await to(LiveStatsService.youtubeStats(dataObj.link));
            if (err) logger.error(`Youtube-live-stats-${dataObj.probeId} - Error occured while fetching data from youtube live stats API`);
            if (!res) return [];
            logger.info(`youtube-live-stats-${dataObj.probeId} res-${JSON.stringify(res.data.items)}`);
            let counts = res.data.items;
            if (counts.length < 1) return [];
            counts = counts[0].statistics;
            let date_time = res.headers.date;
            date_time = GmtToIst(date_time);
            let count = 0;
            const param = dataObj.live_stats_para;
            switch (param) {
                case '#Comments':
                    count = parseInt(counts.commentCount);
                    break;
                case '#Likes':
                    count = parseInt(counts.likeCount);
                    break;
                case '#Views':
                    count = parseInt(counts.viewCount);
                    break;
                default:
                    break;
            }
            let cachedProbeObj = [];
            const obj = { probeId: dataObj.probeId, title: '', props: param, count: count, timestamp: date_time, source: sourcAPI.youtube_doc };
            cachedProbeObj.push(obj);
            await redisCaching.delHMKey(dataObj.probeId, 'eventLiveStatsYT');
            await redisCaching.setHMKey(dataObj.probeId, 'eventLiveStatsYT', JSON.stringify(cachedProbeObj));
            return cachedProbeObj;
        } catch (err) {
            throw err;
        }
    },

    createCricketStats: async function (dataObj) {
        try {
            let err, res, obj;
            let matchId = dataObj.live_stats_para;
            matchId = parseInt(matchId.split(' -')[0]);
            [err, res] = await to(LiveStatsService.cricketStats(matchId));
            if (err) throw err;

            let scoreCard, date_time, score, param;
            let _live = res.data.results.live_details;

            let cachedProbeObj = [];
            date_time = res.headers.date;
            date_time = GmtToIst(date_time);

            if (!_live) {
                res = dataObj.live_stats_para.split('- ')[1];
                obj = { probeId: dataObj.probeId, title: '', props: res, count: `Match yet to start`, timestamp: date_time, source: sourcAPI.crypto_doc }
                cachedProbeObj.push(obj);
            }
            else {
                scoreCard = res.data.results.live_details.scorecard;

                param = scoreCard[0].title;
                param = param.split(' Innings')[0];
                score = `${scoreCard[0].runs}-${scoreCard[0].wickets} (${scoreCard[0].overs})`
                obj = { probeId: dataObj.probeId, title: '', props: param, count: score, timestamp: date_time, source: sourcAPI.crypto_doc }
                cachedProbeObj.push(obj);

                if (scoreCard.length > 1) {
                    param = scoreCard[1].title;
                    param = param.split(' Innings')[0];
                    score = `${scoreCard[1].runs}-${scoreCard[1].wickets} (${scoreCard[1].overs})`
                    obj = { probeId: dataObj.probeId, title: '', props: param, count: score, timestamp: date_time, source: sourcAPI.crypto_doc }
                    cachedProbeObj.push(obj);
                }
            }


            await redisCaching.delHMKey(dataObj.probeId, 'eventLiveStatsCricket');
            await redisCaching.setHMKey(dataObj.probeId, 'eventLiveStatsCricket', JSON.stringify(cachedProbeObj));
            return cachedProbeObj;
        } catch (err) {
            throw err;
        }
    },

    createCryptoStats: async function (dataObj) {
        let err, res;
        [err, res] = await to(LiveStatsService.CryptoStats(dataObj));
        if (err) throw err;

        let last_calndle = res.data;
        last_calndle = last_calndle[0];

        let date_time = res.headers.date;
        date_time = GmtToIst(date_time);
        let count = 0.0;
        const param = dataObj.live_stats_para;
        switch (param) {
            case '5-minute high price (in INR)':
                count = last_calndle.high;
                break;
            case '5-minute low price (in INR)':
                count = last_calndle.low;
                break;
            case 'Current price (in INR)':
                count = last_calndle.close;
                break;
            default:
                break;
        }
        let cachedProbeObj = [];
        const obj = { probeId: dataObj.probeId, title: dataObj.live_stats_type, props: param, count: count, timestamp: date_time, source: sourcAPI.crypto_doc };
        cachedProbeObj.push(obj);
        await redisCaching.delHMKey(dataObj.probeId, 'eventLiveStatsCrypto');
        await redisCaching.setHMKey(dataObj.probeId, 'eventLiveStatsCrypto', JSON.stringify(cachedProbeObj));
        return cachedProbeObj;
    },

    createTwitterStats: async function (dataObj) {
        let err, res;
        let link = dataObj.link;
        link = link.split('/');
        dataObj['id'] = link[link.length - 1];
        [err, res] = await to(LiveStatsService.TwitterStats(dataObj));
        if (err) throw err;

        let _data = res.data.data;
        _data = _data[0];
        _data = _data.public_metrics;

        let date_time = res.headers.date;
        date_time = GmtToIst(date_time);
        let count = 0;
        const param = dataObj.live_stats_para;
        switch (param) {
            case '#Retweets':
                count = _data.retweet_count;
                break;
            case '#Likes':
                count = _data.like_count;
                break;
            case '#Quote-Tweets':
                count = _data.quote_count;
                break;
            default:
                break;
        }
        let cachedProbeObj = [];
        const obj = { probeId: dataObj.probeId, title: '', props: `${param}`, count: count, timestamp: date_time, source: sourcAPI.twitter_doc };
        cachedProbeObj.push(obj);
        await redisCaching.delHMKey(dataObj.probeId, 'eventLiveStatsTwitter');
        await redisCaching.setHMKey(dataObj.probeId, 'eventLiveStatsTwitter', JSON.stringify(cachedProbeObj));
        return cachedProbeObj;
    },

    getLiveStats: async function (probeId) {

        try {
            const probeExistsInCacheYT = await redisCaching.doesKeyExistinHM(probeId, 'eventLiveStatsYT');
            const probeExistsInCacheCrpto = await redisCaching.doesKeyExistinHM(probeId, 'eventLiveStatsCrypto');
            const probeExistsInCacheTwitter = await redisCaching.doesKeyExistinHM(probeId, 'eventLiveStatsTwitter');
            const probeExistsInCacheCricket = await redisCaching.doesKeyExistinHM(probeId, 'eventLiveStatsCricket');

            let res, er, rs;
            let cachedProbeObj;
            if (probeExistsInCacheYT) {
                cachedProbeObj = await redisCaching.getHMKey(probeId, 'eventLiveStatsYT');
                res = JSON.parse(cachedProbeObj);
            } else if (probeExistsInCacheCrpto) {
                cachedProbeObj = await redisCaching.getHMKey(probeId, 'eventLiveStatsCrypto');
                res = JSON.parse(cachedProbeObj);
            } else if (probeExistsInCacheTwitter) {
                cachedProbeObj = await redisCaching.getHMKey(probeId, 'eventLiveStatsTwitter');
                res = JSON.parse(cachedProbeObj);
            } else if (probeExistsInCacheCricket) {
                cachedProbeObj = await redisCaching.getHMKey(probeId, 'eventLiveStatsCricket');
                res = JSON.parse(cachedProbeObj);
            }
            else {
                [er, rs] = await to(getProbeById(probeId, ['live_stats_type', 'live_stats_props', 'source'], true));
                if (er) {
                    throw er;
                }
                if (rs.live_stats_type && rs.live_stats_type !== ' ') {
                    const dataObj = {
                        probeId: probeId,
                        link: rs.source,
                        live_stats_type: rs.live_stats_type,
                        live_stats_para: rs.live_stats_props
                    }
                    await waitTimer(10);
                    [er, res] = await to(this.create(dataObj));
                    if (er) {
                        throw er
                    };
                }
            }
            return res;
        } catch (err) {
            throw err;
        }

    },

    updateLiveStats: async function (props) {
        try {
            logger.info(`live-stats updating live stats for ${props}`);
            const liveStatsList = await redisCaching.getCompleteList(`eventLiveStats${props}`);
            if (liveStatsList.length > 0) {
                let probeId = 0;
                let _data;
                for (let i = 0; i < liveStatsList.length; i++) {
                    const __data = liveStatsList[i];
                    _data = JSON.parse(__data);
                    probeId = parseInt(_data[0]['probeId']);
                    if (probeId) {
                        await redisCaching.delHMKey(probeId, `eventLiveStats${props}`);
                        let [er, res] = await to(this.getLiveStats(probeId));
                        if (er) logger.error(`Error while updating live stats for event - ${probeId}`);

                        if (props === 'YT' || props === 'Twitter') {
                            if (props === 'YT') logger.info(`youtube-live-stats-${probeId} Updated stats - ${JSON.stringify(res)}`);

                            // Write data in file
                            const _path = path.join(__dirname, '../live_stats_data', `${probeId}` + '.json');
                            let data = [];

                            if (fs.existsSync(_path)) {
                                data = fs.readFileSync(_path);
                                data = JSON.parse(data);
                                data.push(res[0]);
                            } else {
                                data.push(res[0]);
                            }
                            const serializedData = JSON.stringify(data, null, 2);
                            try {
                                fs.writeFileSync(_path, serializedData);
                            } catch (err) {
                                throw err;
                            }
                            // Used for Auto settlement
                            //await outcomeEventYoutubeTwitter(res[0], props);

                        }
                    }
                    //waitTimer(10);
                }
            }
            return res;

        } catch (err) {
            throw err;
        }
    }



}

module.exports = liveStats;
