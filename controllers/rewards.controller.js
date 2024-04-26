const RewardsService = require('../services/rewards.service');
const { PartnerService } = require('../services/partner.service');
const { ReS, ReE } = require('../services/util.service');

const log = (...args) => console.log('[REWARDS CONTROLLER LOGGER', ...args);
const get = async (req, res) => {
    let data = await RewardsService.get(req?.user);
    if(!data?.active){
        let staticBannerConfig = await PartnerService.getPartnerServiceConfiguration('staticBanner', req?.user) ??  {};
        if (staticBannerConfig && staticBannerConfig.config) {
            data = staticBannerConfig.config;
        }
    }
    return ReS(res, data);
}

const claim = async (req, res) => {
    try {
        const data = await RewardsService.claim(req?.user);
        return ReS(res, data);
    } catch(e) {
        log(e);
        return ReE(res, e.message, 400);
    }
    
}
const getTokenReward = async (req, res) => {
    const config = await RewardsService.getTokenReward(req?.user, req?.query?.previousEarningsLimit ?? 6);
    if (!req?.query?.isCreate){
        config.earnTokens = config.earnTokens.filter(item => item.key !== 'create-event');
    }
    return ReS(res, config);
}


const mmRewards = async (req, res) => {
    try {
        const mmRewardsConfig = await PartnerService.getPartnerServiceConfiguration(
            "marketReward",
            req.user
        );
        const config = mmRewardsConfig?.config;
        const endTime = await RewardsService.getEndTimeFromConfig(config?.interval);
        config.endTime = endTime;
        const probes = await RewardsService.getMarketMakingRewardsProbes();
        const matched_contracts = await RewardsService.getEligibleMatchedContractsMarketRewards(req.user.id);
        
        return ReS(res, {...config, probes : probes, matched_contracts : matched_contracts});
    } catch(e) {
        log(e);
        return ReE(res, e.message, 400);
    }
    
}

module.exports.get = get; 
module.exports.claim = claim; 
module.exports.getTokenReward = getTokenReward;
module.exports.mmRewards = mmRewards;
