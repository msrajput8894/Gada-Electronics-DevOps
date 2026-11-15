"use strict";

const http = require("http");
const client = require("prom-client");

const register = new client.Registry();
// Node process metrics: memory, CPU, event loop lag, GC.
client.collectDefaultMetrics({ register });

// One histogram gives request rate, error rate and latency (three of the four golden signals).
const httpDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

function metricsMiddleware(req, res, next) {
  const end = httpDuration.startTimer();
  res.on("finish", () => {
    // Route pattern (/api/products/:id), never the raw URL, to keep label cardinality low.
    const route = req.route ? `${req.baseUrl}${req.route.path}` : "unmatched";
    end({ method: req.method, route, status_code: res.statusCode });
  });
  next();
}

// Separate internal port so the public Ingress can never route to /metrics.
function startMetricsServer(port) {
  const server = http.createServer(async (req, res) => {
    if (req.url === "/metrics") {
      res.setHeader("Content-Type", register.contentType);
      res.end(await register.metrics());
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  server.listen(port);
  return server;
}

module.exports = { metricsMiddleware, startMetricsServer };
