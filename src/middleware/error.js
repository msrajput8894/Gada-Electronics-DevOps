'use strict';

const { HttpError } = require('../errors');
const { log } = require('./logger');

function notFound(req, res, next) {
  next(new HttpError(404, 'Not found'));
}

const DATABASE_UNAVAILABLE_ERRORS = new Set([
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoServerSelectionError',
  'MongooseServerSelectionError',
  'MongoTimeoutError',
]);

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const requestId = req.id;
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: err.message,
      ...(err.details ? { details: err.details } : {}),
      ...(requestId ? { requestId } : {}),
    });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON', requestId });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large (maximum 100 KB)', requestId });
  }
  if (err.type === 'encoding.unsupported') {
    return res.status(415).json({ error: 'Request content encoding is not supported', requestId });
  }
  if (err.type === 'request.aborted') {
    return res.status(400).json({ error: 'Request was interrupted before it could be read', requestId });
  }
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: Object.values(err.errors).map((e) => e.message),
      requestId,
    });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ error: `Invalid value for ${err.path}`, requestId });
  }
  if (err.code === 11000) {
    const message = err.keyPattern?.email
      ? 'An account with this email already exists'
      : 'A record with this value already exists';
    return res.status(409).json({ error: message, requestId });
  }
  if (DATABASE_UNAVAILABLE_ERRORS.has(err.name)) {
    log('warn', 'database unavailable', {
      requestId,
      method: req.method,
      path: req.path,
      error: err.message,
    });
    return res.status(503).json({
      error: 'The service is temporarily unable to reach the database. Please try again shortly.',
      requestId,
    });
  }
  log('error', 'unhandled error', {
    requestId,
    method: req.method,
    path: req.path,
    error: err.message,
    stack: err.stack,
  });
  return res.status(500).json({
    error: 'Something went wrong. Please try again. Contact support with the reference ID if the problem continues.',
    requestId,
  });
}

module.exports = { notFound, errorHandler };
