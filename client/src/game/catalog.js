// Cosmetics, perks and progression unlocks.

export const SKIN_TONES = [
  [0.96, 0.8, 0.69], [0.89, 0.69, 0.55], [0.76, 0.56, 0.42], [0.6, 0.42, 0.3], [0.42, 0.28, 0.2], [0.3, 0.2, 0.15],
];
export const HAIR_COLORS = [
  [0.08, 0.06, 0.05], [0.3, 0.18, 0.1], [0.55, 0.38, 0.2], [0.85, 0.7, 0.45], [0.6, 0.15, 0.08], [0.7, 0.7, 0.72], [0.25, 0.3, 0.6],
];

// slot -> list of items. price 0 = free; lvl = required level
export const ITEMS = [
  // hair styles
  { id: 'hair_none', slot: 'hair', n: { ru: 'Без волос', en: 'Bald' }, price: 0 },
  { id: 'hair_short', slot: 'hair', n: { ru: 'Короткая', en: 'Short' }, price: 0 },
  { id: 'hair_long', slot: 'hair', n: { ru: 'Хвост', en: 'Ponytail' }, price: 0 },
  { id: 'hair_mohawk', slot: 'hair', n: { ru: 'Ирокез', en: 'Mohawk' }, price: 150 },
  { id: 'hair_bun', slot: 'hair', n: { ru: 'Пучок', en: 'Bun' }, price: 100 },
  { id: 'hair_messy', slot: 'hair', n: { ru: 'Лохматая', en: 'Messy' }, price: 0, lvl: 2 },
  // hats
  { id: 'hat_none', slot: 'hat', n: { ru: 'Нет', en: 'None' }, price: 0 },
  { id: 'hat_cap', slot: 'hat', n: { ru: 'Кепка', en: 'Cap' }, price: 100, color: [0.15, 0.2, 0.4] },
  { id: 'hat_beanie', slot: 'hat', n: { ru: 'Шапка', en: 'Beanie' }, price: 150, color: [0.5, 0.1, 0.1] },
  { id: 'hat_hood', slot: 'hat', n: { ru: 'Капюшон', en: 'Hood' }, price: 0, lvl: 3, color: [0.25, 0.25, 0.27] },
  { id: 'hat_bandana', slot: 'hat', n: { ru: 'Бандана', en: 'Bandana' }, price: 200, color: [0.6, 0.12, 0.1] },
  { id: 'hat_hardhat', slot: 'hat', n: { ru: 'Каска', en: 'Hard hat' }, price: 300, color: [0.9, 0.7, 0.1] },
  { id: 'hat_headlamp', slot: 'hat', n: { ru: 'Налобный фонарь', en: 'Headlamp' }, price: 450, lvl: 8, color: [0.15, 0.15, 0.15] },
  { id: 'hat_officer', slot: 'hat', n: { ru: 'Фуражка', en: 'Officer cap' }, price: 700, lvl: 10, color: [0.12, 0.14, 0.2] },
  // jackets
  { id: 'jk_hoodie', slot: 'jacket', n: { ru: 'Серая толстовка', en: 'Grey hoodie' }, price: 0, color: [0.35, 0.36, 0.38] },
  { id: 'jk_denim', slot: 'jacket', n: { ru: 'Джинсовка', en: 'Denim jacket' }, price: 0, color: [0.22, 0.32, 0.5] },
  { id: 'jk_bomber', slot: 'jacket', n: { ru: 'Бомбер', en: 'Bomber' }, price: 200, color: [0.22, 0.3, 0.18] },
  { id: 'jk_wind', slot: 'jacket', n: { ru: 'Ветровка', en: 'Windbreaker' }, price: 250, color: [0.65, 0.12, 0.1] },
  { id: 'jk_varsity', slot: 'jacket', n: { ru: 'Колледж', en: 'Varsity' }, price: 300, lvl: 4, color: [0.12, 0.2, 0.45], accent: [0.9, 0.88, 0.8] },
  { id: 'jk_rain', slot: 'jacket', n: { ru: 'Дождевик', en: 'Raincoat' }, price: 400, color: [0.85, 0.7, 0.1] },
  { id: 'jk_leather', slot: 'jacket', n: { ru: 'Кожанка', en: 'Leather' }, price: 500, color: [0.08, 0.07, 0.07] },
  { id: 'jk_medic', slot: 'jacket', n: { ru: 'Халат медика', en: 'Medic coat' }, price: 400, lvl: 6, color: [0.85, 0.88, 0.88], accent: [0.7, 0.1, 0.1] },
  { id: 'jk_camo', slot: 'jacket', n: { ru: 'Камуфляж', en: 'Camo' }, price: 600, color: [0.3, 0.33, 0.2], accent: [0.2, 0.17, 0.1] },
  { id: 'jk_neon', slot: 'jacket', n: { ru: 'Неон', en: 'Neon' }, price: 800, lvl: 12, color: [0.1, 0.1, 0.12], accent: [0.1, 1.0, 0.6], glow: 1 },
  // pants
  { id: 'pt_jeans', slot: 'pants', n: { ru: 'Джинсы', en: 'Jeans' }, price: 0, color: [0.15, 0.2, 0.33] },
  { id: 'pt_sweat', slot: 'pants', n: { ru: 'Треники', en: 'Sweatpants' }, price: 100, color: [0.4, 0.4, 0.42] },
  { id: 'pt_cargo', slot: 'pants', n: { ru: 'Карго', en: 'Cargo' }, price: 150, color: [0.12, 0.12, 0.12] },
  { id: 'pt_khaki', slot: 'pants', n: { ru: 'Хаки', en: 'Khaki' }, price: 150, color: [0.45, 0.4, 0.28] },
  { id: 'pt_track', slot: 'pants', n: { ru: 'Спортивные', en: 'Tracksuit' }, price: 300, color: [0.55, 0.08, 0.08] },
  // masks
  { id: 'mask_none', slot: 'mask', n: { ru: 'Нет', en: 'None' }, price: 0 },
  { id: 'mask_surgical', slot: 'mask', n: { ru: 'Медицинская', en: 'Surgical' }, price: 100, color: [0.6, 0.8, 0.85] },
  { id: 'mask_bandit', slot: 'mask', n: { ru: 'Платок', en: 'Bandit' }, price: 200, color: [0.1, 0.1, 0.12] },
  { id: 'mask_gas', slot: 'mask', n: { ru: 'Противогаз', en: 'Gas mask' }, price: 600, lvl: 5, color: [0.18, 0.2, 0.17] },
  { id: 'mask_white', slot: 'mask', n: { ru: 'Белая маска', en: 'White mask' }, price: 800, lvl: 9, color: [0.92, 0.9, 0.85] },
  { id: 'mask_skull', slot: 'mask', n: { ru: 'Череп', en: 'Skull' }, price: 1200, lvl: 15, color: [0.85, 0.83, 0.78] },
  // back
  { id: 'back_none', slot: 'back', n: { ru: 'Нет', en: 'None' }, price: 0 },
  { id: 'back_pack', slot: 'back', n: { ru: 'Рюкзак', en: 'Backpack' }, price: 200, color: [0.3, 0.15, 0.1] },
  { id: 'back_big', slot: 'back', n: { ru: 'Туристический', en: 'Hiking pack' }, price: 400, lvl: 7, color: [0.15, 0.3, 0.2] },
  { id: 'back_radio', slot: 'back', n: { ru: 'Рация', en: 'Field radio' }, price: 500, lvl: 11, color: [0.2, 0.22, 0.18] },
  // flashlight tints
  { id: 'light_white', slot: 'light', n: { ru: 'Белый', en: 'White' }, price: 0, color: [1, 0.96, 0.88] },
  { id: 'light_warm', slot: 'light', n: { ru: 'Тёплый', en: 'Warm' }, price: 150, color: [1, 0.82, 0.6] },
  { id: 'light_cold', slot: 'light', n: { ru: 'Холодный', en: 'Cold' }, price: 250, color: [0.78, 0.9, 1] },
  { id: 'light_green', slot: 'light', n: { ru: 'Зелёный', en: 'Green' }, price: 300, lvl: 5, color: [0.75, 1, 0.75] },
  { id: 'light_red', slot: 'light', n: { ru: 'Алый', en: 'Crimson' }, price: 400, color: [1, 0.7, 0.68] },
  { id: 'light_violet', slot: 'light', n: { ru: 'Фиолетовый', en: 'Violet' }, price: 600, lvl: 10, color: [0.88, 0.78, 1] },
];

export const ITEM_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
export const SLOTS = ['hair', 'hat', 'jacket', 'pants', 'mask', 'back', 'light'];

export const PERKS = [
  { id: 'light_feet', lvl: 1 },
  { id: 'quiet', lvl: 2 },
  { id: 'second_wind', lvl: 3 },
  { id: 'electrician', lvl: 5 },
  { id: 'medic', lvl: 7 },
  { id: 'steady', lvl: 9 },
  { id: 'mechanic', lvl: 11 },
  { id: 'hoarder', lvl: 14 },
];

export const DEFAULT_APPEARANCE = {
  skin: 1,
  hair: 'hair_short',
  hairColor: 1,
  hat: 'hat_none',
  jacket: 'jk_hoodie',
  pants: 'pt_jeans',
  mask: 'mask_none',
  back: 'back_none',
  light: 'light_white',
  build: 0,
};

export function randomAppearance(rnd = Math.random) {
  const pick = (slot, free = true) => {
    const list = ITEMS.filter((i) => i.slot === slot && (!free || (!i.price && !i.lvl) || rnd() < 0.35));
    return list[Math.floor(rnd() * list.length)].id;
  };
  return {
    skin: Math.floor(rnd() * SKIN_TONES.length),
    hair: pick('hair'),
    hairColor: Math.floor(rnd() * HAIR_COLORS.length),
    hat: rnd() < 0.5 ? 'hat_none' : pick('hat', false),
    jacket: pick('jacket', false),
    pants: pick('pants', false),
    mask: rnd() < 0.8 ? 'mask_none' : pick('mask', false),
    back: rnd() < 0.6 ? 'back_none' : pick('back', false),
    light: pick('light', false),
    build: rnd() < 0.5 ? 0 : 1,
  };
}

// sanitise appearance coming from the network
export function sanitizeAppearance(a) {
  const out = { ...DEFAULT_APPEARANCE };
  if (!a || typeof a !== 'object') return out;
  for (const slot of SLOTS) if (ITEM_BY_ID[a[slot]]?.slot === slot) out[slot] = a[slot];
  if (Number.isInteger(a.skin) && a.skin >= 0 && a.skin < SKIN_TONES.length) out.skin = a.skin;
  if (Number.isInteger(a.hairColor) && a.hairColor >= 0 && a.hairColor < HAIR_COLORS.length) out.hairColor = a.hairColor;
  out.build = a.build === 1 ? 1 : 0;
  return out;
}

const NAME_A = ['Тихий', 'Быстрый', 'Ночной', 'Серый', 'Смелый', 'Хитрый', 'Последний', 'Ржавый', 'Сонный', 'Бледный'];
const NAME_B = ['Лис', 'Ворон', 'Филин', 'Волк', 'Енот', 'Кот', 'Сыч', 'Барсук', 'Ёж', 'Призрак'];
const NAME_A_EN = ['Silent', 'Swift', 'Night', 'Grey', 'Brave', 'Sly', 'Last', 'Rusty', 'Sleepy', 'Pale'];
const NAME_B_EN = ['Fox', 'Raven', 'Owl', 'Wolf', 'Raccoon', 'Cat', 'Moth', 'Badger', 'Hedgehog', 'Ghost'];

export function randomName(lang = 'ru', rnd = Math.random) {
  const i = Math.floor(rnd() * 10), j = Math.floor(rnd() * 10), n = Math.floor(rnd() * 90 + 10);
  return lang === 'ru' ? `${NAME_A[i]} ${NAME_B[j]} ${n}` : `${NAME_A_EN[i]}${NAME_B_EN[j]}${n}`;
}

export const BOT_NAMES = {
  ru: ['Алиса', 'Макс', 'Вера', 'Тимур', 'Соня', 'Гриша', 'Лена', 'Арсений', 'Мира', 'Дима'],
  en: ['Alice', 'Max', 'Vera', 'Tim', 'Sonia', 'Greg', 'Lena', 'Arsen', 'Mira', 'Dima'],
};
