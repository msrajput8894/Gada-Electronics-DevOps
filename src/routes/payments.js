'use strict';

const express = require('express');
const Cart = require('../models/Cart');
const Order = require('../models/Order');
const PaymentSession = require('../models/PaymentSession');
const Product = require('../models/Product');
const { HttpError, asyncHandler } = require('../errors');
const { authenticate } = require('../middleware/auth');
const config = require('../config');
const paymentProvider = require('../paymentProvider');
const { requireDeliveryAddress } = require('../validate');
const { business } = require('../metrics');

const router = express.Router();
router.get('/config', (_req, res) => {
  res.json({ enabled: config.paymentsEnabled });
});

router.use(authenticate);

const requirePaymentsEnabled = (_req, _res, next) => {
  if (!config.paymentsEnabled) {
    return next(new HttpError(503, 'Online payments are disabled'));
  }
  return next();
};

const restoreStock = (items) =>
  Promise.all(items.map((item) => Product.updateOne({ _id: item.product }, { $inc: { stock: item.quantity } })));

router.post(
  '/order',
  requirePaymentsEnabled,
  asyncHandler(async (req, res) => {
    const deliveryAddress = requireDeliveryAddress((req.body || {}).deliveryAddress);
    const cart = await Cart.findOne({ user: req.user.id }).populate('items.product');
    if (!cart || cart.items.length === 0) {
      business.checkoutFailures.inc({ reason: 'empty_cart' });
      throw new HttpError(400, 'Your cart is empty');
    }
    if (cart.items.some((item) => !item.product)) {
      business.checkoutFailures.inc({ reason: 'product_unavailable' });
      throw new HttpError(409, 'A product in your cart is no longer available');
    }
    if (cart.items.some((item) => item.quantity > item.product.stock)) {
      business.checkoutFailures.inc({ reason: 'out_of_stock' });
      throw new HttpError(409, 'A product in your cart no longer has enough stock');
    }

    const items = cart.items.map((item) => ({
      product: item.product._id,
      name: item.product.name,
      price: item.product.price,
      quantity: item.quantity,
    }));
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const amount = Math.round(total * 100);
    if (!Number.isSafeInteger(amount) || amount < 100) {
      throw new HttpError(400, 'The payment total must be at least ₹1');
    }

    const providerOrder = await paymentProvider.createOrder(amount, `gada-${Date.now()}`);
    const session = await PaymentSession.create({
      user: req.user.id,
      providerOrderId: providerOrder.id,
      items,
      total,
      deliveryAddress,
    });
    res.status(201).json({
      payment: {
        keyId: require('../config').razorpayKeyId,
        orderId: providerOrder.id,
        amount: providerOrder.amount,
        currency: providerOrder.currency,
        sessionId: session.id,
      },
    });
  })
);

router.post(
  '/verify',
  requirePaymentsEnabled,
  asyncHandler(async (req, res) => {
    const {
      razorpay_order_id: providerOrderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
    } = req.body || {};
    if (![providerOrderId, paymentId, signature].every((value) => typeof value === 'string' && value.length > 0)) {
      throw new HttpError(400, 'Payment verification details are required');
    }

    const session = await PaymentSession.findOne({ providerOrderId, user: req.user.id });
    if (!session) throw new HttpError(404, 'Payment session not found');
    if (!paymentProvider.verifyCheckoutSignature(providerOrderId, paymentId, signature)) {
      throw new HttpError(400, 'Payment signature is invalid');
    }

    const providerPayment = await paymentProvider.fetchPayment(paymentId);
    if (providerPayment.id !== paymentId || providerPayment.order_id !== providerOrderId) {
      throw new HttpError(409, 'Payment does not match this checkout');
    }
    if (providerPayment.status !== 'captured') {
      throw new HttpError(409, 'Payment has not been captured for this checkout');
    }
    if (providerPayment.amount !== Math.round(session.total * 100) || providerPayment.currency !== 'INR') {
      throw new HttpError(409, 'Captured payment amount does not match this checkout');
    }

    let order = await Order.findOne({ checkoutSession: session._id });
    if (order) {
      await PaymentSession.updateOne(
        { _id: session._id },
        { status: 'paid', paymentId, order: order._id }
      );
      return res.json({ order });
    }
    if (session.status === 'fulfillment_failed') {
      throw new HttpError(409, 'Payment was captured, but stock changed before the order could be fulfilled. Please contact the store to arrange a refund.');
    }

    const claimed = await PaymentSession.findOneAndUpdate(
      {
        _id: session._id,
        $or: [
          { status: 'pending' },
          { status: 'processing', processingAt: { $lt: new Date(Date.now() - 120000) } },
        ],
      },
      { status: 'processing', processingAt: new Date(), paymentId },
      { new: true }
    );
    if (!claimed) {
      throw new HttpError(409, 'This payment is already being confirmed. Please refresh your orders shortly.');
    }

    const reserved = [];
    try {
      for (const item of claimed.items) {
        const updated = await Product.findOneAndUpdate(
          { _id: item.product, stock: { $gte: item.quantity } },
          { $inc: { stock: -item.quantity } }
        );
        if (!updated) {
          throw new HttpError(409, 'Payment was captured, but stock changed before the order could be fulfilled. Please contact the store to arrange a refund.');
        }
        reserved.push({ product: item.product, quantity: item.quantity });
      }

      const created = await Order.create({
        user: claimed.user,
        items: claimed.items,
        total: claimed.total,
        checkoutSession: claimed._id,
        paymentMethod: 'razorpay',
        paymentStatus: 'paid',
        deliveryAddress: claimed.deliveryAddress,
        payment: { provider: 'razorpay', paymentId, status: 'captured' },
      });
      await PaymentSession.updateOne(
        { _id: claimed._id },
        { status: 'paid', order: created._id, paymentId }
      );

      const cart = await Cart.findOne({ user: claimed.user });
      if (cart) {
        const purchased = new Map(claimed.items.map((item) => [String(item.product), item.quantity]));
        cart.items = cart.items.filter((item) => {
          const id = String(item.product);
          if (!purchased.has(id) || item.quantity !== purchased.get(id)) return true;
          return false;
        });
        await cart.save();
      }
      business.ordersPlaced.inc();
      business.orderRevenue.inc(claimed.total);
      return res.status(201).json({ order: created });
    } catch (err) {
      order = await Order.findOne({ checkoutSession: claimed._id });
      if (order) {
        await PaymentSession.updateOne(
          { _id: claimed._id },
          { status: 'paid', order: order._id, paymentId }
        );
        return res.json({ order });
      }
      await restoreStock(reserved);
      await PaymentSession.updateOne(
        { _id: claimed._id },
        err instanceof HttpError && err.status === 409
          ? { status: 'fulfillment_failed', paymentId }
          : { status: 'pending', processingAt: null, paymentId: null }
      );
      if (err instanceof HttpError && err.status === 409) {
        business.checkoutFailures.inc({ reason: 'out_of_stock' });
      } else {
        business.checkoutFailures.inc({ reason: 'error' });
      }
      throw err;
    }
  })
);

module.exports = router;
