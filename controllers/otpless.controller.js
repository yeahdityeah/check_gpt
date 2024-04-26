require('dotenv').config({})
const { Location } = require('../models');
const Otpless = require("../models/otpless");
const { sendWhatsappCustomMessage } = require("../services/notification.service");
const { encrypt, decrypt } = require("../services/steography.service");
const { redisCaching } = require('../services/cache.service');
const { promisify } = require('util');
const { ReE, ReS } = require("../services/util.service");
const https = require('https');

const lock = promisify(require('redis-lock')(redisCaching.client));

const log = (...args) => console.log('[OTPLESS]', ...args);
const { threadId } = require('worker_threads');
const CONFIG = require('../config/config');
const tradexPhoneNumber = '919311961062';

const generateSessionId = () => {
    let uid = Date.now();
    uid = uid + 1;
    return `s_${(uid).toString(32)}_${process.env.MACHINE_ID}_${threadId}`;
};

const generateEncodeKey = () => {
    let uid = Date.now();
    uid = uid + 1;
    return `en_${(uid).toString(32)}_${process.env.MACHINE_ID}_${threadId}`;
};

const verifyWhatsappWebhook = (req, res) => { 
    try {
        console.log(req.query)
        if(req?.query?.['hub.verify_token'] === 'TOKEN') {
            const val = req?.query?.['hub.challenge'] ?? 'unknown';
            return res.end(val);
        }
        return res.end("FAILED VERIFICATION");
    } catch(e) {
        log(e.message);
        return ReE(res, e.message);
    }

}

const whatsappIncomingMessageWebhook = async (req, res) => { 
    let msg;
    try {
        // if(process.env.NODE_ENV === 'production') {
        //     log('Body', JSON.stringify(req.body,null,4));
        //     return ReS(res, { });
        // }
        
        
        const metadata = req?.body?.data?.message ?? req?.body?.message;
        const encoded = metadata?.message_content?.text;
        log('Message received with text as', encoded);
        const uid = decrypt(encoded);        
        
        const session = await Otpless.getSessionByUid(uid);
        if(!session) {
            log(msg);
            return ReE(res, 'Could not find session of message', 200);
        }
        const message_received_at = new Date().toISOString();
        const status = 'MESSAGE_RECEIVED';
        await Otpless.updateSession(session.session_id, {metadata, message_received_at, status});

        let phone_number;
        if (metadata && metadata.phone_number && metadata.countryCode) {
            phone_number = metadata.phone_number.substring(metadata.countryCode.length);
        }
        const url_prefix = (process.env.NODE_ENV !== 'production') ? 'https://testweb.getpredx.com' : 'https://web.tradexapp.co';
        let url = `${url_prefix}?session_id=${session.session_id}`;
        if (session.platform !== 'web'){
            const deeplink = await getShareLinkOtp(url, session.session_id);
            url = deeplink ? deeplink : url;
        }

        log(`Sending message to ${phone_number} of  country  ${metadata?.countryCode}`)
        sendWhatsappCustomMessage('OTPLESSLOGIN', phone_number, metadata?.userName ?? 'otplessUser', '', 
                                [url], metadata?.countryCode);
        return ReS(res, { });
    } catch(e) {
        log(e.message);
        return ReE(res, e.message, 200);
    }

}

const getSessionStatus = async (req, res) => {
    try {
        const session_id = req?.params?.session;
        const session = await Otpless.getSessionById(session_id);
        return ReS(res, session)
    } catch(e) {
        log(e);
        return ReE(res, 'Invalid session', 500)
    }
}

const startOtplessSession = async (req, res) => {
    try {

        const platform = req?.headers['x-platform'];
        const version = req?.headers['version'];
        const session_id = generateSessionId();
        const uid = generateEncodeKey();
        const message = {
            text: 'Hi there, help me login'
        };
        const service = 'whatsapp';
        const encoded = encrypt(message.text, uid);        
        const status = 'START';
        log(encoded, uid, message.text);
        await Otpless.insertSession({
            platform,
            version,
            session_id,
            uid,
            message,
            service,
            status
        });
        return ReS(res, {
            sid: session_id,
            encoded,
            link: `https://wa.me/${tradexPhoneNumber}?text=${encoded}`
        })

    } catch(e) {
        log(e);
        return ReE(res, 'Internal server error', 500);
    }
}

const approveSessionId = async (req, res, next) => {
    let unlock;
    try {

        const sessionId = req?.body?.sid;
        unlock = await lock(`approve_${sessionId}`, 60000);
        const session = await Otpless.validateSession(sessionId);
        if(!session) {
            log('Cannot find valid session with id', sessionId)
            unlock();
            return ReE(res, 'Invalid session', 400);
        }
        const countryCode = session?.metadata?.countryCode;
        const mobile = (session?.metadata?.phone_number ?? '').replace(countryCode, '');
        if(!mobile || !countryCode) {
            log('Cannot find mobile or country code to sign in user');
            return ReE(res, 'Invalid session', 400); 
        }
        req.body.mobile = mobile;
        req.body.country_code = `+${countryCode}`;
        const status = 'APPROVED';
        req.body.status = status;
        const message_acknowledged_at = new Date().toISOString();
        await Otpless.updateSession(session.session_id, { message_acknowledged_at, status });
        unlock();
        return next();
    } catch(e) {
        unlock();
        log(e);
        return ReE(res, e.message, 500);
    }
}

const getShareLinkOtp = async (url , title) => {
    return new Promise((resolve, reject) => {
        var postData = JSON.stringify({
            "dynamicLinkInfo": {
                "domainUriPrefix": "https://pages.tradexapp.co",
                "link": url,
                "androidInfo": {
                    "androidPackageName": "com.theox",
                    "androidFallbackLink": (process.env.NODE_ENV !== 'production') ? 'https://testweb.getpredx.com' : 'https://web.tradexapp.co',
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



module.exports.whatsappIncomingMessageWebhook = whatsappIncomingMessageWebhook;
module.exports.verifyWhatsappWebhook = verifyWhatsappWebhook;
module.exports.startOtplessSession = startOtplessSession;
module.exports.getSessionStatus = getSessionStatus;
module.exports.approveSessionId = approveSessionId