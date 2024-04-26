const jwt = require("jsonwebtoken");
const CONFIG = require( '../config/config' );
const logger = require( '../services/logger.service' );
function isDashboardUser( req ){
    let decodedToken = {};
    try {
        decodedToken = jwt.verify(req.headers.authorization.split(" ")[1], CONFIG.jwt_encryption_v2);
    }
    catch (e) {
        logger.error("Invalid authorization token");
        return false;
    }
    return Object.keys(decodedToken).includes('dashboard_user_id');
}

module.exports.isDashboardUser = isDashboardUser;
