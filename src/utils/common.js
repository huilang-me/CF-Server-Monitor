/**
 * 公共工具函数模块
 * 统一存放各处重复定义的函数
 */

/**
 * 验证 Turnstile token
 * @param {string} token - Turnstile token
 * @param {string} secretKey - Turnstile secret key
 * @returns {Promise<boolean>} 验证结果
 */
export async function verifyTurnstileToken(token, secretKey) {
  if (!token || !secretKey) {
    return false;
  }
  
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        secret: secretKey,
        response: token
      })
    });
    
    const data = await response.json();
    return data.success === true;
  } catch (e) {
    console.error('Turnstile verification error:', e);
    return false;
  }
}

/**
 * 管理后台密码哈希参数
 */
export const PASSWORD_HASH_ALGORITHM = 'pbkdf2_sha256';
export const PASSWORD_HASH_ITERATIONS = 50000;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_HASH_BYTES = 32;

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex) {
  if (!hex || hex.length % 2 !== 0 || !/^[a-f0-9]+$/i.test(hex)) {
    return null;
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function timingSafeEqualBytes(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array)) {
    return false;
  }

  if (left.length === right.length && crypto.subtle && typeof crypto.subtle.timingSafeEqual === 'function') {
    return crypto.subtle.timingSafeEqual(left, right);
  }

  let diff = left.length ^ right.length;
  const maxLength = Math.max(left.length, right.length);
  for (let i = 0; i < maxLength; i++) {
    diff |= (left[i] || 0) ^ (right[i] || 0);
  }
  return diff === 0;
}

async function derivePbkdf2Hash(password, salt, iterations) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations
    },
    keyMaterial,
    PASSWORD_HASH_BYTES * 8
  );

  return new Uint8Array(bits);
}

function parsePbkdf2Hash(storedHash) {
  if (typeof storedHash !== 'string') {
    return null;
  }

  const parts = storedHash.trim().split('$');
  if (parts.length !== 4 || parts[0] !== PASSWORD_HASH_ALGORITHM) {
    return null;
  }

  const iterations = Number(parts[1]);
  const salt = hexToBytes(parts[2]);
  const hash = hexToBytes(parts[3]);

  if (
    !Number.isInteger(iterations) ||
    iterations <= 0 ||
    !salt ||
    salt.length !== PASSWORD_SALT_BYTES ||
    !hash ||
    hash.length !== PASSWORD_HASH_BYTES
  ) {
    return null;
  }

  return { iterations, salt, hash };
}

export function isLegacyMd5Hash(storedHash) {
  return typeof storedHash === 'string' && /^[a-f0-9]{32}$/i.test(storedHash.trim());
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  const hash = await derivePbkdf2Hash(password, salt, PASSWORD_HASH_ITERATIONS);
  return `${PASSWORD_HASH_ALGORITHM}$${PASSWORD_HASH_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(hash)}`;
}

export async function verifyPasswordHash(password, storedHash) {
  const parsed = parsePbkdf2Hash(storedHash);
  if (parsed) {
    const hash = await derivePbkdf2Hash(password, parsed.salt, parsed.iterations);
    return {
      valid: timingSafeEqualBytes(hash, parsed.hash),
      needsRehash: false,
      algorithm: PASSWORD_HASH_ALGORITHM
    };
  }

  if (isLegacyMd5Hash(storedHash)) {
    const hashedPassword = await md5Hash(password);
    const actual = hexToBytes(hashedPassword);
    const expected = hexToBytes(storedHash.trim().toLowerCase());
    const valid = timingSafeEqualBytes(actual, expected);
    return {
      valid,
      needsRehash: valid,
      algorithm: 'md5'
    };
  }

  return {
    valid: false,
    needsRehash: false,
    algorithm: 'unknown'
  };
}

/**
 * 计算 MD5 哈希值，仅用于兼容旧版密码
 * @param {string} input - 输入字符串
 * @returns {Promise<string>} MD5 哈希值
 */
export async function md5Hash(input) {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest('MD5', data);
  return bytesToHex(new Uint8Array(hash));
}
