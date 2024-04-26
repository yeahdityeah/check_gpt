'use strict';

const lodash = require('lodash');
const knex = require('../knex/knex.js');
const knexReadOnly = require('../knex/knex_readonly.js');
const { to } = require('../services/util.service');
const crypto = require('crypto');

const Club = {
    create: async (dataObj) => {
        dataObj['id'] = crypto.randomBytes(16).toString('hex');
        return knex.insert(dataObj, 'id').into('social.club').then((id) => {
            return id;
        }).catch(err => {
            console.log(err)
            throw err;
        });
    },
    update: function (dataObj) {
        try {
            return knex('social.club')
                .where({ id: dataObj['id'] })
                .update(dataObj)
                .returning(['id']);
        } catch (e) {
            throw e;
        }
    },
    getClubs: async (userId) => {
        let sqlParams = { userId };
        const sql = `
        with distinct_clubs as (
            select distinct club_id as id from
            social.club_member
            where user_id = :userId and status = 'A'
        )
            select 
                c.id, c.title, 
                c.image_url,
                :userId = c.owner_id as is_owner,
                COALESCE ( count(distinct user_id), 0 ) as total_members,
                    count( distinct
                        (case 
                        when ce.status = 'A' and ce.starts_at < now() and ce.ends_at > now() 
                        then ce.id else null end) )
                    as active_markets
            from social.club c 
            left join social.club_member cm on  c.id = cm.club_id 
            left outer join social.club_event ce
        on c.id = ce.club_id
            WHERE
            c.id IN (select id from distinct_clubs)  and
            c.status = 'A' and
            cm.status = 'A' 
            group by c.id, c.title, c.image_url
        `;
        return knex.raw(sql, sqlParams).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    getClubById: async (clubId) => {
        let sqlParams = [clubId];
        let whereClause = ` where 1 = 1 and status = 'A' and a.id = ? `;
        const sql = `SELECT * FROM social.club a ${whereClause}`;
        return knex.raw(sql, sqlParams).then((res) => {
            return res.rows;
        }).catch((e) => {
            throw e;
        });
    },
    isClubMember: async (clubId, userId) => {
        let sqlParams = [clubId, userId];
        let whereClause = ` where 1 = 1 and status = 'A' and a.club_id = ? and a.user_id = ?`;
        const sql = `SELECT * FROM social.club_member a ${whereClause}`;
        return knex.raw(sql, sqlParams).then((res) => {
            return res.rows.length?true:false;
        }).catch((e) => {
            throw e;
        });
    },
    joinClub: async (dataObj) => {
        return knex.insert(dataObj, 'id').into('social.club_member').then((id) => {
            return id;
        }).catch(err => {
            throw err;
        });
    },
    getTotalClubMembers: async function (club_id) {
        let sqlQuery = `select count (distinct user_id) from social.club_member where club_id = '${club_id}' and status = 'A'`;
        return knex.raw(sqlQuery)
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    },
    getUserIdClubMembers: async function (club_id, offset) {
		let sqlQuery = "select user_id from social.club_member where club_id = ? and status = 'A' order by id limit 500 offset ?"
        return knex.raw(sqlQuery, [club_id, offset])
            .then((res) => {
                return res['rows'];
            }).catch((err) => {
                throw err;
            });
    }
}

module.exports = Club;
