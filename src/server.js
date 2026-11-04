'use strict';

const mongoose = require('mongoose');
const config = require('./config');
const { createApp } = require('./app');
const { log } = require('./middleware/logger');

async function main() {
  // Fail fast if the database is unreachable: a supervisor (systemd, Docker, Kubernetes) restarts us.
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
  log('info', 'connected to MongoDB');

  const server = createApp().listen(config.port, () => {
    log('info', 'server listening', { port: config.port, env: config.env, version: config.appVersion });
  });

  // Graceful shutdown: stop taking new connections, finish in-flight requests, close the database.
  // Docker and Kubernetes send SIGTERM before killing a container.
  const shutdown = (signal) => {
    log('info', 'shutting down', { signal });
    server.close(async () => {
      await mongoose.connection.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'fatal', msg: 'failed to start', error: err.message }));
  process.exit(1);
});
