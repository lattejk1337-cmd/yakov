import { Icon } from '../components/Icon';
import { fmt } from '../lib/format';
import { useNav } from '../lib/nav';
import { usePref } from '../lib/prefs';
import { useMe } from '../lib/queries';
import { telegram } from '../lib/telegram';

export function Security() {
  const me = useMe();
  const nav = useNav();
  const [hidden, setHidden] = usePref('hideBalance', false);
  if (!me.data) return null;
  const { security, assets } = me.data;

  return (
    <>
      <div className="head">
        <div>
          <div className="label">Настройки</div>
          <div className="head__title">Безопасность</div>
        </div>
      </div>

      <div className="card">
        <button
          className="row"
          onClick={() => nav.push(security.hasPin ? { name: 'pin-change' } : { name: 'pin-setup' })}
        >
          <span className="row__icon">
            <Icon name="key" size={20} />
          </span>
          <span className="row__body">
            <div className="row__title">PIN-код</div>
            <div className="row__sub">{security.hasPin ? 'Сменить код подтверждения' : 'Обязателен для вывода средств'}</div>
          </span>
          <span className={`pill${security.hasPin ? ' pill--ok' : ''}`}>{security.hasPin ? 'Включён' : 'Не задан'}</span>
        </button>

        <div className="row">
          <span className="row__icon">
            <Icon name="eyeOff" size={20} />
          </span>
          <span className="row__body">
            <div className="row__title">Скрывать баланс</div>
            <div className="row__sub">Если рядом посторонние</div>
          </span>
          <button
            className="switch"
            role="switch"
            aria-checked={hidden}
            aria-label="Скрывать баланс"
            onClick={() => {
              telegram.haptic.select();
              setHidden(!hidden);
            }}
          />
        </div>
      </div>

      <div className="card">
        <table className="limits">
          <thead>
            <tr>
              <th>Актив</th>
              <th>Вывод от</th>
              <th>Комиссия</th>
              <th>В сутки</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.code}>
                <td>
                  <b>{a.code}</b>
                </td>
                <td>{fmt(a.minWithdraw, a)}</td>
                <td>{fmt(a.withdrawFee, a)}</td>
                <td>{fmt(a.dailyWithdrawLimit, { ...a, inputDecimals: 0 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="footnote">
        Вход подтверждается подписью Telegram — пароль не нужен. Вывод возможен только на ваш собственный аккаунт
        @CryptoBot и только после ввода PIN-кода. После 5 неверных попыток код блокируется на 15 минут.
      </p>
    </>
  );
}
