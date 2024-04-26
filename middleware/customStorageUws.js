var fs = require('fs');
var Jimp = require('jimp');
var path = require('path');
var concat = require('concat-stream');
var AWS = require('aws-sdk');
const CONFIG = require('../config/config');
const { createReadStream } = require('fs');
const crypto = require("crypto");

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

const _handleFile = async (file, cb) => {
    if (!file) {
        cb(null, null);
        return;
    }
    var ext = file.filename.split('.');
    ext = ext[ext.length - 1];
    if (['jpg', 'jpeg', 'png'].indexOf(ext.toLowerCase()) > -1) {
        const imageData = file.data;
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
                setTimeout(async () => {
                    var uploadPath = await uploadToS3(tmpFile);
                    fs.unlinkSync(tmpFile);
                    cb(null, { gcsFileName: uploadPath });
                }, 100);

            })
            .catch((err) => {
                cb(err);
            });
    } else {
        cb('Invalid file');
    }
}

module.exports._handleFile = _handleFile;