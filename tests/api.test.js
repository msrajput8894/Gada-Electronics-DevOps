'use strict';

const request = require('supertest');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { createApp } = require('../src/app');
const User = require('../src/models/User');
const Product = require('../src/models/Product');
const metrics = require('../src/metrics');

const app = createApp();
const PASSWORD = 'Passw0rd!';

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

describe('cart and checkout', () => {
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

  test('checkout creates an order, reduces stock and empties the cart', async () => {
    const { token } = await register();
    const product = await makeProduct({ price: 1000, stock: 5 });
    await request(app).post('/api/cart/items').set(auth(token)).send({ productId: product.id, quantity: 2 });

    const res = await request(app).post('/api/orders').set(auth(token));
    expect(res.status).toBe(201);
    expect(res.body.order.total).toBe(2000);
    expect(res.body.order.status).toBe('placed');

    expect((await Product.findById(product.id)).stock).toBe(3);
    const cart = await request(app).get('/api/cart').set(auth(token));
    expect(cart.body.cart.items).toHaveLength(0);

    const again = await request(app).post('/api/orders').set(auth(token));
    expect(again.status).toBe(400);
  });

  test('a failed checkout puts reserved stock back', async () => {
    const { token } = await register();
    const plenty = await makeProduct({ name: 'Plenty', stock: 5 });
    const scarce = await makeProduct({ name: 'Scarce', stock: 2 });
    await request(app).post('/api/cart/items').set(auth(token)).send({ productId: plenty.id, quantity: 2 });
    await request(app).post('/api/cart/items').set(auth(token)).send({ productId: scarce.id, quantity: 2 });

    // Someone else buys the scarce item after it was added to this cart.
    await Product.updateOne({ _id: scarce.id }, { stock: 1 });

    const res = await request(app).post('/api/orders').set(auth(token));
    expect(res.status).toBe(409);
    expect((await Product.findById(plenty.id)).stock).toBe(5);
    expect((await Product.findById(scarce.id)).stock).toBe(1);
  });
});

describe('orders', () => {
  async function placeOrder(token, product, quantity = 1) {
    await request(app).post('/api/cart/items').set(auth(token)).send({ productId: product.id, quantity });
    return (await request(app).post('/api/orders').set(auth(token))).body.order;
  }

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
    const order = (await request(app).post('/api/orders').set(auth(token))).body.order;
    expect(await metric('gada_orders_placed_total')).toBe(before.placed + 1);
    expect(await metric('gada_order_revenue_inr_total')).toBe(before.revenue + 1000);

    await request(app).post(`/api/orders/${order._id}/cancel`).set(auth(token));
    expect(await metric('gada_orders_cancelled_total', '{by="customer"}')).toBe(before.cancelled + 1);

    // Empty cart, then stock taken by someone else after the item was added to the cart.
    await request(app).post('/api/orders').set(auth(token));
    expect(await metric('gada_checkout_failures_total', '{reason="empty_cart"}')).toBe(before.emptyCart + 1);
    await request(app).post('/api/cart/items').set(auth(token)).send({ productId: product.id, quantity: 2 });
    await Product.updateOne({ _id: product.id }, { stock: 0 });
    expect((await request(app).post('/api/orders').set(auth(token))).status).toBe(409);
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
