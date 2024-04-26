const {to, ReS} = require("../services/util.service");
const History = require("../models/history");


const getHistoryMarkets = async (req, res, next) => {
    try {
        // res.setHeader('Content-Type', 'application/json');
        let err, page = 1, limit = 10, _historyRows, count = 0, probeid;
        var userid = req.user.id
        probeid = parseInt(req.body.probeid);
        if (probeid) {
            [err, _historyRows] = await to(History.getHistory(probeid, userid));
            if (err) return ReS(res, {
                success: false
            });
            count = _historyRows.length;
        }
        else {
            let _tempHistoryRows;
            _historyRows = [];
            if (req.body.page && req.body.limit) {
                page = parseInt(req.body.page);
                limit = parseInt(req.body.limit);
                if(isNaN(page) || isNaN(limit)){
                    return ReS(res, {
                        success: false
                    });
                }
            }
            const start_idx = (page - 1) * limit, end_idx = page * limit;
            [err, _tempHistoryRows] = await to(History.getClosedEventForUserMarkets(userid));
            if (err) return ReS(res, {
                success: false
            });
            count = _tempHistoryRows.length;
            for (let i = start_idx; i < Math.min(end_idx, count); i++)
                _historyRows.push(_tempHistoryRows[i]);
        }
        return ReS(res, {
            success: true,
            historyRows: _historyRows,
            total: count,
            page: page,
            limit: limit
        });
    } catch (err) {
        next(err);
    }
}

const getHistoryHeader = async (req, res, next) => {
    try {
        // res.setHeader('Content-Type', 'application/json');
        let err;
        const userid = req.user.userid;

        let hisHeader;
        [ err, hisHeader ] = await to( History.getClosedEventHeaderForUserMarkets( userid ) );
        if( err ){
            return ReS( res, {
                success: false,
                error: err.message
            });
        }

        return ReS(res, {
            success: true,
            historyHeader: hisHeader
        });
    } catch (err) {
        next(err);
    }
}

module.exports.getHistoryMarkets = getHistoryMarkets;
module.exports.getHistoryHeader = getHistoryHeader;
