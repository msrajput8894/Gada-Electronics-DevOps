'use strict';

const { HttpError } = require('../errors');
const { log } = require('./logger');

function notFound(req, res, next) {
  next(new HttpError(404, 'Not found'));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON' });
  }
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: Object.values(err.errors).map((e) => e.message),
    });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ error: `Invalid value for ${err.path}` });
  }
  if (err.code === 11000) {
    return res.status(409).json({ error: 'Duplicate value' });
  }
  log('error', 'unhandled error', { path: req.originalUrl, stack: err.stack });
  return res.status(500).json({ error: 'Internal server error' });
}

module.exports = { notFound, errorHandler };
