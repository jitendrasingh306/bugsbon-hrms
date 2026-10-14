import mongoose from 'mongoose';
import { transactionsEnabled } from '../config/db.js';

/**
 * Runs `work(session)` inside a MongoDB transaction when the server supports it
 * (replica set). On a standalone server `session` is undefined and the work runs
 * without atomic rollback. Always pass `{ session }` to Mongoose calls inside `work`.
 * Note: the callback can be retried by the driver, so keep it free of side effects
 * other than database writes.
 */
export async function withTransaction(work) {
  if (!transactionsEnabled) return work(undefined);
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}
