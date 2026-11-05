import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$v2$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<{ valid: boolean; needsUpgrade: boolean }> {
  if (!password || !stored) return { valid: false, needsUpgrade: false };
  const parts = stored.split('$');
  if (parts[0] !== 'scrypt') {
    const a = Buffer.from(password);
    const b = Buffer.from(stored);
    const valid = a.length === b.length && timingSafeEqual(a, b);
    return { valid, needsUpgrade: valid };
  }
  const modern = parts.length === 4 && parts[1] === 'v2';
  if ((!modern && parts.length !== 3)) return { valid: false, needsUpgrade: false };
  const saltHex = parts[modern ? 2 : 1] ?? '';
  const hashHex = parts[modern ? 3 : 2] ?? '';
  if (!/^[0-9a-f]{32}$/i.test(saltHex) || !/^[0-9a-f]{128}$/i.test(hashHex)) return { valid: false, needsUpgrade: false };
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length) as Buffer;
  const valid = timingSafeEqual(expected, actual);
  return { valid, needsUpgrade: valid && !modern };
}
