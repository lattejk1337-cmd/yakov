import { useEffect, useState } from 'react';
import { Icon } from './components/Icon';
import { ApiError } from './lib/api';
import { NavProvider, type Route, useNav } from './lib/nav';
import { useMe } from './lib/queries';
import { telegram } from './lib/telegram';
import { AmountScreen } from './screens/Amount';
import { Home } from './screens/Home';
import { OperationScreen } from './screens/Operation';
import { PinSetup } from './screens/PinSetup';
import { Security } from './screens/Security';
import { WithdrawConfirm } from './screens/WithdrawConfirm';

function useTelegramTheme() {
  const [scheme, setScheme] = useState(telegram.colorScheme);
  useEffect(() => telegram.onThemeChanged(() => setScheme(telegram.colorScheme)), []);
  useEffect(() => {
    document.documentElement.dataset.theme = scheme;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    telegram.paint(bg);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
  }, [scheme]);
}

export function App() {
  useTelegramTheme();
  if (!telegram.initData) return <OpenInTelegram />;
  return (
    <NavProvider>
      <div className="app">
        <Gate />
      </div>
    </NavProvider>
  );
}

/** Handles states where the wallet can't be shown at all. */
function Gate() {
  const me = useMe();
  if (me.error instanceof ApiError) {
    if (me.error.code === 'UNAUTHORIZED') {
      return (
        <Message icon="clock" title="Сессия устарела" text="Закройте и снова откройте приложение из чата с ботом." />
      );
    }
    if (me.error.code === 'USER_BLOCKED') {
      return <Message icon="lock" title="Доступ ограничен" text={me.error.message} />;
    }
    if (!me.data) {
      return (
        <Message icon="info" title="Нет связи с сервером" text={me.error.message} action={() => void me.refetch()} />
      );
    }
  }
  return <Screens />;
}

function Screens() {
  const nav = useNav();
  return (
    <main key={nav.key} className={`screen${nav.direction === 'back' ? ' screen--back' : ''}`}>
      {nav.canGoBack && !telegram.backButton.available && (
        <div style={{ paddingTop: 12 }}>
          <button className="back-fallback" onClick={nav.back} aria-label="Назад">
            <Icon name="back" size={20} />
          </button>
        </div>
      )}
      <RouteView route={nav.route} />
    </main>
  );
}

function RouteView({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <Home />;
    case 'amount':
      return <AmountScreen mode={route.mode} asset={route.asset} />;
    case 'withdraw-confirm':
      return <WithdrawConfirm asset={route.asset} amount={route.amount} />;
    case 'pin-setup':
      return <PinSetup then={route.then} />;
    case 'pin-change':
      return <PinSetup change />;
    case 'operation':
      return <OperationScreen kind={route.kind} id={route.id} />;
    case 'security':
      return <Security />;
  }
}

function Message({
  icon,
  title,
  text,
  action,
}: {
  icon: 'clock' | 'lock' | 'info';
  title: string;
  text: string;
  action?: () => void;
}) {
  return (
    <div className="gate">
      <div className="pin__lock">
        <Icon name={icon} size={28} />
      </div>
      <div className="gate__title">{title}</div>
      <p className="muted" style={{ margin: 0, maxWidth: 300 }}>
        {text}
      </p>
      {action && (
        <button className="btn btn--lime" onClick={action}>
          Повторить
        </button>
      )}
    </div>
  );
}

function OpenInTelegram() {
  const bot = import.meta.env.VITE_BOT_USERNAME;
  return (
    <div className="gate">
      <div className="pin__lock">
        <Icon name="wallet" size={30} />
      </div>
      <div className="gate__title">Откройте в Telegram</div>
      <p className="muted" style={{ margin: 0, maxWidth: 300 }}>
        Кошелёк работает внутри Telegram: так мы надёжно знаем, что это вы, без паролей.
      </p>
      {bot && (
        <a className="btn btn--lime" href={`https://t.me/${bot}`} style={{ textDecoration: 'none' }}>
          Открыть @{bot}
        </a>
      )}
    </div>
  );
}
