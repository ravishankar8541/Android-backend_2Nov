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
    { name: 'Casual Leave', code: 'CL' },
    { name: 'Sick Leave', code: 'SL' },
    { name: 'Earned Leave', code: 'EL' },
    { name: 'Optional Holiday', code: 'OH' },
    { name: 'Unpaid Leave', code: 'UL' },
  ];
  for (const leaveType of defaults) await LeaveType.updateOne({ code: leaveType.code }, { $setOnInsert: leaveType }, { upsert: true });
  console.log('Default leave labels are ready. Assign each employee their monthly paid leave quota from the Leave page.');
} catch (error) {
  logger.error({ err: error }, 'Unable to seed admin');
  process.exitCode = 1;
} finally {
  const mongoose = await import('mongoose');
  await mongoose.default.disconnect();
}
