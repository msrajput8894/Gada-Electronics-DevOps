'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { HttpError } = require('../errors');

function authenticate(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(new HttpError(401, 'Authentication required'));
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = { id: payload.sub, role: payload.role };
    return next();
  } catch {
    return next(new HttpError(401, 'Invalid or expired token'));
  }
}

const requireRole = (role) => (req, res, next) => {
  if (!req.user || req.user.role !== role) {
    return next(new HttpError(403, 'Forbidden'));
  }
  return next();
};

module.exports = { authenticate, requireRole };
