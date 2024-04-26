const { to, waitTimer } = require('../services/util.service');
const { redisCaching } = require('../services/cache.service');
const { getProbeById, update } = require('../models/probe');
const logger = require('../services/logger.service');

const IstToUtc = (dateString) => {
    //dateString = dateString.replace(/'/g, '');
    const d = new Date(dateString);
    d.setHours(d.getHours() + 5);
    d.setMinutes(d.getMinutes() + 30);
    //return `'${d.toISOString()}'`;
    return d;
}

const autoSettle = {
    outcomeEventYoutubeTwitter: async function (dataObj, eventType) {
        try {
            const probeid = dataObj.probeId;
            const currentCount = dataObj.count;
            let currentDateTime, closeTime;
            let [err, res] = await to(getProbeById(probeid, ['settle_threshold', 'auto_settle', 'endsat']));
            if (err) {
                throw err;
            }
            if (res.auto_settle === false) return;
            closeTime = res.endsat;
            // UTC time
            currentDateTime = new Date();
            //console.log(`currenct time = ${currentDateTime} close time = ${closeTime}`);
            //console.log(`current count = ${currentCount} threshold = ${res.settle_threshold}`);



            if (currentCount >= res.settle_threshold) {
                //console.log('current count has crossed threshold');

                await redisCaching.delHMKey(probeid, `eventLiveStats${eventType}`);
                const data = {
                    'id': probeid,
                    'status': 'F',
                    'correctvalue': 'Y',
                    'live_stats_type': ' '
                }
                //waitTimer(10);
                let [err, _probeRows] = await to(update(data));
                if (err) throw err;
            } else {
                //console.log('current count is still less than threshold');
                if (currentDateTime >= closeTime) {
                    //console.log('We have reached close time');
                    await redisCaching.delHMKey(probeid, `eventLiveStats${eventType}`);
                    let outcome = 'N';
                    if (currentCount >= res.settle_threshold) outcome = 'Y';
                    const data = {
                        'id': probeid,
                        'status': 'F',
                        'correctvalue': outcome,
                        'live_stats_type': ' '
                    }
                    let [err, _probeRows] = await to(update(data));
                    if (err) throw err;
                } else {
                    //console.log('close time is far abhi');
                }
            }


        } catch (err) {
            throw err;
        }
    }



}

module.exports = autoSettle;
