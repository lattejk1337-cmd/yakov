import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Small HMAC-signed tokens (session after PIN unlock, locked exchange quotes).
 * Keys are derived per purpose from the bot token, so no extra secret has to be configured,
 * and a token minted for one purpose can never be accepted for another.
 */
export class TokenSigner {
  constructor(private readonly secret: string) {}

  private key(purpose: string): Buffer {
    return createHmac('sha256', `tonum-wallet:${purpose}`).update(this.secret).digest();
  }

  sign<T extends object>(purpose: string, payload: T, ttlSec: number, now = Date.now()): string {
    const body = Buffer.from(JSON.stringify({ ...payload, exp: now + ttlSec * 1000 })).toString('base64url');
    const mac = createHmac('sha256', this.key(purpose)).update(body).digest('base64url');
    return `${body}.${mac}`;
  }

  /** Returns the payload if the token is authentic and not expired, otherwise null. */
  verify<T extends object>(purpose: string, token: string | undefined, now = Date.now()): (T & { exp: number }) | null {
    if (typeof token !== 'string' || token.length > 2048) return null;
    const [body, mac] = token.split('.');
    if (!body || !mac) return null;
    const expected = createHmac('sha256', this.key(purpose)).update(body).digest();
    const actual = Buffer.from(mac, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp: number };
      return typeof payload.exp === 'number' && payload.exp > now ? payload : null;
    } catch {
      return null;
    }
  }
}
