(()=>{'use strict';
const menu=document.querySelector('#mobile-nav'),toggle=document.querySelector('#menu-toggle');
const setMenu=open=>{toggle.setAttribute('aria-expanded',String(open));menu.classList.toggle('is-open',open);};
toggle.addEventListener('click',()=>setMenu(toggle.getAttribute('aria-expanded')!=='true'));
menu.addEventListener('click',e=>{if(e.target.closest('a'))setMenu(false)});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&toggle.getAttribute('aria-expanded')==='true'){setMenu(false);toggle.focus();}});
document.addEventListener('click',e=>{if(!e.target.closest('.site-header'))setMenu(false)});
const request=document.querySelector('#request-form');
request.addEventListener('toggle',()=>{const iframe=request.querySelector('iframe');if(request.open&&!iframe.getAttribute('src'))iframe.src=iframe.dataset.src;});
const event=(name,params)=>{if(typeof window.ym==='function')window.ym(106315549,'reachGoal',name,params||{});};
document.querySelectorAll('[data-goal]').forEach(a=>a.addEventListener('click',()=>event(a.dataset.goal)));
document.querySelector('#home-search').addEventListener('submit',e=>{const input=e.currentTarget.elements.q;if(!input.value.trim()){e.preventDefault();input.focus();return;}input.value=input.value.trim();event('home_search');});
const arrow='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const grid=document.querySelector('#home-products'),number=new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',minimumFractionDigits:2,maximumFractionDigits:2});
function render(products){
 const fragment=document.createDocumentFragment();
 window.URMANI_HOME_CONFIG.featured.forEach(config=>{
  const p=products.find(p=>p.image===config.image);if(!p)return;
  const card=document.createElement('a');card.className='home-product';card.href=window.URMANI_SEO?.products[p.name+'|'+p.image] || 'catalog.html?product='+encodeURIComponent(p.name);card.setAttribute('aria-label',config.title+' — '+number.format(p.price)+'. Подробнее');
  const photo=document.createElement('div');photo.className='product-photo';const img=document.createElement('img');img.src='home-assets/'+p.image.split('/').pop();img.alt=p.name;img.width=480;img.height=480;img.loading='lazy';img.decoding='async';photo.append(img);
  const body=document.createElement('div');body.className='product-body';const category=document.createElement('span');category.className='product-category';category.textContent=p.category;
  const title=document.createElement('h3');title.textContent=config.title;const spec=document.createElement('p');spec.className='product-spec';spec.textContent=config.spec;
  const bottom=document.createElement('div');bottom.className='product-bottom';const price=document.createElement('div');price.className='product-price';price.textContent=number.format(p.price);const caption=document.createElement('small');caption.textContent='Цена по каталогу';price.append(caption);
  const open=document.createElement('span');open.className='product-open';open.setAttribute('aria-hidden','true');open.innerHTML=arrow;bottom.append(price,open);body.append(category,title,spec,bottom);card.append(photo,body);card.addEventListener('click',()=>event('home_product_open',{product:p.image}));fragment.append(card);
 });
 if(!fragment.childNodes.length)return;
 grid.replaceChildren(fragment);
}
render(window.URMANI_HOME_CONFIG.snapshot);
if(location.protocol!=='file:')fetch('products.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error('Catalog unavailable');return r.json()}).then(products=>{if(!Array.isArray(products))throw new Error('Invalid catalog');render(products);}).catch(()=>{ /* Server-rendered catalog snapshot remains available. */ });
})();
