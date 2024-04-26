const { to, ReE, ReS } = require( '../services/util.service' );
// const socketService = require( '../services/socket.service' );
const CONFIG = require( '../config/config' );



const forceUpdateEvent = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        const data = req.body.data;
        if(data['secret'] && data['secret'] === CONFIG.force_app_update_secret){
            // socketService.sendForceUpdateEvent();
            return ReS(res, {
                success: true
            });
        }
        else {
            throw new Error("Invalid secret code");
        }
    } catch (error) {
        next(error);
    }
};

module.exports.forceUpdateEvent = forceUpdateEvent;
