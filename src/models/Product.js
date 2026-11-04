'use strict';

const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    category: { type: String, required: true, trim: true, lowercase: true, index: true },
    price: { type: Number, required: true, min: 0 }, // INR
    stock: { type: Number, required: true, min: 0, default: 0, validate: Number.isInteger },
    imageUrl: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Product', productSchema);
