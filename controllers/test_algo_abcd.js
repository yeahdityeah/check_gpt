let cp = require('child_process');
//child_process helps in running cmd commands inside the code windows has many commands
console.log('trying cp');
let output = cp.execSync('open abcd.js') //write correct file path and try
console.log(output);
// cp.execSync('open tradingfee.controller.js');
// cp.execSync('open chrome https://www.google.com'); only in windows
//we can run any file of python/nodejs/c++ in nodejs using child_process module
console.log('opened calculator');


let os = require("os");
console.log(os.arch());
console.log(os.platform());
console.log(os.networkInterfaces());
console.log(os.cpus());