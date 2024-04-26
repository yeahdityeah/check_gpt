const{ ReE, to, ReS, waitTimer } = require( '../services/util.service' );
const{ messages } = require( '../messages/messages' );
const logger = require( '../services/logger.service' );
const{ Partner, User } = require( '../models' );
const crypto = require( 'crypto' );
const{ threadId } = require( 'worker_threads' );
const CONFIG = require( '../config/config' );
const {RegionService} = require("../services/region");

const generateRandomStr = () => {
    let uid = Date.now();
    uid = uid + 1;
    return`rs_${( uid ).toString( 32 )}_${process.env.MACHINE_ID}_${threadId}`;
};

const getAuthPublicKey = async function( req, res, next ) {
    // The `generateKeyPairSync` method accepts two arguments:
    // 1. The type ok keys we want, which in this case is "rsa"
    // 2. An object with the properties of the key
    const{ publicKey, privateKey } = await (new Promise((resolve, reject) => {
        crypto.generateKeyPair('rsa', {
            // The standard secure default length for RSA keys is 2048 bits
            modulusLength: 2048,
            publicKeyEncoding: {
                type: 'spki',
                format: 'pem'
            },
            privateKeyEncoding: {
                type: 'pkcs1',
                format: 'pem'
            }
        }, (err, publicKey, privateKey) => {
            if(err) {
                return reject(err);
            }
            return resolve({
                publicKey, privateKey
            })
        });
    }));

    let testObj = {
        partner_id: req?.query?.partner || 3,
        partner_user_id: req?.query?.user || 4,
        device_id: req?.query?.device ?? 'B692A37B-41E1-55CD-8314-A6063FFB290A'
    };
    const data = JSON.stringify( testObj );
    const encrypted = crypto.publicEncrypt({
        key: publicKey
    }, Buffer.from( data ) );
    console.log( encrypted.toString( 'base64' ) );

    

    // const decrypted = crypto.privateDecrypt({
    //     key: privateKey
    // }, Buffer.from( encrypted ) );
    // console.log( decrypted.toString( 'utf8' ) );

    let authKey = generateRandomStr();
    let testQueryParams = `payload=${encodeURIComponent(encrypted.toString( 'base64' ))}&auth_key=${encodeURIComponent(authKey)}`;    
    let testUrls;
    if(process.env.NODE_ENV !==  'production' || req?.query?.user  === 'khanna.sid2009@gmail.com') {
        const partners = await Partner.getActivePartners();
        const partner = partners.find( i => i.id === req?.query?.partner);
        testUrls = {
            dev: ['https://devweb.getpredx.com/Home', testQueryParams].join('?'),
            devusp: ['https://devusp.theox.co/Home', testQueryParams].join('?'),
            staging:  ['https://testweb.getpredx.com/Home', testQueryParams].join('?'),
            local: ['http://localhost:19006/Home', testQueryParams].join('?'),
            metaone: ['https://metaone.tradexapp.co/Home', testQueryParams].join('?'),
        }
        if(partner) {
            testUrls = {
                url: [`https://${partner.host}/Home`, testQueryParams].join('?'),
            }
        }
    }
    
    let dataObj = {
        public_key: publicKey,
        private_key: privateKey,
        auth_key: authKey
    };
    let id = await Partner.insertPartnerAuth( dataObj, false );
    logger.info( `Partner auth inserted returning id: ${id}` );

    return ReS( res, {
        success: true,
        public_key: publicKey,
        auth_key: authKey,
        testUrls,
        encrypted: process.env.NODE_ENV !== 'production' ? encrypted.toString( 'base64' ) : undefined,
    });
};

const validatePartnerPayload = async function( req, res, next ) {
    console.log( `validatePartnerPayload: start` );
    const payload = req.body.payload;
    const authKey = req.body.auth_key;
    console.log( `validatePartnerPayload: payload: ${payload}. authKey: ${authKey} ` );
    const timer = `Decrypt Read Key ${new Date().valueOf()}`;
    console.time(timer);
    let partnerAuth = await Partner.getPartnerAuth( authKey, true );
    console.timeEnd(timer);
    
    if( partnerAuth && partnerAuth.length === 0 ) {
        return ReE( res, messages.PARTNER_AUTH_NOT_FOUND, 400 );
    }
    if( partnerAuth.length > 1 ) {
        return ReE( res, messages.PARTNER_INVALID_AUTH_COUNT, 400 );
    }

    let privateKey = partnerAuth[0].private_key;
    console.log( `validatePartnerPayload: privateKey: ${privateKey}` );

    let payloadStr = '';
    const timerDecrypt = `Decrypt Key ${new Date().valueOf()}`;
    console.time(timerDecrypt);
    try {
        let d = Buffer.from( payload, 'base64' );
        const payloadDecrypt = crypto.privateDecrypt({
            key: privateKey,
            // padding: crypto.constants.RSA_NO_PADDING
            // padding: crypto.constants.RSA_PKCS1_PADDING
        }, d );
        payloadStr = payloadDecrypt.toString( 'utf8' );
        console.log( payloadStr );
        console.log( `validatePartnerPayload: payloadStr: ${payloadStr}` );
    } catch( err ) {
        logger.error( `validatePartnerPayload: error decryption `, err );
        try {
            let d = Buffer.from( payload, 'base64' );
            const payloadDecrypt = crypto.privateDecrypt({
                key: privateKey,
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
    console.timeEnd(timerDecrypt);

    let payloadObj = JSON.parse( payloadStr );
    let partnerId = payloadObj.partner_id;
    let partnerUserId = payloadObj.partner_user_id;
    let partnerDeviceID = payloadObj.device_id;

    console.log( `validatePartnerPayload: partnerId: ${partnerId}` );
    console.log( `validatePartnerPayload: partnerUserId: ${partnerUserId}` );

    if( !partnerId || !partnerUserId ) {
        return ReE( res, messages.PARTNER_INVALID_PAYLOAD, 400 );
    }

    let partners = await Partner.findById( partnerId, true );
    if( !partners || partners === null) {
        return ReE( res, messages.PARTNER_NOT_EXIST, 400 );
    }
    let updated = await Partner.updatePartnerAuth( partnerId, partnerUserId, authKey );
    req.headers['x-partner-id'] = partnerId;
    req.body.signup_country = req.headers['country'] || RegionService.getCountry(req.headers['x-forwarded-for']);
    req.body.email = partnerUserId;
    req.body.device_id = partnerDeviceID;
    req.partnerId = payloadObj.partner_id;
    delete req.body.payload;
    delete req.body.auth_key;
    next();

};

const tryDecrypt = (payload, key, partner) => {
    let payloadStr = false;
    try {
        let d = new Buffer( payload, 'base64' );
        const payloadDecrypt = crypto.privateDecrypt({
            key,
        }, Buffer.from( d ) );
        payloadStr = payloadDecrypt.toString( 'utf8' );
        console.log( partner, payloadStr );
        console.log( `validatePartnerPayload: payloadStr: ${payloadStr}` );
    } catch( err ) {
        console.log( `validatePartnerPayload: error decryption `, err );
        try {
            let d = Buffer.from( payload, 'base64' );
            const payloadDecrypt = crypto.privateDecrypt({
                key,
                // padding: crypto.constants.RSA_NO_PADDING
                padding: crypto.constants.RSA_PKCS1_PADDING
            }, d );
            payloadStr = payloadDecrypt.toString( 'utf8' );
            console.log( payloadStr );
            console.log( `validatePartnerPayload: payloadStr: ${payloadStr}` );
        } catch( err ) {
            console.log( `validatePartnerPayload: error decryption `, err );
        }
    }
    return payloadStr;
}

const getTempAuthToken = async function( req, res, next ) {

    // let testObj = {
    //     partner_id: 6,
    //     partner_user_id: '1',
    //     amount: 10
    // };
    // const data = JSON.stringify( testObj );
    // const encrypted = crypto.publicEncrypt({
    //     key: CONFIG.PARTNER_METAONE_PUBLIC_KEY
    // }, Buffer.from( data ) );
    // console.log( encrypted.toString( 'base64' ) );

    const payload = req.body.payload;
    let payloadStr = '';
    const partners = ['METAONE', 'MYMASTER11'];
    for(let i=0; i<partners.length; i++) {
        const key = `PARTNER_${partners[i]}_PRIVATE_KEY`;
        if(CONFIG[key]) {
            console.log('TRY DECRYPT WITH ', key);
            payloadStr = tryDecrypt(payload, CONFIG[key]);
            if(!payloadStr) {
                continue;
            }
            break;
        } 
    }
    if(!payloadStr) {
        console.log( `validatePartnerPayload: error decryption`);
        return ReE( res, messages.PARTNER_PRIVATE_KEY_MISMATCH, 400 );
    }
    

    let payloadObj = JSON.parse( payloadStr );

    let partnerId = payloadObj.partner_id;
    let partnerUserId = payloadObj.partner_user_id;
    let whereCond = { email: partnerUserId, partner: partnerId };
    let[ userErr, _userRows ] = await to( User.get( 'users', whereCond ) );
    if( userErr ) throw userErr;

    if( _userRows.length === 0 ) {
        return ReE( res, messages.PARTNER_USER_ERROR, 400 );
    }
    let userId = _userRows[0].id;

    let[ jwtErr, jwt ] = await to( User.getTempJWT( userId ) );
    if( jwtErr ) throw jwtErr;

    return ReS( res, {
        success: true,
        auth_token: jwt
    });
};



module.exports.getAuthPublicKey = getAuthPublicKey;
module.exports.validatePartnerPayload = validatePartnerPayload;
module.exports.getTempAuthToken = getTempAuthToken;
