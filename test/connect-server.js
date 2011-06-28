var connect = require('connect'),
    cdn = require('../lib/connect-cdn');

connect(cdn({
  root: __dirname + '/data',
  cloudfiles: {
    auth: {
      username: 'username',
      apiKey: 'apiKey'
    }
  }
}), function(req, res) {
  var file = res.cdn('x.js');

  console.log(file);
  res.writeHead(200);
  res.end(file);
}).listen(8082);
