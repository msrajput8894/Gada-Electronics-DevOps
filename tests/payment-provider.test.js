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
});
