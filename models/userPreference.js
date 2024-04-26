'use strict';
const knex = require('../knex/knex.js');

const UserPreference = {
    createPreference: async function (dataObj) {
        return knex.insert(dataObj, 'id')
        .into('user_preference').then((id) => {
            return id;
        }).catch(err => {
            throw err;
        });
    },

    getPreference: async function (userId) {
        return knex('user_preference')
        .select('category_preference', 'probes_viewed')
        .where({ userid: userId })
        .then((res) => {
            return res;
        }).catch((err) => {
            throw err; 
        });
    },

    updateCategoryPreference: async function (dataObj) {
        return knex('user_preference')
        .where({ userid: dataObj['userid'] })
        .update({ category_preference: dataObj['category_preference']})
        .then((res) => {
            return res;
        }).catch((err)=>{
            throw err;
        })
    },

    updateProbesViewed: async function (dataObj) {
        return knex('user_preference')
        .where({ userid: dataObj['userid'] })
        .update({ probes_viewed: dataObj['probes_viewed']})
        .then((res) => {
            return res;
        }).catch((err)=>{
            throw err;
        }) 
    },

    doesPreferenceExist: async function(userId) {
        const sql = `select count(*) from user_preference where userid = ${userId}`;
        return knex.raw(sql).then((res)=>{
            return parseInt(res.rows[0].count) !== 0;
        }).catch((err)=>{
            throw err;
        })
    },

    getAllExistingPreferenceRows: async function(){
        try{
			const sql = `select userid from user_preference order by id`;
			return knex.raw(sql).then((res) => {
				return res.rows;
			})
		}catch(err){
			throw err;
		}
    }
}

module.exports = UserPreference;