import { Bot, InlineKeyboard } from 'grammy';
import type { Config } from '../config.js';
import type { Logger, Notifier } from '../services/wallet.js';

export function createBot(config: Config, log: Logger): Bot {
  const bot = new Bot(config.BOT_TOKEN);
  const openButton = () =>
    config.WEBAPP_URL ? new InlineKeyboard().webApp('Открыть кошелёк', config.WEBAPP_URL) : undefined;

  bot.command('start', async (ctx) => {
    await ctx.reply(
      [
        '<b>Кошелёк</b> — пополняйте и выводите криптовалюту прямо в Telegram.',
        '',
        '• Пополнение через @CryptoBot за пару касаний',
        '• Вывод защищён PIN-кодом',
        '• Уведомления о каждой операции',
      ].join('\n'),
      { parse_mode: 'HTML', reply_markup: openButton() },
    );
  });

  bot.command('help', (ctx) =>
    ctx.reply('Откройте кошелёк кнопкой ниже. Если что-то пошло не так — напишите в поддержку.', {
      reply_markup: openButton(),
    }),
  );

  bot.catch((err) => log.error({ err: err.error, updateId: err.ctx.update.update_id }, 'bot handler failed'));
  return bot;
}

/** Sets the chat menu button so the wallet opens from any chat with the bot. */
export async function configureBot(bot: Bot, config: Config, log: Logger): Promise<void> {
  try {
    await bot.api.setMyCommands([
      { command: 'start', description: 'Открыть кошелёк' },
      { command: 'help', description: 'Помощь' },
    ]);
    if (config.WEBAPP_URL) {
      await bot.api.setChatMenuButton({
        menu_button: { type: 'web_app', text: 'Кошелёк', web_app: { url: config.WEBAPP_URL } },
      });
    }
  } catch (err) {
    log.warn({ err }, 'failed to configure bot commands/menu');
  }
}

export class BotNotifier implements Notifier {
  constructor(
    private readonly bot: Bot,
    private readonly webAppUrl?: string,
  ) {}

  async notify(userId: number, text: string): Promise<void> {
    await this.bot.api.sendMessage(userId, text, {
      reply_markup: this.webAppUrl ? new InlineKeyboard().webApp('Открыть кошелёк', this.webAppUrl) : undefined,
    });
  }
}
