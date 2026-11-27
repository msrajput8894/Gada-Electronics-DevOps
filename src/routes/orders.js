'use strict';

const express = require('express');
const Cart = require('../models/Cart');
const Order = require('../models/Order');
const Product = require('../models/Product');
const { HttpError, asyncHandler } = require('../errors');
const { authenticate, requireRole } = require('../middleware/auth');
const { str, requireObjectId } = require('../validate');
const config = require('../config');
const { business } = require('../metrics');

const router = express.Router();
router.use(authenticate);

// Allowed status changes, enforced on the server.
const TRANSITIONS = {
  placed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

const restoreStock = (items) =>
  Promise.all(
    items.map((item) =>
      Product.updateOne({ _id: item.product }, { $inc: { stock: item.quantity } })
    )
  );

router.post(
  '/',
  asyncHandler(async (req, res) => {
    if (config.paymentsEnabled) {
      throw new HttpError(409, 'Checkout requires a verified payment');
    }

    const cart = await Cart.findOne({ user: req.user.id }).populate('items.product');
    if (!cart || cart.items.length === 0) {
      business.checkoutFailures.inc({ reason: 'empty_cart' });
      throw new HttpError(400, 'Your cart is empty');
    }
    if (cart.items.some((item) => !item.product)) {
      business.checkoutFailures.inc({ reason: 'product_unavailable' });
      throw new HttpError(409, 'A product in your cart is no longer available');
    }

    const reserved = [];
    try {
      for (const item of cart.items) {
        const updated = await Product.findOneAndUpdate(
          { _id: item.product._id, stock: { $gte: item.quantity } },
          { $inc: { stock: -item.quantity } }
        );
        if (!updated) {
          throw new HttpError(409, `Not enough stock for ${item.product.name}`);
        }
        reserved.push({ product: item.product._id, quantity: item.quantity });
      }

      const items = cart.items.map((item) => ({
        product: item.product._id,
        name: item.product.name,
        price: item.product.price,
        quantity: item.quantity,
      }));
      const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const order = await Order.create({ user: req.user.id, items, total });

      cart.items = [];
      await cart.save();
      business.ordersPlaced.inc();
      business.orderRevenue.inc(total);
      res.status(201).json({ order });
    } catch (err) {
      await restoreStock(reserved);
      business.checkoutFailures.inc({ reason: err instanceof HttpError && err.status === 409 ? 'out_of_stock' : 'error' });
      throw err;
    }
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter = {};
    // Admins may list every order with ?all=true; everyone else only sees their own.
    const listAll = req.user.role === 'admin' && str(req.query.all) === 'true';
    if (!listAll) filter.user = req.user.id;
    let query = Order.find(filter).sort({ createdAt: -1 }).limit(100);
    // Admins also see who placed each order (name and email only, never the password hash).
    if (listAll) query = query.populate('user', 'name email');
    res.json({ orders: await query });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const order = await Order.findById(requireObjectId(req.params.id, 'order id'));
    // Report 404 (not 403) for other people's orders so order ids cannot be probed.
    if (!order || (req.user.role !== 'admin' && String(order.user) !== req.user.id)) {
      throw new HttpError(404, 'Order not found');
    }
    res.json({ order });
  })
);

// Customers can cancel their own order while it is still "placed" (not yet shipped).
// Stock goes back on the shelf. Admins cancel any order through the status route below.
router.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'order id');
    const order = await Order.findById(id);
    // 404 (not 403) for other people's orders, same as GET, so order ids cannot be probed.
    if (!order || String(order.user) !== req.user.id) throw new HttpError(404, 'Order not found');
    if (order.status !== 'placed') {
      throw new HttpError(409, `Only placed orders can be cancelled (this one is ${order.status})`);
    }

    // Conditional update: if an admin ships it at the same moment, one of the two wins cleanly.
    const updated = await Order.findOneAndUpdate({ _id: id, status: 'placed' }, { status: 'cancelled' }, { new: true });
    if (!updated) throw new HttpError(409, 'Order was changed by someone else, reload and retry');
    await restoreStock(order.items);
    business.ordersCancelled.inc({ by: 'customer' });
    res.json({ order: updated });
  })
);

router.patch(
  '/:id/status',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'order id');
    const next = (req.body || {}).status;
    const order = await Order.findById(id);
    if (!order) throw new HttpError(404, 'Order not found');
    if (!TRANSITIONS[order.status].includes(next)) {
      throw new HttpError(409, `Cannot change an order from ${order.status} to ${next}`);
    }

    // Conditional update so two admins cannot apply conflicting changes at the same time.
    const updated = await Order.findOneAndUpdate(
      { _id: id, status: order.status },
      { status: next },
      { new: true }
    );
    if (!updated) throw new HttpError(409, 'Order was changed by someone else, reload and retry');
    if (next === 'cancelled') {
      await restoreStock(order.items);
      business.ordersCancelled.inc({ by: 'admin' });
    }
    res.json({ order: updated });
  })
);

module.exports = router;
