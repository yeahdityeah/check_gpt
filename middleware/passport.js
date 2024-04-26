const{ ExtractJwt, Strategy } = require( 'passport-jwt' );
var JWTStrategy = require( 'passport-jwt' ).JWTStrategy;
const{ User } = require( '../models' );
const CONFIG = require( '../config/config' );
const{ to } = require( '../services/util.service' );

module.exports = function( passport ) {

    var opts = {};
    opts.jwtFromRequest = ExtractJwt.fromAuthHeaderAsBearerToken();
    opts.secretOrKey = CONFIG.jwt_encryption;
    passport.use( 'jwt', new Strategy( opts, async function( jwt_payload, done ) {
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
    passport.use( 'jwt-1', new Strategy( opts, async function( jwt_payload, done ) {
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

// const passportLocal = function (passport) {
//   passport.use(new Strategy(
//     function (username, password, cb) {
//       db.users.findByUsername(username, function (err, user) {
//         if (err) { return cb(err); }
//         if (!user) { return cb(null, false); }
//         if (user.password != password) { return cb(null, false); }
//         return cb(null, user);
//       });
//     }));


//   passport.serializeUser(function (user, cb) {
//     cb(null, user.id);
//   });

//   passport.deserializeUser(function (id, cb) {
//     db.users.findById(id, function (err, user) {
//       if (err) { return cb(err); }
//       cb(null, user);
//     });
//   });
// }

// module.exports.passportLocalMW = passportLocal;
// module.exports.passportJWTMW = passportJWT;

