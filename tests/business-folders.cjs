'use strict';
// Run from the site directory: node tests/business-folders.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs');
const b=require('../business-catalog.js');
const products=require('../products.json');
assert.equal(products.length,1096);
const byName=part=>{const p=products.find(p=>p.name.includes(part));assert(p,'Missing fixture '+part);return p;};
const expect=(part,business,folder)=>assert.equal(b.group(byName(part),business),folder,part);
// Regressions: packaging words must never override the actual product.
for(const p of products.filter(p=>/ватные палочки|ватные диски/i.test(p.name))){
 assert.equal(b.group(p,'coffee'),'');assert.equal(b.group(p,'restaurant'),'');
}
expect('Ватные палочки','coffee','');
expect('Крышка карт.мет.для алюм.формы. 1040','coffee','');
expect('Крышка карт.мет.для алюм.формы. 1040','bakery','molds');
expect('Крышка для бумажного контейнера','coffee','containers');
expect('Крышка для стакана тип А','coffee','lids');
expect('Стакан бумажный 250 мл КРАФТ','coffee','cups');
expect('Держатель для 2-вух стаканов','coffee','cups');
expect('Трубочки для коктейлей','coffee','stirrers');
expect('Салфетка микрофибра','coffee','');
expect('Салфетка микрофибра','cleaning','tools');
expect('Мешки д/ мусора 30л','cleaning','waste');
expect('Мешок кондитерский','bakery','pastry');
expect('Форма алюминиев. кругл. 130мл','bakery','molds');
expect('Бумажная форма Тюльпан','bakery','molds');
expect('Вакуум.пакет','shop','sealed');
expect('Кассовая лента 57*30','shop','till');
expect('Весовая Термоэтикетка','shop','till');
expect('Чековая лента','shop','till');
expect('Шампунь Чистая','cleaning','');
expect('Спирали от комаров','cleaning','');
expect('Доместос 1000','cleaning','sanitary');
expect('МС Grass очиститель Clean Glass','cleaning','surfaces');
for(const [selection,preset] of Object.entries(b.presets)){
 const keys=preset.folders.map(f=>f.key);assert.equal(new Set(keys).size,keys.length);
 const all=new Set();
 for(const f of preset.folders){
  const items=products.filter(p=>b.group(p,selection)===f.key);assert(items.length,selection+'/'+f.key+' is empty');
  for(const p of items){assert(!all.has(p),'Duplicate placement');all.add(p);}
 }
 assert.equal(all.size,products.filter(p=>b.group(p,selection)).length);
 for(const p of products){assert.deepEqual(b.membership(p)[selection],b.group(p,selection));}
}
assert.equal(b.resolve('cleaning','bags'),'waste');
assert.equal(b.resolve('restaurant','lids'),'cups');
assert.equal(b.resolve('coffee','wrong-folder'),'');
const html=fs.readFileSync('catalog.html','utf8');assert(html.indexOf('business-catalog.js')<html.indexOf('src="catalog.js'));
console.log('Business folders: 1096 products, all 5 selections, exclusive placement and regression cases passed.');
