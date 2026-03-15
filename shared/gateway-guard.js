'use strict';

var http = require('http');
var net  = require('net');
var fs   = require('fs');
var path = require('path');

var LISTEN_PORT    = 18789;
var GATEWAY_HOST   = '127.0.0.1';
var GATEWAY_PORT   = 18790;

var RATE_WINDOW_MS = 10000;
var RATE_MAX       = 5;

var LOG_DIR  = path.join(process.env.HOME || '/tmp', '.openclaw', 'logs');
var LOG_FILE = path.join(LOG_DIR, 'gateway-guard.log');

function ensureLogDir() {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) { /* ignore */ }
}

function log(level, msg, meta) {
  var ts = new Date().toISOString();
  var line = meta
    ? ts + ' [guard] ' + level + ': ' + msg + ' ' + JSON.stringify(meta)
    : ts + ' [guard] ' + level + ': ' + msg;
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) { /* ignore */ }
  if (level === 'warn' || level === 'error') {
    process.stderr.write(line + '\n');
  }
}

var LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i;

function isOriginAllowed(origin) {
  if (origin === undefined || origin === null) return true;
  if (origin === 'null') return true;
  if (typeof origin === 'string' && origin.startsWith('file://')) return true;
  if (LOCAL_ORIGIN_RE.test(origin)) return true;
  return false;
}

var buckets = new Map();

function isRateLimited(ip) {
  var now = Date.now();
  var hits = buckets.get(ip);
  if (!hits) {
    hits = [];
    buckets.set(ip, hits);
  }
  while (hits.length > 0 && hits[0] <= now - RATE_WINDOW_MS) {
    hits.shift();
  }
  if (hits.length >= RATE_MAX) {
    return true;
  }
  hits.push(now);
  return false;
}

var cleanupTimer = setInterval(function () {
  var now = Date.now();
  buckets.forEach(function (hits, ip) {
    while (hits.length > 0 && hits[0] <= now - RATE_WINDOW_MS) {
      hits.shift();
    }
    if (hits.length === 0) buckets.delete(ip);
  });
}, 60000);
cleanupTimer.unref();

module.exports = {
  isOriginAllowed: isOriginAllowed,
  isRateLimited: isRateLimited,
  RATE_MAX: RATE_MAX,
  RATE_WINDOW_MS: RATE_WINDOW_MS,
  buckets: buckets
};

// ---------------------------------------------------------------------------
// Shared upgrade handler
// ---------------------------------------------------------------------------

function handleUpgrade(req, clientSocket, head) {
  var remoteIp = req.socket.remoteAddress || 'unknown';
  var origin   = req.headers['origin'];

  if (!isOriginAllowed(origin)) {
    log('warn', 'blocked: bad origin', { origin: origin, ip: remoteIp, url: req.url });
    clientSocket.write(
      'HTTP/1.1 403 Forbidden\r\n' +
      'Connection: close\r\n' +
      'Content-Type: text/plain\r\n' +
      '\r\n' +
      'Origin not allowed\n'
    );
    clientSocket.destroy();
    return;
  }

  if (isRateLimited(remoteIp)) {
    log('warn', 'blocked: rate limit', { ip: remoteIp, url: req.url });
    clientSocket.write(
      'HTTP/1.1 429 Too Many Requests\r\n' +
      'Connection: close\r\n' +
      'Content-Type: text/plain\r\n' +
      'Retry-After: 10\r\n' +
      '\r\n' +
      'Too many connections\n'
    );
    clientSocket.destroy();
    return;
  }

  var gwSocket = net.connect(GATEWAY_PORT, GATEWAY_HOST, function () {
    var raw = req.method + ' ' + req.url + ' HTTP/' + req.httpVersion + '\r\n';
    for (var i = 0; i < req.rawHeaders.length; i += 2) {
      raw += req.rawHeaders[i] + ': ' + req.rawHeaders[i + 1] + '\r\n';
    }
    raw += '\r\n';
    gwSocket.write(raw);
    if (head && head.length > 0) gwSocket.write(head);
    clientSocket.pipe(gwSocket);
    gwSocket.pipe(clientSocket);
  });

  gwSocket.on('error', function (err) {
    log('error', 'gateway connect failed', { error: err.message });
    clientSocket.write(
      'HTTP/1.1 502 Bad Gateway\r\n' +
      'Connection: close\r\n' +
      '\r\n'
    );
    clientSocket.destroy();
  });

  clientSocket.on('error', function () { gwSocket.destroy(); });
}

function handleHttp(_req, res) {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found\n');
}

// ---------------------------------------------------------------------------
// Start (skip if loaded as a module for testing)
// ---------------------------------------------------------------------------

if (require.main === module) {
  ensureLogDir();

  // Listen on both IPv4 and IPv6 loopback to prevent bypass
  var server4 = http.createServer(handleHttp);
  server4.on('upgrade', handleUpgrade);
  server4.listen(LISTEN_PORT, '127.0.0.1', function () {
    log('info', 'listening on 127.0.0.1:' + LISTEN_PORT);
  });

  var server6 = http.createServer(handleHttp);
  server6.on('upgrade', handleUpgrade);
  server6.listen(LISTEN_PORT, '::1', function () {
    log('info', 'listening on [::1]:' + LISTEN_PORT);
  });

  console.log('[gateway-guard] listening on 127.0.0.1:' + LISTEN_PORT + ' + [::1]:' + LISTEN_PORT + ' -> ' + GATEWAY_HOST + ':' + GATEWAY_PORT);

  function shutdown(sig) {
    log('info', 'shutting down on ' + sig);
    var closed = 0;
    function onClose() { if (++closed >= 2) process.exit(0); }
    server4.close(onClose);
    server6.close(onClose);
    setTimeout(function () { process.exit(1); }, 3000);
  }
  process.on('SIGTERM', function () { shutdown('SIGTERM'); });
  process.on('SIGINT', function () { shutdown('SIGINT'); });
}
