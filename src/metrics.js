'use strict';

const http = require('http');
const client = require('prom-client');

const register = new client.Registry();
// Node process metrics: memory, CPU, event loop lag, GC.
client.collectDefaultMetrics({ register });

// One histogram gives request rate, error rate and latency (three of the four golden signals).
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

// Business events. These answer "is the shop actually working?", which the request metrics
// cannot: every request can return 200 while nobody is able to buy anything.
const ordersPlaced = new client.Counter({
  name: 'gada_orders_placed_total',
  help: 'Orders successfully placed',
  registers: [register],
});
const orderRevenue = new client.Counter({
  name: 'gada_order_revenue_inr_total',
  help: 'Sum of the totals of placed orders, in INR',
  registers: [register],
});
const checkoutFailures = new client.Counter({
  name: 'gada_checkout_failures_total',
  help: 'Checkouts that did not create an order, by reason',
  labelNames: ['reason'],
  registers: [register],
});
const ordersCancelled = new client.Counter({
  name: 'gada_orders_cancelled_total',
  help: 'Orders cancelled, by who cancelled them',
  labelNames: ['by'],
  registers: [register],
});
const loginAttempts = new client.Counter({
  name: 'gada_login_attempts_total',
  help: 'Login attempts, by outcome',
  labelNames: ['result'],
  registers: [register],
});
const registrations = new client.Counter({
  name: 'gada_registrations_total',
  help: 'Accounts created',
  registers: [register],
});

// Create every labelled series at 0, so rate() and increase() work from the first scrape
// instead of only after the first event of each kind has happened.
for (const reason of ['empty_cart', 'product_unavailable', 'out_of_stock', 'error']) {
  checkoutFailures.inc({ reason }, 0);
}
for (const by of ['customer', 'admin']) ordersCancelled.inc({ by }, 0);
for (const result of ['success', 'failure']) loginAttempts.inc({ result }, 0);

function metricsMiddleware(req, res, next) {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    // Route pattern (/api/products/:id), never the raw URL, to keep label cardinality low.
    const route = req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched';
    end({ method: req.method, route, status_code: res.statusCode });
  });
  next();
}

// Separate internal port so the public Ingress can never route to /metrics.
function startMetricsServer(port) {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/metrics') {
      res.setHeader('Content-Type', register.contentType);
      res.end(await register.metrics());
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  server.listen(port);
  return server;
}

module.exports = {
  register,
  metricsMiddleware,
  startMetricsServer,
  business: { ordersPlaced, orderRevenue, checkoutFailures, ordersCancelled, loginAttempts, registrations },
};
