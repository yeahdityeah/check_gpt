'use strict';
const knex = require('../knex/knex.js');
const { redisCaching } = require( '../services/cache.service' );

const PaymentConfig = {

	getConfig: async (whereObj) => {
		let sqlQuery = `SELECT a.* FROM payment_configurations a :where: ORDER BY a.created_at DESC LIMIT 100`;
		let whereClause = [];
		const whereClauseBindings = [];
		if( whereObj && typeof whereObj === 'object' && Object.keys(whereObj).length > 0 ){
			for (const [key, value] of Object.entries(whereObj)) {
				whereClause.push(`${key} = ?`)
				whereClauseBindings.push( value );
			}
			if( whereClauseBindings.length > 0 ){
				whereClause = 'WHERE ' + whereClause.join(' AND ');
			}
		}
		sqlQuery = sqlQuery.replace(':where:', whereClause);
		
		return knex.raw(sqlQuery, whereClauseBindings)
			.then((res) => {
				return res['rows'];
			}).catch((err) => {
				throw err;
			});
	},

	createNewPaymentConfig: async ( dataObj ) => {

		return knex('payment_configurations')
			.update({is_active: false})
			.where({is_active: true})
			.then( () => {
				return knex.insert(dataObj, 'id').into('payment_configurations').then((id) => {
					dataObj.id = id[0];
					const paymentConfigKey = dataObj?.partner ?? 1 + '_' + dataObj?.region ?? 'INDIA';
					redisCaching.updatePaymentConfig(dataObj, paymentConfigKey);
					return id;
				}).catch(err => {
					throw err;
				});
			}, (err) => { throw err } );
	},


}


module.exports = PaymentConfig;
