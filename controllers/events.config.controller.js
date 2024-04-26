const EventsConfig = require('../models/EventsConfig');
const { isDashboardUser } = require("../middleware/dashboard.user");
const { ReS, ReE } = require('../services/util.service');
const getAllEventsConfig = async (req, res, next) => {
    if(!isDashboardUser(req)){
        res.writeStatus( "401" );
        return ReS(res, {
            success: true, msg: 'Unauthorized request, incident has been reported'
        });
    }
    const result = await EventsConfig.getAllConfig();
    console.log(result)
    return ReS(
        res,
        result,
    )
}

const addEventsConfig = async (req, res, next) => {
    if(!isDashboardUser(req)){
        res.writeStatus( "401" );
        return ReS(res, {
            success: true, msg: 'Unauthorized request, incident has been reported'
        });
    }
    const result = await EventsConfig.createConfig(req.body);
    return ReS(res, result)
}

const updateEventsConfig = async (req, res, next) => {
    if(!isDashboardUser(req)){
        res.writeStatus( "401" );
        return ReS(res, {
            success: true, msg: 'Unauthorized request, incident has been reported'
        });
    }
    const result = await EventsConfig.updateConfig(req.body);
    return ReS(res, result)
}


module.exports.getAllEventsConfig = getAllEventsConfig;
module.exports.addEventsConfig = addEventsConfig;
module.exports.updateEventsConfig = updateEventsConfig;