const { to, ReE, ReS } = require( '../services/util.service' );
const {  Banner } = require('../models');
const { isDashboardUser } = require( '../middleware/dashboard.user' );
const { logDashboardRequest } = require( '../services/mongodb.service' );
const MAX_LIMIT = 100;

const getBanners = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        const partnerId = Number(req.headers['x-partner-id']) || 1;
        let whereObj = {'partnerId' : partnerId};
        if (req.query.page){
            whereObj['page'] = req.query.page;
        }
        let limit = req.query.limit || 10;
        let offset = req.query.offset || 0;
        limit = limit > MAX_LIMIT ? MAX_LIMIT : limit;
        let [err, banners] = await to( Banner.getBanners( limit, offset, whereObj ) );
        if(err) throw err;
        // if(req?.user?.id === -1 && partnerId == 1) banners = []
        if(!isDashboardUser(req)){ 
            banners = banners.filter( b => 
                (b?.regions??[]).indexOf(req?.user?.region) !== -1)
        }
        return ReS(res, {
            success: true, banners: banners
        });
    } catch (error) {
        next(error);
    }
};

const createBanner = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        if(!isDashboardUser(req)){
            res.writeStatus( "401" );
            return ReS(res, {
                success: true, msg: 'Unauthorized request, incident has been reported'
            });
        }
        logDashboardRequest( req, 'Creating banner' );
        const dataObj = req.body.data;
        const regions = dataObj?.regions ?? ['INDIA'];
        delete dataObj?.regions;
        const [err, rows] = await to( Banner.createBanner(dataObj) );
        if(err) throw err;
        const banner_id = rows?.[0];
        const regionsData = regions.map((region) => ({
            region,
            banner_id
        }))
        const [errRegions, regionsRows] = await to( Banner.addRegions(regionsData, banner_id) );
        if(errRegions) throw errRegions;
        return ReS(res, rows);
    } catch (error) {
        next(error);
    }
};

const updateBanner = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        if(!isDashboardUser(req)){
            res.writeStatus( "401" );
            return ReS(res, {
                success: true, msg: 'Unauthorized request, incident has been reported'
            });
        }
        logDashboardRequest( req, 'Updating banner' );
        const dataObj = req.body.data;
        
        if(!dataObj.id)
            throw new Error("missing id attribute");
        const regions = dataObj?.regions;
        if(Array.isArray(regions)) {
            const regionsData = regions.map((region) => ({
                region,
                banner_id: dataObj.id,
            }));
            const [errRegions, regionsRows] = await to( Banner.addRegions(regionsData, dataObj.id) );
            if(errRegions) throw errRegions;
        }
        delete dataObj?.regions
        const [err, rows] = await to( Banner.updateBanner(dataObj) );
        if(err) throw err;
        
        
        return ReS(res, rows);
    } catch (error) {
        next(error);
    }
};

const deleteBanner = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        if(!isDashboardUser(req)){
            res.writeStatus( "401" );
            return ReS(res, {
                success: true, msg: 'Unauthorized request, incident has been reported'
            });
        }
        logDashboardRequest( req, 'Deleting banner' );
        const dataObj = req.body;
        if(!dataObj.id)
            throw new Error("missing id attribute");
        const [err, rows] = await to( Banner.deleteBanner(dataObj.id) );
        const [errRegions, regionsRows] = await to( Banner.addRegions([], dataObj.id) );
        if(err) throw err;
        if(errRegions) throw errRegions;
        return ReS(res, rows);
    } catch (error) {
        next(error);
    }
};

module.exports.getBanners = getBanners;
module.exports.createBanner = createBanner;
module.exports.updateBanner = updateBanner;
module.exports.deleteBanner = deleteBanner;

