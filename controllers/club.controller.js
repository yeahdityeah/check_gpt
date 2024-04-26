const { to, ReE, ReS } = require('../services/util.service');
const CONFIG = require('../config/config');
const { isDashboardUser } = require('../middleware/dashboard.user');
const { Club, User} = require('../models');
const logger = require('../services/logger.service');
const https = require('https');
const { handleNotification } = require('../services/notification.service');
const {messages} = require("../messages/messages");

const createClub = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        var err, _clubIds, userId;
        // if (!isDashboardUser(req)) {
        //     res.status(401);
        //     return ReS(res, {
        //         success: true, msg: 'Unauthorized request, incident has been reported'
        //     });
        // }

        // if req.body.owner_id is present then use that value else
        // set owner_id as req.user.id
        // Remove admin Auth check and add check for token passport middleware
        // Join owner id to the club

        if (req.user && req.user.id && req.user.id != -1) {
            userId = req.user.id;
        }
        
        var data = Object.assign({}, req.body);

        if (!data['owner_id'] && userId){
            data['owner_id'] = userId;
        }
        data['status'] = 'A';
        data['social'] = JSON.stringify(data['social']);
        data['shareable_url'] = '';
        [err, _clubIds] = await to(Club.create(data));
        if (err) throw err;
        try {
            const sharelink = await getClubShareLink(_clubIds[0], data['title']);
            const dataToUpdate = { 'id': _clubIds[0], 'shareable_url': sharelink };
            await to(Club.update(dataToUpdate));
            await handleNotification({'owner_id' : data['owner_id'], 'title' : req.body.title, 'shareable_url' : sharelink}, "club create");
            // Notification to  req.owner_id with sharelnk
        } catch (e) {
            logger.error('Cannot create dynamic link')
            logger.error(e)
        }
        const dataObj = {
            'club_id': _clubIds[0],
            'user_id': data['owner_id'],
            'status': 'A',
            'joined_at': 'now()'
        };
        [err, _member] = await to(Club.joinClub(dataObj));
        if (err) throw err;
        
        return ReS(res, {
            success: true, clubid: _clubIds[0]
        });
    } catch (error) {
        console.log(error)
        next(error);
    }
};

const updateClub = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        if (!isDashboardUser(req)) {
            res.writeStatus( "401" );
            return ReS(res, {
                success: true, msg: 'Unauthorized request, incident has been reported'
            });
        }
        // const clubId = req.params.clubId;
        let err, _club;
        [err, _club] = await to(Club.update({ ...req.body }));
        if (err) throw err;
        return ReS(res, { club: _club[0] });
    } catch (error) {
        next(error);
    }
};

const getClubs = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        const userId = req.user.id;
        var err, _clubs;
        // Add Owner Flag
        [err, _clubs] = await to(Club.getClubs(userId));
        if (err) throw err;
        return ReS(res, {
            success: true, clubs: []
        });
    } catch (error) {
        next(error);
    }
};

const getClub = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        var err, _clubs, is_member, userId;
        const clubId = req.params.clubId;
        userId = req.user.id;
        [err, _clubs] = await to(Club.getClubById(clubId));
        if (err) throw err;
        is_member = await Club.isClubMember(clubId, userId);
        console.log(_clubs?.[0]?.owner_id, req.user.id )
        return ReS(res, {
            success: true, clubs: _clubs, is_member: is_member,
            is_owner: _clubs?.[0]?.owner_id == req.user.id
        });
    } catch (error) {
        next(error);
    }
};

const joinClub = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        return ReE(res, 'Cannot join club at this time', 422);
        var err, _member;
        const clubId = req.params.clubId;
        const userId = req.user.id;

        const isUserBlocked = await User.isUserBlocked(userId);
        if (isUserBlocked) {
            return ReE(res, messages.USER_BLOCKED, 500);
        }

        const dataObj = {
            'club_id': clubId,
            'user_id': userId,
            'status': 'A',
            'joined_at': 'now()'
        };
        [err, _member] = await to(Club.joinClub(dataObj));
        if (err) throw err;
        return ReS(res, {
            success: true
        });
    } catch (error) {
        next(error);
    }
};

const getClubShareLink = function (clubId, title) {
    return new Promise((resolve, reject) => {
        var postData = JSON.stringify({
            "dynamicLinkInfo": {
                "domainUriPrefix": "https://pages.tradexapp.co",
                "link": `https://web.tradexapp.co/clubs?club_id=${clubId}`,
                "androidInfo": {
                    "androidPackageName": "com.theox",
                    "androidFallbackLink": `https://web.tradexapp.co/clubs?club_id=${clubId}`,
                },
                "iosInfo": {
                    "iosBundleId": "com.theox",
                    "iosFallbackLink": `https://web.tradexapp.co/clubs?club_id=${clubId}`,
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

module.exports.createClub = createClub;
module.exports.updateClub = updateClub;
module.exports.getClubs = getClubs;
module.exports.getClub = getClub;
module.exports.joinClub = joinClub;