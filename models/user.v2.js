'use strict';

const bcrypt = require('bcrypt');
const bcrypt_p = require('bcrypt-promise');
const jwt = require('jsonwebtoken');
const { TE, to } = require('../services/util.service');
const CONFIG = require('../config/config');
const knex = require('../knex/knex.js');
// const { whereNot } = require('../knex/knex.js');

const User = {
	findById: (userId) => {
		return knex('users').where({
			id: userId
		}).then((rows) => {
			return rows[0];
		}).catch((err) => {
			throw err;
		});
	},
	findFcmTokenById: (userId) => {
		return knex('users').select('fcmtoken').where({
			id: userId
		}).then((rows) => {
			return rows[0];
		}).catch((err) => {
			throw err;
		});
	}
}

async function comparePwd(pwdRef, pwdSrc) {
	let err, pass;
	if (!pwdRef) {
		TE('Password not set');
	}
	[err, pass] = await to(bcrypt_p.compare(pwdRef, pwdSrc));

	if (err) TE(err);

	if (!pass) TE('Invalid Password');

	return pass;
}

module.exports = User;
