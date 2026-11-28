'use strict';

const config = require('../src/config');
const paymentProvider = require('../src/paymentProvider');

describe('payment provider configuration', () => {
  let fetch;

  beforeEach(() => {
    fetch = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetch.mockRestore();
    config.paymentsEnabled = false;
    config.razorpayKeyId = '';
    config.razorpayKeySecret = '';
  });

  test('does not contact Razorpay while the feature flag is disabled', async () => {
    config.paymentsEnabled = false;
    config.razorpayKeyId = 'test-key';
    config.razorpayKeySecret = 'test-secret';

    await expect(paymentProvider.createOrder(100, 'receipt')).rejects.toMatchObject({ status: 503 });
    expect(fetch).not.toHaveBeenCalled();
  });

  test('does not contact Razorpay with example placeholder credentials', async () => {
    config.paymentsEnabled = true;
    config.razorpayKeyId = 'replace_with_razorpay_test_key_id';
    config.razorpayKeySecret = 'replace_with_razorpay_test_key_secret';

    await expect(paymentProvider.createOrder(100, 'receipt')).rejects.toMatchObject({ status: 503 });
    expect(fetch).not.toHaveBeenCalled();
  });

  test('reports invalid JSON from Razorpay instead of treating it as an empty result', async () => {
    config.paymentsEnabled = true;
    config.razorpayKeyId = 'test-key';
    config.razorpayKeySecret = 'test-secret';
    fetch.mockResolvedValue({ ok: true, status: 200, json: jest.fn().mockRejectedValue(new SyntaxError('invalid JSON')) });

    await expect(paymentProvider.createOrder(100, 'receipt')).rejects.toMatchObject({
      status: 502,
      message: 'The payment provider returned an invalid response. Please try again.',
    });
  });

  test('rejects malformed successful order responses', async () => {
    config.paymentsEnabled = true;
    config.razorpayKeyId = 'test-key';
    config.razorpayKeySecret = 'test-secret';
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'order_test' }) });

    await expect(paymentProvider.createOrder(100, 'receipt')).rejects.toMatchObject({
      status: 502,
      message: 'The payment provider returned an invalid order. Please try again.',
    });
  });

  test('returns a retryable error when Razorpay rejects a request', async () => {
    config.paymentsEnabled = true;
    config.razorpayKeyId = 'test-key';
    config.razorpayKeySecret = 'test-secret';
    fetch.mockResolvedValue({ ok: false, status: 503 });

    await expect(paymentProvider.fetchPayment('pay_test')).rejects.toMatchObject({
      status: 502,
      message: 'The payment provider could not process the request. Please try again.',
    });
  });
});
