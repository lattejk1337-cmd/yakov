// Параметры акции, фиксированные для всех покупателей
const PRICE = 1800;      // цена одного букета, руб.
const DISCOUNT = 10;     // скидка, %
const TAX = 7;           // налог, %

// Параметры, задаваемые пользователем
let quantity = Number(prompt("Введите количество букетов:", 4));
let budget = Number(prompt("Введите ваш бюджет (руб.):", 7000));

// Исходная сумма заказа (до скидки и налога)
let baseSum = PRICE * quantity;

// Сумма скидки и сумма после применения скидки
let discountSum = Math.round(baseSum * DISCOUNT / 100 * 100) / 100;
let sumAfterDiscount = Math.round((baseSum - discountSum) * 100) / 100;

// Налог начисляется на сумму, уменьшенную на величину скидки
let taxSum = Math.round(sumAfterDiscount * TAX / 100 * 100) / 100;

// Итоговая сумма, округлённая до копеек
let totalSum = Math.round((sumAfterDiscount + taxSum) * 100) / 100;

// Укладывается ли покупатель в бюджет
let inBudget = totalSum <= budget;

// Бонусные баллы начисляются, если количество букетов — чётное число
let bonus = quantity % 2 === 0;

// Чек покупателя
console.log("======= ЧЕК =======");
console.log(`Цена за единицу: ${PRICE} руб.`);
console.log(`Количество: ${quantity} шт.`);
console.log(`Исходная сумма заказа: ${baseSum} руб.`);
console.log(`Скидка (${DISCOUNT}%): ${discountSum} руб.`);
console.log(`Сумма после скидки: ${sumAfterDiscount} руб.`);
console.log(`Налог (${TAX}%): ${taxSum} руб.`);
console.log(`Итоговая сумма: ${totalSum} руб.`);
console.log(`Бюджет покупателя: ${budget} руб.`);
console.log(`Укладывается в бюджет: ${inBudget}`);
console.log(`Бонусные баллы начислены: ${bonus}`);
console.log("===================");

// Сообщение пользователю
alert(`Итоговая сумма: ${totalSum} руб.\n` +
      `Укладывается в бюджет: ${inBudget}\n` +
      `Бонусные баллы начислены: ${bonus}`);
