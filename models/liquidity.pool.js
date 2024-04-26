'use strict';
const knex = require('../knex/knex.js');
const tableName = 'liquidity_pool';

const returnsPerShare = 100;
const funding = 10000;
const initialTokens = funding / returnsPerShare;

const calculateTruePrice = async (probeId, numOfContracts, callValue, action) => {
	const resultSet = await knex(tableName).where({ probeid: probeId }).select();
	const previousData = resultSet[0];

	if (!previousData) {
		throw new Error(`No Data found for probeid: ${probeId}`);
	}

	let newQuantityOfYes = 0;
	let newQuantityOfNo = 0;
	let newPriceOfYes = 0;
	let newPriceOfNo = 0;
	const mul = action === 'order' ? 1 : -1;
	if (callValue === "Y") {
		// no. of contracts for which we got a "PURCHASE" request
		newQuantityOfYes = previousData.quantity_yes - (numOfContracts * mul);

		// As number of "Yes" contracts has been decreased we need to add more contracts of "No" to keep the value of
		// liquidity pool unchanged, formula is : liquidityPool/( currentQuanityOfYes * previousPriceOfYes *  previousPriceOfNo)
		newQuantityOfNo = previousData.liquidity_pool / (newQuantityOfYes * previousData.price_per_contract_no * previousData.price_per_contract_yes);
		// Liquidity pool value is still not the same, we need to make adjustment in the price of both "Yes" and "No"

		newPriceOfYes = (1000 * 50) / newQuantityOfYes;
		newPriceOfNo = previousData.liquidity_pool / (newQuantityOfYes * newQuantityOfNo * newPriceOfYes);

	} else if (callValue === "N") {
		// no. of contracts for which we got a "PURCHASE" request
		newQuantityOfNo = previousData.quantity_no - (numOfContracts * mul);

		// As number of "No" contracts has been decreased we need to add more contracts of "Yes" to keep the value of
		// liquidity pool unchanged, formula is : liquidityPool/( currentQuanityOfNo * previousPriceOfYes *  previousPriceOfNo)
		newQuantityOfYes = previousData.liquidity_pool / (newQuantityOfNo * previousData.price_per_contract_no * previousData.price_per_contract_yes);
		// Liquidity pool value is still not the same, we need to make adjustment in the price of both "Yes" and "No"

		newPriceOfYes = (1000 * 50) / newQuantityOfYes;
		newPriceOfNo = previousData.liquidity_pool / (newQuantityOfYes * newQuantityOfNo * newPriceOfYes);

	}
	return {
		quantity_yes: newQuantityOfYes,
		quantity_no: newQuantityOfNo,
		price_per_contract_no: newPriceOfNo,
		price_per_contract_yes: newPriceOfYes
	};
}
const LiquidityPool = {

	add: async (probeId, initialTokens, pricePerContract) => {
		const data = {
			probeid: probeId,
			quantity_yes: initialTokens,
			quantity_no: initialTokens,
			price_per_contract_yes: pricePerContract,
			price_per_contract_no: pricePerContract,
			liquidity_pool: initialTokens * initialTokens * pricePerContract * pricePerContract
		}
		return knex.insert(data).into('liquidity_pool').catch(err => {
			throw err;
		});
	},
	// update: async (probeId, numOfContracts, callValue, action) => {
	// 	probeId = parseInt( probeId );
	// 	numOfContracts = parseInt( numOfContracts );
	// 	if( action === 'cancelsell'){
	// 		action = 'order';
	// 	}
	// 	if(
	// 		!['Y', 'N'].includes(callValue) ||
	// 		!['order', 'sell', 'cancel', 'exit'].includes(action)
	// ){
	// 		throw new Error('Invalid data received');
	// 	}
	// 	if( numOfContracts <= 0){
	// 		throw new Error("zero contracts");
	// 	}
	// 	const fieldsToUpdate = await calculateTruePrice(  probeId, numOfContracts, callValue, action );
	// 	if( fieldsToUpdate && fieldsToUpdate.price_per_contract_yes >=0 && fieldsToUpdate.price_per_contract_no >=0 &&
	// 		fieldsToUpdate.quantity_yes >=0 && fieldsToUpdate.quantity_no >=0 ){
	// 		return knex(tableName)
	// 			.update(fieldsToUpdate)
	// 			.where({ probeid: probeId })
	// 			.catch(err => {
	// 				throw err;
	// 			});
	// 	} else {
	// 		throw new Error( "less than zero values found: " + JSON.stringify(fieldsToUpdate) + "probeid: "+probeId );
	// 	}

	// },

	update: async (eventId, updateObj) => {
		let whereObj = { 'probeid': eventId };
		const resultSet = await knex(tableName).update(updateObj).where(whereObj);
	},

	get: async (probeId, columns) => {
		if (
			typeof probeId !== 'number' || probeId <= 0 ||
			!Array.isArray(columns) || columns.length === 0
		) {
			throw new Error('Invalid data received');
		}

		const resultSet = await knex
			.select(columns)
			.from(tableName)
			.where({ probeid: probeId });
		return resultSet[0];
	}
}


module.exports = {
	LiquidityPool,
	calculateTruePrice
};
// module.exports.calculateTruePrice = calculateTruePrice;
