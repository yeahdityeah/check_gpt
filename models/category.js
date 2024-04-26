'use strict';
const knex = require('../knex/knex.js');
const Category = {

	getCategories: async (limit, offset, isDashBoardUser, region, partner = 1) => {
		if (!limit) limit = 100;
		if (!offset) offset = 0;
		if (!region) region = null;
		const whereClause = isDashBoardUser === false ? `WHERE
											a.text in (
								  				SELECT DISTINCT(category) 
												FROM probes
												INNER JOIN probes_partner pp on pp.probeid = probes.id
												LEFT JOIN probes_region pr on pr.probeid = probes.id
												WHERE
													status IN ('A', 'H') AND
													endsat > now() AND 
													start_date <= now() AND
												    is_internal = false AND
												    is_private = false AND
													(pr.probeid is NULL or pr.region = :region) AND
													pp.partner = :partner
											)` : 'WHERE a.id NOT IN (1)';
		const sqlQuery = `SELECT 
							a.id, a.text, CASE WHEN a.image IS NULL THEN '' ELSE a.image END, a.count, b.subcategory, CASE WHEN a.image_svg IS NULL THEN '' ELSE a.image_svg END
							FROM categories a
							left join (select category, array_agg( distinct(b.subcategory)) AS subcategory from probes b
							INNER JOIN probes_partner pp on pp.probeid = b.id
							LEFT JOIN probes_region as pr on pr.probeid = b.id
							where length(subcategory) > 0 AND
							b.status IN ('A', 'H') AND
							b.endsat > now() AND
							b.start_date <= now() AND
							b.is_internal = false AND
							b.is_private = false AND
							(pr.probeid is NULL or pr.region = :region) AND
							pp.partner = :partner
							group by category) b
							on a.text = b.category
							${whereClause}
							ORDER BY a.rank LIMIT :limit OFFSET :offset`;
		return knex.raw(sqlQuery, { region, partner, limit, offset })
			.then((res) => {
				return res['rows'];
			}).catch((err) => {
				throw err;
			});
	},

	createCategory: async (dataObj) => {
		if (dataObj['id']) {
			delete dataObj['id']
		}
		return knex.insert(dataObj, 'id').into('categories').then((id) => {
			return id;
		}).catch(err => {
			throw err;
		});
	},

	getSubCatAndTags: async () => {
		let limit = 200, offset = 0;
		const sqlQuery = `SELECT DISTINCT hashtags, subcategory FROM (SELECT * FROM probes where status in ('A', 'F', 'H') or endsat > now() - interval '48 hours' order by id desc limit 1000) a limit ? offset ?;`
		return knex.raw(sqlQuery, [limit, offset])
			.then((res) => {
				return res['rows'];
			}).catch((err) => {
				throw err;
			});
	}

}

module.exports = Category;
