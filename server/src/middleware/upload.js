import multer from 'multer';
import path from 'node:path';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { randomStoredName, uploadDir } from '../utils/files.js';

// Files land in a private folder under a random name; the original name is kept only as metadata.
const storage = (kind, ext) =>
  multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir(kind)),
    filename: (req, file, cb) => cb(null, randomStoredName(ext || 'bin')),
  });

export const apkUpload = multer({
  storage: storage('builds', 'apk'),
  limits: { fileSize: env.MAX_APK_MB * 1024 * 1024, files: 1, fields: 20, fieldSize: 20000 },
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== '.apk') {
      return cb(new AppError(400, 'Only .apk files can be uploaded as builds.', 'INVALID_FILE_TYPE'));
    }
    cb(null, true);
  },
}).single('apk');

export const bugImageUpload = multer({
  storage: storage('bug-images', 'tmp'),
  limits: { fileSize: env.MAX_IMAGE_MB * 1024 * 1024, files: 3, fields: 20, fieldSize: 20000 },
  fileFilter: (req, file, cb) => {
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(file.originalname).toLowerCase())) {
      return cb(new AppError(400, 'Screenshots must be PNG, JPG or WEBP images.', 'INVALID_FILE_TYPE'));
    }
    cb(null, true);
  },
}).array('screenshots', 3);
