import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { AuthTokenPayload } from './types.ts';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin888';
const SERVER_SECRET = process.env.SERVER_SECRET || 'a-stock-tracker-secret-key-32b!';

// IP 失败计数与锁定记录 (Sliding window rate limit)
interface IPRateLimit {
  failures: number[];
  lockedUntil: number;
}
const ipRateLimits = new Map<string, IPRateLimit>();

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf-8');
}

export function signToken(payload: AuthTokenPayload): string {
  const payloadStr = JSON.stringify(payload);
  const encodedPayload = base64UrlEncode(payloadStr);
  const signature = crypto
    .createHmac('sha256', SERVER_SECRET)
    .update(encodedPayload)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${encodedPayload}.${signature}`;
}

export function verifyToken(token: string): AuthTokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encodedPayload, signature] = parts;
    const expectedSignature = crypto
      .createHmac('sha256', SERVER_SECRET)
      .update(encodedPayload)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    // 常数时间签名比对
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const payload: AuthTokenPayload = JSON.parse(base64UrlDecode(encodedPayload));
    if (Date.now() > payload.exp) {
      return null; // 过期
    }
    return payload;
  } catch (err) {
    return null;
  }
}

/**
 * 校验密码并处理防暴力破解 (Section 5.1)
 */
export function verifyPassword(password: string, clientIp: string): { success: boolean; token?: string; exp?: number; error?: string; status: number } {
  const now = Date.now();
  let rateInfo = ipRateLimits.get(clientIp);
  if (!rateInfo) {
    rateInfo = { failures: [], lockedUntil: 0 };
    ipRateLimits.set(clientIp, rateInfo);
  }

  // 检查是否在锁定中 (5分钟锁定)
  if (rateInfo.lockedUntil > now) {
    const remainSec = Math.ceil((rateInfo.lockedUntil - now) / 1000);
    return {
      success: false,
      error: `密码错误过多，IP已被锁定，请在 ${remainSec} 秒后重试`,
      status: 429
    };
  }

  // 清除 1 分钟以前的失败记录
  rateInfo.failures = rateInfo.failures.filter(t => now - t < 60 * 1000);

  // 常数时间安全比对密码
  const inputBuf = Buffer.from(password || '');
  const targetBuf = Buffer.from(ADMIN_PASSWORD);
  const isMatch = inputBuf.length === targetBuf.length && crypto.timingSafeEqual(inputBuf, targetBuf);

  if (!isMatch) {
    rateInfo.failures.push(now);
    if (rateInfo.failures.length >= 5) {
      rateInfo.lockedUntil = now + 5 * 60 * 1000; // 锁定5分钟
      return {
        success: false,
        error: '连续密码错误达到 5 次，IP已被临时锁定 5 分钟',
        status: 429
      };
    }
    return {
      success: false,
      error: '管理授权密码不正确',
      status: 401
    };
  }

  // 成功重置计数
  rateInfo.failures = [];
  rateInfo.lockedUntil = 0;

  const exp = now + 24 * 60 * 60 * 1000; // 24小时有效期
  const token = signToken({
    iat: now,
    exp,
    scope: 'write'
  });

  return {
    success: true,
    token,
    exp,
    status: 200
  };
}

/**
 * Express 鉴权中间件: requireWriteAuth (Section 5.1)
 */
export function requireWriteAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供有效的写操作授权令牌', code: 'UNAUTHORIZED' });
  }

  const token = authHeader.slice(7).trim();
  const payload = verifyToken(token);
  if (!payload || payload.scope !== 'write') {
    return res.status(401).json({ error: '授权令牌无效或已过期，请重新输入密码', code: 'INVALID_TOKEN' });
  }

  (req as any).userAuth = payload;
  next();
}
