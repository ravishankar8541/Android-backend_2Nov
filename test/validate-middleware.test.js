import test from 'node:test';
import assert from 'node:assert/strict';
import express, { request as expressRequest } from 'express';
import { z } from 'zod';
import { validate } from '../src/middleware/validate.js';

test('query validation keeps Express 5 req.query read-only and exposes coerced values', () => {
  const request = Object.create(expressRequest);
  request.app = express();
  request.url = '/?page=2&limit=30';
  let nextCalled = false;
  const middleware = validate(z.object({ page: z.coerce.number(), limit: z.coerce.number() }).passthrough(), 'query');

  assert.doesNotThrow(() => middleware(request, {}, (error) => {
    assert.equal(error, undefined);
    nextCalled = true;
  }));
  assert.equal(nextCalled, true);
  assert.deepEqual(request.validatedQuery, { page: 2, limit: 30 });
  assert.deepEqual(Object.fromEntries(Object.entries(request.query)), { page: '2', limit: '30' });
});

test('query validation returns a client error for an invalid query', () => {
  const request = Object.create(expressRequest);
  request.app = express();
  request.url = '/?page=0';
  let receivedError;
  validate(z.object({ page: z.coerce.number().int().positive() }), 'query')(request, {}, (error) => { receivedError = error; });
  assert.equal(receivedError?.status, 400);
  assert.equal(receivedError?.code, 'VALIDATION_ERROR');
  assert.equal(request.validatedQuery, undefined);
});
