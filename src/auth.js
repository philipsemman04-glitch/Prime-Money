const crypto = require('node:crypto');

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
const COOKIE_NAME = 'pm_session';

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function validateUsername(username) {
  if (typeof username !== 'string' || !/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
    return 'Username must be 3-32 characters: letters, numbers, dot, dash or underscore.';
  }
  return null;
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  if (password.length > 200) return 'Password is too long.';
  return null;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(token, { secure, maxAgeMs }) {
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

module.exports = {
  SESSION_TTL_MS,
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  randomToken,
  validateUsername,
  validatePassword,
  parseCookies,
  sessionCookie,
};
