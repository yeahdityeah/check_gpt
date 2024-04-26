const { SolrService } = require( '../services/solr.service' );
const { ReS } = require( '../services/util.service' );

const indexAllDocuments = async function (req, res, next) {
    // res.setHeader('Content-Type', 'application/json');
    try {
        await SolrService.indexAllEvents();
        return ReS(res, {success: true});
    } catch (error) {
        next(error);
    }
};

module.exports.indexAllDocuments = indexAllDocuments;

