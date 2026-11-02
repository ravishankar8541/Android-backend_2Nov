import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';

const toRadians = (value) => value * Math.PI / 180;

export function distanceInMeters(from, to) {
  const earthRadius = 6_371_000;
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function assertInsideOffice(location, office) {
  if (location.accuracyMeters > env.MAX_LOCATION_ACCURACY_METERS) {
    throw new HttpError(422, 'Location accuracy is too low. Please try again outdoors.', 'LOW_LOCATION_ACCURACY');
  }
  const distanceMeters = distanceInMeters(location, office);
  const radius = office.radiusMeters ?? env.DEFAULT_GEOFENCE_RADIUS_METERS;
  if (distanceMeters > radius) throw new HttpError(403, 'You are outside the office attendance area', 'OUTSIDE_GEOFENCE');
  return Math.round(distanceMeters);
}
