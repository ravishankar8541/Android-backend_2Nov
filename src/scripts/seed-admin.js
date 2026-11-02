import { connectDatabase } from '../config/database.js';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { LeaveType } from '../models/LeaveType.js';
import { logger } from '../utils/logger.js';

if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) {
  console.error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in backend/.env first.');
  process.exit(1);
}

try {
  await connectDatabase();
  const email = env.SEED_ADMIN_EMAIL.toLowerCase();
  if (await User.exists({ email })) {
    console.log(`An account already exists for ${email}. No changes made.`);
  } else {
    const user = new User({ email, role: 'super_admin' });
    await user.setPassword(env.SEED_ADMIN_PASSWORD);
    await user.save();
    console.log(`Created super admin ${email}.`);
  }
  const defaults = [
    { name: 'Casual Leave', code: 'CL', annualAllowance: 12, paid: true, carryForward: false },
    { name: 'Sick Leave', code: 'SL', annualAllowance: 6, paid: true, carryForward: false },
    { name: 'Earned Leave', code: 'EL', annualAllowance: 18, paid: true, carryForward: true },
    { name: 'Optional Holiday', code: 'OH', annualAllowance: 2, paid: true, carryForward: false },
    { name: 'Unpaid Leave', code: 'UL', annualAllowance: 0, paid: false, carryForward: false },
  ];
  for (const leaveType of defaults) await LeaveType.updateOne({ code: leaveType.code }, { $setOnInsert: leaveType }, { upsert: true });
  console.log('Default leave types are ready.');
} catch (error) {
  logger.error({ err: error }, 'Unable to seed admin');
  process.exitCode = 1;
} finally {
  const mongoose = await import('mongoose');
  await mongoose.default.disconnect();
}
