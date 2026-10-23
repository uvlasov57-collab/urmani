/* Business folders use the product category and its actual type, never a lone
   word anywhere in the name. A product belongs to at most one folder per business. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.URMANI_BUSINESS=api;
})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  const normalize=s=>String(s||'').toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim();
  function type(p){
    const n=normalize(p.name),c=p.category;
    // Personal care and unrelated household goods stay in the full catalogue.
    if(c==='Бытовая химия'){
      if(/ватн|зубн|^з[\/\\]п |шампун|дезодоран|^део |прокл|тампон|брить|станок|д\/лица|д\/ног|для ног|крем детск|гель д\/д|гель для душ|exxe men|от комар|мух|дихлофос|фумигатор|для обув|д\/об|для лака|д\/лака/.test(n))return '';
      if(/мыло|milana/.test(n))return 'soap';
      if(/салфет|вафельное полотно|полотенца хозяйствен|^тряпка/.test(n)&&!/влажн|насадка/.test(n))return 'cloths';
      if(/губка/.test(n)&&!/авто|обув/.test(n)||/^спираль д[\/\\]посуд/.test(n))return 'sponges';
      if(/швабр|насадка моп/.test(n))return 'mops';
      if(/стирк|белья|отбеливател|^см[сc]\s/.test(n))return 'laundry';
      if(/дезинф|deso/.test(n))return 'disinfectants';
      if(/унитаз|сантех|wc-gel|труб|доместос|санокс|антиналет|санитар/.test(n))return 'sanitary';
      if(/стекл|clean glass|д\/ок/.test(n))return 'glass';
      if(/жир|azelit|нагар/.test(n))return 'degreasers';
      if(/пола|полирующ|прогресс/.test(n))return 'surfaces';
      if(/посуд|^мс\s/.test(n))return 'dishwashing';
      if(/белизна|^чс\s|чистящ/.test(n))return 'surfaces';
      return '';
    }
    if(c==='Мусорные мешки')return 'waste';
    if(c==='Бумажная продукция'){
      if(/^салфет/.test(n)&&!/космет/.test(n))return 'napkins';
      if(/полотенц/.test(n))return 'paper-towels';
      if(/туалетн/.test(n))return 'toilet-paper';
      return '';
    }
    // Qualify bags independently of the old source category (some live in Containers).
    if(c==='Пакеты/Фасовка'||c==='Контейнера'&&/^(?:пакет|термо|крафт.пакет|бумажный пакет)/.test(n)){
      if(/бумажная форма/.test(n))return 'baking-molds';
      if(/вакуум/.test(n))return 'vacuum-bags';
      if(/гриппер|дой-пак/.test(n))return 'zip-bags';
      if(/терм[оа]с?пакет/.test(n))return 'thermal-bags';
      if(/^пакет (?:гриль|для шаурмы)/.test(n))return 'fastfood-bags';
      if(/^майка\s|^пакет.?майка|ручк|руч\.|проруб|^пакет (?:40\*42|арт|интерпак)|пакет на вынос|крафт-пакет "навынос"/.test(n))return 'carry-bags';
      if(/бумаж|бум\.|крафт|^уголок|бумага оберточ/.test(n))return 'paper-bags';
      if(/^(?:пласт\s|фасовка\s|пакет бопп)/.test(n))return 'food-bags';
      if(/^пакет под бутылку/.test(n))return 'carry-bags';
    }
    if(c==='Контейнера'){
      if(/алюм.*форм|форм.*алюм/.test(n))return 'baking-molds';
      if(/кружевн/.test(n))return 'cake-supports';
      if(/торт|кондит|^т-\d/.test(n))return 'cake-boxes';
      if(/пицц|гамбургер|фри|наггет|хот.дог|сэндвич|бургер|шаурм|сэндвич/.test(n))return 'fastfood-boxes';
      if(/^(?:ведро|банка)\s/.test(n))return 'food-storage';
      if(/лоток|подложка/.test(n))return 'food-trays';
      if(/шпагат/.test(n))return '';
      return 'food-containers';
    }
    if(c==='Одноразовая посуда'){
      if(/^крышка\s/.test(n))return 'drink-lids';
      if(/^набор рюмок|^стакан.*пивно/.test(n))return 'party-cups';
      if(/^стакан\s|^чашка\s/.test(n))return 'cups';
      if(/^держатель.*стакан|капхолдер/.test(n))return 'cup-holders';
      if(/размешивател/.test(n))return 'stirrers';
      if(/тарелк|миска/.test(n))return 'plates';
      if(/креманк|форма пагода/.test(n))return 'dessert-cups';
      if(/вилка|ложка|нож |прибор|набор столов|набор шашлычный|палочки для (?:суши|еды)/.test(n))return 'cutlery';
      if(/^бутылка|^колпачок/.test(n))return 'bottles';
      return '';
    }
    if(c==='Прочее'){
      if(/^трубочк/.test(n))return 'straws';
      if(/^перчатк/.test(n)){
        if(/хоз\.|резин|особо прочн|латексн/.test(n))return 'cleaning-gloves';
        if(/винил|нитрил|одноразов|эластомер/.test(n))return 'food-gloves';
        return '';
      }
      if(/^фартук однораз|^нарукавник|^шапочки/.test(n))return 'workwear';
      if(/бумага для выпеч|бумага для запек|^пергамент|^лист 290/.test(n))return 'baking-paper';
      if(/^мешок кондитер/.test(n))return 'pastry-bags';
      if(/^рукав для запек|^фольга/.test(n))return 'foil-sleeves';
      if(/^пленка|^стрейтч|^стрейч/.test(n)&&!/окна/.test(n))return /паллет/.test(n)?'pallet-wrap':'food-film';
      if(/кассовая лента|чековая лента/.test(n))return 'till';
      if(/термоэтикет|^ценник/.test(n))return 'labels';
      if(/^скотч/.test(n))return 'tape';
      if(/^маркер|^ручка|^резинка (?:д\/|для)денег|^накладные|^товарный чек/.test(n))return 'shop-supplies';
      if(/^зубочистк|^шпажк|^пика |^декоративные пики/.test(n))return 'picks';
      if(/^скатерть/.test(n))return 'tablecloths';
    }
    return '';
  }
  const folder=(key,label,description,types)=>({key,label,description,types});
  const presets={
    coffee:{title:'Для кофейни',folders:[
      folder('cups','Стаканы и держатели','Бумажные и пластиковые стаканы, капхолдеры',['cups','cup-holders']),
      folder('lids','Крышки для стаканов','Плоские, купольные и с питейником',['drink-lids']),
      folder('stirrers','Трубочки и размешиватели','Для кофе, коктейлей и холодных напитков',['stirrers','straws']),
      folder('containers','Контейнеры для еды','Контейнеры, соусники и подходящие к ним крышки',['food-containers','fastfood-boxes']),
      folder('desserts','Упаковка для десертов','Креманки, упаковка для тортов и десертов',['dessert-cups','cake-boxes','cake-supports']),
      folder('bags','Пакеты навынос','Бумажные пакеты и пакеты с ручками',['paper-bags','carry-bags']),
      folder('napkins','Салфетки и полотенца','Бумажные салфетки и полотенца для заведения',['napkins','paper-towels'])
    ]},
    restaurant:{title:'Для кафе и доставки',folders:[
      folder('containers','Контейнеры и крышки','Контейнеры, соусники, банки и пищевые вёдра',['food-containers','food-storage']),
      folder('fastfood','Упаковка для фастфуда','Коробки для пиццы, бургеров и еды навынос',['fastfood-boxes']),
      folder('plates','Тарелки и миски','Одноразовая посуда для подачи блюд',['plates']),
      folder('cutlery','Приборы и шпажки','Вилки, ложки, ножи, зубочистки и шпажки',['cutlery','picks']),
      folder('cups','Стаканы и напитки','Стаканы, крышки, трубочки и бутылки',['cups','cup-holders','drink-lids','stirrers','straws','bottles','party-cups']),
      folder('bags','Пакеты для доставки','Бумажные пакеты, пакеты с ручками и фасовка',['paper-bags','carry-bags','food-bags','vacuum-bags','zip-bags','thermal-bags','fastfood-bags']),
      folder('napkins','Сервировка','Бумажные салфетки, полотенца и скатерти',['napkins','paper-towels','tablecloths']),
      folder('kitchen','Для кухни и персонала','Плёнка, фольга, формы, перчатки и фартуки',['food-film','foil-sleeves','baking-paper','baking-molds','food-gloves','workwear']),
      folder('desserts','Упаковка для десертов','Торты, пирожные и десерты',['dessert-cups','cake-boxes','cake-supports'])
    ]},
    shop:{title:'Для магазина',folders:[
      folder('bags','Пакеты с ручками','Пакеты-майки, с ручками и термопакеты',['carry-bags','thermal-bags']),
      folder('packing','Фасовка и бумажные пакеты','Фасовочные пакеты, БОПП и бумажная упаковка',['food-bags','paper-bags']),
      folder('sealed','Вакуумные и зип-пакеты','Вакуумная упаковка, грипперы и дой-пак',['vacuum-bags','zip-bags']),
      folder('containers','Контейнеры и лотки','Пищевая упаковка, подложки, банки и крышки',['food-containers','food-trays','food-storage']),
      folder('film','Плёнка и скотч','Пищевая и паллетная плёнка, упаковочный скотч',['food-film','pallet-wrap','tape']),
      folder('till','Лента, этикетки и ценники','Кассовая лента, термоэтикетки, ценники',['till','labels']),
      folder('supplies','Для кассы и персонала','Маркеры, ручки, перчатки и расходники',['shop-supplies','food-gloves','workwear'])
    ]},
    bakery:{title:'Для пекарни',folders:[
      folder('bags','Пакеты для выпечки','Бумажные пакеты, уголки, фасовка и пакеты навынос',['paper-bags','carry-bags','food-bags']),
      folder('baking','Бумага и пергамент','Бумага для выпечки, листы и пергамент',['baking-paper']),
      folder('molds','Формы для выпечки','Бумажные и алюминиевые формы, крышки к формам',['baking-molds']),
      folder('pastry','Кондитерские мешки','Для крема, теста и оформления изделий',['pastry-bags']),
      folder('cakes','Упаковка для тортов','Упаковка для тортов и кружевные салфетки',['cake-boxes','cake-supports']),
      folder('containers','Контейнеры и креманки','Контейнеры с крышками и порционная упаковка',['food-containers','dessert-cups']),
      folder('film','Плёнка, фольга и рукава','Для хранения и приготовления',['food-film','foil-sleeves']),
      folder('gloves','Перчатки и гигиена','Одноразовые перчатки, фартуки и бумажные расходники',['food-gloves','workwear','napkins','paper-towels'])
    ]},
    cleaning:{title:'Для уборки',folders:[
      folder('kitchen','Для посуды и кухни','Средства для посуды, удаления жира и нагара',['dishwashing','degreasers']),
      folder('surfaces','Для пола и стёкол','Средства для пола, стекла и поверхностей',['surfaces','glass']),
      folder('sanitary','Сантехника и дезинфекция','Для санузлов, труб и дезинфекции',['sanitary','disinfectants']),
      folder('laundry','Для стирки','Порошки, гели, отбеливатели и кондиционеры',['laundry']),
      folder('soap','Мыло для рук','Жидкое и твёрдое мыло',['soap']),
      folder('tools','Губки, тряпки и швабры','Губки, уборочные салфетки, МОПы и насадки',['sponges','cloths','mops']),
      folder('waste','Мешки для мусора','Мусорные мешки разных объёмов и прочности',['waste']),
      folder('gloves','Перчатки для уборки','Хозяйственные, прочные латексные и нитриловые',['cleaning-gloves','food-gloves']),
      folder('paper','Бумажная гигиена','Бумажные полотенца и туалетная бумага',['paper-towels','toilet-paper'])
    ]}
  };
  function membership(p){const t=type(p);return Object.fromEntries(Object.entries(presets).map(([key,preset])=>[key,preset.folders.find(f=>f.types.includes(t))?.key||'']));}
  function group(p,selection){return membership(p)[selection]||'';}
  function folders(selection){return presets[selection]?.folders||[];}
  function title(selection,key){return folders(selection).find(f=>f.key===key)?.label||'';}
  // Keep existing bookmarked folders useful after rebuilding the navigation.
  const aliases={coffee:{cutlery:'stirrers'},restaurant:{lids:'cups',stirrers:'cups',gloves:'kitchen',baking:'kitchen'},shop:{labels:'till'},bakery:{napkins:'gloves',lids:'molds'},cleaning:{napkins:'tools',bags:'waste',cleaners:'all'}};
  function resolve(selection,key){if(!key||key==='all')return key;const target=aliases[selection]?.[key]||key;return target==='all'||folders(selection).some(f=>f.key===target)?target:'';}
  return {presets,type,group,membership,folders,title,resolve};
});
