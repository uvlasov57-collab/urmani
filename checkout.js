(() => {
  'use strict';
  const $=s=>document.querySelector(s),cartKey='urmani_request_v1',pendingKey='urmani_checkout_pending_v1';
  const money=cents=>(cents/100).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
  const read=(storage,key,fallback)=>{try{return JSON.parse(storage.getItem(key))??fallback;}catch{return fallback;}};
  const write=(storage,key,value)=>{try{storage.setItem(key,JSON.stringify(value));}catch{}};
  const cart=read(localStorage,cartKey,{});
  let items=[],total=0,config=null,token='',pendingPayload=null,busy=false;
  function newToken(){const bytes=new Uint8Array(24);crypto.getRandomValues(bytes);return [...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');}
  function saveToken(){try{sessionStorage.setItem(pendingKey,token);}catch{}}
  const error=(message)=>{$('#checkout-error').textContent=message;$('#checkout-error').hidden=false;};
  async function api(path,options={}){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch(path,{cache:'no-store',...options,signal:controller.signal});
      const type=response.headers.get('content-type')||'';
      if(!type.includes('application/json'))throw new Error('Сервис заказов сейчас недоступен. Корзина сохранена.');
      const data=await response.json();
      if(!response.ok){const err=new Error(data.error||'Не удалось отправить заказ.');err.status=response.status;err.data=data;throw err;}
      return data;
    }catch(err){if(err.name==='AbortError')throw new Error('Ответ задерживается. Нажмите кнопку ещё раз — проверим отправку без повторного заказа.');throw err;}
    finally{clearTimeout(timer);}
  }
  function render(){
    const fragment=document.createDocumentFragment();
    for(const p of items){
      const row=document.createElement('article');row.className='checkout-item';
      const img=document.createElement('img');img.src=p.image;img.alt='';img.width=56;img.height=60;img.loading='lazy';
      img.onerror=()=>{img.onerror=null;img.src='placeholder.png';};
      const body=document.createElement('div'),title=document.createElement('h3'),quantity=document.createElement('p'),sum=document.createElement('strong');
      title.textContent=p.name;quantity.textContent=money(p.price_cents)+' × '+p.quantity;sum.textContent=money(p.price_cents*p.quantity);
      body.append(title,quantity,sum);row.append(img,body);fragment.append(row);
    }
    $('#checkout-items').replaceChildren(fragment);total=items.reduce((sum,p)=>sum+p.price_cents*p.quantity,0);$('#checkout-total').textContent=money(total);
    $('#delivery-hint').textContent=total>=300000?'По предварительной сумме — доставка по Ростову-на-Дону и области бесплатно. Маршрут подтвердит менеджер.':'До бесплатной доставки по Ростову-на-Дону и области ещё '+money(300000-total)+'. Маршрут подтвердит менеджер.';
  }
  function lockFields(lock){$('#checkout-form').querySelectorAll('input,textarea').forEach(el=>el.disabled=lock);}
  function success(receipt){
    const current=read(localStorage,cartKey,{}),ordered=receipt.items||items;
    for(const p of ordered){if(Number.isFinite(Number(current[p.key]))){const remaining=Number(current[p.key])-p.quantity;if(remaining>0)current[p.key]=remaining;else delete current[p.key];}}
    write(localStorage,cartKey,current);
    try{sessionStorage.removeItem(pendingKey);sessionStorage.removeItem('urmani_request_comment_v1');}catch{}
    write(sessionStorage,'urmani_last_order_receipt_v1',{number:receipt.number,total_cents:receipt.total_cents});
    $('#checkout-main').hidden=true;$('#order-success').hidden=false;$('#success-number').textContent='№ '+receipt.number;$('#success-total').textContent='Предварительная сумма: '+money(receipt.total_cents);$('#success-title').focus();
    if(typeof window.ym==='function')window.ym(106315549,'reachGoal','order_saved',{order_number:receipt.number});
  }
  function fulfillment(){const pickup=$('input[name=fulfillment]:checked').value==='pickup';$('#address-field').hidden=pickup;$('#customer-address').required=!pickup;$('#pickup-note').hidden=!pickup;}
  document.querySelectorAll('input[name=fulfillment]').forEach(el=>el.addEventListener('change',fulfillment));
  $('#checkout-form').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!config||!items.length)return;
    $('#checkout-error').hidden=true;
    if(!pendingPayload){
      if(!$('#checkout-form').reportValidity())return;
      const form=new FormData($('#checkout-form'));
      pendingPayload={customer:{name:form.get('name'),phone:form.get('phone'),city:form.get('city'),address:form.get('address')||''},fulfillment:form.get('fulfillment'),comment:form.get('comment')||'',website:form.get('website')||'',consent:form.get('consent')==='on',consent_version:config.consent_version,items:items.map(p=>({key:p.key,quantity:p.quantity})),expected_total_cents:total,attribution:read(sessionStorage,'urmani_attribution_v1',{})};
      saveToken();
    }
    busy=true;lockFields(true);$('#place-order').disabled=true;$('#place-order').textContent='Сохраняем заказ…';
    try{
      const receipt=await api('/api/orders',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':token},body:JSON.stringify(pendingPayload)});
      if(!receipt.saved||!receipt.number)throw new Error('Не удалось подтвердить сохранение. Повторите проверку отправки.');
      success(receipt);
    }catch(err){
      error(err.message||'Не удалось получить ответ. Повторите отправку — заказ не продублируется.');
      if(err.status && err.status<500){
        if(err.data?.code==='PRICE_CHANGED' && Array.isArray(err.data.items)){items=err.data.items;render();}
        pendingPayload=null;token=newToken();saveToken();lockFields(false);
      }else{
        // Re-send the identical payload/key after an uncertain network outcome.
        $('#place-order').textContent='Проверить отправку ещё раз';
      }
    }finally{busy=false;$('#place-order').disabled=false;if(!pendingPayload)$('#place-order').textContent='Отправить заказ менеджеру';}
  });
  async function init(){
    try{
      config=await api('/api/checkout/config');if(!config.available)throw new Error('Приём заказов временно недоступен. Свяжитесь с менеджером.');
      $('#test-notice').hidden=!config.test_mode;
      try{token=sessionStorage.getItem(pendingKey)||'';}catch{}
      if(token){
        try{const receipt=await api('/api/orders/receipt',{headers:{'Idempotency-Key':token}});success(receipt);return;}catch(err){if(err.status!==404)throw err;}
      }else token=newToken();
      const res=await fetch('products.json',{cache:'no-store'});if(!res.ok)throw new Error('Не удалось загрузить состав заказа.');
      const products=await res.json(),byKey=new Map();
      products.forEach((p,i)=>{let key=String(p.id||p.slug||p.name);if(byKey.has(key))key+='::'+p.image;if(byKey.has(key))key+='::'+i;byKey.set(key,p);});
      let missing=false;
      if(cart && typeof cart==='object'&&!Array.isArray(cart))for(const [key,quantity] of Object.entries(cart)){
        const p=byKey.get(key);if(!p||!Number.isInteger(quantity)||quantity<1||quantity>999999){missing=true;continue;}
        items.push({...p,key,quantity,price_cents:Math.round(Number(p.price)*100)});
      }
      if(missing)throw new Error('Некоторые позиции изменились. Вернитесь в корзину и проверьте состав заказа.');
      if(!items.length){const receipt=read(sessionStorage,'urmani_last_order_receipt_v1',null);if(receipt?.number){success({...receipt,items:[]});return;}$('#checkout-empty').hidden=false;return;}
      if(items.length>200)throw new Error('В заявке больше 200 разных позиций. Разделите её или обратитесь к менеджеру.');
      try{$('#customer-comment').value=sessionStorage.getItem('urmani_request_comment_v1')||'';}catch{}
      render();$('#checkout-layout').hidden=false;$('#place-order').disabled=false;
    }catch(err){$('#checkout-unavailable').textContent=err.message||'Не удалось открыть оформление. Корзина сохранена.';$('#checkout-unavailable').hidden=false;$('#checkout-contact').hidden=false;}
    finally{$('#checkout-loading').hidden=true;}
  }
  init();
})();
