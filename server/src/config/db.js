import mongoose from 'mongoose';
import { env } from './env.js';

// Live binding: importers always see the current value.
export let transactionsEnabled = false;

export function getMongoUri() {
  if (env.NODE_ENV === 'test') {
    if (!env.MONGODB_URI_TEST) {
      throw new Error('MONGODB_URI_TEST is not set. Tests need their own database (it gets wiped).');
    }
    if (env.MONGODB_URI_TEST === env.MONGODB_URI) {
      throw new Error('MONGODB_URI_TEST must differ from MONGODB_URI, otherwise tests would wipe real data.');
    }
    return env.MONGODB_URI_TEST;
  }
  return env.MONGODB_URI;
}

export async function connectDb() {
  const uri = getMongoUri();
  mongoose.set('strictQuery', true);
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  } catch (err) {
    throw new Error(
      `Cannot connect to MongoDB at ${uri.replace(/\/\/.*@/, '//***@')}. ` +
        'Is the MongoDB service running? (Windows: run "net start MongoDB" in an Administrator Command Prompt.) ' +
        `Original error: ${err.message}`
    );
  }

  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  const isReplicaSet = Boolean(hello.setName);

  if (env.USE_TRANSACTIONS === 'true' && !isReplicaSet) {
    throw new Error(
      'USE_TRANSACTIONS=true but MongoDB is not running as a replica set. See README "Optional: single-node replica set".'
    );
  }
  transactionsEnabled = env.USE_TRANSACTIONS !== 'false' && isReplicaSet;
  if (!transactionsEnabled && env.NODE_ENV !== 'test') {
    console.warn(
      '[db] MongoDB transactions are OFF (standalone server). Multi-step updates run without atomic rollback. ' +
        'See README to enable a free local replica set.'
    );
  }
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
