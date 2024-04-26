require('dotenv').config();
module.exports = {
  development: {
    client: 'pg',
    connection: {
      host: '172.31.37.108',
      user: 'postgres_staging',
      password: 'UIb0FHxlsrUWe82d7gin',
      database: 'playox',
      charset: 'utf8'
    },
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      directory: __dirname + '/knex/migrations',
    },
    seeds: {
      directory: __dirname + '/knex/seeds'
    }
  },

  staging: {
    client: 'postgresql',
    connection: {
      // host: 'tradex-staging-primary.csf4le3jblm7.ap-south-1.rds.amazonaws.com',
      host: '172.31.37.108',
      user: 'postgres_staging',
      password: process.env.DB_PRIMARY_PASSWORD,
      database: 'playox',
      charset: 'utf8'
    },
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      tableName: 'knex_migrations'
    }
  },

  staging_readonly: {
    client: 'postgresql',
    connection: {
      // host: 'tradex-staging-primary.csf4le3jblm7.ap-south-1.rds.amazonaws.com',
      host: '172.31.37.108',
      user: 'postgres_staging',
      password: process.env.DB_PRIMARY_PASSWORD,
      database: 'playox',
      charset: 'utf8'
    },
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      tableName: 'knex_migrations'
    }
  },

  production_readonly: {
    client: 'postgresql',
    connection: {
      host: 'tradex-live-db-replica-02.csf4le3jblm7.ap-south-1.rds.amazonaws.com',
      user: 'read_write',
      password: process.env.DB_PRIMARY_PASSWORD,
      database: 'playox',
      charset: 'utf8'
    },
    pool: {
      min: 5,
      max: 10
    },
    migrations: {
      tableName: 'knex_migrations'
    }
  },
  production: {
    client: 'postgresql',
    connection: {
      host: 'tradex-database-live.csf4le3jblm7.ap-south-1.rds.amazonaws.com',
      user: 'read_write',
      password: process.env.DB_PRIMARY_PASSWORD,
      database: 'playox',
      charset: 'utf8'
    },
    pool: {
      min: 5,
      max: 10
    },
    migrations: {
      tableName: 'knex_migrations'
    }
  },
  analytics: {
    client: 'postgresql',
    connection: {
      host: 'analytics.cluster-csf4le3jblm7.ap-south-1.rds.amazonaws.com',
      user: 'analytics',
      password: process.env.ANALYTICS_DB_PRIMARY_PASSWORD,
      database: 'playox',
      charset: 'utf8'
    },
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      tableName: 'knex_migrations'
    }
  }
};