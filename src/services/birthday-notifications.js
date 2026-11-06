import { env } from '../config/env.js';
import { Employee } from '../models/Employee.js';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { dateKeyInTimeZone } from '../utils/date.js';
import { logger } from '../utils/logger.js';
import { fitNotification } from './reviewer-notifications.js';

const SEND_AT_UTC = { hour: 3, minute: 30 }; // 09:00 IST, when the office day opens
const LAZY_RETRY_MS = 10 * 60 * 1000;
let lastLazyAttempt = 0;

/**
 * dateOfBirth arrives from a YYYY-MM-DD field, so it is stored at UTC midnight and its UTC
 * parts are exactly the calendar day the admin typed — no office-timezone shift.
 */
function monthDay(dateOfBirth) {
  return new Date(dateOfBirth).toISOString().slice(5, 10);
}

export function celebrantsOn(dateKey, employees) {
  return employees.filter((employee) => employee.dateOfBirth && monthDay(employee.dateOfBirth) === dateKey.slice(5));
}

export async function sendBirthdayWishes({ now = new Date() } = {}) {
  const dateKey = dateKeyInTimeZone(now, env.OFFICE_TIME_ZONE);
  const employees = await Employee.find({ employmentStatus: 'active', dateOfBirth: { $ne: null } })
    .select('_id firstName lastName employeeId department dateOfBirth').lean();
  const celebrants = celebrantsOn(dateKey, employees);
  let sent = 0;
  if (!celebrants.length) return { dateKey, sent };
  const accounts = await User.find({ active: true }).select('_id employee').lean();
  for (const celebrant of celebrants) {
    if (await Notification.exists({ type: 'birthday_wish', 'data.dateKey': dateKey, 'data.employeeId': celebrant.employeeId })) continue;
    const recipients = accounts.filter((account) => account.employee?.toString() !== celebrant._id.toString());
    if (!recipients.length) continue;
    const name = `${celebrant.firstName} ${celebrant.lastName}`;
    const payload = fitNotification({
      type: 'birthday_wish',
      title: `Today is ${name}'s birthday`,
      message: `${name} (${celebrant.employeeId}${celebrant.department ? ` · ${celebrant.department}` : ''}) has a birthday today. Wish them a great one!`,
      data: { dateKey, employeeId: celebrant.employeeId, employee: celebrant._id },
    });
    await Notification.insertMany(recipients.map(({ _id }) => ({ ...payload, recipient: _id })), { ordered: false });
    sent += 1;
  }
  if (sent) logger.info({ dateKey, sent }, 'Birthday wishes sent to the team');
  return { dateKey, sent };
}

function sendTimeReached(now) {
  return now.getUTCHours() > SEND_AT_UTC.hour || (now.getUTCHours() === SEND_AT_UTC.hour && now.getUTCMinutes() >= SEND_AT_UTC.minute);
}

function nextRunAt(now) {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), SEND_AT_UTC.hour, SEND_AT_UTC.minute));
  if (next > now) return next;
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/**
 * Render's free tier sleeps when idle, so a timer alone can miss the morning. The alerts endpoint
 * nudges the broadcaster too; the per-employee per-day guard above keeps every nudge cheap.
 */
export function wakeBirthdayWishes() {
  const now = new Date();
  if (!sendTimeReached(now) || now.getTime() - lastLazyAttempt < LAZY_RETRY_MS) return;
  lastLazyAttempt = now.getTime();
  sendBirthdayWishes({ now }).catch((error) => logger.error({ err: error }, 'Birthday wish catch-up failed'));
}

export function scheduleBirthdayWishes() {
  const schedule = () => {
    const delay = Math.max(1000, nextRunAt(new Date()).getTime() - Date.now());
    const timer = setTimeout(async () => {
      try {
        await sendBirthdayWishes();
      } catch (error) {
        logger.error({ err: error }, 'Birthday wishes failed');
      } finally {
        schedule();
      }
    }, delay);
    timer.unref();
  };
  schedule();
  if (sendTimeReached(new Date())) sendBirthdayWishes().catch((error) => logger.error({ err: error }, 'Birthday wish boot catch-up failed'));
}
