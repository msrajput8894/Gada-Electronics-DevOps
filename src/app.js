'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const { requestLogger } = require('./middleware/logger');
const { notFound, errorHandler } = require('./middleware/error');

function createApp() {
  const app = express();

  // The app will sit behind nginx / a load balancer, so trust the first proxy hop.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          // Helmet's default would force https for assets, which breaks plain-HTTP test servers
          // (for example an EC2 instance before TLS is set up). Remove once HTTPS is in place.
          'upgrade-insecure-requests': null,
        },
      },
    })
  );
  app.use(requestLogger);
  app.use(express.json({ limit: '100kb' }));

  app.use(require('./routes/health'));
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/products', require('./routes/products'));
  app.use('/api/cart', require('./routes/cart'));
  app.use('/api/orders', require('./routes/orders'));
  app.use('/api', notFound);

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
