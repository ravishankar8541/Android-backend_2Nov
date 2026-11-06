import { Payslip } from '../models/Payslip.js';
import { logger } from '../utils/logger.js';
import { generatePayslipsForMonth, latestClosedMonthKey } from './payroll-service.js';

const RUN_AT_UTC = { hour: 3, minute: 30 }; // 09:00 IST, after the office day opens

function nextRunAt(now) {
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, RUN_AT_UTC.hour, RUN_AT_UTC.minute));
  if (startOfMonth > now) return startOfMonth;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, RUN_AT_UTC.hour, RUN_AT_UTC.minute));
}

export async function catchUpMissingPayroll() {
  const monthKey = latestClosedMonthKey();
  if (await Payslip.exists({ monthKey })) return null;
  const summary = await generatePayslipsForMonth({ monthKey });
  logger.info({ monthKey, created: summary.created, skippedNoSalary: summary.skippedNoSalary }, 'Prepared draft payslips for the closed month');
  return summary;
}

const MAX_TIMEOUT_MS = 2 ** 31 - 1; // Node clamps a longer wait to 1ms, which would spin the timer

export function scheduleMonthlyPayroll() {
  const schedule = () => {
    const delay = nextRunAt(new Date()).getTime() - Date.now();
    const timer = setTimeout(async () => {
      if (delay > MAX_TIMEOUT_MS) {
        schedule();
        return;
      }
      try {
        const summary = await generatePayslipsForMonth({ monthKey: latestClosedMonthKey() });
        logger.info({ monthKey: summary.monthKey, created: summary.created, updated: summary.updated }, 'Monthly payslip generation finished');
      } catch (error) {
        logger.error({ err: error }, 'Monthly payslip generation failed');
      } finally {
        schedule();
      }
    }, Math.max(1000, Math.min(delay, MAX_TIMEOUT_MS)));
    timer.unref();
  };
  schedule();
  catchUpMissingPayroll().catch((error) => logger.error({ err: error }, 'Payslip catch-up failed'));
}
