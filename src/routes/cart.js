'use strict';

const express = require('express');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const { HttpError, asyncHandler } = require('../errors');
const { authenticate } = require('../middleware/auth');
const { requireObjectId } = require('../validate');

const router = express.Router();
router.use(authenticate);

const getCart = async (userId) =>
  (await Cart.findOne({ user: userId })) || new Cart({ user: userId, items: [] });

// Shape the cart for the client: product details plus line totals and a grand total.
const serialize = async (cart) => {
  await cart.populate('items.product');
  // Drop lines whose product was deleted since it was added.
  const lines = cart.items
    .filter((item) => item.product)
    .map((item) => ({
      product: {
        id: item.product._id,
        name: item.product.name,
        price: item.product.price,
        stock: item.product.stock,
        imageUrl: item.product.imageUrl,
      },
      quantity: item.quantity,
      lineTotal: item.product.price * item.quantity,
    }));
  return {
    items: lines,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    total: lines.reduce((sum, line) => sum + line.lineTotal, 0),
  };
};

const parseQuantity = (value, { allowZero = false } = {}) => {
  const min = allowZero ? 0 : 1;
  if (!Number.isInteger(value) || value < min || value > 99) {
    throw new HttpError(400, `quantity must be a whole number between ${min} and 99`);
  }
  return value;
};

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ cart: await serialize(await getCart(req.user.id)) });
  })
);

router.post(
  '/items',
  asyncHandler(async (req, res) => {
    const { productId, quantity } = req.body || {};
    requireObjectId(productId, 'productId');
    const qty = parseQuantity(quantity);

    const product = await Product.findById(productId);
    if (!product) throw new HttpError(404, 'Product not found');

    const cart = await getCart(req.user.id);
    const existing = cart.items.find((item) => String(item.product) === productId);
    const newQty = (existing ? existing.quantity : 0) + qty;
    if (newQty > product.stock) {
      throw new HttpError(400, `Only ${product.stock} of ${product.name} in stock`);
    }
    if (newQty > 99) throw new HttpError(400, 'quantity per product is limited to 99');

    if (existing) existing.quantity = newQty;
    else cart.items.push({ product: product._id, quantity: qty });
    await cart.save();
    res.status(201).json({ cart: await serialize(cart) });
  })
);

router.patch(
  '/items/:productId',
  asyncHandler(async (req, res) => {
    const productId = requireObjectId(req.params.productId, 'product id');
    const qty = parseQuantity((req.body || {}).quantity, { allowZero: true });

    const cart = await getCart(req.user.id);
    const existing = cart.items.find((item) => String(item.product) === productId);
    if (!existing) throw new HttpError(404, 'Product is not in the cart');

    if (qty === 0) {
      cart.items = cart.items.filter((item) => String(item.product) !== productId);
    } else {
      const product = await Product.findById(productId);
      if (!product) throw new HttpError(404, 'Product not found');
      if (qty > product.stock) {
        throw new HttpError(400, `Only ${product.stock} of ${product.name} in stock`);
      }
      existing.quantity = qty;
    }
    await cart.save();
    res.json({ cart: await serialize(cart) });
  })
);

router.delete(
  '/items/:productId',
  asyncHandler(async (req, res) => {
    const productId = requireObjectId(req.params.productId, 'product id');
    const cart = await getCart(req.user.id);
    cart.items = cart.items.filter((item) => String(item.product) !== productId);
    await cart.save();
    res.json({ cart: await serialize(cart) });
  })
);

router.delete(
  '/',
  asyncHandler(async (req, res) => {
    const cart = await getCart(req.user.id);
    cart.items = [];
    await cart.save();
    res.json({ cart: await serialize(cart) });
  })
);

module.exports = router;
