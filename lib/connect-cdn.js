/**
 * CDN Middleware for connect
 */

var fs = require('fs'),
    path = require('path'),
    cloudfiles = require('cloudfiles');

// TODO: Remove this when @indexzero will push new version of
//       cloudfiles to npm
cloudfiles.mime.types['.ttf'] = 'application/x-font-ttf';
cloudfiles.mime.types['.woff'] = 'application/x-woff';

var Cdn = module.exports = function Cdn(options, callback) {
  if (!(this instanceof Cdn)) return new Cdn(options, callback);

  var container = options.container || 'connect-cdn',
      service = options.service ||
                options.cloudfiles &&
                cloudfiles.createClient(options.cloudfiles),
      root = options.root || './';

  this.containerName = container;
  this.service = service;

  // Add trailing slash
  this.root = root.replace(/([^\/])$/, '$1/');

  // Turn off loggin if debug is not enabled
  if (!options.debug) {
    this.log = function() {};
  }

  // Init instance
  this.init(callback);

  // Prepare method
  var cdnMethod = this.cdn.bind(this);

  function middleware(req, res, next) {
    res.cdn = cdnMethod;
    next();
  };
  middleware.cdn = cdnMethod;

  return middleware;
};

// Init Cdn middleware
Cdn.prototype.init = function(callback) {
  var that = this;

  this.queue = [];
  this.watching = [];
  this.container = null;
  this.hash = {};

  var c = new cloudfiles.Container(this.service, {
    name: this.containerName,
    cdnEnabled: true
  });

  this.service.createContainer(c, function(err, container) {
    if (err) {
      if (callback) {
        callback(err);
        return;
      }
      throw err;
    }
    end(container);
  });

  function end(container) {
    that.container = container;
    that.processQueue();
    callback && callback(that);
  };
};

// Process store queue
Cdn.prototype.processQueue = function() {
  this.queue.forEach(function(fn) {
    fn();
  });
  this.queue = [];
};

// store file on cdn
Cdn.prototype.store = function(filename, immediate, force) {
  var that = this;

  // Skip this step if file was uploaded
  if (!force && this.hash[filename] !== undefined) return;

  if (!this.container) {
    this.queue.push(function() {
      that.store(filename, immediate, force);
    });
    return;
  }

  var parsedName = filename.match(/^([^#\?]*)([#\?].*)?$/),
      srcname = this.root + parsedName[1];

  if (!path.existsSync(srcname)) {
    this.log('File %s not exists', srcname);
    return;
  }

  try {
    var stat = fs.statSync(srcname);
  } catch(e) {
    this.log(e);
    return;
  }

  if (!stat.isFile()) {
    this.log('%s in not a file', srcname);
    return;
  }

  var match = parsedName[1].match(/^(.*?)(\.[^\.]+)?$/),
      destname = match[1] + '-' + (+stat.mtime) + (match[2] || ''),
      destUrl = this.container.cdnUri + '/' + destname + (parsedName[2] || '');

  if (this.watching.indexOf(srcname) === -1) {
    this.watching.push(srcname);
    fs.watchFile(srcname, function() {
      // Renew file on change
      that.store(filename, immediate, true);
    });
  }

  // Locks
  this.hash[filename] = immediate ? destUrl : null;

  var options = {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Encoding': 'gzip'
    }
  };
  this.container.addFile(destname, srcname, options, function(err, uploaded) {
    // Release locks
    that.hash[filename] = undefined;

    if (err) return that.log(err);
    if (!uploaded) {
      return that.log('File wasn\'t uploaded for unknown reason');
    }

    that.hash[filename] = destUrl;
  });
};

// Return file's cdn url if it was uploaded
Cdn.prototype.cdn = function(filename, immediate) {
  var _filename = filename.toString().replace(/^\/+/, '');

  this.store(_filename, immediate);

  return this.hash[_filename] ||
         filename;
};

// Destroy instance
Cdn.prototype.destroy = function() {
  var that = this;

  that.watching.forEach(function(filename) {
    try {
      fs.unwatchFile(filename);
    } catch(e) {
      that.log(e);
    }
  });
};

// Express helper
Cdn.expressHelper = function(app) {
  app.dynamicHelpers({
    cdn: function(req, res) {
      return res.cdn;
    }
  });
};

// Debug mode only
Cdn.prototype.log = function() {
  console.log.apply(console, arguments);
};
