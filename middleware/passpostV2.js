const{ ExtractJwt, Strategy } = require( 'passport-jwt' );
var JWTStrategy = require( 'passport-jwt' ).JWTStrategy;
const{ User } = require( '../models' );
const CONFIG = require( '../config/config' );
const{ to } = require( '../services/util.service' );

module.exports = function( passport ) {

    var opts = {};
    opts.jwtFromRequest = ExtractJwt.fromAuthHeaderAsBearerToken();
    opts.secretOrKey = CONFIG.jwt_encryption_v2;
    passport.use( 'jwt-2', new Strategy( opts, async function( jwt_payload, done ) {
        let err, user;
        if( jwt_payload.user_id ) {
            [ err, user ] = await to( User.findById( jwt_payload.user_id, false ) );
        } else if( jwt_payload.dashboard_user_id ) {
            [ err, user ] = await to( User.findDashboardUserById( jwt_payload.dashboard_user_id ) );
        }

        if( err ) return done( err, false );

        if( user ) {
            return done( null, user );
        } else {
            return done( null, false );
        }
    }) );
    passport.use( 'jwt-3', new Strategy( opts, async function( jwt_payload, done ) {
        let err, user;
        if( jwt_payload.user_id ) {
            [ err, user ] = await to( User.findById( jwt_payload.user_id, false ) );
        } else if( jwt_payload.dashboard_user_id ) {
            [ err, user ] = await to( User.findDashboardUserById( jwt_payload.dashboard_user_id ) );
        }

        if( err ) return done( err, false );

        if( user ) {
            return done( null, user );
        } else {
            if( jwt_payload.user_id == -1 ) {
                return done( null, { id: -1 });
            }
            return done( null, false );
        }
    }) );


};
