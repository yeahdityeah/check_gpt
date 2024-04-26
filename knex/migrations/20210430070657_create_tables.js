
exports.up = async function (knex) {
    await knex.schema.createTable('users', function (table) {
        table.increments();
        table.string('email');
        table.string('displayname');
        table.string('bio');
        table.string('avatar');
        table.double('coins');
        table.string('coupon');
        table.string('fcmtoken');
        table.string('location');
        table.timestamp('createdat').defaultTo(knex.fn.now())
        table.timestamp('updatedat').defaultTo(knex.fn.now())
    });
    await knex.schema.createTable('probes', function (table) {
        table.increments();
        table.string('title');
        table.string('type');
        table.string('description');
        table.string('category');
        table.float('entryfee').defaultTo(0);
        table.integer('proptionsid');
        table.integer('correctproptionid');
        table.integer('correctvalue');
        table.string('imageurl');
        table.string('videourl');
        table.string('status');
        table.integer('createdby');
        table.timestamp('createdat').defaultTo(knex.fn.now())
        table.timestamp('updatedat').defaultTo(knex.fn.now())
    });
    await knex.schema.createTable('proptions', function (table) {
        table.increments();
        table.string('text');
        table.integer('probeid');
        table.float('odds');
        table.timestamp('createdat').defaultTo(knex.fn.now());
        table.timestamp('updatedat').defaultTo(knex.fn.now());
    });
    await knex.schema.createTable('probecalls', function (table) {
        table.increments();
        table.integer('userid');
        table.integer('probeid');
        table.integer('proptionid');
        table.integer('rank').defaultTo(0);
        table.float('odds').defaultTo(0.0);
        table.float('callvalue').defaultTo(0.0);
        table.float('coins');
        table.float('returns');
        table.timestamp('createdat').defaultTo(knex.fn.now());
        table.timestamp('updatedat').defaultTo(knex.fn.now());
    });
    await knex.schema.createTable('settlements', function (table) {
        table.increments();
        table.integer('userid');
        table.integer('sourceid');
        table.integer('source');
        table.string('refid');
        table.string('description');
        table.float('coins');
        table.timestamp('createdat').defaultTo(knex.fn.now());
    });
    await knex.schema.createTable('messages', function (table) {
        table.increments();
        table.integer('userid');
        table.integer('fromuserid');
        table.string('type');
        table.string('image');
        table.string('message');
        table.boolean('read').defaultTo(false);
        table.timestamp('createdat').defaultTo(knex.fn.now())
        table.timestamp('updatedat').defaultTo(knex.fn.now())
    });
    await knex.schema.createTable('transactions', function (table) {
        table.increments();
        table.integer('userid');
        table.float('amount');
        table.string('type');
        table.string('txnid');
        table.string('message');
        table.timestamp('createdat').defaultTo(knex.fn.now())
        table.timestamp('updatedat').defaultTo(knex.fn.now())
    });
    await knex.schema.createTable('redeems', function (table) {
        table.increments();
        table.string('transactionid');
        table.string('status');
        table.string('referrer');
        table.string('refid');
        table.timestamp('createdat').defaultTo(knex.fn.now());
        table.timestamp('updatedat').defaultTo(knex.fn.now());
    });
};

exports.down = async function (knex) {
    await knex.schema.dropTable('users');
    await knex.schema.dropTable('probes');
    await knex.schema.dropTable('proptions');
    await knex.schema.dropTable('probecalls');
    await knex.schema.dropTable('transactions');
    await knex.schema.dropTable('settlements');
    await knex.schema.dropTable('messages');
};
