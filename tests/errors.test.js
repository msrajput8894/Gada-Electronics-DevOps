'use strict';

const { errorHandler } = require('../src/middleware/error');

function response() {
  return {
    statusCode: undefined,
    body: undefined,
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

describe('error handler', () => {
  const req = { id: 'request-123', method: 'GET', path: '/api/test' };

  test('turns database connectivity failures into a retryable service error', () => {
    const res = response();
    errorHandler({ name: 'MongoServerSelectionError', message: 'private connection details' }, req, res, jest.fn());

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({
      error: 'The service is temporarily unable to reach the database. Please try again shortly.',
      requestId: 'request-123',
    });
    expect(JSON.stringify(res.body)).not.toContain('private connection details');
  });

  test('returns a reference ID without exposing unexpected exception details', () => {
    const res = response();
    errorHandler(new Error('private implementation details'), req, res, jest.fn());

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      error: 'Something went wrong. Please try again. Contact support with the reference ID if the problem continues.',
      requestId: 'request-123',
    });
    expect(JSON.stringify(res.body)).not.toContain('private implementation details');
  });

  test('delegates errors when the response has already started', () => {
    const res = response();
    res.headersSent = true;
    const err = new Error('stream failed');
    const next = jest.fn();

    errorHandler(err, req, res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.statusCode).toBeUndefined();
  });
});
