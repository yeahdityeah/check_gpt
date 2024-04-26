
const { Category } = require('../models');
const { to, ReE, ReS } = require('../services/util.service');
const jwt = require('jsonwebtoken');
const CONFIG = require('../config/config');
const logger = require('../services/logger.service');
const { isDashboardUser } = require('../middleware/dashboard.user');
const { logDashboardRequest } = require('../services/mongodb.service');
const MAX_LIMIT = 100;

const getCategories = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        const isADashboardUser = isDashboardUser(req);
        let limit = req.query.limit || 100;
        let offset = req.query.offset || 0;
        limit = limit > MAX_LIMIT ? MAX_LIMIT : limit;
        const [err, categories] = await to(Category.getCategories(limit, offset, isADashboardUser));
        if (err) throw err;
        let resObj = {};
        resObj["categories"] = categories;
        return ReS(res, resObj);
    } catch (error) {
        next(error);
    }
};

const getSubCatAndTags = async (req, res, next) => {
    try {
        const isADashboardUser = isDashboardUser(req);
        if (!isADashboardUser) {
            return ReE(res, 'Invalid Request', 501)
        }
        let limit = req.query.limit || 100;
        let offset = req.query.offset || 0;
        limit = limit > MAX_LIMIT ? MAX_LIMIT : limit;
        const [err, data] = await to(Category.getSubCatAndTags());
        if (err) throw err;
        let resObj = {};
        resObj["data"] = data;
        return ReS(res, resObj);
    } catch (error) {
        next(error);
    }
}

const createCategories = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        if (!isDashboardUser(req)) {
            res.writeStatus("401");
            return ReS(res, {
                success: true, msg: 'Unauthorized request, incident has been reported'
            });
        }
        logDashboardRequest(req, 'Creating category');
        const dataObj = req.body.data;
        const [err, rows] = await to(Category.createCategory(dataObj));
        if (err) throw err;
        return ReS(res, rows);
    } catch (error) {
        next(error);
    }
};

module.exports.getCategories = getCategories;
module.exports.createCategories = createCategories;
module.exports.getSubCatAndTags = getSubCatAndTags;

