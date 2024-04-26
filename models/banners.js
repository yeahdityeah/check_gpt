'use strict';
const knex = require('../knex/knex.js');

const Banners = {

	getBanners: async (limit, offset, whereObj) => {
		let whereClause = '';
		if (whereObj && whereObj['partnerId']){
			whereClause += knex.raw(' and partner = ?', whereObj['partnerId']);
		}
		if (whereObj && whereObj['page']){
			whereClause += knex.raw(' and page = ?', whereObj['page']);
		} else {
			whereClause += ` and page = 'home' `;
		}
		if(!limit) limit = 10;
		if(!offset) offset = 0;

		let sqlQuery = `SELECT a.id, a.banner_text, a.image_url, a.link, a.action, type,
						array_remove(array_agg(b.region), NULL) as regions  
						FROM banners a left join banners_region b on a.id = b.banner_id
						where is_enabled = true ${whereClause}
						group by a.id, a.banner_text, a.image_url, a.link, a.action, type 
						order by a.id desc LIMIT ? OFFSET ?`;
		return knex.raw(sqlQuery, [limit, offset])
			.then((res) => {
				return res['rows'];
			}).catch((err) => {
				throw err;
			});
	},

	createBanner: async ( dataObj ) => {
		return knex.insert(dataObj, 'id').into('banners').then((id) => {
			return id;
		}).catch(err => {
			throw err;
		});
	},


	updateBanner: async (dataObj) => {
		const id = dataObj.id;
		delete dataObj.id; // to avoid id manipulation
		delete dataObj.created_at;
			return knex('banners')
				.update(dataObj, ['id', 'banner_text', 'image_url', 'link', 'type', 'action'])
				.where({ id })
				.then( (rs) => {
					return rs;
				}, (err) => { throw err } );
	},

	deleteBanner: async (id) => {
		return knex('banners')
			.where('id', id)
			.del()
			.then((res) => {
				return res
			}, (err => { throw err }) );
	},
	addRegions: async function (regionsData, bannerId) {
        var chunkSize = 10;
        if (bannerId) {
            try {
                await knex('banners_region').del().where('banner_id', bannerId);
            } catch (e) {
                throw e;
            }
        }
        return knex.batchInsert('banners_region', regionsData, chunkSize)
            .returning('id')
            .then(function (ids) { return ids; })
            .catch(function (error) { throw error });
        return []
    },

}


module.exports = Banners;
