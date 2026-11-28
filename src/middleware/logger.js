'use strict';

const { randomUUID } = require('crypto');
const config = require('../config');

// One JSON object per line on stdout. Log shippers (Docker, Loki, CloudWatch) parse this easily.
function log(level, msg, extra = {}) {
  if (config.env === 'test') return;
  console.log(JSON.stringify({ time: new Date().toISOString(), level, msg, ...extra }));
}

function requestLogger(req, res, next) {
  req.id = randomUUID();
  res.setHeader('X-Request-Id', req.id);
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    log('info', 'request', {
      requestId: req.id,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Math.round(ms * 10) / 10,
    });
  });
  next();
}

module.exports = { log, requestLogger };
