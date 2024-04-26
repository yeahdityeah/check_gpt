const { to, ReE, ReS, waitTimer } = require('../services/util.service');
const CONFIG = require('../config/config');
const logger = require('../services/logger.service');
const https = require('https');
const { ClubEvents, User, Transactions, Club } = require('../models');
const { calculateTradingFee } = require('../utils/tradingfee.util.js');
const knex = require('../knex/knex.js');
const { isDashboardUser } = require('../middleware/dashboard.user');
const { handleNotification } = require('../services/notification.service');
const TdsUsers = require('../models/tdsUsers');
const {messages} = require("../messages/messages");

const generateError = (title, subtitle) => ({
    success: false,
    error: title,
    status: "failed",
    message: subtitle,
})

const createClubEvent = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        // if (!isDashboardUser(req)) {
        //     res.status(401);
        //     return ReS(res, {
        //         success: true, msg: 'Unauthorized request, incident has been reported'
        //     });
        // }
        // const generateError = (title, subtitle) => ({
        //     success: false,
        //     error: title,
        //     status: "failed",
        //     message: subtitle,
        // })
        return ReS(res, generateError(
            'Cannot Create Event',
            'This feature is not available currently.'
        ));
        let userId;
        if (req.user && req.user.id && req.user.id != -1) {
            userId = req.user.id;
            
        }
        const isUserBlocked = await User.isUserBlocked(userId);
        if (isUserBlocked) {
            return ReE(res, messages.USER_BLOCKED, 500);
        }

        const dashboardUser = isDashboardUser(req)
        const clubId = req.params.clubId;
        var err, _optionIds, _eventIds;
        let data = Object.assign({}, req.body);
        data['status'] = 'A';
        const options = req.body.options;
        delete data['options'];
        let defaults = {
            "created_by": userId,
            "max_pool_size": 100000,
            "max_particicpants": 100,
            "min_bet": 10,
            "max_bet": 1000,
            "default_amount": 10,
            "max_cummulative_bet": 2000,
            "tooltip": "tooltip",
            "owner_commission": 0.5,
        }
        data = {
            ...defaults,
            ...data
        }
        if(!data?.image_url) {
            if(data?.category) {
                let host;
                switch(true) {
                    case process.env.NODE_ENV === 'development':
                        host = 'https://devapi.theox.co';
                        break;
                    case process.env.NODE_ENV === 'staging':
                        host = 'https://testapi.theox.co';
                        break;
                    case process.env.NODE_ENV === 'production':
                        host = 'https://api.tradexapp.co';
                        break;
                    default: 
                        host = 'http://localhost:4000';
                        break;
                }
                const prefix = `${host}/v2/assets/icons/club`;
                const images = [
                    'finance.svg', 
                    'media.svg', 
                    'news.svg', 
                    'politics.svg', 
                    'sports.svg'
                ]
                const image = images.find( i => new RegExp(data?.category, 'gi').test(i.toLowerCase()))
                if(image) {
                    data['image_url'] = `${prefix}/${image}`
                }
            }
        }

        /**
         * Validations
         */
        
        if(!options || !Array.isArray(options)) {
            res.writeStatus("400");
            return ReS(res, generateError(
                'Invalid Request',
                'Poll options are not in correct format'
            ));
        }
        if(Array.isArray(options) && options.length < 2) {
            res.writeStatus("400");
            return ReS(res, generateError(
                'Invalid Request',
                'Minimum two poll options are required'
            ));
        }
        if(Array.isArray(options) && options.length > 4) {
            res.writeStatus("400");
            return ReS(res, generateError(
                'Invalid Request',
                'Maximum four poll options are allowed '
            ));
        }
        function containsDuplicates(array) {
            const result = array.find(element => {
                const items = array.filter( i => 
                    String(i).toLowerCase().trim() ===  String(element).toLowerCase().trim()
                )
                console.log(items, element)
                if(items.length > 1) {
                    return true
                }
                return false
            });
            return result;
        }
        const duplicateElement = containsDuplicates(options)
        console.log(duplicateElement)
        if(duplicateElement) {
            res.writeStatus("400");
            return ReS(res, generateError(
                'Invalid Request',
                `Duplicate entry in options for ${duplicateElement}`
            ));
        }


        
        if(!data?.description) {
            data.description = data?.title
        }
        data['shareable_url'] = '';
        [err, _eventIds] = await to(ClubEvents.create(data));
        if (err) throw err;
        const optionsData = options.map((option, index) => {
            return {
                'club_id': data['club_id'],
                'event_id': _eventIds[0],
                'label': option,
                'rank': index+1
            }
        });
        if (optionsData.length > 0) {
            [err, _optionIds] = await to(ClubEvents.createEventOptions(optionsData));
            if (err) throw err;
        }
        let sharelink
        try {
            sharelink = await getClubEventShareLink(clubId, _eventIds[0], data['title']);
            const dataToUpdate = { 'id': _eventIds[0], 'shareable_url': sharelink };
            await to(ClubEvents.update(dataToUpdate));
            await handleNotification({'club_id' : data['club_id'], 'shareable_url' : sharelink}, "new event social club");
        } catch (e) {
            logger.error('Cannot create dynamic link for event')
            logger.error(e)
        }

        return ReS(res, {
            success: true, eventId: _eventIds[0], 
            successTitle: 'Event Created Successfully',
            successSubtitle: 'Your event has been created successully and will begin as per your instructions',
            sharelink,
        });
    } catch (error) {
        // res.statusCode = 500;
        console.log("CLUB EVENT CREATION ERROR", 
            error.message, error.detail, error.hint)
        // return res.json({
        //     success: false,
        //     error: 'Internal Server Error Request',
        //     message: 'Contact support to create the event',
        // })
        next(error);
    }
};

const updateClubEvent = async function (req, res, next) {
    // if (!isDashboardUser(req)) {
    //     res.status(401);
    //     return ReS(res, {
    //         success: true, msg: 'Unauthorized request, incident has been reported'
    //     });
    // }
    let userId;
    if (req.user && req.user.id && req.user.id != -1) {
        userId = req.user.id;
    }

    const isUserBlocked = await User.isUserBlocked(userId);
    if (isUserBlocked) {
        return ReE(res, messages.USER_BLOCKED, 500);
    }

    const dashboardUser = isDashboardUser(req)
    // res.setHeader('Content-Type', 'application/json');
    const log = (...args) => {
        console.log(`[Club Event Update ${req?.body?.id ?? 'NO ID FOUND'}]`, ...args)
    }
    const t1 = Date.now();
    try {
        let data = req.body;
        log(`Updating club event id ${data?.id}`)
        log('Request Data', JSON.stringify(data))
        if(isNaN(parseInt(data?.id))) {
            throw new Error('You need to pass event ID for update')
        }
        const [err, currentEvent] = await to(ClubEvents.getClubEventById(data?.id));
        if(err) throw err;
        if(!currentEvent) throw new Error(`Unable to find event ${data?.id}`)

        // Delete Fields from data which cannot be updated
        delete data.club_id;
        delete data.created_at;
        
        let transactions = [];
        let removeTransactions = [];
        let updatedTransactions = [];
        let isValidOption = false

        const appendTradingFee = async (t) => {
            for(let i=0; i<t.length; i++) {
                const item = t[i];
                let params = {
                    userAction: 'Club Settlement',
                    noOfContracts: 1,
                    eventId: data?.id,
                    userId: item.userId,
                    isMarketOrder: true,
                    eventType:'IM',
                    buyPrice: item.coins,
                    sellPrice: item.amount
                }
                t[i]['surcharge'] = await calculateTradingFee(params)
                t[i].message = `${t[i].message}${t[i].coins}`
                delete t[i].coins
            }
            return t;
        }

        let isSettlement = false;
        switch(true) {
            case currentEvent.status === 'A' && data.status === 'C':
                
                isValidOption = await ClubEvents.checkOption(data.id, data.correct_value)
                if(!isValidOption) {
                    res.writeStatus("400");
                    return ReS(res, generateError(
                        'Invalid Request',
                        `Option ${data.correct_value} and event ${data.id} does not match` 
                    ));
                    // throw new Error(`Option ${data.correct_value} and event ${data.id} does not match`)
                }
                
                // const highestOptionId = eventDetails.options.sort((a,b) => 
                //     a.poll_percent > b.poll_percent  ? -1 : 1
                // )[0].id;
                // console.log(highestOptionId, data.correct_value)
                // if(highestOptionId !== data.correct_value && !dashboardUser) {
                //     res.writeStatus("400");
                //     return ReS(res, {...generateError(
                //         'Contact your Relationship Manager',
                //         `To settle this event you need to contact your relationship manager` 
                //     ), contactRelationshipManager: true});
                // }
                log(`Settling club event id ${data?.id} with option id as ${data?.correct_value}`)
                transactions = await ClubEvents.settleEvent(data.id, data.correct_value)
                transactions = await appendTradingFee(transactions)
                isSettlement = true;
                break;
            case currentEvent.status === 'A' && data.status === 'CAN':
                transactions = await ClubEvents.cancelEvent(data.id)
                break;
            case currentEvent.status === 'C' && data.status === 'RST':
                // removeTransactions = await ClubEvents.resetEvent(data.id)
                transactions = await ClubEvents.resetEvent(data.id)
                break;        
            case currentEvent.status === 'RST' && data.status === 'C':
                // throw new Error('Reset to Complete not implemented')
                isValidOption = await ClubEvents.checkOption(data.id, data.correct_value)
                if(!isValidOption) {
                    throw new Error(`Option ${data.correct_value} and event ${data.id} does not match`)
                }
                log(`Settling club event id ${data?.id} with option id as ${data?.correct_value}`)
                transactions = await ClubEvents.settleEvent(data.id, data.correct_value)
                transactions = await appendTradingFee(transactions)
                isSettlement = true;
                break;
            case currentEvent.status === 'A' && data.status === 'F':
            case currentEvent.status === 'A' && data.status === 'I':    
                break;
            case data?.status && currentEvent.status !== data?.status:
                throw new Error(`Invalid status update from ${currentEvent?.status} to ${data.status}`)   
            case currentEvent.status === 'C' && data.status === 'C':
            case currentEvent.status === 'CAN' && data.status === 'CAN':  
                throw new Error(`Cannot update event in status ${currentEvent.status}`)
                break;
            default:
                break;  
        }

        let clubEvent, updateErr, club_title;
        const getEventMeta = msg => {
            const metaRegEx = /Settlement for club event:\n(?<club_title>.*)\nof event\n(?<event_title>.*)\nwith option\n(?<option_label>.*)\nfor investment of\n₹(?<investment>.*)/;
            const matches = metaRegEx.exec(msg);
            const groups = matches?.groups ?? {};
            return groups;
        }
        await knex.transaction(async trx => {
            
            if(transactions.length) {
                if (isSettlement){
                    const owner = await ClubEvents.getOwnerCommission(data?.id);
                    
                    const appendOwnerFeeDebit = (agg, item) => {
                        const meta = getEventMeta(item.message)
                        console.log(owner.commission, item.surcharge)
                        const entries = [{
                            ...item, 
                            surcharge: item.surcharge * (1 - owner.commission)
                        },
                        {
                            ...item, 
                            amount: item.surcharge * owner.commission,
                            surcharge: 0,
                            type: 'DEBIT',
                            txnid: item.txnid.replace('CLS', 'CLF'),
                            message: ['Club Event Trading Fee Deduction',
                            meta.event_title].join('\n')
                        }]
                        
                        return agg.concat(entries)
                    }
                    updatedTransactions = transactions
                    
                    if(isSettlement) {
                        updatedTransactions = transactions.reduce(appendOwnerFeeDebit, [])
                    }

                    const ownerCommissionAmount = updatedTransactions.filter(i => i.type === 'DEBIT').reduce(
                        (sum, item) => sum + item.amount
                    , 0);

                    if(ownerCommissionAmount > 0) {
                        /**
                         * userid, type, createdat, surcharge, message, txnid, 
                         sum(coins) as coins, sum(amount) as amount
                        */
                        const meta = getEventMeta(updatedTransactions[0].message)
                        club_title = meta?.club_title;
                        const ownerSettlementTransaction = {
                            userid: owner.id,
                            type: 'CREDIT',
                            createdat: new Date().toISOString(),
                            surcharge: 0,
                            message: ['Settlement fees for event', meta.event_title].join('\n'),
                            txnid: `CLBRF1000${data?.id}`,
                            amount: ownerCommissionAmount
                        }
                        updatedTransactions.push(ownerSettlementTransaction);
                        const ownerTdsTransaction = {
                            userid: owner.id,
                            type: 'DEBIT',
                            createdat: new Date().toISOString(),
                            surcharge: 0,
                            message: ['TDS Deducted on Settlement for event', meta.event_title].join('\n'),
                            txnid: `TDSCLB1000${data?.id}`,
                            amount: ownerCommissionAmount * 0.05
                        }
                        updatedTransactions.push(ownerTdsTransaction);
                    }
                }else{
                    updatedTransactions  = transactions
                }
                const ids = await Transactions.insertTransactions(updatedTransactions, trx);
                let clubOwnerReferralId, clubOwnerReferralAmount;
                for(let i=0; i<ids.length; i++) {
                    const item = ids[i];
                    log(`Transaction ${item.type} ${item.userid} with amount as ${item.amount} surcharge of ${item.surcharge}`)
                    const groups = getEventMeta(item.message)
                    if(item?.type === 'CREDIT' &&
                      (
                        item?.txnid.indexOf('CLS') === 0 ||
                        item?.txnid.indexOf('CLBRF') === 0 ||
                        item?.txnid.indexOf('TDSRF') === 0
                      )) {
                        if(item?.txnid.indexOf('CLS') === 0) {
                            await handleNotification({'userid' : item.userid, 'title' : groups?.club_title ?? "club_title", 'profit_amount' : parseFloat(parseFloat(item.amount) - parseFloat(groups?.investment ?? 1)).toFixed(2), 
                            'shareable_url' : 'https://pages.tradexapp.co/WZ8eSPERsrQcoedK8'}, "club event settlement");
                        } else if (item?.txnid.indexOf('CLBRF') === 0){
                            clubOwnerReferralId = item?.id;
                            clubOwnerReferralAmount = item?.amount;
                            await handleNotification({'userid' : item.userid, 'title' : club_title, 'profit_amount' : parseFloat((item.amount).toString()).toFixed(2), 'shareable_url' : 'https://pages.tradexapp.co/WZ8eSPERsrQcoedK8'}, "club event settlement");
                        } else if (item?.txnid.indexOf('TDSRF') === 0){
                            //transaction_id is id from transactions table of
                            let err1, txnResp, netWinnings;
                            [err1, txnResp] = await to(User.getTransactions({ 'userid': item.userid, 'txnid': item.txnid.replace('TDSRF', 'TDSCLB') }));
                            if (err1) {
                                console.log(err1);
                            }
                            
                            [err1, tdsResp] = await to(TdsUsers.getTdsData({ user_id: item.userid, txnid_tds_id : txnResp[0]['id'] }));
                            if (err1) {
                                console.log(err1);
                            }
                            if (tdsResp && tdsResp.length > 0){
                                netWinnings = tdsResp[0]['profit_amount'];
                            }else{
                                netWinnings = 0;
                            } 
                            let tdsData = {
                                user_id: item.userid,
                                probe_id: null,
                                transaction_id: txnResp[0]['id'],
                                txnid_tds_id: item.id,
                                invested_amount: null,
                                earnings: null,
                                earning_type: 'refund',
                                profit_amount: netWinnings,
                                tax_deducted: -1 * item.amount,
                                tax_percentage: 5,
                                refund_reason : `club event reset ${item.txnid}`
                            };
                            console.log(`tdsCancelLog txnid_tds_id ${JSON.stringify(tdsData)}`);
                            [err1, tdsResp] = await to(TdsUsers.addTdsUsers(tdsData));
                            if (err1) {
                                console.log(err1);
                                logger.info(`Error adding TDS for user in tds_users: ${item.userid}`);
                            }
                        }
                        
                    }
                    if(item?.type === 'DEBIT' && (item?.txnid.indexOf('TDSCLB') === 0)){
                        let tdsData = {
                            user_id: item.userid,
                            probe_id: null,
                            transaction_id: clubOwnerReferralId,
                            txnid_tds_id: item.id,
                            invested_amount: null,
                            earnings: null,
                            earning_type: 'referral',
                            profit_amount: clubOwnerReferralAmount,
                            tax_deducted: 1 * item.amount,
                            tax_percentage: 5,
                            refund_reason : null
                        };
                        let [err, tdsResp] = await to(TdsUsers.addTdsUsers(tdsData, trx));
                        if (err) {
                            console.log(err);
                        }
                    }
                    let walletEntry = item.amount - item.surcharge
                    const walletData = { 'coinsd': walletEntry, 'userid': item.userid, 'transactionId': item.id };
                    const mul = item?.type === 'DEBIT' ? -1 : 1
                    let [errW, _] = await to(User.updateWalletTransaction(walletData, mul, item.type.toLowerCase(), walletEntry, trx));
                    if(errW) throw errW
                }
            }
            if(isSettlement) {
                await ClubEvents.updateBetWinStatus(data?.id, data?.correct_value)
                await ClubEvents.updateBetLostStatus(data?.id, data?.correct_value)
            }
            if (!isSettlement && data.status === 'CAN'){
                await ClubEvents.updateBetCancelStatus(data?.id)
                await ClubEvents.updateEventCancelStatus(data?.id)
            }
            if (!isSettlement && data.status === 'RST'){
                await ClubEvents.updateBetResetStatus(data?.id)
                await ClubEvents.updateEventResetStatus(data?.id)
            }
            [updateErr, clubEvent]  = await to(ClubEvents.update( data ));
            if(updateErr) throw updateErr;
            const t2 = Date.now();
            log(`Updating club event id ${data?.id} completed in ${(t2 - t1)/1000} seconds`)
            
        })
        

        const successTitle = isSettlement ? 'Event Settled Successfully' : 'Event Updated Successfully';
        const successSubtitle = isSettlement ? 'Your commission has been credited to your TradeX wallet' : 'Event details has been updated successfully';
        
        return ReS(res, { clubEvent, successTitle, successSubtitle });
    } catch (error) {
        console.log(error);
        log('Update Error', error.message)
        next(error);
    }
};

const getClubEvents = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        var err, _events, _clubs, is_owner;
        const clubId = req.params.clubId;

        [err, _clubs] = await to(Club.getClubById(clubId));
        if (err) throw err;

        is_owner = _clubs?.[0]?.owner_id == req.user.id;

        if (is_owner){
            [err, _events] = await to(ClubEvents.getClubEventsOwner(clubId));
            if (err) throw err;
        }else{
            [err, _events] = await to(ClubEvents.getClubEvents(clubId));
            if (err) throw err;
        }


        return ReS(res, {
            success: true, events: _events
        });
    } catch (error) {
        next(error);
    }
};

const getUserActiveEvents = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        var err, _events;
        const userId = req.user.id;
        const clubId = req.params.clubId;
        [err, _events] = await to(ClubEvents.getUserLiveClubEvents(userId, clubId));
        if (err) throw err;
        return ReS(res, {
            success: true, events: _events
        });
    } catch (error) {
        next(error);
    }
};

const getUserSettledEvents = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        var err, _events;
        const userId = req.user.id;
        const clubId = req.params.clubId;
        [err, _events] = await to(ClubEvents.getUserSettledClubEvents(userId, clubId));
        if (err) throw err;
        return ReS(res, {
            success: true, events: _events
        });
    } catch (error) {
        next(error);
    }
};

const getClubEventDetails = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        var err, _events, _clubs, userId, invested_amount, is_member=false, is_owner=false;
        if (req.user && req.user.id && req.user.id != -1) {
            userId = req.user.id;
        }
        const eventId = req.params.eventId;
        const clubId = req.params.clubId;
        [err, _events] = await to(ClubEvents.getClubEventDetails(eventId));
        if (err) throw err;
        [err, _clubs] = await to(Club.getClubById(clubId));
        if (err) throw err;
        // Add is_owner flag
        if(userId){
            is_member = await Club.isClubMember(clubId, userId);
            is_owner = _clubs.length?_clubs[0]['owner_id'] == userId : false;
            [err, invested_amount] = await to(ClubEvents.getUserClubEventDetails(userId, eventId));
        }
        if (err) throw err;
        let data = _events.length?_events[0]: {};
        data['invested_amount'] = invested_amount;
        data['is_member'] = is_member;
        data['is_owner'] = is_owner;
        return ReS(res, {
            success: true, data: data
        });
    } catch (error) {
        next(error);
    }
};

const getClubEventOdds = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        var err, _odds;
        const eventId = req.params.eventId;
        const amount = parseFloat(req.body.amount);
        [err, _odds] = await to(ClubEvents.getClubEventOdds(eventId, amount));
        if (err) throw err;
        return ReS(res, {
            success: true, data: _odds
        });
    } catch (error) {
        next(error);
    }
};

const getClubEventShareLink = function (clubId, eventId, title) {
    return new Promise((resolve, reject) => {
        var postData = JSON.stringify({
            "dynamicLinkInfo": {
                "domainUriPrefix": "https://pages.tradexapp.co",
                "link":  `https://web.tradexapp.co?club_id=${clubId}&eventId=${eventId}`,
                "androidInfo": {
                    "androidPackageName": "com.theox",
                    "androidFallbackLink":`https://web.tradexapp.co/club/${clubId}/event/${eventId}`,
                },
                "iosInfo": {
                    "iosBundleId": "com.theox",
                    "iosFallbackLink": `https://web.tradexapp.co/club/${clubId}/event/${eventId}`,
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

module.exports.createClubEvent = createClubEvent;
module.exports.updateClubEvent = updateClubEvent;
module.exports.getClubEvents = getClubEvents;
module.exports.getUserActiveEvents = getUserActiveEvents;
module.exports.getUserSettledEvents = getUserSettledEvents;
module.exports.getClubEventDetails = getClubEventDetails;
module.exports.getClubEventOdds = getClubEventOdds;
