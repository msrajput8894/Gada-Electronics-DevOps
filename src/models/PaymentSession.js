'use strict';

const mongoose = require('mongoose');
const DeliveryAddress = require('./DeliveryAddress');

const paymentSessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    providerOrderId: { type: String, required: true, unique: true },
    paymentId: { type: String, default: null },
    items: [
      {
        _id: false,
        product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
        name: { type: String, required: true },
        price: { type: Number, required: true, min: 0 },
        quantity: { type: Number, required: true, min: 1 },
      },
    ],
    total: { type: Number, required: true, min: 0 },
    deliveryAddress: { type: DeliveryAddress, required: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'paid', 'fulfillment_failed'],
      default: 'pending',
    },
    processingAt: { type: Date },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PaymentSession', paymentSessionSchema);
