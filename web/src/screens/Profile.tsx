import { useState } from 'react';
import { Avatar } from '../components/Avatar';
import { CurrencyIcon } from '../components/CurrencyIcon';
import { Icon, type IconName } from '../components/Icon';
import type { Me } from '../lib/api';
import { DISPLAY_CURRENCIES } from '../lib/currencies';
import { money } from '../lib/format';
import { useNav } from '../lib/nav';
import { session } from '../lib/session';
import { telegram } from '../lib/telegram';

export function Profile({
  me,
  displayCurrency,
  onDisplayCurrency,
  hidden,
  onToggleHidden,
}: {
  me: Me;
  displayCurrency: string;
  onDisplayCurrency: (c: string) => void;
  hidden: boolean;
  onToggleHidden: () => void;
}) {
  const nav = useNav();
  const [showLimits, setShowLimits] = useState(false);
  const name = me.user.firstName || me.user.username || '';
  const displayable = DISPLAY_CURRENCIES.filter((c) => me.assets.some((a) => a.code === c));

  return (
    <div className="page">
      <div className="profile-head">
        <Avatar name={name} photoUrl={me.user.photoUrl} size={96} ring />
        <h1 className="profile-head__name">{name}</h1>
        {me.user.username && <span className="caption">@{me.user.username}</span>}
      </div>

      <div className="list glass">
        <Row icon="key" title="Сменить код-пароль" onClick={() => nav.open({ name: 'pin-change' })} chevron />
        <Row icon={hidden ? 'eyeOff' : 'eye'} title="Скрывать балансы">
          <button
            className="switch"
            role="switch"
            aria-checked={hidden}
            aria-label="Скрывать балансы"
            onClick={() => {
              telegram.haptic.select();
              onToggleHidden();
            }}
          />
        </Row>
        <Row icon="lock" title="Заблокировать сейчас" onClick={() => session.lock()} />
      </div>

      <div className="section">
        <div className="section__head">
          <span className="section__title section__title--small">Показывать общий баланс в</span>
        </div>
        <div className="segmented glass">
          {displayable.map((c) => (
            <button
              key={c}
              className={c === displayCurrency ? 'is-active' : ''}
              onClick={() => {
                telegram.haptic.select();
                onDisplayCurrency(c);
              }}
            >
              <CurrencyIcon code={c} size={22} /> {c}
            </button>
          ))}
        </div>
      </div>

      <div className="list glass">
        <Row icon="gauge" title="Лимиты и комиссии" onClick={() => setShowLimits((v) => !v)} chevron rotate={showLimits} />
        {showLimits && (
          <div className="limits">
            {me.assets.map((a) => (
              <div key={a.code} className="limits__row">
                <CurrencyIcon code={a.code} size={28} />
                <div>
                  <b>{a.name}</b>
                  <span>
                    Вывод от {money(a.minWithdraw, a.code, a)} · комиссия {money(a.withdrawFee, a.code, a)}
                    <br />
                    До {money(a.dailyWithdrawLimit, a.code, a)} в сутки · обмен {me.exchangeFeePercent}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        <Row icon="info" title="Как работают счета" onClick={() => nav.open({ name: 'about' })} chevron />
      </div>

      <p className="footnote">
        Вход и выводы защищены код-паролем. Рубли, доллары, евро и юани пополняются и выводятся через @CryptoBot: вы платите
        криптовалютой по текущему курсу, а при выводе получаете USDT. Tonum Wallet · v2
      </p>
    </div>
  );
}

function Row({
  icon,
  title,
  onClick,
  chevron,
  rotate,
  children,
}: {
  icon: IconName;
  title: string;
  onClick?: () => void;
  chevron?: boolean;
  rotate?: boolean;
  children?: React.ReactNode;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={`row${onClick ? ' press' : ''}`} onClick={onClick}>
      <span className="row__icon">
        <Icon name={icon} size={20} />
      </span>
      <span className="row__title">{title}</span>
      {children}
      {chevron && (
        <span className={`row__chev${rotate ? ' is-open' : ''}`}>
          <Icon name="chevronRight" size={18} />
        </span>
      )}
    </Tag>
  );
}
