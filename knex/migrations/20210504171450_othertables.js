exports.up = async function (knex) {
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
};

exports.down = async function (knex) {
    await knex.schema.dropTable('messages');
};
