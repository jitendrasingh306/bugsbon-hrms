import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import mongoose from 'mongoose';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { loadUser } from './middleware/auth.js';
import { csrfProtection } from './middleware/csrf.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { notFound, errorHandler } from './middleware/error.js';
import { SESSION_COOKIE } from './utils/session.js';
import routes from './routes/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Must be called after connectDb() — the session store reuses Mongoose's connection. */
export function createApp() {
  const app = express();
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));

  const ttlMs = env.SESSION_TTL_HOURS * 60 * 60 * 1000;
  app.use(
    session({
      name: SESSION_COOKIE,
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      store: MongoStore.create({
        client: mongoose.connection.getClient(),
        collectionName: 'sessions',
        ttl: env.SESSION_TTL_HOURS * 60 * 60,
        autoRemove: env.SESSION_AUTO_REMOVE,
      }),
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: env.COOKIE_SECURE === 'true',
        maxAge: ttlMs,
      },
    })
  );

  app.use('/api', apiLimiter, loadUser, csrfProtection, routes);
  app.use('/api', notFound);

  if (env.SERVE_CLIENT === 'true') {
    const dist = path.resolve(here, '../../client/dist');
    if (fs.existsSync(dist)) {
      app.use(express.static(dist));
      app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
    } else {
      console.warn('[server] SERVE_CLIENT=true but client/dist does not exist. Run "npm run build" first.');
    }
  }

  app.use(errorHandler);
  return app;
}
