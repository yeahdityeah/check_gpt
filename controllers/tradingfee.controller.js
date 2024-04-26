const { ReS } = require('../services/util.service');
const CONFIG = require('../config/config');
const tradingFee = require('../utils/tradingfee.util');

const getTradingFee = async function (req, res, next) {
    // this is only for CDA event
    // res.setHeader('Content-Type', 'application/json');
    try {
        let numberOfContracts = parseInt(req.query.noofcontracts);
        const oAmount = parseInt(req.query.orderamount);
        const isLimit = req.query.islimit;
        const oType = req.query.ordertype;
        const price = parseFloat("" + req.query.price).toFixed(2);
        const eId = req.query.eventid
        const callValue = req.query.callvalue;
        const isMarketOrder = false
        if (oType == "order" && ((typeof isLimit == "string" && isLimit === "false") || (typeof isLimit == "boolean" && !isLimit))) {
            isMarketOrder = true
            numberOfContracts = oAmount / price
        }
        let commissionFee = await tradingFee.getTradingFee("ORDER", callValue, parseFloat(numberOfContracts), parseFloat(price), parseInt(eId), req?.user?.id, true, isMarketOrder)
        commissionFee = parseFloat((commissionFee).toFixed(2));
        return ReS(res, {
            success: true, data: { trading_fee: commissionFee }
        });

    } catch (error) {
        next(error);
    }
};

module.exports.getTradingFee = getTradingFee;

