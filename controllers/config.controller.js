const { success } = require("../lib/response");
const { isDashboardUser } = require("../middleware/dashboard.user");
const Config = require("../models/config");
const ConfigService = require("../services/config.service");
const { ReE, ReS } = require("../services/util.service");

const log = (...args) => console.log('[CONFIG CONTROLLER]')
const getConfig = async (req, res) => {
    try {
        if(!isDashboardUser(req)) {
            return ReE(res, 'Not authorized', 403);
        }
        const service = req?.params?.service;
        if(!service) {
            return ReE(res, 'Need to pass a service', 400);
        }
        let config = await Config.getConfig(service);
        if(!Array.isArray(config) || config.length === 0) {
            return ReE(res, `${service} config not found`, 404);
        }
        return ReS(res, config[0]);
    } catch(e) {
        log(e.message);
        return ReE(res, e.message, 500);
    }
}



const updateConfig = async (req, res) => {
    try {
        if(!isDashboardUser(req)) {
            return ReE(res, 'Not authorized', 403);
        }
        const service = req?.params?.service;
        if(!service) {
            return ReE(res, 'Need to pass a service id', 400);
        }
        if(!req?.body) {
            return ReE(res, 'Need configuration in the body', 400);
        }         
        let config = await Config.getConfig(service);
        if(!Array.isArray(config) || config.length === 0) {
            return ReE(res, `${service} config not found`, 404);
        }
        const updatedConfig = await ConfigService.updateData(service, req?.body);
        if(!updatedConfig) {
            return ReE(res, 'Error cannot update configuration', 500);
        }
        return ReS(res, updatedConfig);
    } catch(e) {
        log(e.message);
        return ReE(res, e.message, 500);
    }
}

module.exports.getConfig = getConfig;
module.exports.updateConfig = updateConfig;