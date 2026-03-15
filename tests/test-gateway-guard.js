'use strict';

var guard = require('../shared/gateway-guard');
var isOriginAllowed = guard.isOriginAllowed;
var isRateLimited   = guard.isRateLimited;
var RATE_MAX        = guard.RATE_MAX;
var buckets         = guard.buckets;

var passed = 0;
var failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error('  FAIL: ' + label);
  }
}

console.log('Origin validation:');

// Allowed
assert(isOriginAllowed(undefined)                      === true,  'undefined origin allowed');
assert(isOriginAllowed(null)                           === true,  'null origin allowed');
assert(isOriginAllowed('null')                         === true,  'string "null" allowed');
assert(isOriginAllowed('file://local')                 === true,  'file:// allowed');
assert(isOriginAllowed('http://localhost')              === true,  'http://localhost allowed');
assert(isOriginAllowed('http://localhost:18789')        === true,  'http://localhost:18789 allowed');
assert(isOriginAllowed('https://localhost:3000')        === true,  'https://localhost:3000 allowed');
assert(isOriginAllowed('http://127.0.0.1')             === true,  'http://127.0.0.1 allowed');
assert(isOriginAllowed('http://127.0.0.1:8080')        === true,  'http://127.0.0.1:8080 allowed');
assert(isOriginAllowed('http://[::1]')                 === true,  'http://[::1] allowed');
assert(isOriginAllowed('http://[::1]:18789')            === true,  'http://[::1]:18789 allowed');

// Blocked
assert(isOriginAllowed('https://evil.com')             === false, 'https://evil.com blocked');
assert(isOriginAllowed('http://attacker.local')        === false, 'http://attacker.local blocked');
assert(isOriginAllowed('https://example.com')         === false, 'https://example.com blocked');
assert(isOriginAllowed('http://localhost.evil.com')     === false, 'http://localhost.evil.com blocked');
assert(isOriginAllowed('http://127.0.0.2')             === false, 'http://127.0.0.2 blocked');
assert(isOriginAllowed('https://10.0.0.1')            === false, 'https://10.0.0.1 blocked');
assert(isOriginAllowed('http://192.168.1.1')           === false, 'http://192.168.1.1 blocked');

console.log('Rate limiting:');

buckets.clear();

for (var i = 0; i < RATE_MAX; i++) {
  assert(isRateLimited('test-ip') === false, 'connection ' + (i + 1) + ' allowed');
}
assert(isRateLimited('test-ip') === true, 'connection ' + (RATE_MAX + 1) + ' blocked');

assert(isRateLimited('other-ip') === false, 'different IP allowed independently');

console.log('');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All gateway-guard tests passed.');
}
