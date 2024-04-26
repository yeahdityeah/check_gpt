const{ to, ReE, ReS } = require( '../services/util.service' );
const{ User, Level, Payments, Probe } = require( '../models' );

const getRechargeDetails = async( payload ) => {
    try {
        const mobile = payload['mobile'];
        const email = payload['email'];
        console.log( `Chatgpt function: getRechargeStatus. mobile: ${mobile}` );
        let _user = await User.get( '', { mobile: mobile });
        console.log( `Chatgpt function: getRechargeStatus. user: ${JSON.stringify( _user )}` );
        if( !_user[0] ) {
            console.log( `Chatgpt function: getRechargeStatus. user not found using mobile` );
            if( email ) {
                _user = await User.get( '', { email: email });
                if( !_user[0] ) {
                    console.log( `Chatgpt function: getRechargeStatus. user not found using email` );
                    return{ message: 'Unable to retrieve user info from both mobile and email. Ask user to check again and provide correct mobile or email-id' };
                }
            } else {
                console.log( `Chatgpt function: getRechargeStatus. user not found and email not available` );
                return{ message: 'User not found using mobile number. Ask user to provide registered email-id' };
            }
        }
        let userId = _user[0].id;
        console.log( `Chatgpt function: getRechargeStatus. userid: ${userId}` );
        let[ err, lastRecharge ] = await to( User.getLastPayment({ 'userid': userId }) );
        console.log( `Chatgpt function: getRechargeStatus. lastRecharge: ${JSON.stringify( lastRecharge )}` );
        let msg = ``;
        if( !lastRecharge ) {
            msg = `We do not see any recharge initiated by you`;
        } else if( lastRecharge.paymentid ) {
            msg = `Your last recharge of Rs ${lastRecharge.amount} has been processed succesfully. Please check wallet`;
        } else {
            msg = `Your last recharge of Rs ${lastRecharge.amount} is in pending state in our system. Can you please check with the bank if money is debited`;
        }
        console.log( `Chatgpt function: getRechargeStatus. msg: ${msg}` );
        return{ message: msg };

    } catch( e ) {
        console.log( e );
        return`ERROR`;
    }
};
const getWithdrawDetails = async( payload ) => {
    try {
        const mobile = payload['mobile'];
        const email = payload['email'];
        console.log( `Chatgpt function: getWithdrawStatus. mobile: ${mobile}` );
        let _user = await User.get( '', { mobile: mobile });
        console.log( `Chatgpt function: getWithdrawStatus. user: ${JSON.stringify( _user )}` );
        if( !_user[0] ) {
            console.log( `Chatgpt function: getRechargeStatus. user not found using mobile` );
            if( email ) {
                _user = await User.get( '', { email: email });
                if( !_user[0] ) {
                    console.log( `Chatgpt function: getRechargeStatus. user not found using email` );
                    return{ message: 'Unable to retrieve user info from both mobile and email. Ask user to check again and provide correct mobile or email-id' };
                }
            } else {
                console.log( `Chatgpt function: getRechargeStatus. user not found and email not available` );
                return{ message: 'User not found using mobile number. Ask user to provide registered email-id' };
            }
        }
        let userId = _user[0].id;
        console.log( `Chatgpt function: getWithdrawStatus. userId: ${userId}` );
        let[ err, lastRedeem ] = await to( User.getLastRedeem({ 'userid': userId }) );
        console.log( `Chatgpt function: getWithdrawStatus. lastRedeem: ${lastRedeem}` );
        let msg = ``;
        if( !lastRedeem ) {
            msg = `No withdraw request found in system for the mobile number mentioned. Please raise the request first`;
        } else if( lastRedeem.status === 'C' ) {
            msg = `Your last withdraw request of Rs ${lastRedeem.amount} has been processed succesfully. Please check with your bank`;
        } else {
            msg = `Your last withdraw request of Rs ${lastRedeem.amount} will be processed shortly. Thanks for your patience`;
        }
        console.log( `Chatgpt function: getWithdrawStatus. msg: ${msg}` );
        return{ message: msg };

    } catch( e ) {
        console.log( e );
        return`ERROR`;
    }
};
const getEventStatus = async( payload ) => {
    try {
        const mobile = payload['mobile'];
        const eventId = payload['eventId'];
        const _user = await User.get( '', { mobile: mobile });
        if( !_user[0] ) {
            return{ message: 'User not found. Please provide registered mobile number' };
        }
        let[ err, eventStatus ] = await to( Probe.getProbes({ probeid: eventId }) );
        let msg;
        if( eventStatus[0].status === 'A' ) {
            return'Event is in active state. You will get money depending on win loose once the event gets settled';
        } else if( eventStatus[0].status === 'CAN' ) {
            return'Event is in cancelled. Your money has been refunded in your wallet. Check transactions';
        } else if( eventStatus[0].status === 'C' ) {
            return`The event has been settled at ${eventStatus[0].correctvalue}`;
        }
    } catch( e ) {
        return`ERROR`;
    }
};

module.exports.getWithdrawDetails = getWithdrawDetails;
module.exports.getRechargeDetails = getRechargeDetails;
module.exports.getEventStatus = getEventStatus;
