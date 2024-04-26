var fs = require('fs');
var Jimp = require('jimp');
var path = require('path');
var concat = require('concat-stream');
var AWS = require('aws-sdk');
const CONFIG = require('../config/config');
const { createReadStream } = require('fs');
const crypto = require("crypto");

const {
    User
} = require('../models');

require( 'dotenv' ).config();
AWS.config.update({ 'accessKeyId': process.env.AWSAccessKeyId,
    'secretAccessKey': process.env.AWSSecretKey, region: 'ap-south-1' });
s3 = new AWS.S3({ apiVersion: '2006-03-01' });

const tmpFilePath = path.join(__dirname, '../public/tp/');

const DEFAULT_BUCKET_NAME = CONFIG.awsBucket;

const uniqueString = function () {
    return Date.now() + crypto.randomBytes(2).toString('hex');
}

async function uploadToS3(file) {
    var uploadParams = { Bucket: DEFAULT_BUCKET_NAME, Key: '', Body: '' };
    return new Promise((resolve, reject) => {
        var fileStream = createReadStream(file);
        fileStream.on('error', function (err) {
            console.log('File Error', err);
        });
        uploadParams.Body = fileStream;
        uploadParams.Key = path.basename(file);
        uploadParams.ACL = 'public-read';

        s3.upload(uploadParams, function (err, data) {
            if (err) {
                reject(err);
            } if (data) {
                resolve(data.Location);
            }
        });

    });

}


function CustomStorage(opts) {
    this.getDestination = (opts.destination || getDestination)
    this.getFileName = (opts.filename)
}

CustomStorage.prototype._processImage = async function _processImage(tmpFile, cb) {
    try {
        var uploadPath = await uploadToS3(tmpFile);
        fs.unlinkSync(tmpFile);
        cb(null, { gcsFileName: uploadPath });
    } catch (e) {
        cb(e);
    }
}

CustomStorage.prototype._createOutputStream = function (filepath, cb) {
    // create a reference for this to use in local functions
    var that = this;
    // create a writable stream from the filepath
    var output = fs.createWriteStream(filepath);
    // set callback fn as handler for the error event
    output.on('error', cb);
    // set handler for the finish event
    output.on('finish', function () {
        cb(null, {
            destination: that.uploadPath,
            baseUrl: that.uploadBaseUrl,
            filename: path.basename(filepath),
            storage: that.options.storage
        });
    });
    return output;
};


CustomStorage.prototype._handleFile = function _handleFile(req, file, cb) {
    if (!file) {
        cb(null, null);
        return;
    }
    var that = this;
    var ext = file.originalname.split('.');
    ext = ext[ext.length - 1];
    if (['jpg', 'jpeg', 'png'].indexOf(ext.toLowerCase()) > -1) {
        var fileManipulate = concat(function (imageData) {
            Jimp.read(imageData)
                .then((image) => {
                    let name = uniqueString();
                    // console.log(name);
                    let x = 256, y = 256, tmpFileName = `${name}.${ext}`;
                    var clone = image.clone();
                    let { width, height } = clone.bitmap;
                    if (height > width) {
                        x = Math.min(720, width);
                        y = Jimp.AUTO;
                    } else {
                        y = Math.min(720, height);
                        x = Jimp.AUTO;
                    }
                    var tmpFile = `${tmpFilePath}${tmpFileName}`;
                    image.resize(x, y)
                        .quality(60)
                        .write(tmpFile)
                    setTimeout(() => {
                        that._processImage(tmpFile, cb);
                    }, 100);

                })
                .catch((err) => {
                    cb(err);
                });
        });
        file.stream.pipe(fileManipulate);
    } else if (['csv'].indexOf(ext.toLowerCase()) > -1) {
        // cb(null, { gcsFileName: file.path });
        var fileManipulate = concat(function (fileData) {
            cb(null, { gcsFileName: fileData });
        });
        file.stream.pipe(fileManipulate);
    } else {
        cb('Invalid file');
    }
}

CustomStorage.prototype._removeFile = function _removeFile(req, file, cb) {
    fs.unlink(file.path, cb)
}

module.exports = function (opts) {
    return new CustomStorage(opts)
}