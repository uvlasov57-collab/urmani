'use strict';
(() => {
  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = n => Number(n).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
  const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const normalize = s => String(s).toLowerCase().replace(/ё/g,'е').replace(/(\d),(\d)/g,'$1.$2').replace(/(\d)\s+(мл|мм|см|мкм|кг|шт|л)(?=\b|[^а-я]|$)/g,'$1$2').replace(/\s+/g,' ').trim();
  const readStore = (key, fallback) => {try {return JSON.parse(localStorage.getItem(key)) ?? fallback;} catch {return fallback;}};
  const writeStore = (key,value) => {try {localStorage.setItem(key,JSON.stringify(value));} catch {}};
  const presets = {
    coffee:{title:'Для кофейни',terms:['стакан','крышка','размешив','салфет']},
    restaurant:{title:'Для кафе и доставки',terms:['контейнер','тарелк','салфет','прибор','перчатк']},
    shop:{title:'Для магазина',terms:['пакет','фасов','кассовая лента','чековая лента']},
    bakery:{title:'Для пекарни',terms:['бумага для выпечки','бумага для запекания','мешок кондитер','пакет крафт','форм','салфет']},
    cleaning:{title:'Для уборки',terms:['средство','мыло','губк','тряпк','салфетк вискоз','салфетк микрофиб','швабр','ведро для','мешки для мусор','мешок для мусор','перчатки хоз','белизна','чистящ','моющ']}
  };
  const sections = [
    ['lids','Крышки',/крышк/],
    ['cups','Стаканы',/стакан/],
    ['stirrers','Размешиватели',/размешив/],
    ['containers','Контейнеры и упаковка',/контейнер|подложк|ланч|салатник|супниц|соусник|тортниц|креманк/],
    ['plates','Тарелки',/тарелк/],
    ['cutlery','Приборы',/прибор|(?:^|[^а-я])(?:вилк|ложк|нож(?:и| |$))/],
    ['napkins','Салфетки',/салфет/],
    ['gloves','Перчатки',/перчатк/],
    ['bags','Пакеты и фасовка',/пакет|фасов/],
    ['till','Кассовая лента',/кассовая лента|чековая лента/],
    ['baking','Для выпечки и кондитера',/выпечк|запекан|кондитер|форм/],
    ['soap','Мыло',/мыло/],
    ['cleaners','Моющие и чистящие средства',/средство|белизна|чистящ|моющ/],
    ['tools','Инвентарь для уборки',/губк|тряпк|швабр|ведро/],
    ['waste','Мешки для мусора',/мусор/],
    ['other','Другие товары',null]
  ];
  function sectionKey(p){
    const name=normalize(p.name);
    return sections.find(([key,label,pattern])=>pattern?.test(name))?.[0] || 'other';
  }
  const sectionTitle = key => sections.find(s=>s[0]===key)?.[1] || '';
  const categoryTitles = {'Контейнера':'Контейнеры','Пакеты/Фасовка':'Пакеты и фасовка','Прочее':'Хозяйственные товары'};
  const categoryTitle = c => categoryTitles[c] || c;
  const params = new URLSearchParams(location.search);
  const state = {category:params.get('category') || 'all',q:params.get('q') || '',selection:presets[params.get('selection')] ? params.get('selection') : '',group:params.get('group')==='packaging',sort:['price-asc','price-desc','name'].includes(params.get('sort'))?params.get('sort'):'default',min:params.get('min')||'',max:params.get('max')||'',section:params.get('section')||'',facets:{},limit:48};
  let products=[],filtered=[],byKey=new Map(),cart={},recent=[],toastTimer,lastFocus=null,currentKey='',comment='';
  const quantityValue = v => Math.max(1,Math.min(999999,Math.round(Number(v)||1)));
  const productKey = p => String(p._key || p.id || p.slug || p.name);
  const getImage = p => esc(p.image || 'placeholder.png');
  const title = p => p.name.replace(/\s+/g,' ').trim();
  const cents = p => Math.round(Number(p.price)*100);
  const categoryCounts = new Map();
  // Only explicit units are extracted; transport ratios such as 1/50/600 stay in the full name.
  function specs(p) {
    const n=p.name.replace(/([а-я])\.(?=\d)/gi,'$1 '), list=[];
    const push=(key,label,value) => {if(value)list.push({key,label,value});};
    let m=n.match(/(?:^|[^\d.,])(\d+(?:[.,]\d+)?)\s*(мл|л)(?=[^а-яa-z]|$)/i);
    if(m && p.category!=='Бумажная продукция') push('volume','Объём',m[1].replace(',','.')+' '+m[2].toLowerCase());
    m=n.match(/(\d+(?:[.,]\d+)?\s*[хx*×]\s*\d+(?:[.,]\d+)?(?:\s*[хx*×]\s*\d+(?:[.,]\d+)?)?)\s*(мм|см)(?=[^а-я]|$)/i);
    if(m) push('dimensions','Размеры',m[1].replace(/\s+/g,'').replace(/[хx*]/gi,' × ')+' '+m[2].toLowerCase());
    m=n.match(/(?:^|[^\d.,])(\d+(?:[.,]\d+)?)\s*(кг)(?=[^а-яa-z]|$)/i);
    if(m)push('weight','Масса',m[1].replace(',','.')+' кг');
    const mats=[];
    if(/(?:^|[^а-яa-z])(ПЭТ|PET)(?=[^а-яa-z]|$)/i.test(n))mats.push('ПЭТ');
    if(/(?:^|[^а-яa-z])(ПП|PP|РР)(?=[^а-яa-z]|$)/i.test(n))mats.push('ПП');
    if(/(?:^|[^а-яa-z])(ПС|PS)(?=[^а-яa-z]|$)/i.test(n))mats.push('ПС');
    if(/(?:^|[^а-яa-z])БОПП(?=[^а-яa-z]|$)/i.test(n))mats.push('БОПП');
    if(/(?:^|[^а-яa-z])ПНД(?=[^а-яa-z]|$)/i.test(n))mats.push('ПНД');
    if(/(?:^|[^а-яa-z])ПВД(?=[^а-яa-z]|$)/i.test(n))mats.push('ПВД');
    if(/крафт/i.test(n))mats.push('Крафт');
    if(/алюмини/i.test(n))mats.push('Алюминий');
    if(/нитрил/i.test(n))mats.push('Нитрил');
    if(/винил/i.test(n))mats.push('Винил');
    if(!mats.length && /бумажн/i.test(n))mats.push('Бумага');
    push('material','Материал',mats.join(' / '));
    m=n.match(/(\d+(?:[.,]\d+)?)\s*мкм(?=[^а-я]|$)/i);
    if(m)push('thickness','Толщина',m[1].replace(',','.')+' мкм');
    if(/перчатк/i.test(n)){m=n.match(/(?:^|[\s(])((?:XX|X)?[SML])(?=[\s),]|$)/i);if(m)push('size','Размер',m[1].toUpperCase());}
    // Explicit count is descriptive, not a claim about which unit the price refers to.
    m=n.match(/(?:^|[^\d/\\*хx])([1-9]\d*)\s*(шт|лист(?:ов)?|рул(?:он(?:ов)?)?)(?=[^а-я]|$)/i);
    if(m)push('count','Количество в названии',m[1]+' '+(/лист/i.test(m[2])?'лист.':/рул/i.test(m[2])?'рул.':'шт.'));
    return list;
  }
  function toast(text){$('#toast').textContent=text;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),2600);}
  function quantityMarkup(p,value=1,context='card') {
    return `<div class="quantity" data-key="${esc(productKey(p))}" data-context="${context}"><button type="button" data-qty="-1" aria-label="Уменьшить количество: ${esc(p.name)}">−</button><input type="number" min="1" max="999999" step="1" inputmode="numeric" value="${value}" aria-label="Количество: ${esc(p.name)}"><button type="button" data-qty="1" aria-label="Увеличить количество: ${esc(p.name)}">+</button></div>`;
  }
  function actions(p,context='card'){return `<div class="product-actions">${quantityMarkup(p,1,context)}<button type="button" class="btn btn-primary product-add" data-add="${esc(productKey(p))}">${icon('bag')}В заявку</button></div>`;}
  const productPage = p => window.URMANI_SEO?.products[p.name+'|'+p.image] || 'catalog.html?product='+encodeURIComponent(productKey(p));
  function card(p){
    return `<article class="product" data-product-id="${esc(productKey(p))}"><a class="product-photo" href="${esc(productPage(p))}" data-product="${esc(productKey(p))}" aria-label="Подробнее: ${esc(p.name)}"><img src="${getImage(p)}" alt="${esc(p.name)}" width="400" height="400" loading="lazy" decoding="async"></a><div class="product-body"><div class="category">${esc(categoryTitle(p.category))}</div><h3><a class="product-title" href="${esc(productPage(p))}" data-product="${esc(productKey(p))}" title="${esc(p.name)}">${esc(title(p))}</a></h3><div class="spec-chips">${p._specs.slice(0,3).map(s=>`<span class="spec-chip" title="${esc(s.label)}">${esc(s.value)}</span>`).join('')}</div><div class="price">${money(p.price)}</div><div class="price-caption">Цена по каталогу</div>${actions(p)}</div></article>`;
  }
  function updateUrl(){
    const q=new URLSearchParams();
    if(state.category!=='all')q.set('category',state.category);
    if(state.q)q.set('q',state.q);
    if(state.selection)q.set('selection',state.selection);
    if(state.selection && state.section)q.set('section',state.section);
    if(state.group)q.set('group','packaging');
    if(state.sort!=='default')q.set('sort',state.sort);
    if(state.min!=='')q.set('min',state.min);
    if(state.max!=='')q.set('max',state.max);
    Object.entries(state.facets).forEach(([k,v])=>{if(v)q.set(k,v);});
    if(currentKey)q.set('product',currentKey);
    history.replaceState({},'',location.pathname+(q.size?'?'+q.toString():''));
    let robots=$('meta[name=robots]');if(!robots){robots=document.createElement('meta');robots.name='robots';document.head.append(robots);}robots.content=q.size?'noindex,follow':'index,follow';
  }
  function baseProducts(ignoreSection=false){
    let list=products;
    if(state.selection)list=list.filter(p=>presets[state.selection].terms.some(t=>normalize(p.name).includes(t)));
    if(state.group)list=list.filter(p=>['Пакеты/Фасовка','Мусорные мешки'].includes(p.category));
    if(state.category!=='all')list=list.filter(p=>p.category===state.category);
    const terms=normalize(state.q).split(' ').filter(Boolean);
    if(terms.length)list=list.filter(p=>terms.every(t=>p._search.includes(t)));
    if(!ignoreSection && state.selection && state.section && state.section!=='all')list=list.filter(p=>sectionKey(p)===state.section);
    return list;
  }
  function facetKeys(){
    if(['Контейнера','Одноразовая посуда'].includes(state.category))return ['volume','material'];
    if(['Пакеты/Фасовка','Мусорные мешки'].includes(state.category))return ['volume','dimensions','material','thickness'];
    if(state.category==='Прочее')return ['material','size'];
    return [];
  }
  const facetNames={volume:'Объём',dimensions:'Размеры',material:'Материал',thickness:'Толщина',size:'Размер перчаток'};
  function renderFacets(){
    const base=baseProducts();const keys=facetKeys();
    const parts=keys.map(k=>{
      const values=[...new Set(base.flatMap(p=>p._specs.filter(s=>s.key===k).map(s=>s.value)))].sort((a,b)=>a.localeCompare(b,'ru',{numeric:true}));
      if(!values.length){delete state.facets[k];return '';}
      if(state.facets[k] && !values.includes(state.facets[k]))delete state.facets[k];
      return `<label class="facet-label">${facetNames[k]}<select data-facet="${k}"><option value="">Любой</option>${values.map(v=>`<option value="${esc(v)}"${state.facets[k]===v?' selected':''}>${esc(v)}</option>`).join('')}</select></label>`;
    }).join('');
    $('#facetFilters').innerHTML=parts?`<div class="filter-section">${parts}</div>`:'';
  }
  function renderCategories(){
    $('#categoryFilters').innerHTML=[['all',products.length],...categoryCounts].map(([c,count])=>`<button type="button" class="filter-btn${state.category===c?' active':''}" data-category="${esc(c)}" aria-pressed="${state.category===c}">${esc(c==='all'?'Все товары':categoryTitle(c))}<span>${count}</span></button>`).join('');
    $$('#businessFilters button').forEach(b=>{b.classList.toggle('active',b.dataset.selection===state.selection);b.setAttribute('aria-pressed',String(b.dataset.selection===state.selection));});
  }
  function renderSections(){
    const box=$('#businessSections');
    box.hidden=!state.selection;
    if(!state.selection){box.innerHTML='';return;}
    const list=baseProducts(true);
    const groups=sections.map(([key,label])=>({key,label,items:list.filter(p=>sectionKey(p)===key)})).filter(g=>g.items.length);
    if(state.section && state.section!=='all' && !sections.some(s=>s[0]===state.section))state.section='';
    box.innerHTML=`<div class="subsection-heading"><div><h3>Что нужно для вашего бизнеса?</h3><p>Откройте подраздел, чтобы сразу перейти к нужным товарам.</p></div><button type="button" class="text-button" data-section="all" aria-pressed="${state.section==='all'}">Все товары подборки (${list.length})</button></div><div class="subsection-grid">${groups.map(g=>`<button type="button" class="subsection-card${state.section===g.key?' active':''}" data-section="${g.key}" aria-pressed="${state.section===g.key}"><img src="${getImage(g.items[0])}" alt="" width="64" height="64" loading="lazy"><span><strong>${esc(g.label)}</strong><small>${g.items.length} позиций</small></span><span aria-hidden="true">→</span></button>`).join('')}</div>`;
  }
  function foldersOnly(){return state.selection && !state.section && !state.q && state.category==='all' && state.min==='' && state.max==='';}
  function renderActive(){
    const chips=[];
    const chip=(text,key)=>chips.push(`<button type="button" data-remove-filter="${key}" aria-label="Убрать фильтр: ${esc(text)}">${esc(text)}<span aria-hidden="true">×</span></button>`);
    if(state.selection)chip(presets[state.selection].title,'selection');
    if(state.selection && state.section && state.section!=='all')chip(sectionTitle(state.section),'section');
    if(state.group)chip('Пакеты и мешки','group');
    if(state.category!=='all')chip(categoryTitle(state.category),'category');
    if(state.q)chip('Поиск: '+state.q,'q');
    if(state.min!=='')chip('От '+state.min+' ₽','min');
    if(state.max!=='')chip('До '+state.max+' ₽','max');
    Object.entries(state.facets).forEach(([k,v])=>{if(v)chip(facetNames[k]+': '+v,k);});
    $('#activeFilters').innerHTML=chips.join('');
    $('#clearSearch').hidden=!state.q;
  }
  function renderProducts(append=false){
    if(foldersOnly()){
      $('#catalog').innerHTML='';$('#loadMore').hidden=true;$('#shownCount').textContent='Выберите подраздел выше или нажмите «Все товары подборки».';return;
    }
    const shown=filtered.slice(0,state.limit);
    if(!append)$('#catalog').innerHTML=shown.map(card).join('');
    else $('#catalog').insertAdjacentHTML('beforeend',shown.slice(Math.max(0,state.limit-48)).map(card).join(''));
    if(!filtered.length)$('#catalog').innerHTML='<div class="empty-state"><h3>Пока ничего не нашли</h3><p>Попробуйте другое название, уберите часть фильтров или обратитесь к менеджеру.</p><button class="btn btn-primary" type="button" data-reset>Сбросить фильтры</button> <a class="btn btn-outline" href="index.html#contact">Помочь с подбором</a></div>';
    const displayed=Math.min(state.limit,filtered.length);
    $('#loadMore').hidden=displayed>=filtered.length;
    $('#loadMore').innerHTML='Показать ещё '+Math.min(48,filtered.length-displayed)+' товаров <span aria-hidden="true">↓</span>';
    $('#shownCount').textContent=filtered.length?`Показано ${displayed} из ${filtered.length}`:'';
  }
  function applyFilters(rebuildFacets=true){
    state.limit=48;
    renderSections();
    if(rebuildFacets)renderFacets();
    filtered=baseProducts().filter(p=>{
      if(state.min!=='' && Number(p.price)<Number(state.min))return false;
      if(state.max!=='' && Number(p.price)>Number(state.max))return false;
      return Object.entries(state.facets).every(([k,v])=>!v || p._specs.some(s=>s.key===k&&s.value===v));
    });
    if(state.sort==='price-asc')filtered.sort((a,b)=>a.price-b.price||a._index-b._index);
    if(state.sort==='price-desc')filtered.sort((a,b)=>b.price-a.price||a._index-b._index);
    if(state.sort==='name')filtered.sort((a,b)=>a.name.localeCompare(b.name,'ru',{numeric:true}));
    $('#resultTitle').textContent=state.selection && state.section && state.section!=='all'?sectionTitle(state.section):state.category!=='all'?categoryTitle(state.category):state.selection?presets[state.selection].title:state.group?'Пакеты и мешки':'Все товары';
    $('#resultCount').textContent=`Найдено: ${filtered.length} · Всего в каталоге: ${products.length}`;
    renderCategories();renderActive();renderProducts();updateUrl();
  }
  function syncInputs(){ $('#productSearch').value=state.q;$('#priceMin').value=state.min;$('#priceMax').value=state.max;$('#sortSelect').value=state.sort; }
  function resetFilters(){Object.assign(state,{category:'all',q:'',selection:'',section:'',group:false,min:'',max:'',facets:{},sort:'default'});syncInputs();applyFilters();}
  function openDialog(dialog){lastFocus=document.activeElement;if(typeof dialog.showModal==='function')dialog.showModal();else {dialog.setAttribute('open','');dialog.style.display='block';}dialog.querySelector('button')?.focus();}
  function closeDialog(dialog){if(typeof dialog.close==='function')dialog.close();else{dialog.removeAttribute('open');dialog.style.display='';}if(dialog.id==='productModal'){currentKey='';updateUrl();}if(lastFocus?.isConnected)lastFocus.focus();}
  function openProductById(key){
    const p=byKey.get(String(key));if(!p)return false;
    currentKey=productKey(p);
    const details=p._specs.map(s=>`<div><dt>${esc(s.label)}</dt><dd>${esc(s.value)}</dd></div>`).join('');
    $('#modalContent').innerHTML=`<div class="modal-layout"><img class="modal-image" src="${getImage(p)}" alt="${esc(p.name)}" width="500" height="500"><div class="modal-copy"><p class="modal-category">${esc(categoryTitle(p.category))}</p><h2 id="productDialogTitle">${esc(title(p))}</h2>${details?`<dl class="spec-list">${details}</dl>`:''}<div class="price">${money(p.price)}</div><p class="price-caption">Цена по каталогу. Единицу продажи, фасовку и наличие уточнит менеджер.</p>${actions(p,'modal')}<p><a class="text-button" href="${esc(productPage(p))}">Открыть страницу товара →</a></p><div class="modal-contact">Нужна помощь с этим товаром?<br><a href="https://max.ru/u/f9LHodD0cOLaHA3tCZoG0DjXYAP4ytX60VM6HWRPrIgbrQ4GWo4Pu-tjIyA" data-max-contact target="_blank" rel="noopener noreferrer">Связаться в MAX ↗</a><a href="tel:+79515344480">Позвонить</a></div></div></div><details class="full-name"><summary>Полное наименование из прайса</summary><p>${esc(p.name)}</p><p>Характеристики выше выделены из наименования. Обозначения транспортной упаковки сохранены без изменения.</p></details>`;
    openDialog($('#productModal'));updateUrl();
    recent=[currentKey,...recent.filter(k=>k!==currentKey)].slice(0,6);writeStore('urmani_recent_v1',recent);renderRecent();return true;
  }
  function renderRecent(){
    $('#recentSection').hidden=!recent.length;
    $('#recentProducts').innerHTML=recent.map(key=>byKey.get(key)).filter(Boolean).map(p=>`<button type="button" class="recent-item" data-product="${esc(productKey(p))}"><img src="${getImage(p)}" alt="${esc(p.name)}" width="160" height="160" loading="lazy"><strong>${esc(title(p))}</strong><span>${money(p.price)}</span></button>`).join('');
  }
  function cartItems(){return Object.entries(cart).filter(([k,q])=>byKey.has(k)&&q>0).map(([key,quantity])=>({p:byKey.get(key),quantity}));}
  function saveCart(){writeStore('urmani_request_v1',cart);updateCartSummary();}
  function updateCartSummary(){
    const items=cartItems();const total=items.reduce((sum,x)=>sum+cents(x.p)*x.quantity,0)/100;
    $$('.cart-count').forEach(e=>e.textContent=String(items.length));$$('.mobile-total').forEach(e=>e.textContent=money(total));
    return total;
  }
  function renderCart(focusKey){
    const items=cartItems();const total=updateCartSummary();
    if(!items.length){$('#cartContent').innerHTML=`<div class="cart-empty">${icon('bag')}<h3>Здесь будет ваш список</h3><p>Выберите количество и нажмите «В заявку»<br>в карточке нужного товара.</p><button type="button" class="btn btn-primary" data-close-dialog>Перейти к выбору</button></div>`;return;}
    $('#cartContent').innerHTML=`<p class="cart-explanation">Количество укажите в единицах, которые хотите заказать по прайсу. Фасовку и единицы продажи подтвердит менеджер. Расчёт предварительный.</p><div class="cart-lines">${items.map(({p,quantity})=>`<article class="cart-line"><img src="${getImage(p)}" alt="${esc(p.name)}" width="55" height="65"><div><h3>${esc(title(p))}</h3><div class="cart-line-meta">${quantityMarkup(p,quantity,'cart')}<button type="button" class="remove-item" data-remove="${esc(productKey(p))}" aria-label="Убрать из заявки: ${esc(p.name)}">Убрать</button></div></div><div class="cart-line-price">${money(cents(p)*quantity/100)}<small>${money(p.price)} × ${quantity}</small></div></article>`).join('')}</div><div class="cart-summary"><div class="cart-total-row"><span>Предварительная сумма</span><strong>${money(total)}</strong></div><div class="delivery-progress">${total<3000?`До бесплатной доставки ещё <strong>${money(3000-total)}</strong>`:'По предварительному расчёту — доставка бесплатно'}<progress value="${Math.min(total,3000)}" max="3000" aria-label="Сумма до бесплатной доставки"></progress><small>От 3 000 ₽ по Ростову-на-Дону и области. Итоговую сумму и маршрут подтвердит менеджер.</small></div><label class="request-comment">Комментарий к заявке<textarea id="requestComment" maxlength="1000" placeholder="Например: город, нужная дата, уточнения по количеству">${esc(comment)}</textarea></label><button type="button" class="btn btn-primary cart-send" id="sendRequest">Скопировать заявку и открыть MAX ${icon('arrow')}</button><p class="cart-explanation" style="margin:10px 0 0">Скопируем список и откроем профиль Юрмани в MAX. Вставьте текст в сообщение и отправьте менеджеру.</p><div class="cart-tools"><button type="button" class="text-button" id="copyRequest">Скопировать список</button><button type="button" class="text-button" id="downloadRequest">Скачать список .txt</button></div><button type="button" class="cart-clear" id="clearCart">Очистить заявку</button></div>`;
    syncRequestLink();
    if(focusKey){const input=$$('.cart-line .quantity').find(e=>e.dataset.key===focusKey)?.querySelector('input');input?.focus();}
  }
  function syncRequestLink(){
    const button=$('#sendRequest');if(!button)return;
    button.nextElementSibling.textContent='Скопируем список и откроем профиль Юрмани в MAX. Нажмите «Написать», вставьте текст в сообщение и отправьте менеджеру.';
    button.onclick=()=>document.dispatchEvent(new CustomEvent('urmani:max',{detail:{text:requestText(),copyAndOpen:true}}));
  }
  function requestText(){const items=cartItems();return 'Здравствуйте! Прошу подтвердить заявку Юрмани:\n\n'+items.map(({p,quantity},i)=>`${i+1}. ${p.name}\nКоличество: ${quantity}; цена по каталогу: ${money(p.price)}; сумма: ${money(cents(p)*quantity/100)}`).join('\n\n')+`\n\nПредварительная сумма: ${money(items.reduce((sum,x)=>sum+cents(x.p)*x.quantity,0)/100)}.\nПрошу уточнить единицы продажи, фасовку, наличие и доставку.`+(comment.trim()?'\n\nКомментарий: '+comment.trim():'');}
  function downloadRequest(){const a=document.createElement('a');const url=URL.createObjectURL(new Blob([requestText()],{type:'text/plain;charset=utf-8'}));a.href=url;a.download='urmani-zayavka.txt';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function copyRequest(){try {await navigator.clipboard.writeText(requestText());toast('Список скопирован — можно отправить менеджеру');}catch{const ta=document.createElement('textarea');ta.value=requestText();ta.style.cssText='position:fixed;left:-9999px';document.body.append(ta);ta.select();let copied=false;try{copied=document.execCommand('copy');}catch{}ta.remove();if(copied)toast('Список скопирован');else {downloadRequest();toast('Список сохранён в файл для отправки менеджеру');}}}
  function setCartQuantity(key,value,focus){cart[key]=quantityValue(value);saveCart();renderCart(focus?key:null);}
  document.addEventListener('click',e=>{
    const target=e.target.closest('button,a');if(!target)return;
    if(target.hasAttribute('data-product')){e.preventDefault();openProductById(target.dataset.product);return;}
    if(target.hasAttribute('data-add')){const key=target.dataset.add;if(!byKey.has(key))return;const n=quantityValue(target.closest('.product-actions').querySelector('input').value);cart[key]=Math.min(999999,(cart[key]||0)+n);saveCart();toast('Товар добавлен в заявку');target.textContent='Добавлено ✓';setTimeout(()=>{if(target.isConnected)target.innerHTML=icon('bag')+'В заявку';},1200);return;}
    if(target.hasAttribute('data-qty')){const box=target.closest('.quantity');const input=$('input',box);const n=quantityValue(Number(input.value)+Number(target.dataset.qty));if(box.dataset.context==='cart')setCartQuantity(box.dataset.key,n,true);else input.value=n;return;}
    if(target.hasAttribute('data-open-cart')){renderCart();if($('#productModal').open)closeDialog($('#productModal'));openDialog($('#cartModal'));return;}
    if(target.hasAttribute('data-close-dialog')){closeDialog(target.closest('dialog'));return;}
    if(target.hasAttribute('data-remove')){delete cart[target.dataset.remove];saveCart();renderCart();return;}
    if(target.hasAttribute('data-category')){state.category=target.dataset.category;state.selection='';state.section='';state.group=false;state.facets={};applyFilters();return;}
    if(target.hasAttribute('data-section')){state.section=target.dataset.section;state.facets={};applyFilters();return;}
    if(target.hasAttribute('data-selection')){state.section='';state.q='';state.min='';state.max='';syncInputs();state.selection=state.selection===target.dataset.selection?'':target.dataset.selection;state.category='all';state.group=false;state.facets={};applyFilters();return;}
    if(target.hasAttribute('data-remove-filter')){const k=target.dataset.removeFilter;if(k==='selection'){state.selection='';state.section='';}else if(k==='category'){state.category='all';state.facets={};}else if(k==='group')state.group=false;else if(k in state.facets)delete state.facets[k];else state[k]='';syncInputs();applyFilters();return;}
    if(target.hasAttribute('data-reset')||target.id==='resetFilters'){resetFilters();return;}
    if(target.id==='clearCart'){cart={};saveCart();renderCart();toast('Заявка очищена');return;}
    if(target.id==='copyRequest'){copyRequest();return;}
    if(target.id==='downloadRequest'){downloadRequest();return;}
  });
  document.addEventListener('change',e=>{
    if(e.target.matches('.quantity input')){const box=e.target.closest('.quantity');const n=quantityValue(e.target.value);e.target.value=n;if(box.dataset.context==='cart')setCartQuantity(box.dataset.key,n,true);}
    if(e.target.matches('[data-facet]')){state.facets[e.target.dataset.facet]=e.target.value;applyFilters(false);}
  });
  document.addEventListener('input',e=>{if(e.target.id==='requestComment'){comment=e.target.value;syncRequestLink();}});
  document.addEventListener('error',e=>{if(e.target.tagName==='IMG'&&!e.target.src.endsWith('/placeholder.png'))e.target.src='placeholder.png';},true);
  $$('dialog').forEach(dialog=>{
    dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog(dialog);}});
    dialog.addEventListener('cancel',e=>{e.preventDefault();closeDialog(dialog);});
  });
  $('#searchForm').addEventListener('submit',e=>{e.preventDefault();state.q=$('#productSearch').value.trim();applyFilters();$('#productSearch').blur();});
  $('#productSearch').addEventListener('input',()=>{state.q=$('#productSearch').value.trim();applyFilters();});
  $('#clearSearch').addEventListener('click',()=>{state.q='';syncInputs();applyFilters();$('#productSearch').focus();});
  $('#sortSelect').addEventListener('change',()=>{state.sort=$('#sortSelect').value;applyFilters(false);});
  for(const [id,key] of [['priceMin','min'],['priceMax','max']])$('#'+id).addEventListener('input',()=>{const value=$('#'+id).value;state[key]=value!==''&&Number(value)>=0?value:'';applyFilters(false);});
  $('#loadMore').addEventListener('click',()=>{const oldCount=$$('.product').length;state.limit+=48;renderProducts(true);$$('.product')[oldCount]?.querySelector('button')?.focus({preventScroll:true});});
  function setFiltersOpen(open){$('#filterPanel').classList.toggle('is-open',open);$('#toggleFilters').setAttribute('aria-expanded',String(open));if(open)$('#filterPanel').scrollIntoView?.({behavior:'smooth',block:'start'});else $('#toggleFilters').focus();}
  $('#toggleFilters').addEventListener('click',()=>setFiltersOpen(!$('#filterPanel').classList.contains('is-open')));
  $('#closeFilters').addEventListener('click',()=>setFiltersOpen(false));
  $('#clearRecent').addEventListener('click',()=>{recent=[];writeStore('urmani_recent_v1',recent);renderRecent();});
  async function load(){
    try {
      const res=await fetch('products.json');if(!res.ok)throw new Error('HTTP '+res.status);
      const data=await res.json();if(!Array.isArray(data)||!data.length)throw new Error('Empty catalog');
      const usedKeys=new Set();
      products=data.map((p,i)=>{
        let key=String(p.id || p.slug || p.name);
        if(usedKeys.has(key))key+='::'+p.image;
        if(usedKeys.has(key))key+='::'+i;
        usedKeys.add(key);
        return {...p,_key:key,_index:i,_specs:specs(p),_search:normalize(p.name)};
      });
      byKey=new Map(products.map(p=>[productKey(p),p]));
      products.forEach(p=>categoryCounts.set(p.category,(categoryCounts.get(p.category)||0)+1));
      const sorted=[...categoryCounts].sort((a,b)=>categoryTitle(a[0]).localeCompare(categoryTitle(b[0]),'ru'));categoryCounts.clear();sorted.forEach(([c,n])=>categoryCounts.set(c,n));
      if(state.category!=='all'&&!categoryCounts.has(state.category))state.category='all';
      for(const k of facetKeys())if(params.get(k))state.facets[k]=params.get(k);
      for(const k of ['min','max'])if(state[k]!==''&&(!Number.isFinite(Number(state[k]))||Number(state[k])<0))state[k]='';
      const stored=readStore('urmani_request_v1',{});if(stored&&typeof stored==='object'&&!Array.isArray(stored))for(const [key,value] of Object.entries(stored))if(byKey.has(key)&&Number.isFinite(Number(value))&&Number(value)>0)cart[key]=quantityValue(value);
      const viewed=readStore('urmani_recent_v1',[]);recent=Array.isArray(viewed)?[...new Set(viewed.filter(k=>byKey.has(k)))].slice(0,6):[];
      syncInputs();applyFilters();updateCartSummary();renderRecent();$('#loading').hidden=true;
      if(params.get('request')==='1'){renderCart();openDialog($('#cartModal'));}
      let key=params.get('product')||params.get('id');
      try {const saved=sessionStorage.getItem('urmani_redirect_path');if(saved){sessionStorage.removeItem('urmani_redirect_path');const match=saved.match(/\/catalog\/([^/?#]+)|[?&]product=([^&]+)/);if(match)key=decodeURIComponent(match[1]||match[2]);}}catch{}
      if(key&&!openProductById(key))toast('Товар по этой ссылке не найден. Попробуйте поиск.');
      window.dispatchEvent(new Event('productsLoaded'));
    }catch(err){$('#loading').innerHTML='<strong>Не удалось загрузить каталог</strong><p>Проверьте соединение и попробуйте ещё раз. При локальном открытии запустите START-WINDOWS.cmd.</p><button type="button" class="btn btn-primary" id="retryLoad">Повторить</button> <a class="btn btn-outline" href="price.pdf">Скачать прайс</a>';$('#resultCount').textContent='Каталог временно недоступен';$('#retryLoad').addEventListener('click',load,{once:true});}
  }
  load();
})();
