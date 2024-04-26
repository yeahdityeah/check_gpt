'use strict';
const knex = require('../knex/knex.js');

const AppVersion = {
	getLatestVersion: async (platform, partner_id, region, show_update_popup) => {
		let sqlQuery = `SELECT * FROM app_versions a where platform = ? and partner = ? and region = ?  order by version desc limit 1`;
		if(show_update_popup) {
			sqlQuery = `SELECT * FROM app_versions a where platform = ? and partner = ? and region = ? and show_update_popup = ? order by version desc limit 1`;
			return knex.raw(sqlQuery, [platform, partner_id, region, show_update_popup])
			.then((res) => {
				return res['rows'].length?res['rows'][0]: null;
			}).catch((err) => {
				throw err;
			});
		}
		return knex.raw(sqlQuery, [platform, partner_id, region])
			.then((res) => {
				return res['rows'].length?res['rows'][0]: null;
			}).catch((err) => {
				throw err;
			});
	}

}


module.exports = AppVersion;
