'use strict';

// Test database helper.
// Locally: starts an in-memory MongoDB (the binary is downloaded on first run).
// In CI: set TEST_MONGO_URI to use a real MongoDB service container instead.

const mongoose = require('mongoose');

let memoryServer;

async function connect() {
  if (process.env.TEST_MONGO_URI) {
    await mongoose.connect(process.env.TEST_MONGO_URI);
    return;
  }
  const { MongoMemoryServer } = require('mongodb-memory-server');
  memoryServer = await MongoMemoryServer.create();
  await mongoose.connect(memoryServer.getUri());
}

async function clear() {
  const collections = Object.values(mongoose.connection.collections);
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
}

async function disconnect() {
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
}

module.exports = { connect, clear, disconnect };
