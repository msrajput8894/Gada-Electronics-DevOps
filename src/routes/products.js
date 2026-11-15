'use strict';

const express = require('express');
const Product = require('../models/Product');
const { HttpError, asyncHandler } = require('../errors');
const { authenticate, requireRole } = require('../middleware/auth');
const { str, escapeRegex, parsePositiveInt, requireObjectId } = require('../validate');

const router = express.Router();

// Allowed sort orders. The client sends a key; it never sends field names, so user input
// cannot become a MongoDB sort operator. _id is a tie-breaker so pages are stable.
const SORTS = {
  newest: { createdAt: -1, _id: -1 },
  price_asc: { price: 1, _id: 1 },
  price_desc: { price: -1, _id: -1 },
  name_asc: { name: 1, _id: 1 },
};

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
    if (str(req.query.inStock) === 'true') filter.stock = { $gt: 0 };

    const sortKey = str(req.query.sort) || 'newest';
    if (!Object.hasOwn(SORTS, sortKey)) {
      throw new HttpError(400, `sort must be one of: ${Object.keys(SORTS).join(', ')}`);
    }

    const page = parsePositiveInt(req.query.page, 1, 100000);
    const limit = parsePositiveInt(req.query.limit, 12, 50);

    let query = Product.find(filter)
      .sort(SORTS[sortKey])
      .skip((page - 1) * limit)
      .limit(limit);
    // Sort names without regard to case ("apple" next to "Apple", not after "Zebra").
    if (sortKey === 'name_asc') query = query.collation({ locale: 'en', strength: 2 });

    const [items, total] = await Promise.all([query, Product.countDocuments(filter)]);
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
