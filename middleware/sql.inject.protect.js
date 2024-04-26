//var rawbody = require('raw-body');

function hasSql(value) {

    if (value === null || value === undefined) {
        return false;
    }

    var sql_meta = new RegExp('(%27)|(\')|(--)|(%23)|(#)', 'i');
    if (sql_meta.test(value)) {
        return true;
    }

    // var sql_format = new RegExp(/(\s*([\0\b\'\"\n\r\t\%\_\\]*\s*(((select\s*.+\s*from\s*.+)|(insert\s*.+\s*into\s*.+)|(update\s*.+\s*set\s*.+)|(delete\s*.+\s*from\s*.+)|(drop\s*.+)|(truncate\s*.+)|(alter\s*.+)|(exec\s*.+)|(\s*(all|any|not|and|between|in|like|or|some|contains|containsall|containskey)\s*.+[\=\>\<=\!\~]+.+)|(let\s+.+[\=]\s*.*)|(begin\s*.*\s*end)|(\s*[\/\*]+\s*.*\s*[\*\/]+)|(\s*(\-\-)\s*.*\s+)|(\s*(contains|containsall|containskey)\s+.*)))(\s*[\;]\s*)*)+)/i);
    // if(sql_format.test(value)){
    //     return true;
    // }

    var sql_meta2 = new RegExp('((%3D)|(=))[^\n]*((%27)|(\')|(--)|(%3B)|(;))', 'i');
    if (sql_meta2.test(value)) {
        return true;
    }

    var sql_typical = new RegExp('w*((%27)|(\'))((%6F)|o|(%4F))((%72)|r|(%52))', 'i');
    if (sql_typical.test(value)) {
        return true;
    }

    var sql_union = new RegExp('((%27)|(\'))union', 'i');
    if (sql_union.test(value)) {
        return true;
    }

    return false;
}

function sqlInjectProtection(req, res, next) {

    var containsSql = false;

    if (req.originalUrl !== null && req.originalUrl !== undefined) {
        if (hasSql(req.originalUrl) === true) {
            containsSql = true;
        }
    }
    let body = req.body;
    if (containsSql === false) {

        // rawbody(req, {
        //     encoding: 'utf8'
        // }, function(err, body) {

            // if (err) {
            //     return next(err);
            // }

            if (body !== null && body !== undefined) {

                if (typeof body !== 'string') {
                    body = JSON.stringify(body);
                }

                if (hasSql(body) === true) {
                    containsSql = true;
                }
            }

            if (containsSql === true) {
                res.status(403).json({
                    error: 'SQL Detected in Request, Rejected.'
                });
            } else {
                console.log(String(next));
                next();
            }
        //});
    } else {
        res.status(403).json({
            error: 'SQL Detected in Request, Rejected.'
        });
    }
}

module.exports.sqlInjectProtection = sqlInjectProtection;
