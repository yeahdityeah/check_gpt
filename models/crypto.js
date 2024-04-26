const knex = require("../knex/knex.js");

const log = (...args) => console.log(`[CRYPTO MODEL]`, ...args);

const Crypto = {
  getCryptoDetails: async function(refId, trx) {
    try {
        const client  = trx || knex;
        const res = await client.raw(`SELECT * FROM crypto_payment_detail where ref_id = :refId and status = 'good'`, {
            refId
        })
        return res?.rows ?? [];
    } catch(e) {
        log(e.message)
        throw e;
    }
  },
  upsertCryptoPaymentDetails: async function (payload, trx) {
    try {
      const client  = trx || knex;
      const sql = `INSERT INTO public.crypto_payment_detail as cpd 
                select * from json_populate_recordset(
                    null::crypto_payment_detail, 
                    :payload
                )
                ON CONFLICT  on constraint crypto_payment_detail__pkey
                DO UPDATE  SET
                    status = excluded.status,
                    status_ts = 
                        case when excluded.status = cpd.status 
                        THEN cpd.status_ts else excluded.status_ts end,
                    order_amount = 
                        case when excluded.status = cpd.status 
                        THEN cpd.order_amount else excluded.order_amount end,
                    transaction_fee_amount = 
                        case when excluded.status = cpd.status 
                        THEN cpd.transaction_fee_amount else excluded.transaction_fee_amount end,
                    crypto_amount = 
                        case when excluded.status = cpd.status 
                        THEN cpd.crypto_amount else excluded.crypto_amount end
                returning 
                txid,
                network,
                status,
                payment_id as id,
                user_id, 
                order_amount,
                transaction_fee_amount,
                format('Payment successfully completed for %1$s credits
at an exchange rate of 1%2$s = %3$s credits
txid %4$s on network %5$s', order_amount, crypto_currency, exchange_rate, txid, network  ) as message;	`;
        const res = await client.raw(sql, {
            payload: JSON.stringify(payload)
        })
        return res?.rows || []
    } catch (e) {
        log(e.message)
        throw e;
    }
  },
};

module.exports = Crypto;
