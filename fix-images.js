const fs = require('fs');

// Читаем исходный файл products.json
const data = JSON.parse(fs.readFileSync('products.json', 'utf8'));
let counter = 38;

data.forEach(item => {
  if (item.image === "placeholder.png") {
    item.image = `images/${counter}.webp`;
    counter++;
  }
});

// Перезаписываем ТОТ ЖЕ файл products.json
fs.writeFileSync('products.json', JSON.stringify(data, null, 2), 'utf8');
console.log(`✅ Заменено ${counter - 38} изображений. Последний номер: ${counter - 1}`);