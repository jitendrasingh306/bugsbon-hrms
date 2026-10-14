import mongoose from 'mongoose';
import { env } from './config/env.js';
import { connectDb } from './config/db.js';
import { createApp } from './app.js';

try {
  await connectDb();
  const app = createApp();
  const server = app.listen(env.PORT, env.HOST, () => {
    console.log(`Bugsbon HRMS API listening on http://${env.HOST}:${env.PORT}  (${env.NODE_ENV})`);
  });

  const shutdown = async (signal) => {
    console.log(`\n${signal} received — shutting down`);
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
} catch (err) {
  console.error(`\nStartup failed: ${err.message}\n`);
  process.exit(1);
}
