const CONFIG = require("../config/config");
const messages = {
    MARKET_CLOSED_BUY: 'This market is now closed for taking positions.',
    MARKET_CLOSED_HALTED: 'Trading temporarily suspended. We will be back soon when play resumes.',
    MARKET_CLOSED_CANCEL: 'This market is now closed for cancelling orders.',
    MARKET_CLOSED_SELL: 'This market is now closed for selling orders.',
    USER_BLOCKED: 'Your account has been blocked for violating our policies. Contact support for further queries.',
    USER_SUSPENDED: 'Your account has been temporarily suspended  for violating policies. Please try again later',
    REQUEST_IN_PROGRESS: 'Your request already in progress',
    INVALID_REQUEST: 'Invalid Request',
    UNAUTHORIZED_REQUEST: 'Unauthorized Request',
    BAD_REQUEST: 'Bad Request',
    INSUFFICIENT_FUNDS: 'Insufficient Funds',
    INSUFFICIENT_LUCKYCOINS: 'Insufficient Token points',
    POSITIONS_LIMIT: `You've reached the participation limit on this tournament!`,
    TOURNAMENT_CLOSED: 'This tournament has been closed for participation!',
    NO_SPOTS: 'No more spots available for participation!',
    TAKING_TIME: 'Taking time. Please try again!',
    NOT_FOUND: 'Not Found',
    TRADING_NOT_ALLOWED: 'Trading is not allowed on this version of app. Please update. If you are on web, Close the tab and open the link again',
    TRADING_SECURITY_HALT: 'Trading is currently on hold due to maintenance work. Apologies for the inconvenience caused. We will be up shortly.',
    MARKET_ADD_LIQUIDITY: 'This market is now closed for updating liquidity.',
    BUY_INSTANT_MATCH_MAX_LIMIT_ERR: `Cannot purchase shares worth more than ${CONFIG.INSTANT_MATCH_POSITION_MAX_ALLOWED} at a time`,
    SELL_INSTANT_MATCH_MAX_LIMIT_ERR: `Cannot sell shares worth more than ${CONFIG.INSTANT_MATCH_POSITION_MAX_ALLOWED} at a time`,
    TRADING_BLOCKED: 'Trading is not allowed in your region. Please contact support for more details',
    TRADE_DECLINED_HIGH_TRADE_PRICE: 'Trade declined, as trade execution price is more than 99 and guarantees a loss after trading fee. ',
    NOT_ELIGIBLE_TO_BUY: 'Because of too much traffic, not able to place order',
    GPE_CAN_ONLY_BUY_ONCE: 'You can place 1 trade on this event. Please contact support for more details',
    MAX_ALLOWED_GPE_REACHED: 'Because of too much traffic, not able to place order',
    TRADING_BLOCKED_USER: 'Due to technical maintenance your withdrawal, deposits and Trading is on halt. We apologise for the inconvenience. Services will be up soon.',
    NO_MARKET_ORDER_PLACED: 'No matching positions available',
    NO_PG_REGION: 'No Payment gateway configured for the region',
    PARTNER_NOT_EXIST: 'Invalid Partner id',
    PARTNER_INVALID_PAYLOAD: 'Payload is incorrect. Either partner_id or user_id is missing',
    PARTNER_AUTH_NOT_FOUND: 'Auth key is not found',
    PARTNER_INVALID_AUTH_COUNT: 'More than one auth key found',
    PARTNER_PRIVATE_KEY_MISMATCH: 'In correct authkey and payload combination. This content is encrypt with some other key',
    WITHDRAW_DISABLE_FOR_MM_USERS: 'Withdraw is not allowed for internal MM users',
    PARTNER_USER_ERROR: 'Partner user does not exist. Looks like users is not logged in',
    PARTNER_WALLET_ERROR: 'This functionality is not enabled for you',
    OPEN_SELL_CREDIT_INVALID_PAYLOAD: 'Invalid payload for the credit api',
    PARTNER_NOT_SUPPORTED_ACTION: 'This partner is not supported for the payment option',
    WITHDRAW_NOT_ALLOWED_YEAREND: 'Withdraw requests temporarily disabled for year end financials, will resume on April 2nd 12:00AM IST'
};

module.exports.messages = messages;







