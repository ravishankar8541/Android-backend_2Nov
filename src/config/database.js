import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

export async function connectDatabase() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  logger.info('Connected to MongoDB');
}
