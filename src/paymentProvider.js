'use strict';

const crypto = require('crypto');
const config = require('./config');
const { HttpError } = require('./errors');
const { log } = require('./middleware/logger');

function requireCredentials() {
  if (!config.paymentsEnabled) {
    throw new HttpError(503, 'Online payments are disabled');
  }
  if (
    !config.razorpayKeyId ||
    !config.razorpayKeySecret ||
    config.razorpayKeyId === 'replace_with_razorpay_test_key_id' ||
    config.razorpayKeySecret === 'replace_with_razorpay_test_key_secret'
  ) {
    throw new HttpError(503, 'Payment is not configured. Set Razorpay test credentials to enable checkout.');
  }
}

async function razorpayRequest(path, { method = 'GET', body } = {}) {
  requireCredentials();
  const operation = method === 'POST' ? 'create_order' : 'fetch_payment';
  let response;
  try {
    response = await fetch(`https://api.razorpay.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.razorpayKeyId}:${config.razorpayKeySecret}`).toString('base64')}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    log('warn', 'payment provider request failed', { operation, error: err.message });
    throw new HttpError(502, 'Could not reach the payment provider. Please try again.');
  }

  if (!response.ok) {
    log('warn', 'payment provider rejected request', { operation, status: response.status });
    throw new HttpError(502, 'The payment provider could not process the request. Please try again.');
  }
  let result;
  try {
    result = await response.json();
  } catch {
    log('warn', 'payment provider returned invalid JSON', { operation, status: response.status });
    throw new HttpError(502, 'The payment provider returned an invalid response. Please try again.');
  }
  return result;
}

async function createOrder(amount, receipt) {
  const result = await razorpayRequest('/orders', { method: 'POST', body: { amount, currency: 'INR', receipt } });
  if (
    !result ||
    typeof result.id !== 'string' ||
    !result.id ||
    result.amount !== amount ||
    result.currency !== 'INR'
  ) {
    log('warn', 'payment provider returned an invalid order', { operation: 'create_order' });
    throw new HttpError(502, 'The payment provider returned an invalid order. Please try again.');
  }
  return result;
}

async function fetchPayment(paymentId) {
  const result = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}`);
  if (
    !result ||
    typeof result.id !== 'string' ||
    typeof result.order_id !== 'string' ||
    typeof result.status !== 'string' ||
    !Number.isSafeInteger(result.amount) ||
    typeof result.currency !== 'string'
  ) {
    log('warn', 'payment provider returned an invalid payment', { operation: 'fetch_payment' });
    throw new HttpError(502, 'The payment provider returned invalid payment details. Please try again.');
  }
  return result;
}

function verifyCheckoutSignature(orderId, paymentId, signature) {
  requireCredentials();
  const expected = crypto
    .createHmac('sha256', config.razorpayKeySecret)
    .update(`${orderId}|${paymentId}`)
    .digest();
  let actual;
  try {
    actual = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = {
  createOrder,
  fetchPayment,
  verifyCheckoutSignature,
};
