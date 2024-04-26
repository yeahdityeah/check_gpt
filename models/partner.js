'use strict';

// @ts-ignore
const{ TE, to, waitTimer } = require( '../services/util.service' );
const CONFIG = require( '../config/config' );
const knex = require( '../knex/knex.js' );
const knexReadOnly = require( '../knex/knex_readonly.js' );
const{ redisCaching } = require( '../services/cache.service' );
const{ promisify } = require( 'util' );
const lock = promisify( require( 'redis-lock' )( redisCaching.client ) );
const lodash = require( 'lodash' );
const{ Service } = require( 'aws-sdk' );

const Partner = {
    findById: async( partnerId, useReadOnly ) => {
        try {
            const knexClient = useReadOnly === true ? knexReadOnly : knex;
            let sqlQuery = `SELECT * from partners where id = ? and is_active=true limit 1`;
            var res = await knexClient.raw( sqlQuery, [ partnerId ] );
            return res.rows.length?res.rows[0]: null;
        } catch( e ) {
            return null;
            // throw e;
        }
    },
    getAllPartnerId: async( useReadOnly ) => {
        try {
            const knexClient = useReadOnly === true ? knexReadOnly : knex;
            let sqlQuery = `SELECT id from partners`;
            var res = await knexClient.raw( sqlQuery );
            return res.rows.length?res.rows: null;
        } catch( e ) {
            throw e;
        }
    },
    insertPartnerAuth: async( dataObj, useReadOnly='true' ) => {
        try {
            const knexClient = useReadOnly === true ? knexReadOnly : knex;
            return knexClient( 'partner_auth' ).insert( dataObj ).returning( [ 'id' ] );
        } catch( e ) {
            throw e;
        }
    },
    updatePartnerAuth: async( partnerId, partnerUserId, authKey ) => {
        try {
            let sqlQuery = `update partner_auth set partner_id = ?, partner_user_id = ? where auth_key= ?`;
            var res = await knex.raw( sqlQuery, [ partnerId, partnerUserId, authKey ] );
            return res.rows.length?res.rows: null;
        } catch( e ) {
            throw e;
        }
    },
    getPartnerAuth: async( authKey, useReadOnly='true' ) => {
        try {
            const knexClient = useReadOnly === true ? knexReadOnly : knex;
            let sqlQuery = `SELECT * from partner_auth where auth_key = ?`;
            var res = await knexClient.raw( sqlQuery, [ authKey ] );
            return res.rows.length?res.rows: [];
        } catch( e ) {
            throw e;
        }
    },
    getCategories: async( partnerId, useReadOnly ) => {
        try {
            const knexClient = useReadOnly === true ? knexReadOnly : knex;
            let sqlQuery = `select category, array_agg( distinct(sub_category)) AS subcategory from partner_probe_filter where partnerid = ? group by category;`;
            var res = await knexClient.raw( sqlQuery, [ partnerId ] );
            return res.rows;
        } catch( e ) {
            throw e;
        }
    },
    getPartnerWithConfig: async( partnerId, region, useReadOnly ) => {
        try {
            const knexClient = useReadOnly === true ? knexReadOnly : knex;
            let sqlQuery = `SELECT p.id, p.name, p.is_active, p.bundle_bucket, p.support_email, p.whatsapp_number,p.createdat,p.updatedat,
            pf.partner, pf.region,pf.login_options,pf.gst_enable,pf.kyc_verification,pf.bank_account_verification,
            pf.tds_applicable,pf.deposit_pg,pf.withdraw_pg,pf.notifications, pf.sms_otp, pf.links from partners p join partner_feature pf on pf.partner = p.id where p.id = ? and p.is_active=true 
            and pf.region = ? limit 1`;
            var res = await knexReadOnly.raw( sqlQuery, [ partnerId, region ] );
            return res.rows.length?res.rows[0]: null;
        } catch( e ) {
            throw e;
        }
    },
    getPartnerWithServiceConfig: async( partnerId, region, service, country = '', version = '', platform = '', useReadOnly = true ) => {
        try {
            const knexClient = useReadOnly === true ? knexReadOnly : knex;
            let sqlQuery = `SELECT p.id, p.name, p.is_active, p.bundle_bucket, p.support_email, p.whatsapp_number,p.createdat,p.updatedat,
            pf.partner, pf.region, pf.service, merge_key_agg(c.data ORDER BY region NULLS FIRST, country NULLS FIRST) as config 
            from partners p join partner_service_config pf on pf.partner = p.id 
            inner join config c on pf.config_id = c.id 
            where p.id = :partnerId and p.is_active = true 
            and pf.region = :region and pf.service = :service AND (
				country is null or country = NULLIF(:country, '')
			) AND (
				version is null or version = NULLIF(:version, '')
			) AND (
				platform is null or platform = NULLIF(:platform, '')
			) GROUP BY p.id, p.name, p.is_active, p.bundle_bucket, p.support_email, p.whatsapp_number,p.createdat,p.updatedat,
            pf.partner, pf.region, pf.service limit 1`;
            var res = await knexReadOnly.raw( sqlQuery, { partnerId, region, service, country, version, platform } );
            return res.rows.length?res.rows[0]: null;
        } catch( e ) {
            throw e;
        }
    },
    getShareLinkForPartner: async( partnerId, probeid, useReadOnly ) => {
        try {
            const knexClient = useReadOnly === true ? knexReadOnly : knex;
            let sqlQuery = `SELECT * from probe_partner p where p.partner = ? and p.id = ? limit 1`;
            var res = await knexReadOnly.raw( sqlQuery, [ partnerId, probeid ] );
            return res.rows.length?res.rows[0]['sharelink']: null;
        } catch( e ) {
            throw e;
        }
    },
    getPartnersForService: async( service, useReadOnly ) => {
        try {
            const knexClient = useReadOnly === true ? knexReadOnly : knex;
            let sqlQuery = `SELECT pf.*, c.data as config from partner_service_config pf 
            inner join config c on pf.config_id = c.id where service = ?`;
            var res = await knexClient.raw( sqlQuery, [ service ] );
            return res.rows.length?res.rows: null;
        } catch( e ) {
            throw e;
        }
    },
    addShareLinkPartner: ( dataObj ) => {
        return knex( 'probe_partner' ).insert( dataObj ).returning( [ 'partner', 'sharelink' ] );
    },
    getActivePartners: () => {
        return knex('partners').select('id', 'name as label', 'bundle_bucket as host').where({
            is_active:  true,
        })
    }
};


module.exports = Partner;
