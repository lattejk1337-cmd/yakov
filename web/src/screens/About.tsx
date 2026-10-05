import { CurrencyIcon } from '../components/CurrencyIcon';
import type { Me } from '../lib/api';

export function About({ me }: { me: Me }) {
  return (
    <div className="flow about">
      <div className="about__icons">
        {me.assets.map((a) => (
          <CurrencyIcon key={a.code} code={a.code} size={40} />
        ))}
      </div>
      <div className="glass about__card">
        <h3>Счета в разных валютах</h3>
        <p>У вас отдельный счёт в каждой валюте. Деньги между ними переводятся обменом по рыночному курсу CryptoBot с комиссией {me.exchangeFeePercent}%.</p>
        <h3>Пополнение</h3>
        <p>Через @CryptoBot. Для рублей, долларов, евро и юаней вы оплачиваете счёт криптовалютой (USDT или TON) по курсу на момент оплаты — на баланс приходит ровно сумма счёта.</p>
        <h3>Вывод</h3>
        <p>Выводы приходят в @CryptoBot. Рубли, доллары, евро и юани выводятся в USDT по текущему курсу, TON — в TON. Каждый вывод подтверждается код-паролем.</p>
        <h3>Безопасность</h3>
        <p>Вход подтверждается подписью Telegram и вашим код-паролем. После 5 неверных попыток вход блокируется на 15 минут. Приложение само блокируется, если свернуть его больше чем на 2 минуты.</p>
      </div>
    </div>
  );
}
