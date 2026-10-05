import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signInitData, validateInitData } from '../src/auth/telegram.js';
import { formatAmount, parseAmount } from '../src/domain/money.js';
import { CryptoPayProvider, verifyCryptoPaySignature } from '../src/providers/cryptopay.js';
import { ProviderRejectedError, ProviderUnavailableError } from '../src/providers/types.js';
import { assertPinStrength, hashPin, verifyPinHash } from '../src/services/pin.js';
import { BOT_TOKEN } from './helpers.js';

describe('money', () => {
  it('parses decimal strings into minor units', () => {
    expect(parseAmount('12.5', 6)).toBe(12_500_000n);
    expect(parseAmount('0.000001', 6)).toBe(1n);
    expect(parseAmount('100', 9)).toBe(100_000_000_000n);
  });

  it('rejects malformed or over-precise input', () => {
    for (const bad of ['', '-1', '1e5', '1,5', '.5', '5.', ' 1 2', 'NaN', '0x10', '1234567890123456']) {
      expect(() => parseAmount(bad, 6), bad).toThrow();
    }
    expect(() => parseAmount('1.234', 6, 2)).toThrow();
  });

  it('formats without trailing zeros and round-trips', () => {
    expect(formatAmount(12_500_000n, 6)).toBe('12.5');
    expect(formatAmount(0n, 6)).toBe('0');
    expect(formatAmount(-1n, 6)).toBe('-0.000001');
    for (const s of ['0.1', '99999.99', '1']) expect(formatAmount(parseAmount(s, 6), 6)).toBe(s);
  });
});

describe('telegram initData', () => {
  const now = new Date();
  const fresh = () =>
    signInitData(
      {
        auth_date: String(Math.floor(now.getTime() / 1000)),
        user: JSON.stringify({ id: 42, first_name: 'Яков', username: 'yakov' }),
        query_id: 'AAF',
      },
      BOT_TOKEN,
    );

  it('accepts correctly signed data', () => {
    const data = validateInitData(fresh(), BOT_TOKEN, { maxAgeSec: 3600, now });
    expect(data.user.id).toBe(42);
    expect(data.user.first_name).toBe('Яков');
  });

  it('rejects a wrong bot token', () => {
    expect(() => validateInitData(fresh(), '999:OTHER_TOKEN_abcdefghijklmnopqrstuvw', { maxAgeSec: 3600, now })).toThrow(
      /signature/,
    );
  });

  it('rejects tampered user data', () => {
    const tampered = fresh().replace(encodeURIComponent('"id":42'), encodeURIComponent('"id":43'));
    expect(tampered).not.toBe(fresh());
    expect(() => validateInitData(tampered, BOT_TOKEN, { maxAgeSec: 3600, now })).toThrow(/signature/);
  });

  it('rejects stale data', () => {
    const later = new Date(now.getTime() + 2 * 3600 * 1000);
    expect(() => validateInitData(fresh(), BOT_TOKEN, { maxAgeSec: 3600, now: later })).toThrow(/expired/);
  });

  it('rejects missing hash', () => {
    expect(() => validateInitData('auth_date=1&user=%7B%7D', BOT_TOKEN, { maxAgeSec: 3600 })).toThrow();
  });
});

describe('crypto pay', () => {
  const token = '1234:AAtoken';
  const body = Buffer.from('{"update_id":1,"update_type":"invoice_paid"}');
  const sign = (b: Buffer) =>
    createHmac('sha256', createHash('sha256').update(token).digest()).update(b).digest('hex');

  it('verifies webhook signatures', () => {
    expect(verifyCryptoPaySignature(body, sign(body), token)).toBe(true);
    expect(verifyCryptoPaySignature(Buffer.from(body.toString() + ' '), sign(body), token)).toBe(false);
    expect(verifyCryptoPaySignature(body, undefined, token)).toBe(false);
    expect(verifyCryptoPaySignature(body, 'abc', token)).toBe(false);
  });

  it('classifies API errors as rejected vs unknown outcome', async () => {
    const respond = (status: number, json: unknown) =>
      (async () => new Response(JSON.stringify(json), { status })) as unknown as typeof fetch;
    const transfer = (f: typeof fetch) =>
      new CryptoPayProvider(token, 'testnet', f).transfer({ telegramUserId: 1, asset: 'USDT', amount: '1', spendId: 'x' });

    await expect(transfer(respond(400, { ok: false, error: { code: 400, name: 'INSUFFICIENT_FUNDS' } }))).rejects.toBeInstanceOf(
      ProviderRejectedError,
    );
    await expect(transfer(respond(502, {}))).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(transfer(respond(429, {}))).rejects.toBeInstanceOf(ProviderUnavailableError);
    const failing = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(transfer(failing)).rejects.toBeInstanceOf(ProviderUnavailableError);
    const ok = await transfer(respond(200, { ok: true, result: { transfer_id: 77, spend_id: 'x', status: 'completed' } }));
    expect(ok.transferId).toBe('77');
  });
});

describe('pin', () => {
  it('rejects weak PINs', () => {
    for (const weak of ['0000', '1111', '1234', '9876', '123', '12345', 'abcd']) {
      expect(() => assertPinStrength(weak), weak).toThrow();
    }
    expect(() => assertPinStrength('2749')).not.toThrow();
  });

  it('hashes with a random salt and verifies', async () => {
    const a = await hashPin('2749');
    const b = await hashPin('2749');
    expect(a).not.toBe(b);
    expect(await verifyPinHash('2749', a)).toBe(true);
    expect(await verifyPinHash('2748', a)).toBe(false);
  });
});

describe('fixed-point rates', () => {
  it('derives USD prices and converts without floats', async () => {
    const { buildUsdPrices } = await import('../src/services/rates.js');
    const { convertUnits, formatDecimal, parseDecimal, SCALE } = await import('../src/domain/decimal.js');
    const prices = buildUsdPrices([
      { source: 'USDT', target: 'USD', rate: '1' },
      { source: 'USDT', target: 'RUB', rate: '92.5' },
      { source: 'TON', target: 'USD', rate: '5.2' },
      { source: 'BAD', target: 'USD', rate: 'oops' },
    ]);
    expect(prices.get('USD')).toBe(SCALE);
    expect(prices.has('BAD')).toBe(false);
    // 100.00 USD → RUB (2 decimals): 9250.00
    const rub = convertUnits(10_000n, { decimals: 2, price: prices.get('USD')! }, { decimals: 2, price: prices.get('RUB')! });
    expect(rub).toBe(925_000n);
    // 1 TON (9 decimals) → USD cents
    expect(convertUnits(10n ** 9n, { decimals: 9, price: prices.get('TON')! }, { decimals: 2, price: SCALE })).toBe(520n);
    expect(formatDecimal(parseDecimal('92.5'), 4)).toBe('92.5');
    expect(parseDecimal('1e-7')).toBe(100_000_000_000n);
  });

  it('signs tokens per purpose and expires them', async () => {
    const { TokenSigner } = await import('../src/auth/tokens.js');
    const s = new TokenSigner('secret');
    const t = s.sign('session', { u: 1 }, 60);
    expect(s.verify('session', t)).toMatchObject({ u: 1 });
    expect(s.verify('quote', t)).toBeNull();
    expect(new TokenSigner('other').verify('session', t)).toBeNull();
    expect(s.verify('session', s.sign('session', { u: 1 }, -1))).toBeNull();
    expect(s.verify('session', 'garbage')).toBeNull();
    // Flipping a spare bit of the last base64 character keeps the bytes but must not be accepted.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const sibling = t.slice(0, -1) + alphabet[alphabet.indexOf(t.at(-1)!) ^ 1];
    expect(s.verify('session', sibling)).toBeNull();
  });
});
