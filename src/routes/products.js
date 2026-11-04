'use strict';

const express = require('express');
const Product = require('../models/Product');
const { HttpError, asyncHandler } = require('../errors');
const { authenticate, requireRole } = require('../middleware/auth');
const { str, escapeRegex, parsePositiveInt, requireObjectId } = require('../validate');

const router = express.Router();

const EDITABLE = ['name', 'description', 'category', 'price', 'stock', 'imageUrl'];

// Copy only whitelisted fields from the request body (prevents mass assignment).
const pickEditable = (body = {}) =>
  Object.fromEntries(EDITABLE.filter((key) => body[key] !== undefined).map((key) => [key, body[key]]));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter = {};
    const q = str(req.query.q);
    const category = str(req.query.category);
    if (q) filter.name = new RegExp(escapeRegex(q), 'i');
    if (category) filter.category = category.toLowerCase();

    const page = parsePositiveInt(req.query.page, 1, 100000);
    const limit = parsePositiveInt(req.query.limit, 12, 50);

    const [items, total] = await Promise.all([
      Product.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Product.countDocuments(filter),
    ]);
    res.json({ items, page, limit, total, pages: Math.ceil(total / limit) });
  })
);

router.get(
  '/categories',
  asyncHandler(async (req, res) => {
    const categories = await Product.distinct('category');
    res.json({ categories: categories.sort() });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const product = await Product.findById(requireObjectId(req.params.id, 'product id'));
    if (!product) throw new HttpError(404, 'Product not found');
    res.json({ product });
  })
);

router.post(
  '/',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const product = await Product.create(pickEditable(req.body));
    res.status(201).json({ product });
  })
);

router.put(
  '/:id',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const product = await Product.findByIdAndUpdate(
      requireObjectId(req.params.id, 'product id'),
      pickEditable(req.body),
      { new: true, runValidators: true }
    );
    if (!product) throw new HttpError(404, 'Product not found');
    res.json({ product });
  })
);

router.delete(
  '/:id',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const product = await Product.findByIdAndDelete(requireObjectId(req.params.id, 'product id'));
    if (!product) throw new HttpError(404, 'Product not found');
    res.status(204).end();
  })
);

module.exports = router;
