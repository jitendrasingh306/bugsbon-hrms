import { defineConfig } from 'vitest/config';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Test uploads go to a throwaway folder, never to server/storage.
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bugsbon-uploads-'));

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      SESSION_SECRET: 'test-only-session-secret-0123456789abcdef0123456789',
      BCRYPT_ROUNDS: '4',
      UPLOAD_DIR: uploadDir,
    },
  },
});
