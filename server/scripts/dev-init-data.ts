/**
 * Prints a signed Telegram initData string for local development outside Telegram.
 * Put the output into web/.env.local as VITE_DEV_INIT_DATA. Never use in production.
 *
 *   npm run dev:initdata -w server -- [userId] [firstName]
 */
import { signInitData } from '../src/auth/telegram.js';

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('BOT_TOKEN is not set (add it to .env)');
  process.exit(1);
}
const [id = '100000001', firstName = 'Dev'] = process.argv.slice(2);
console.log(
  signInitData(
    {
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: 'DEV',
      user: JSON.stringify({ id: Number(id), first_name: firstName, username: 'dev_user', language_code: 'ru' }),
    },
    token,
  ),
);
