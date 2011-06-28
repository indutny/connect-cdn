/**
 * CDN Middleware for connect
 */

var fs = require('fs'),
    path = require('path'),
    cloudfiles = require('cloudfiles');

var Cdn = module.exports = function Cdn(options) {
  if (!(this instanceof Cdn)) return new Cdn(options);

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
  this.init();

  // Prepare method
  var cdnMethod = this.cdn.bind(this);

  return function(req, res, next) {
    res.cdn = cdnMethod;
    next();
  };
};

// Init Cdn middleware
Cdn.prototype.init = function() {
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
    if (err) throw err;
    end(container);
  });

  function end(container) {
    that.container = container;
    that.processQueue();
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
Cdn.prototype.store = function(filename) {
  var that = this;

  // Skip this step if file was uploaded
  if (this.hash[filename] !== undefined) return;

  if (!this.container) {
    this.queue.push(function() {
      that.store(filename);
    });
    return;
  }

  var srcname = this.root + filename;

  // Locks
  this.hash[filename] = null;

  path.exists(srcname, function(exists) {
    // Release locks
    that.hash[filename] = undefined;

    if (!exists) return that.log('File %s not exists', srcname);

    // Locks
    that.hash[filename] = null;

    fs.stat(srcname, function(err, stat) {

      // Release locks
      that.hash[filename] = undefined;

      if (err || !stat.isFile()) {
        return that.log(err || '%s in not a file', srcname);
      }

      if (~that.watching.indexOf(srcname)) {
        that.watching.push(srcname);
        fs.watchFile(srcname, function() {
          // Renew file on change
          that.store(srcname);
        });
      }

      var match = filename.match(/^(.*?)(\.[^\.]+)?$/),
          destname = match[1] + '-' + (+stat.mtime) + (match[2] || '');

      // Locks
      that.hash[filename] = null;

      that.container.addFile(destname, srcname, function(err, uploaded) {
        // Release locks
        that.hash[filename] = undefined;

        if (err) return that.log(err);
        if (!uploaded) {
          return that.log('File wasn\'t uploaded for unknown reason');
        }

        that.hash[filename] = that.container.cdnUri + '/' + destname;
      });
    });
  });
};

// Return file's cdn url if it was uploaded
Cdn.prototype.cdn = function(filename) {
  filename = filename.replace(/^\/+/, '');

  this.store(filename);
  return this.hash[filename] ||
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
