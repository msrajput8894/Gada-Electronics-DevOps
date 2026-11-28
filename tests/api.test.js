'use strict';

const request = require('supertest');
const bcrypt = require('bcryptjs');
const db = require('./db');
jest.mock('../src/paymentProvider', () => ({
  createOrder: jest.fn(),
  fetchPayment: jest.fn(),
  verifyCheckoutSignature: jest.fn(),
}));
const paymentProvider = require('../src/paymentProvider');
const config = require('../src/config');
const { createApp } = require('../src/app');
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Product = require('../src/models/Product');
const Order = require('../src/models/Order');
const metrics = require('../src/metrics');

const app = createApp({ authRateLimits: { loginLimit: 100, registrationLimit: 100 } });
const rateLimitedAuthApp = createApp({ authRateLimits: { loginLimit: 2, registrationLimit: 2 } });
const PASSWORD = 'Passw0rd!';
const DELIVERY_ADDRESS = {
  fullName: 'Asha Sharma',
  phone: '9876543210',
  addressLine1: '14 Main Road',
  addressLine2: '',
  city: 'Pune',
  state: 'Maharashtra',
  postalCode: '411001',
};

beforeAll(db.connect);
afterEach(db.clear);
afterAll(db.disconnect);

async function register(email = 'asha@example.com', name = 'Asha') {
  const res = await request(app).post('/api/auth/register').send({ name, email, password: PASSWORD });
  return { token: res.body.token, user: res.body.user, res };
}

async function adminToken() {
  await User.create({
    name: 'Admin',
    email: 'admin@example.com',
    role: 'admin',
    passwordHash: await bcrypt.hash(PASSWORD, 4),
  });
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@example.com', password: PASSWORD });
  return res.body.token;
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const makeProduct = (overrides = {}) =>
  Product.create({ name: 'Gada Buds', category: 'audio', price: 1000, stock: 5, ...overrides });

let nextProviderOrder = 0;
beforeEach(() => {
  config.paymentsEnabled = false;
  paymentProvider.createOrder.mockImplementation(async (amount) => ({
    id: `order_test_${++nextProviderOrder}`,
    amount,
    currency: 'INR',
  }));
  paymentProvider.fetchPayment.mockReset();
  paymentProvider.verifyCheckoutSignature.mockReturnValue(true);
});

describe('health', () => {
  test('GET /health reports the process is alive', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('GET /ready reports ready when the database is connected', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });

  test('GET /ready does not expose database errors', async () => {
    const admin = jest.spyOn(mongoose.connection.db, 'admin').mockReturnValue({
      ping: jest.fn().mockRejectedValueOnce(new Error('private database detail')),
    });
    let res;
    try {
      res = await request(app).get('/ready');
    } finally {
      admin.mockRestore();
    }

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'not ready', reason: 'database unavailable' });
    expect(JSON.stringify(res.body)).not.toContain('private database detail');
  });
});

describe('error responses', () => {
  test('returns a request reference for malformed JSON', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .send('{"name":');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Request body is not valid JSON');
    expect(res.body.requestId).toBeTruthy();
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
  });

  test('rejects request bodies over the configured size limit clearly', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Asha', email: 'asha@example.com', password: PASSWORD, extra: 'x'.repeat(101 * 1024) });

    expect(res.status).toBe(413);
    expect(res.body.error).toBe('Request body is too large (maximum 100 KB)');
    expect(res.body.requestId).toBeTruthy();
  });

  test('returns a JSON 404 for unknown non-API paths', async () => {
    const res = await request(app).get('/unknown-page');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'Not found' });
  });
});

describe('auth', () => {
  test('registers a customer and returns a token', async () => {
    const { res } = await register();
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.role).toBe('customer');
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  test('ignores a role sent in the request body', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Eve', email: 'eve@example.com', password: PASSWORD, role: 'admin' });
    expect(res.body.user.role).toBe('customer');
  });

  test('rejects duplicate emails and weak passwords', async () => {
    await register();
    const duplicate = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Asha', email: 'ASHA@example.com', password: PASSWORD });
    expect(duplicate.status).toBe(409);

    const weak = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Bob', email: 'bob@example.com', password: 'short' });
    expect(weak.status).toBe(400);
  });

  test('login works with the right password and fails with the wrong one', async () => {
    await register();
    const ok = await request(app).post('/api/auth/login').send({ email: 'asha@example.com', password: PASSWORD });
    expect(ok.status).toBe(200);
    const bad = await request(app).post('/api/auth/login').send({ email: 'asha@example.com', password: 'wrong-password' });
    expect(bad.status).toBe(401);
  });

  test('limits registration attempts and returns a structured 429 response', async () => {
    const body = (email) => ({ name: 'Asha', email, password: PASSWORD });
    expect((await request(rateLimitedAuthApp).post('/api/auth/register').send(body('one@example.com'))).status).toBe(201);
    expect((await request(rateLimitedAuthApp).post('/api/auth/register').send(body('two@example.com'))).status).toBe(201);

    const limited = await request(rateLimitedAuthApp)
      .post('/api/auth/register')
      .send(body('three@example.com'));
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: 'Too many registration attempts. Please try again later.' });
    expect(await User.countDocuments()).toBe(2);
  });

  test('limits failed logins without counting successful logins', async () => {
    await register();
    const login = (password) =>
      request(rateLimitedAuthApp).post('/api/auth/login').send({ email: 'asha@example.com', password });

    expect((await login('wrong-password')).status).toBe(401);
    expect((await login(PASSWORD)).status).toBe(200);
    expect((await login('wrong-password')).status).toBe(401);

    const limited = await login('wrong-password');
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: 'Too many login attempts. Please try again later.' });
  });

  test('GET /api/auth/me requires a valid token', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    const { token } = await register();
    const res = await request(app).get('/api/auth/me').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('asha@example.com');
  });
});

describe('products', () => {
  test('lists, searches and filters products publicly', async () => {
    await makeProduct({ name: 'Gada Buds', category: 'audio' });
    await makeProduct({ name: 'Gada Phone', category: 'smartphones' });

    const all = await request(app).get('/api/products');
    expect(all.body.total).toBe(2);

    const search = await request(app).get('/api/products?q=phone');
    expect(search.body.items.map((p) => p.name)).toEqual(['Gada Phone']);

    const byCategory = await request(app).get('/api/products?category=audio');
    expect(byCategory.body.total).toBe(1);
  });

  test('sorts by price and name, and rejects unknown sort keys', async () => {
    await makeProduct({ name: 'banana', price: 300 });
    await makeProduct({ name: 'Apple', price: 100 });
    await makeProduct({ name: 'Cherry', price: 200 });
    const names = async (sort) =>
      (await request(app).get(`/api/products?sort=${sort}`)).body.items.map((p) => p.name);

    expect(await names('price_asc')).toEqual(['Apple', 'Cherry', 'banana']);
    expect(await names('price_desc')).toEqual(['banana', 'Cherry', 'Apple']);
    expect(await names('name_asc')).toEqual(['Apple', 'banana', 'Cherry']); // case-insensitive
    expect((await request(app).get('/api/products')).body.items[0].name).toBe('Cherry'); // newest first

    const bad = await request(app).get('/api/products?sort=price');
    expect(bad.status).toBe(400);
    expect((await request(app).get('/api/products?sort=constructor')).status).toBe(400);
    expect((await request(app).get('/api/products?sort[$ne]=x')).status).toBe(200); // not a string: default order
  });

  test('inStock=true hides sold-out products', async () => {
    await makeProduct({ name: 'Available', stock: 3 });
    await makeProduct({ name: 'Sold out', stock: 0 });
    const res = await request(app).get('/api/products?inStock=true');
    expect(res.body.items.map((p) => p.name)).toEqual(['Available']);
    expect(res.body.total).toBe(1);
    expect((await request(app).get('/api/products')).body.total).toBe(2);
  });

  test('treats query operators as plain text, not as MongoDB operators', async () => {
    await makeProduct();
    const res = await request(app).get('/api/products?q[$ne]=zzz&category[$ne]=zzz');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  test('only admins can create products', async () => {
    const { token } = await register();
    const body = { name: 'New TV', category: 'televisions', price: 20000, stock: 3 };

    expect((await request(app).post('/api/products').send(body)).status).toBe(401);
    expect((await request(app).post('/api/products').set(auth(token)).send(body)).status).toBe(403);

    const admin = await adminToken();
    const created = await request(app).post('/api/products').set(auth(admin)).send(body);
    expect(created.status).toBe(201);
    expect(created.body.product.name).toBe('New TV');
  });

  test('validates product input', async () => {
    const admin = await adminToken();
    const res = await request(app)
      .post('/api/products')
      .set(auth(admin))
      .send({ name: 'Broken', category: 'audio', price: -5, stock: 1 });
    expect(res.status).toBe(400);
  });

  test('admin can update and delete a product', async () => {
    const admin = await adminToken();
    const product = await makeProduct();

    const updated = await request(app).put(`/api/products/${product.id}`).set(auth(admin)).send({ price: 1500 });
    expect(updated.status).toBe(200);
    expect(updated.body.product.price).toBe(1500);

    const removed = await request(app).delete(`/api/products/${product.id}`).set(auth(admin));
    expect(removed.status).toBe(204);
    expect((await request(app).get(`/api/products/${product.id}`)).status).toBe(404);
  });

  test('returns 400 for a malformed product id', async () => {
    expect((await request(app).get('/api/products/not-an-id')).status).toBe(400);
  });
});

describe('payment feature flag', () => {
  test('payments are disabled by default and the existing checkout still works', async () => {
    expect(config.paymentsEnabled).toBe(false);
    expect((await request(app).get('/api/payments/config')).body.enabled).toBe(false);

    const { token } = await register();
    const product = await makeProduct({ stock: 5 });
    await request(app).post('/api/cart/items').set(auth(token)).send({ productId: product.id, quantity: 2 });
    paymentProvider.createOrder.mockClear();

    expect((await request(app).post('/api/payments/order').set(auth(token))).status).toBe(503);
    expect((await request(app).post('/api/payments/verify').set(auth(token))).status).toBe(503);
    expect(paymentProvider.createOrder).not.toHaveBeenCalled();

    const checkout = await request(app)
      .post('/api/orders')
      .set(auth(token))
      .send({ paymentMethod: 'cod', deliveryAddress: DELIVERY_ADDRESS });
    expect(checkout.status).toBe(201);
    expect(checkout.body.order.total).toBe(2000);
    expect(checkout.body.order).toMatchObject({
      paymentMethod: 'cod',
      paymentStatus: 'pending',
      deliveryAddress: { fullName: 'Asha Sharma', postalCode: '411001', country: 'India' },
    });
    expect((await Product.findById(product.id)).stock).toBe(3);
    expect((await request(app).get('/api/cart').set(auth(token))).body.cart.items).toHaveLength(0);
  });

  test('requires a valid delivery address before creating a COD order', async () => {
    const { token } = await register();
    const product = await makeProduct();
    await request(app).post('/api/cart/items').set(auth(token)).send({ productId: product.id, quantity: 1 });

    const missing = await request(app)
      .post('/api/orders')
      .set(auth(token))
      .send({ paymentMethod: 'cod' });
    expect(missing.status).toBe(400);

    const invalid = await request(app)
      .post('/api/orders')
      .set(auth(token))
      .send({
        paymentMethod: 'cod',
        deliveryAddress: { ...DELIVERY_ADDRESS, phone: '123', postalCode: '12' },
      });
    expect(invalid.status).toBe(400);
    expect(await Order.countDocuments()).toBe(0);
    expect((await Product.findById(product.id)).stock).toBe(5);
  });

  test('failed demo checkout restores stock reserved earlier in the cart', async () => {
    const { token } = await register();
    const available = await makeProduct({ name: 'Available', stock: 5 });
    const scarce = await makeProduct({ name: 'Scarce', stock: 1 });
    await request(app).post('/api/cart/items').set(auth(token)).send({ productId: available.id, quantity: 2 });
    await request(app).post('/api/cart/items').set(auth(token)).send({ productId: scarce.id, quantity: 1 });
    await Product.updateOne({ _id: scarce.id }, { stock: 0 });

    const checkout = await request(app)
      .post('/api/orders')
      .set(auth(token))
      .send({ paymentMethod: 'cod', deliveryAddress: DELIVERY_ADDRESS });
    expect(checkout.status).toBe(409);
    expect((await Product.findById(available.id)).stock).toBe(5);
    expect((await Product.findById(scarce.id)).stock).toBe(0);
    expect((await request(app).get('/api/cart').set(auth(token))).body.cart.items).toHaveLength(2);
  });
});

describe('cart and checkout', () => {
  beforeEach(() => {
    config.paymentsEnabled = true;
  });

  test('cart requires authentication', async () => {
    expect((await request(app).get('/api/cart')).status).toBe(401);
  });

  test('adds items, merges quantities and refuses more than the stock', async () => {
    const { token } = await register();
    const product = await makeProduct({ stock: 3 });

    await request(app).post('/api/cart/items').set(auth(token)).send({ productId: product.id, quantity: 2 });
    const merged = await request(app).post('/api/cart/items').set(auth(token)).send({ productId: product.id, quantity: 1 });
    expect(merged.body.cart.items[0].quantity).toBe(3);
    expect(merged.body.cart.total).toBe(3000);

    const tooMany = await request(app).post('/api/cart/items').set(auth(token)).send({ productId: product.id, quantity: 1 });
    expect(tooMany.status).toBe(400);
  });

  async function startPayment(token) {
    return request(app)
      .post('/api/payments/order')
      .set(auth(token))
      .send({ deliveryAddress: DELIVERY_ADDRESS });
  }

  async function confirmPayment(token, payment, overrides = {}) {
    const body = {
      razorpay_order_id: payment.body.payment.orderId,
      razorpay_payment_id: 'pay_test_1',
      razorpay_signature: 'test-signature',
      ...overrides,
    };
    paymentProvider.fetchPayment.mockResolvedValueOnce({
      id: body.razorpay_payment_id,
      order_id: body.razorpay_order_id,
      status: 'captured',
      amount: payment.body.payment.amount,
      currency: payment.body.payment.currency,
    });
    return request(app).post('/api/payments/verify').set(auth(token)).send(body);
  }

  test('checkout verifies a captured payment before creating the order', async () => {
    const { token } = await register();
    const product = await makeProduct({ price: 1000, stock: 5 });
    await request(app).post('/api/cart/items').set(auth(token)).send({ productId: product.id, quantity: 2 });

    const payment = await startPayment(token);
    expect((await request(app).get('/api/payments/config')).body.enabled).toBe(true);
    expect(payment.status).toBe(201);
    expect(payment.body.payment).toMatchObject({ amount: 200000, currency: 'INR' });
    expect((await Product.findById(product.id)).stock).toBe(5);

    const res = await confirmPayment(token, payment);
    expect(res.status).toBe(201);
    expect(res.body.order.total).toBe(2000);
    expect(res.body.order.status).toBe('placed');
    expect(res.body.order).toMatchObject({
      paymentMethod: 'razorpay',
      paymentStatus: 'paid',
      deliveryAddress: { fullName: 'Asha Sharma', postalCode: '411001', country: 'India' },
    });
    expect(res.body.order.payment).toMatchObject({ provider: 'razorpay', paymentId: 'pay_test_1', status: 'captured' });

    expect((await Product.findById(product.id)).stock).toBe(3);
    const cart = await request(app).get('/api/cart').set(auth(token));
    expect(cart.body.cart.items).toHaveLength(0);

    const duplicate = await confirmPayment(token, payment);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.order._id).toBe(res.body.order._id);
    expect((await Product.findById(product.id)).stock).toBe(3);
  });

  test('does not place an order when Razorpay reports an uncaptured payment', async () => {
    const { token } = await register();
    const product = await makeProduct();
    await request(app).post('/api/cart/items').set(auth(token)).send({ productId: product.id, quantity: 1 });
    const payment = await startPayment(token);
    paymentProvider.fetchPayment.mockResolvedValueOnce({
      id: 'pay_test_1',
      order_id: payment.body.payment.orderId,
      status: 'authorized',
      amount: payment.body.payment.amount,
      currency: payment.body.payment.currency,
    });

    const res = await request(app)
      .post('/api/payments/verify')
      .set(auth(token))
      .send({
        razorpay_order_id: payment.body.payment.orderId,
        razorpay_payment_id: 'pay_test_1',
        razorpay_signature: 'test-signature',
      });
    expect(res.status).toBe(409);
    expect(await Order.countDocuments()).toBe(0);
    expect((await Product.findById(product.id)).stock).toBe(5);
  });

  test('does not accept an invalid payment signature', async () => {
    const { token } = await register();
    const product = await makeProduct();
    await request(app).post('/api/cart/items').set(auth(token)).send({ productId: product.id, quantity: 1 });
    const payment = await startPayment(token);
    paymentProvider.verifyCheckoutSignature.mockReturnValueOnce(false);

    const res = await confirmPayment(token, payment);
    expect(res.status).toBe(400);
    expect(paymentProvider.fetchPayment).not.toHaveBeenCalled();
    expect(await Order.countDocuments()).toBe(0);
  });

  test('a captured payment cannot place an order if inventory changed', async () => {
    const { token } = await register();
    const product = await makeProduct();
    await request(app).post('/api/cart/items').set(auth(token)).send({ productId: product.id, quantity: 1 });
    const payment = await startPayment(token);
    await Product.updateOne({ _id: product.id }, { stock: 0 });

    const res = await confirmPayment(token, payment);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Payment was captured');
    expect(await Order.countDocuments()).toBe(0);
    expect((await Product.findById(product.id)).stock).toBe(0);
  });

  test('does not place an order when the captured amount does not match the checkout', async () => {
    const { token } = await register();
    const product = await makeProduct({ price: 1000 });
    await request(app).post('/api/cart/items').set(auth(token)).send({ productId: product.id, quantity: 1 });
    const payment = await startPayment(token);
    paymentProvider.fetchPayment.mockResolvedValueOnce({
      id: 'pay_test_1',
      order_id: payment.body.payment.orderId,
      status: 'captured',
      amount: payment.body.payment.amount + 100,
      currency: 'INR',
    });

    const res = await request(app)
      .post('/api/payments/verify')
      .set(auth(token))
      .send({
        razorpay_order_id: payment.body.payment.orderId,
        razorpay_payment_id: 'pay_test_1',
        razorpay_signature: 'test-signature',
      });
    expect(res.status).toBe(409);
    expect(await Order.countDocuments()).toBe(0);
  });

  test('COD is accepted while direct Razorpay orders are rejected', async () => {
    const { token } = await register();
    const product = await makeProduct();
    await request(app).post('/api/cart/items').set(auth(token)).send({ productId: product.id, quantity: 1 });
    const directOnline = await request(app)
      .post('/api/orders')
      .set(auth(token))
      .send({ paymentMethod: 'razorpay', deliveryAddress: DELIVERY_ADDRESS });
    expect(directOnline.status).toBe(400);

    const cod = await request(app)
      .post('/api/orders')
      .set(auth(token))
      .send({ paymentMethod: 'cod', deliveryAddress: DELIVERY_ADDRESS });
    expect(cod.status).toBe(201);
    expect(cod.body.order.paymentMethod).toBe('cod');
  });
});

describe('orders', () => {
  beforeEach(() => {
    config.paymentsEnabled = true;
  });

  async function placeOrder(token, product, quantity = 1) {
    await request(app).post('/api/cart/items').set(auth(token)).send({ productId: product.id, quantity });
    const payment = await request(app)
      .post('/api/payments/order')
      .set(auth(token))
      .send({ deliveryAddress: DELIVERY_ADDRESS });
    paymentProvider.fetchPayment.mockResolvedValueOnce({
      id: `pay_test_${nextProviderOrder}`,
      order_id: payment.body.payment.orderId,
      status: 'captured',
      amount: payment.body.payment.amount,
      currency: payment.body.payment.currency,
    });
    const result = await request(app)
      .post('/api/payments/verify')
      .set(auth(token))
      .send({
        razorpay_order_id: payment.body.payment.orderId,
        razorpay_payment_id: `pay_test_${nextProviderOrder}`,
        razorpay_signature: 'test-signature',
      });
    return result.body.order;
  }

  test('collects COD payment when an admin marks the order delivered', async () => {
    const { token } = await register();
    const admin = await adminToken();
    const product = await makeProduct();
    await request(app).post('/api/cart/items').set(auth(token)).send({ productId: product.id, quantity: 1 });
    const placed = await request(app)
      .post('/api/orders')
      .set(auth(token))
      .send({ paymentMethod: 'cod', deliveryAddress: DELIVERY_ADDRESS });
    expect(placed.body.order.paymentStatus).toBe('pending');

    await request(app)
      .patch(`/api/orders/${placed.body.order._id}/status`)
      .set(auth(admin))
      .send({ status: 'shipped' });
    const delivered = await request(app)
      .patch(`/api/orders/${placed.body.order._id}/status`)
      .set(auth(admin))
      .send({ status: 'delivered' });
    expect(delivered.status).toBe(200);
    expect(delivered.body.order.paymentStatus).toBe('paid');
  });

  test('customers only see their own orders', async () => {
    const asha = await register('asha@example.com', 'Asha');
    const ravi = await register('ravi@example.com', 'Ravi');
    const product = await makeProduct({ stock: 10 });
    const order = await placeOrder(asha.token, product);

    const mine = await request(app).get('/api/orders').set(auth(asha.token));
    expect(mine.body.orders).toHaveLength(1);
    const theirs = await request(app).get('/api/orders').set(auth(ravi.token));
    expect(theirs.body.orders).toHaveLength(0);
    expect((await request(app).get(`/api/orders/${order._id}`).set(auth(ravi.token))).status).toBe(404);
  });

  test('only admins change order status, and only along allowed transitions', async () => {
    const { token } = await register();
    const admin = await adminToken();
    const product = await makeProduct({ stock: 10 });
    const order = await placeOrder(token, product);

    const asCustomer = await request(app).patch(`/api/orders/${order._id}/status`).set(auth(token)).send({ status: 'shipped' });
    expect(asCustomer.status).toBe(403);

    const skip = await request(app).patch(`/api/orders/${order._id}/status`).set(auth(admin)).send({ status: 'delivered' });
    expect(skip.status).toBe(409);

    const shipped = await request(app).patch(`/api/orders/${order._id}/status`).set(auth(admin)).send({ status: 'shipped' });
    expect(shipped.status).toBe(200);
    expect(shipped.body.order.status).toBe('shipped');
  });

  test('cancelling an order restores stock', async () => {
    const { token } = await register();
    const admin = await adminToken();
    const product = await makeProduct({ stock: 10 });
    const order = await placeOrder(token, product, 4);
    expect((await Product.findById(product.id)).stock).toBe(6);

    const res = await request(app).patch(`/api/orders/${order._id}/status`).set(auth(admin)).send({ status: 'cancelled' });
    expect(res.status).toBe(200);
    expect((await Product.findById(product.id)).stock).toBe(10);
  });

  test('a customer can cancel their own placed order, once, and stock comes back', async () => {
    const { token } = await register();
    const product = await makeProduct({ stock: 10 });
    const order = await placeOrder(token, product, 3);
    expect((await Product.findById(product.id)).stock).toBe(7);

    const res = await request(app).post(`/api/orders/${order._id}/cancel`).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('cancelled');
    expect((await Product.findById(product.id)).stock).toBe(10);

    const again = await request(app).post(`/api/orders/${order._id}/cancel`).set(auth(token));
    expect(again.status).toBe(409);
    expect((await Product.findById(product.id)).stock).toBe(10); // not restored twice
  });

  test('customers cannot cancel shipped orders or other customers orders', async () => {
    const asha = await register('asha@example.com', 'Asha');
    const ravi = await register('ravi@example.com', 'Ravi');
    const admin = await adminToken();
    const product = await makeProduct({ stock: 10 });
    const order = await placeOrder(asha.token, product);

    expect((await request(app).post(`/api/orders/${order._id}/cancel`).set(auth(ravi.token))).status).toBe(404);
    expect((await request(app).post(`/api/orders/${order._id}/cancel`)).status).toBe(401);
    expect((await request(app).post('/api/orders/not-an-id/cancel').set(auth(asha.token))).status).toBe(400);

    await request(app).patch(`/api/orders/${order._id}/status`).set(auth(admin)).send({ status: 'shipped' });
    const late = await request(app).post(`/api/orders/${order._id}/cancel`).set(auth(asha.token));
    expect(late.status).toBe(409);
    expect((await Product.findById(product.id)).stock).toBe(9);
  });

  test('admins see who placed each order, customers do not get user details', async () => {
    const asha = await register('asha@example.com', 'Asha');
    const admin = await adminToken();
    const product = await makeProduct({ stock: 10 });
    await placeOrder(asha.token, product);

    const all = await request(app).get('/api/orders?all=true').set(auth(admin));
    expect(all.body.orders[0].user).toMatchObject({ name: 'Asha', email: 'asha@example.com' });
    expect(all.body.orders[0].user.passwordHash).toBeUndefined();

    const mine = await request(app).get('/api/orders').set(auth(asha.token));
    expect(typeof mine.body.orders[0].user).toBe('string'); // just an id
  });
});

describe('business metrics', () => {
  beforeEach(() => {
    config.paymentsEnabled = true;
  });

  // Counters only ever go up and are shared by every test in this file, so compare before and after.
  async function metric(name, labels = '') {
    const text = await metrics.register.metrics();
    const pattern = new RegExp(`^${name}${labels.replace(/[{}]/g, '\\$&')} (\\S+)$`, 'm');
    const match = text.match(pattern);
    return match ? Number(match[1]) : 0;
  }

  test('orders, revenue, cancellations, failed checkouts and logins are counted', async () => {
    const before = {
      placed: await metric('gada_orders_placed_total'),
      revenue: await metric('gada_order_revenue_inr_total'),
      cancelled: await metric('gada_orders_cancelled_total', '{by="customer"}'),
      outOfStock: await metric('gada_checkout_failures_total', '{reason="out_of_stock"}'),
      emptyCart: await metric('gada_checkout_failures_total', '{reason="empty_cart"}'),
      badLogins: await metric('gada_login_attempts_total', '{result="failure"}'),
      goodLogins: await metric('gada_login_attempts_total', '{result="success"}'),
      signups: await metric('gada_registrations_total'),
    };

    const { token } = await register('meter@example.com', 'Meter');
    expect(await metric('gada_registrations_total')).toBe(before.signups + 1);

    const product = await makeProduct({ price: 500, stock: 5 });
    await request(app).post('/api/cart/items').set(auth(token)).send({ productId: product.id, quantity: 2 });
    const payment = await request(app)
      .post('/api/payments/order')
      .set(auth(token))
      .send({ deliveryAddress: DELIVERY_ADDRESS });
    paymentProvider.fetchPayment.mockResolvedValueOnce({
      id: 'pay_metrics',
      order_id: payment.body.payment.orderId,
      status: 'captured',
      amount: payment.body.payment.amount,
      currency: payment.body.payment.currency,
    });
    const order = (
      await request(app)
        .post('/api/payments/verify')
        .set(auth(token))
        .send({
          razorpay_order_id: payment.body.payment.orderId,
          razorpay_payment_id: 'pay_metrics',
          razorpay_signature: 'test-signature',
        })
    ).body.order;
    expect(await metric('gada_orders_placed_total')).toBe(before.placed + 1);
    expect(await metric('gada_order_revenue_inr_total')).toBe(before.revenue + 1000);

    await request(app).post(`/api/orders/${order._id}/cancel`).set(auth(token));
    expect(await metric('gada_orders_cancelled_total', '{by="customer"}')).toBe(before.cancelled + 1);

    // Empty cart, then stock taken by someone else after the item was added to the cart.
    await request(app)
      .post('/api/payments/order')
      .set(auth(token))
      .send({ deliveryAddress: DELIVERY_ADDRESS });
    expect(await metric('gada_checkout_failures_total', '{reason="empty_cart"}')).toBe(before.emptyCart + 1);
    await request(app).post('/api/cart/items').set(auth(token)).send({ productId: product.id, quantity: 2 });
    await Product.updateOne({ _id: product.id }, { stock: 0 });
    expect(
      (
        await request(app)
          .post('/api/payments/order')
          .set(auth(token))
          .send({ deliveryAddress: DELIVERY_ADDRESS })
      ).status
    ).toBe(409);
    expect(await metric('gada_checkout_failures_total', '{reason="out_of_stock"}')).toBe(before.outOfStock + 1);
    // A failed checkout is not an order.
    expect(await metric('gada_orders_placed_total')).toBe(before.placed + 1);

    await request(app).post('/api/auth/login').send({ email: 'meter@example.com', password: 'wrong-password' });
    await request(app).post('/api/auth/login').send({ email: 'meter@example.com', password: PASSWORD });
    expect(await metric('gada_login_attempts_total', '{result="failure"}')).toBe(before.badLogins + 1);
    expect(await metric('gada_login_attempts_total', '{result="success"}')).toBe(before.goodLogins + 1);
  });

  test('every counter series exists from the start, so rate() works before the first event', async () => {
    const text = await metrics.register.metrics();
    for (const line of [
      'gada_orders_placed_total',
      'gada_checkout_failures_total{reason="out_of_stock"}',
      'gada_checkout_failures_total{reason="error"}',
      'gada_orders_cancelled_total{by="admin"}',
      'gada_login_attempts_total{result="failure"}',
    ]) {
      expect(text).toContain(line);
    }
  });
});
