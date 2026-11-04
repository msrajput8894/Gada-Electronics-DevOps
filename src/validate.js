'use strict';

const mongoose = require('mongoose');
const { HttpError } = require('./errors');

// Query-string values can be arrays or objects (e.g. ?q[$ne]=x).
// Only accept plain strings so user input never becomes a MongoDB operator.
const str = (value) => (typeof value === 'string' ? value.trim() : undefined);

const isEmail = (value) =>
  typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parsePositiveInt = (value, fallback, max) => {
  const n = parseInt(str(value), 10);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, max);
};

const requireObjectId = (value, label = 'id') => {
  if (typeof value !== 'string' || !mongoose.isValidObjectId(value)) {
    throw new HttpError(400, `Invalid ${label}`);
  }
  return value;
};

module.exports = { str, isEmail, escapeRegex, parsePositiveInt, requireObjectId };
