'use strict';

const mongoose = require('mongoose');

module.exports = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 100 },
    phone: {
      type: String,
      required: true,
      trim: true,
      match: /^(?:\+91[ -]?)?[6-9]\d{9}$/,
    },
    addressLine1: { type: String, required: true, trim: true, maxlength: 200 },
    addressLine2: { type: String, trim: true, maxlength: 200, default: '' },
    city: { type: String, required: true, trim: true, maxlength: 100 },
    state: { type: String, required: true, trim: true, maxlength: 100 },
    postalCode: { type: String, required: true, match: /^[1-9]\d{5}$/ },
    country: { type: String, required: true, enum: ['India'], default: 'India' },
  },
  { _id: false }
);
