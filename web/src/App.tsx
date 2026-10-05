import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Aurora } from './components/Aurora';
import { Icon } from './components/Icon';
import { Sheet } from './components/Sheet';
import { TabBar } from './components/TabBar';
import { ApiError, api, type Me } from './lib/api';
import { type Overlay, NavProvider, useNav } from './lib/nav';
import { usePref } from './lib/prefs';
import { keys, useMe } from './lib/queries';
import { session } from './lib/session';
import { telegram } from './lib/telegram';
import { About } from './screens/About';
import { DepositFlow } from './screens/Deposit';
import { ExchangeScreen } from './screens/Exchange';
import { HistoryScreen } from './screens/History';
import { Home } from './screens/Home';
import { Lock } from './screens/Lock';
import { OperationView } from './screens/Operation';
import { PinChange } from './screens/PinChange';
import { Profile } from './screens/Profile';
import { WithdrawFlow } from './screens/Withdraw';

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
  const [tint, setTint] = usePref('currency', 'RUB');
  if (!telegram.initData) {
    return (
      <>
        <Aurora currency={tint} />
        <OpenInTelegram />
      </>
    );
  }
  return (
    <>
      <Aurora currency={tint} />
      <Gate tint={tint} setTint={setTint} />
    </>
  );
}

function Gate({ tint, setTint }: { tint: string; setTint: (c: string) => void }) {
  const token = useSyncExternalStore(session.subscribe, () => session.token);
  const auth = useQuery({ queryKey: keys.auth, queryFn: api.authState, staleTime: 0 });

  if (auth.error instanceof ApiError) {
    if (auth.error.code === 'UNAUTHORIZED') {
      return <Message icon="clock" title="Сессия устарела" text="Закройте и снова откройте приложение из чата с ботом." />;
    }
    if (auth.error.code === 'USER_BLOCKED') return <Message icon="lock" title="Доступ ограничен" text={auth.error.message} />;
    if (!auth.data) return <Message icon="info" title="Нет связи с сервером" text={auth.error.message} action={() => void auth.refetch()} />;
  }
  if (!auth.data) return <Splash />;
  if (!token) return <Lock key="lock" state={auth.data} />;
  return (
    <NavProvider>
      <Wallet tint={tint} setTint={setTint} />
    </NavProvider>
  );
}

function Wallet({ tint, setTint }: { tint: string; setTint: (c: string) => void }) {
  const me = useMe();
  const nav = useNav();
  const [hidden, setHidden] = usePref('hideBalance', false);
  const [display, setDisplay] = usePref('displayCurrency', 'RUB');
  const onCurrency = useCallback((c: string) => setTint(c), [setTint]);

  if (!me.data) return me.isError ? <Message icon="info" title="Не удалось загрузить" text={me.error.message} action={() => void me.refetch()} /> : <Splash />;
  const data = me.data;
  const selected = data.assets.some((a) => a.code === tint) ? tint : data.assets[0]!.code;
  const displayCurrency = data.assets.some((a) => a.code === display) ? display : data.assets[0]!.code;
  const behind = nav.overlays.some((o) => !o.closing);

  return (
    <>
      <div className={`shell${behind ? ' is-behind' : ''}`}>
        <main key={nav.tab} className="tab-page">
          {nav.tab === 'home' && (
            <Home
              me={data}
              selected={selected}
              onSelect={setTint}
              displayCurrency={displayCurrency}
              hidden={hidden}
              onToggleHidden={() => setHidden(!hidden)}
            />
          )}
          {nav.tab === 'exchange' && <ExchangeScreen me={data} initialFrom={selected} onCurrency={onCurrency} />}
          {nav.tab === 'history' && <HistoryScreen me={data} hidden={hidden} />}
          {nav.tab === 'profile' && (
            <Profile
              me={data}
              displayCurrency={displayCurrency}
              onDisplayCurrency={setDisplay}
              hidden={hidden}
              onToggleHidden={() => setHidden(!hidden)}
            />
          )}
        </main>
      </div>
      {/* Outside .shell: a transformed ancestor would pin this "fixed" bar to the page instead of the screen. */}
      <TabBar tab={nav.tab} onChange={nav.setTab} behind={behind} />
      {nav.overlays.map((e, i) => (
        <Sheet key={e.key} title={titleOf(e.overlay)} closing={e.closing} onClose={nav.close} depth={i}>
          <OverlayContent overlay={e.overlay} me={data} onCurrency={onCurrency} />
        </Sheet>
      ))}
    </>
  );
}

function titleOf(o: Overlay): string {
  switch (o.name) {
    case 'deposit':
      return 'Пополнение';
    case 'withdraw':
      return 'Вывод';
    case 'operation':
      return o.kind === 'exchange' ? 'Обмен' : o.kind === 'deposit' ? 'Пополнение' : 'Вывод';
    case 'pin-change':
      return 'Код-пароль';
    case 'about':
      return 'Как это работает';
  }
}

function OverlayContent({ overlay, me, onCurrency }: { overlay: Overlay; me: Me; onCurrency: (c: string) => void }) {
  switch (overlay.name) {
    case 'deposit':
      return <DepositFlow me={me} asset={overlay.asset} onCurrency={onCurrency} />;
    case 'withdraw':
      return <WithdrawFlow me={me} asset={overlay.asset} onCurrency={onCurrency} />;
    case 'operation':
      return <OperationView me={me} kind={overlay.kind} id={overlay.id} />;
    case 'pin-change':
      return <PinChange />;
    case 'about':
      return <About me={me} />;
  }
}

function Splash() {
  return (
    <div className="splash">
      <div className="splash__logo glass">T</div>
    </div>
  );
}

function Message({ icon, title, text, action }: { icon: 'clock' | 'lock' | 'info'; title: string; text: string; action?: () => void }) {
  return (
    <div className="gate">
      <div className="gate__icon glass">
        <Icon name={icon} size={30} />
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
      {action && (
        <button className="btn btn--primary" onClick={action}>
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
      <div className="gate__icon glass">
        <Icon name="wallet" size={32} />
      </div>
      <h2>Откройте в Telegram</h2>
      <p>Tonum Wallet работает внутри Telegram: так мы надёжно знаем, что это вы.</p>
      {bot && (
        <a className="btn btn--primary" href={`https://t.me/${bot}`}>
          Открыть @{bot}
        </a>
      )}
    </div>
  );
}
