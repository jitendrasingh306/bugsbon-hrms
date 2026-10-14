import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { AppError } from './AppError.js';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Private upload root. Never exposed through express.static. */
export const uploadRoot = () =>
  path.isAbsolute(env.UPLOAD_DIR) ? env.UPLOAD_DIR : path.resolve(serverRoot, env.UPLOAD_DIR);

export function uploadDir(kind) {
  const dir = path.join(uploadRoot(), kind);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Resolves a stored file name safely (no path traversal). */
export function storedPath(kind, storedName) {
  if (!/^[a-f0-9]{32}\.[a-z0-9]{2,5}$/.test(storedName || '')) {
    throw new AppError(404, 'File not found.', 'NOT_FOUND');
  }
  return path.join(uploadDir(kind), storedName);
}

export const randomStoredName = (ext) => `${crypto.randomBytes(16).toString('hex')}.${ext}`;

export async function removeFile(filePath) {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch {
    /* already gone */
  }
}

export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(filePath)
      .on('data', (c) => hash.update(c))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** Lists entry names of a ZIP file by reading its central directory (no extraction, no dependency). */
export async function zipEntryNames(filePath) {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const { size } = await fh.stat();
    if (size < 22) throw new Error('too small');
    const head = Buffer.alloc(4);
    await fh.read(head, 0, 4, 0);
    if (head.readUInt32LE(0) !== 0x04034b50) throw new Error('no local header');

    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) throw new Error('no end of central directory');

    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new Error('zip64 not supported');
    if (cdSize > 64 * 1024 * 1024 || cdOffset + cdSize > size) throw new Error('bad central directory');

    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    const names = [];
    let p = 0;
    while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      names.push(cd.toString('utf8', p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
    }
    return names;
  } finally {
    await fh.close();
  }
}

/** Content check (not just the extension): must be a ZIP that contains AndroidManifest.xml. */
export async function assertValidApk(filePath) {
  let names;
  try {
    names = await zipEntryNames(filePath);
  } catch {
    throw new AppError(400, 'The file is not a valid APK (it is not a readable ZIP archive).', 'INVALID_APK');
  }
  if (!names.includes('AndroidManifest.xml')) {
    throw new AppError(400, 'The file is not a valid APK: AndroidManifest.xml is missing.', 'INVALID_APK');
  }
  if (names.some((n) => n.startsWith('/') || n.includes('..'))) {
    throw new AppError(400, 'The APK contains unsafe file paths and was rejected.', 'INVALID_APK');
  }
}

/** Detects png/jpeg/webp by magic bytes. Returns { ext, mime } or null. */
export async function sniffImage(filePath) {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const b = Buffer.alloc(12);
    await fh.read(b, 0, 12, 0);
    if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
    if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
    return null;
  } finally {
    await fh.close();
  }
}

/** Strips path parts and unsafe characters from a client-supplied file name (display only). */
export function safeDisplayName(name = 'file') {
  const base = path.basename(String(name)).replace(/[^\w.\- ()]/g, '_').slice(0, 120);
  return base || 'file';
}
