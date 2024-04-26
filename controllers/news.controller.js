const { Probe } = require("../models");
const { to, ReS } = require("../services/util.service");
const logger = require("../services/logger.service");

const getCategoryNews = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        const category = req.query.category;
        if (typeof category !== 'string') ReE(res, 'Invalid Request', 422);

        let [errN, newsData] = await to(Probe.getCategoryNews(category));
        if (errN) {
            logger.info(`Category news Fetch Error : ${errN}`);
            throw errN;
        }

        let respData = [];
        if (newsData.length > 0) {
            respData = newsData.map(chunk => {
                const jsonData = JSON.parse(chunk.data);
                if (jsonData && jsonData.name && jsonData.url) {
                    return {
                        url: jsonData.url,
                        title: jsonData.name,
                        description: jsonData.description,
                        published_at: jsonData.datePublished || "",
                        image: jsonData.image && jsonData.image.thumbnail && jsonData.image.thumbnail.contentUrl ?
                            jsonData.image.thumbnail.contentUrl :
                            "",
                        source: Array.isArray(jsonData.provider) && jsonData.provider.length > 0 && jsonData.provider[0].name ?
                            jsonData.provider[0].name :
                            ""
                    };
                }
            });
        }

        return ReS(res, {
            success: true, data: respData
        });
    } catch (error) {
        console.log(error);
        next(error);
    }
};

module.exports.getCategoryNews = getCategoryNews;
