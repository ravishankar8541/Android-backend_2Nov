import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/vam-hrms-test';
process.env.JWT_ACCESS_SECRET = 'test-only-secret-that-is-never-used-for-auth';

const { assertInsideOffice, distanceInMeters } = await import('../src/services/geofence.js');

const office = { latitude: 0, longitude: 0, radiusMeters: 25 };
const pointAtDistance = (meters) => ({
  latitude: 0,
  longitude: (2 * Math.asin(meters / (2 * 6_371_000))) * 180 / Math.PI,
  accuracyMeters: 3,
});

test('geofence accepts a location inside and exactly on the configured radius', () => {
  assert.equal(assertInsideOffice({ ...office, accuracyMeters: 3 }, office), 0);
  const boundary = pointAtDistance(25);
  const measuredDistance = distanceInMeters(boundary, office);
  assert.equal(assertInsideOffice(boundary, { ...office, radiusMeters: measuredDistance }), Math.round(measuredDistance));
});

test('geofence rejects locations outside the radius and with poor accuracy', () => {
  assert.throws(() => assertInsideOffice(pointAtDistance(25.1), office), (error) => error.status === 403 && error.code === 'OUTSIDE_GEOFENCE');
  assert.throws(() => assertInsideOffice({ ...pointAtDistance(5), accuracyMeters: 101 }, office), (error) => error.status === 422 && error.code === 'LOW_LOCATION_ACCURACY');
});
