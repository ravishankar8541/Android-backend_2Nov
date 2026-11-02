import { env } from '../../config/env.js';
import { HttpError } from '../../utils/http-error.js';
import { consumeAttendanceSession, releaseAttendanceSession, verifyAttendanceSession as verifyLocalAttendanceSession } from './local-provider.js';

/**
 * The local open-source path recomputes 1:1 face distance on the server using the
 * encrypted employee template. Liveness is evaluated by the Android native SDK;
 * without device attestation, a modified client can forge its liveness result.
 * A production deployment needing stronger spoof resistance should replace this
 * adapter with a provider that validates camera/liveness evidence server-side.
 */
export async function verifyAttendanceSession({ sessionId, employeeId, eventType }) {
  if (env.BIOMETRIC_PROVIDER === 'local') {
    return verifyLocalAttendanceSession({ sessionId, employeeId, eventType });
  }
  if (env.BIOMETRIC_PROVIDER === 'disabled') {
    throw new HttpError(503, 'Face verification is not configured yet', 'BIOMETRIC_PROVIDER_UNAVAILABLE');
  }
  if (!sessionId || !employeeId) {
    throw new HttpError(400, 'A verified face session is required', 'FACE_SESSION_REQUIRED');
  }
  throw new HttpError(503, 'The configured biometric provider adapter is not installed', 'BIOMETRIC_ADAPTER_UNAVAILABLE');
}

export { consumeAttendanceSession, releaseAttendanceSession };
