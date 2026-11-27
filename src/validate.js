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

const requireDeliveryAddress = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'Delivery address is required');
  }

  const address = {
    fullName: typeof value.fullName === 'string' ? value.fullName.trim() : '',
    phone: typeof value.phone === 'string' ? value.phone.trim() : '',
    addressLine1: typeof value.addressLine1 === 'string' ? value.addressLine1.trim() : '',
    addressLine2: typeof value.addressLine2 === 'string' ? value.addressLine2.trim() : '',
    city: typeof value.city === 'string' ? value.city.trim() : '',
    state: typeof value.state === 'string' ? value.state.trim() : '',
    postalCode: typeof value.postalCode === 'string' ? value.postalCode.trim() : '',
    country: 'India',
  };
  const problems = [];

  for (const [field, label, max] of [
    ['fullName', 'recipient name', 100],
    ['addressLine1', 'address line 1', 200],
    ['city', 'city', 100],
    ['state', 'state', 100],
  ]) {
    if (!address[field] || address[field].length > max) {
      problems.push(`${label} is required and must be at most ${max} characters`);
    }
  }
  if (!/^(?:\+91[ -]?)?[6-9]\d{9}$/.test(address.phone)) {
    problems.push('phone must be a valid Indian mobile number');
  }
  if (address.addressLine2.length > 200) {
    problems.push('address line 2 must be at most 200 characters');
  }
  if (!/^[1-9]\d{5}$/.test(address.postalCode)) {
    problems.push('postal code must be a valid 6-digit Indian PIN code');
  }
  if (problems.length) throw new HttpError(400, 'Delivery address is invalid', problems);
  return address;
};

module.exports = { str, isEmail, escapeRegex, parsePositiveInt, requireObjectId, requireDeliveryAddress };
