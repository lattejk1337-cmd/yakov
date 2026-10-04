import type { AssetInfo, Me } from './api';
import type { Mode } from './nav';
import { fromUnits, normalize, toUnits } from './money';
import { fmt } from './format';

export interface AmountCheck {
  units: bigint;
  fee: bigint;
  /** Largest amount the user can enter right now. */
  max: bigint;
  min: bigint;
  error: string | null;
  hint: string;
}

/** Client-side mirror of the server rules, for instant feedback. The server stays authoritative. */
export function checkAmount(me: Me, asset: AssetInfo, mode: Mode, value: string): AmountCheck {
  const u = (s: string) => toUnits(s, asset.decimals);
  const f = (v: bigint) => `${fmt(fromUnits(v, asset.decimals), asset)} ${asset.code}`;
  const units = u(normalize(value));

  if (mode === 'deposit') {
    const min = u(asset.minDeposit);
    const max = u(asset.maxDeposit);
    let error: string | null = null;
    if (value && units < min) error = `Минимум ${f(min)}`;
    else if (units > max) error = `Максимум ${f(max)}`;
    return { units, fee: 0n, min, max, error, hint: `от ${f(min)} до ${f(max)}` };
  }

  const fee = u(asset.withdrawFee);
  const balance = u(me.balances[asset.code] ?? '0');
  const dailyLeft = u(asset.dailyWithdrawLimit) - u(me.withdrawnToday[asset.code] ?? '0');
  const min = u(asset.minWithdraw);
  let max = u(asset.maxWithdraw);
  if (balance - fee < max) max = balance - fee;
  if (dailyLeft < max) max = dailyLeft;
  if (max < 0n) max = 0n;

  let error: string | null = null;
  if (value && units < min) error = `Минимум ${f(min)}`;
  else if (units + fee > balance && units > 0n) error = 'Недостаточно средств с учётом комиссии';
  else if (units > dailyLeft) error = `Суточный лимит: доступно ${f(dailyLeft > 0n ? dailyLeft : 0n)}`;
  else if (units > u(asset.maxWithdraw)) error = `Максимум за раз ${f(u(asset.maxWithdraw))}`;

  return { units, fee, min, max, error, hint: `Доступно ${f(max)}` };
}

/** Rounds down to what the user is allowed to type. */
export function floorToInput(units: bigint, asset: AssetInfo): bigint {
  const step = 10n ** BigInt(asset.decimals - asset.inputDecimals);
  return units - (units % step);
}
