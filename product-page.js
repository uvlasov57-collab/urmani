(() => {
  'use strict';
  const storeKey = 'urmani_request_v1';
  const read = () => { try { const value=JSON.parse(localStorage.getItem(storeKey));return value && typeof value==='object' && !Array.isArray(value)?value:{}; } catch { return {}; } };
  function updateCount(){const count=Object.values(read()).filter(q=>Number.isFinite(Number(q))&&Number(q)>0).length;document.querySelectorAll('.cart-count').forEach(el=>el.textContent=String(count));}
  updateCount();
  window.addEventListener('pageshow',updateCount);
  window.addEventListener('storage',updateCount);
  const form=document.querySelector('#seo-add-form');
  if(!form)return;
  const p=JSON.parse(document.querySelector('#seo-product-data').textContent);
  form.addEventListener('submit',event=>{
    event.preventDefault();
    const input=document.querySelector('#seo-quantity');
    const quantity=Math.max(1,Math.min(999999,Math.round(Number(input.value)||1)));
    input.value=quantity;
    const cart=read();
    const previous=Number(cart[p._key]);
    cart[p._key]=Math.min(999999,(Number.isFinite(previous)&&previous>0?previous:0)+quantity);
    const status=document.querySelector('#seo-add-status');
    try {localStorage.setItem(storeKey,JSON.stringify(cart));status.textContent='Добавлено в корзину: '+cart[p._key]+'. Откройте корзину, чтобы проверить состав и оформить заказ.';updateCount();}
    catch {status.textContent='Браузер запретил сохранение. Откройте каталог с поиском или свяжитесь с менеджером.';}
  });
})();
