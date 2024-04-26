const { to, ReE, ReS } = require( '../services/util.service' );
const {  PaymentConfig, Banner } = require('../models');
const { logDashboardRequest } = require( '../services/mongodb.service' );
const { isDashboardUser } = require('../middleware/dashboard.user');

const getConfig = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
       const [err, paymentConfig] = await to( PaymentConfig.getConfig() );
        if(err) throw err;
        return ReS(res, {
            success: true, payment_config: paymentConfig
        });
    } catch (error) {
        next(error);
    }
};


const createPaymentConfig = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        if (!isDashboardUser(req)) {
            res.writeStatus("401");
            return ReS(res, {
                success: true, msg: 'Unauthorized request, incident has been reported'
            });
        }
        logDashboardRequest( req, 'Creating a new payment configuration' );
        const dataObj = req.body.data;
        if(dataObj.id){
            delete dataObj.id;
        }
        if(dataObj.is_active !== undefined){
            delete dataObj.is_active;
        }
        if(dataObj.created_at){
            delete dataObj.created_at;
        }
        const [err, rows] = await to( PaymentConfig.createNewPaymentConfig(dataObj) );
        if(err) throw err;
        return ReS(res, {
            success: true, rows
        });
    } catch (error) {
        next(error);
    }
};

module.exports.getConfig = getConfig;
module.exports.createPaymentConfig = createPaymentConfig;
