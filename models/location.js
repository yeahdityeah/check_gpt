'use strict';

const knexReadOnly = require('../knex/knex_readonly.js');

const Location = {
    getCountries: async (partnerId = 1) => {
        let sqlQuery = `select 
        name, iso_code, isd_code, is_enabled,
        COALESCE(
                sms_enabled, (pf.login_options ->> 'is_sms_enabled')::bool, false
        ) as sms_enabled,
        COALESCE(
                whatsapp_enabled, (pf.login_options ->> 'is_whatsapp_enabled')::bool, false
        ) as whatsapp_enabled,
            COALESCE(
                (pf.login_options ->> 'is_gmail_enabled')::bool, false
        ) as gmail_enabled,
        COALESCE(
            whatsapp_otpless_enabled, (pf.login_options ->> 'is_whatsapp_otpless_enabled')::bool, false
        ) as whatsapp_otpless_enabled,
        COALESCE(
            email_enabled, (pf.login_options ->> 'is_email_enabled')::bool, false
        ) as email_enabled,
        flag_url, c.region
    from country   c
    inner join partner_feature pf on c.region = pf.region
    where is_enabled  = true and pf.partner = ?`;
        return knexReadOnly.raw(sqlQuery, [partnerId])
        .then((res) => {
            return res['rows'];
        }).catch((err) => {
            throw err;
        });
    },
    getRegions: async function () {
        const sql = `SELECT region as key, string_agg(distinct iso_code, ',') as countries, count(distinct iso_code)
        from country where is_enabled = true group by region`;
        const res = await knexReadOnly.raw(sql);
        return res?.rows ?? [];
    },
    getCountryRegion: async function (iso_code) {
        const sql = `SELECT region from country where lower(iso_code) = ?`;
        const res = await knexReadOnly.raw(sql, [(iso_code || '').toLowerCase()]);
        return res?.rows?.[0]?.region ?? 'INDIA';
    }
}

module.exports = Location;