const { User } = require("../models");
const Referral = require("../models/referral");
const {to, ReS} = require("../services/util.service");
const { PartnerService } = require('../services/partner.service');
const CONFIG = require('../config/config');

const { redisCaching } = require("../services/cache.service");
const { UserService } = require("../services/user.service");

const getDescription = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        return ReS(res, {
            success: true, description: [
                'Refer Friends. Earn Cash.',
                `Earn up to ${CONFIG.REFERRAL_PERCENTAGE}% commission on the trading fees paid by your referred friends.`,
                'Invite your friends using this referral code.'
            ]
        });
    } catch (error) {
        console.log(error);
        next(error);
    }
};

const getReferralData = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        var userid = req.user.id;
        PartnerService

        const luckycoinsconfig = await PartnerService.getPartnerServiceConfiguration(
            "luckyCoins",
            req.user
        );
        const {refereeAmount, referrerAmount, signup_bonus} = luckycoinsconfig?.config?.signup;

        let err, response, resObj = {
            total_referral_earning: 0,
            total_referred_users: 0,
            total_referral_promo_earning: 0,
            total_redeemed_amount: 0,
            referral_percentage: CONFIG.REFERRAL_PERCENTAGE
        };
        

        [err, response] = await to(Referral.totalReferredUsers(userid))
        if (err)throw err;

        resObj['total_referred_users'] = response.total_referred_users;

        if(resObj['total_referred_users'] !== 0) {
            let  total_redeemed_amount;
            const hKey = `Referral Redeemed`;
            const key = userid;
            total_redeemed_amount = await redisCaching.getHMKey(key, hKey);
            if(!total_redeemed_amount) {
                [err, total_redeemed_amount] = await to(Referral.getTotalReferrerEarningsTx(userid));
                if (err)throw err;
                total_redeemed_amount = total_redeemed_amount ?? Number(0);            
                await redisCaching.setHMKey(key, hKey, total_redeemed_amount)
            }
            resObj.total_redeemed_amount = parseFloat(total_redeemed_amount);
            

            [err, response] = await to(Referral.totalReferralPromoEarning(userid));
            if (err)throw err;

            resObj.total_referral_promo_earning = response.total_referral_promo_earning;

            [err, response] = await to(Referral.getUnprocessedReferrerEarnings(userid));
            if (err) throw err;
                        
            let percentage = await UserService.getReferralPercentage(userid);
            resObj.total_referral_earning = Number(resObj.total_redeemed_amount) + (response?.amount * percentage ?? Number(0));
        }

        resObj['description'] = [
            `Earn upto ${CONFIG.REFERRAL_PERCENTAGE}% cashback on trading fee paid by your friends via token points`,
            `Your friend will get ${CONFIG.referralBonus} credits`
        ];

        return ReS(res, resObj);
    } catch (error) {
        console.log(error);
        next(error);
    }
};

const eventReferral = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        // Ignore for partner other than id=1
        var data = Object.assign({}, req.body);
        let referredBy = data['referredBy'].replace('}', '')
        let eventId = data['eventId']
        if (req.user && req.user.id && req.user.id != -1 && req.user.id != referredBy) {
            await Referral.updateEventReferral(referredBy, req.user.id, eventId);
            return ReS(res, {
                success: true, description: "Event referral updated."
            });
        } else {
            return ReS(res, {
                success: true, description: "Event referral not updated."
            });
        }
    } catch (error) {
        console.log(error);
        next(error);
    }
};

module.exports.getDescription = getDescription;
module.exports.getReferralData = getReferralData;
module.exports.eventReferral = eventReferral;