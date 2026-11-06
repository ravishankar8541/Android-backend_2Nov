import { app } from './app.js';
import { connectDatabase } from './config/database.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { scheduleMonthlyPayroll } from './services/payroll-scheduler.js';
import { scheduleBirthdayWishes } from './services/birthday-notifications.js';

try {
  await connectDatabase();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'VAM HRMS API listening');
    if (env.NODE_ENV !== 'test') scheduleMonthlyPayroll();
    if (env.NODE_ENV !== 'test') scheduleBirthdayWishes();
  });
  const shutdown = (signal) => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
} catch (error) {
  logger.fatal({ err: error }, 'Unable to start API');
  process.exit(1);
}
