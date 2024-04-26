const knex = require('../knex/knex.js');

const EventsConfig = {
    getAllConfig: () => {
        const sql = 'SELECT * FROM public.events_config ORDER BY id desc';
        return knex.raw(sql)
        .then((res) => {
            return res['rows'];
        }).catch((err) => {
            throw err;
        });
    },

    createConfig: (data) => {
        return knex.insert(data, 'id').into('public.events_config').then((id) => {
            return id;
        }).catch(err => {
            console.log(err)
            throw err;
        });
    },

    updateConfig: (data) => {
        return knex('events_config')
        .where({ id: data.id })
        .update({
            event_type: data.event_type,
            event_sport: data.event_sport,
            event_category: data.event_category,
            event_config: data.event_config,
            user_id: data.user_id
        })
        .returning(['event_type', 'event_sport', 'event_category', 'event_config']);
    }

}

module.exports = EventsConfig;