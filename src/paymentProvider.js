'use strict';

const crypto = require('crypto');
const config = require('./config');
const { HttpError } = require('./errors');

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
  } catch {
    throw new HttpError(502, 'Could not reach the payment provider');
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(502, 'The payment provider rejected the request');
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
  createOrder: (amount, receipt) =>
    razorpayRequest('/orders', { method: 'POST', body: { amount, currency: 'INR', receipt } }),
  fetchPayment: (paymentId) => razorpayRequest(`/payments/${encodeURIComponent(paymentId)}`),
  verifyCheckoutSignature,
};
