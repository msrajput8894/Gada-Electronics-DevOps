'use strict';

const express = require('express');
const mongoose = require('mongoose');
const config = require('../config');
const { log } = require('../middleware/logger');

const router = express.Router();

// Liveness: the process is up. Load balancers and Kubernetes restart the app if this fails.
router.get('/health', (req, res) => {
  res.json({ status: 'ok', version: config.appVersion, uptimeSeconds: Math.round(process.uptime()) });
});

// Readiness: the app can serve traffic (database reachable). Traffic is withheld while this fails.
router.get('/ready', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) throw new Error('database not connected');
    await mongoose.connection.db.admin().ping();
    res.json({ status: 'ready' });
  } catch (err) {
    log('warn', 'readiness check failed', {
      requestId: req.id,
      path: req.path,
      error: err.message,
    });
    res.status(503).json({ status: 'not ready', reason: 'database unavailable' });
  }
});

module.exports = router;
