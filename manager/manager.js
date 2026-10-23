(() => {
  'use strict';
  const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=cents=>(cents/100).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
  const date=value=>value?new Date(value).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'}):'—';
  let session=null,page=1,total=0,currentOrder=null,timer=null,refreshing=false,lastFocus=null;
  async function api(path,options={}){
    const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,headers:{...(options.body?{'Content-Type':'application/json','X-CSRF-Token':session?.csrf||''}:{}),...options.headers}});
    if(!(response.headers.get('content-type')||'').includes('application/json'))throw new Error('Сервис заказов недоступен. Проверьте подключение.');
    const value=await response.json();
    if(!response.ok){const err=new Error(value.error||'Не удалось выполнить действие.');err.status=response.status;if(response.status===401 && path!=='/api/admin/login')showLogin('Сессия истекла. Войдите снова.');throw err;}
    return value;
  }
  function showLogin(message=''){
    session=null;clearInterval(timer);$('#login-view').hidden=false;$('#manager-app').hidden=true;
    if($('#order-detail').open)$('#order-detail').close();
    $('#login-error').textContent=message;$('#login-error').hidden=!message;
  }
  async function enter(){
    session=await api('/api/admin/me');$('#login-view').hidden=true;$('#manager-app').hidden=false;$('#user-name').textContent=session.user.name;
    $('#manager-test').hidden=!session.test_mode;$('#mail-notice').hidden=session.mail_enabled;
    $('#status-filter').innerHTML='<option value="">Все статусы</option>'+Object.entries(session.statuses).map(([key,name])=>`<option value="${esc(key)}">${esc(name)}</option>`).join('');
    await list();clearInterval(timer);timer=setInterval(()=>{if(!document.hidden&&!$('#order-detail').open)list();},60000);
    const match=location.hash.match(/^#order=([1-9][0-9]*)$/);if(match)openOrder(Number(match[1]));
  }
  $('#login-form').addEventListener('submit',async event=>{
    event.preventDefault();$('#login-error').hidden=true;$('#login-submit').disabled=true;
    try{await api('/api/admin/login',{method:'POST',body:JSON.stringify({login:$('#manager-login').value,password:$('#manager-password').value})});$('#manager-password').value='';await enter();}
    catch(err){$('#login-error').textContent=err.message;$('#login-error').hidden=false;}
    finally{$('#login-submit').disabled=false;}
  });
  $('#logout').addEventListener('click',async()=>{try{await api('/api/admin/logout',{method:'POST',body:'{}'});showLogin();}catch(err){$('#manager-error').textContent=err.message;$('#manager-error').hidden=false;}});
  async function list(){
    if(refreshing||!session)return;
    refreshing=true;$('#refresh-orders').disabled=true;$('#manager-error').hidden=true;
    try{
      const query=new URLSearchParams({status:$('#status-filter').value,q:$('#order-search').value.trim(),page:String(page)});
      const value=await api('/api/admin/orders?'+query);total=value.total;
      for(const key of ['new','contacted','confirmed','completed'])$('#metric-'+key).textContent=value.counts[key]||0;
      $('#new-count').textContent=value.counts.new||0;
      $('#orders-list').innerHTML=value.orders.length?value.orders.map(o=>`<button type="button" class="order-row" data-order="${o.id}" aria-label="Открыть заказ ${esc(o.number)}"><span><strong>${esc(o.number)}</strong><small>${esc(date(o.created_at))}</small></span><span><strong>${esc(o.customer_name)}</strong><small>${esc(o.phone)} · ${esc(o.city)}</small></span><span><strong>${esc(money(o.total_cents))}</strong>${o.next_contact_at?`<small>Звонок: ${esc(date(o.next_contact_at))}</small>`:''}</span><span><span class="badge ${esc(o.status)}">${esc(session.statuses[o.status])}</span><small>${esc(o.assignee_name||'Не назначен')}</small></span></button>`).join(''):'<div class="list-empty">Заказов по этим условиям пока нет.</div>';
      $('#list-count').textContent=total?`Показано ${(page-1)*30+1}–${Math.min(page*30,total)} из ${total}`:'Новых заказов пока нет';
      $('#previous-page').disabled=page<=1;$('#next-page').disabled=page*30>=total;
    }catch(err){$('#manager-error').textContent=err.message;$('#manager-error').hidden=false;}
    finally{refreshing=false;$('#refresh-orders').disabled=false;}
  }
  function localDate(value){if(!value)return '';const d=new Date(value);const pad=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;}
  function renderDetail(order,note=''){
    currentOrder=order;$('#detail-title').textContent=order.number;
    const emails={pending:'Ожидает отправки',retry:'Повторная попытка запланирована',sending:'Отправляется',sent:'Отправлено',failed:'Не доставлено — заказ сохранён в кабинете'};
    $('#detail-content').innerHTML=`<p class="muted">Создан ${esc(date(order.created_at))}</p><dl class="detail-customer"><div><dt>Клиент</dt><dd>${esc(order.customer_name)}</dd></div><div><dt>Телефон</dt><dd><a href="tel:${esc(order.phone)}">${esc(order.phone)}</a></dd></div><div><dt>Город</dt><dd>${esc(order.city)}</dd></div><div><dt>Получение</dt><dd>${order.fulfillment==='pickup'?'Самовывоз':esc(order.address)}</dd></div></dl>${order.comment?`<h3>Пожелания клиента</h3><p class="customer-comment">${esc(order.comment)}</p>`:''}<table class="detail-items"><thead><tr><th>Товар</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead><tbody>${order.items.map(p=>`<tr><td>${esc(p.name)}</td><td>${p.quantity}</td><td>${esc(money(p.price_cents))}</td><td>${esc(money(p.quantity*p.price_cents))}</td></tr>`).join('')}</tbody></table><p class="detail-total">${esc(money(order.total_cents))}</p><p class="detail-caption">Предварительно. Подтвердите единицы продажи, фасовку и наличие.</p><p class="source-note">Источник: ${esc(order.attribution.source||'Не определён')}${order.attribution.utm_campaign?' · Кампания: '+esc(order.attribution.utm_campaign):''}</p><p class="source-note">Письмо менеджеру: ${session.mail_enabled?esc(emails[order.email_status]||'Ожидает отправки'):'уведомления не настроены'}</p><form id="detail-form" class="detail-edit"><h3>Работа с заказом</h3><div class="edit-grid"><div><label for="detail-status">Статус</label><select id="detail-status">${Object.entries(session.statuses).map(([key,name])=>`<option value="${esc(key)}"${order.status===key?' selected':''}>${esc(name)}</option>`).join('')}</select></div><div><label for="detail-assignee">Ответственный</label><select id="detail-assignee"><option value="">Не назначен</option>${session.users.map(user=>`<option value="${user.id}"${order.assignee_id===user.id?' selected':''}>${esc(user.name)}</option>`).join('')}</select></div></div><div class="edit-full"><label for="detail-callback">Следующий звонок (время устройства)</label><input id="detail-callback" type="datetime-local" value="${localDate(order.next_contact_at)}"></div><div class="edit-full"><label for="detail-note">Новый комментарий менеджера</label><textarea id="detail-note" rows="3" maxlength="3000" placeholder="Что согласовали, что уточнить при следующем звонке">${esc(note)}</textarea></div><p id="detail-error" class="error" role="alert" hidden></p><button class="btn primary" type="submit" id="save-order">Сохранить изменения</button></form><section class="history"><h3>История заказа</h3>${order.history.map(entry=>`<article><small>${esc(date(entry.created_at))} · ${esc(entry.actor)}</small><p>${esc(entry.note)}</p></article>`).join('')}</section>`;
    $('#detail-form').addEventListener('submit',saveOrder);
  }
  async function openOrder(id){
    try{const order=await api('/api/admin/orders/'+id);lastFocus=document.activeElement;renderDetail(order);if(!$('#order-detail').open)$('#order-detail').showModal();history.replaceState({},'','#order='+id);}
    catch(err){$('#manager-error').textContent=err.message;$('#manager-error').hidden=false;}
  }
  async function saveOrder(event){
    event.preventDefault();const orderId=currentOrder.id;const note=$('#detail-note').value;$('#save-order').disabled=true;$('#detail-error').hidden=true;
    try{
      const callback=$('#detail-callback').value;
      const saved=await api('/api/admin/orders/'+orderId,{method:'PATCH',body:JSON.stringify({version:currentOrder.version,status:$('#detail-status').value,assignee_id:$('#detail-assignee').value?Number($('#detail-assignee').value):null,next_contact_at:callback?new Date(callback).toISOString():null,note})});
      renderDetail(saved);await list();
    }catch(err){
      if(err.status===409){try{renderDetail(await api('/api/admin/orders/'+orderId),note);}catch{}}
      if($('#detail-error')){$('#detail-error').textContent=err.message;$('#detail-error').hidden=false;}
    }finally{if($('#save-order'))$('#save-order').disabled=false;}
  }
  function closeDetail(){$('#order-detail').close();history.replaceState({},'',location.pathname);lastFocus?.focus();}
  $('#close-detail').addEventListener('click',closeDetail);
  $('#order-detail').addEventListener('cancel',event=>{event.preventDefault();closeDetail();});
  $('#orders-list').addEventListener('click',event=>{const button=event.target.closest('[data-order]');if(button)openOrder(Number(button.dataset.order));});
  $('#filter-form').addEventListener('submit',event=>{event.preventDefault();page=1;list();});
  $('#status-filter').addEventListener('change',()=>{page=1;list();});
  $('#refresh-orders').addEventListener('click',list);
  $('#show-all').addEventListener('click',()=>{page=1;$('#order-search').value='';$('#status-filter').value='';list();});
  $('#previous-page').addEventListener('click',()=>{if(page>1){page--;list();}});
  $('#next-page').addEventListener('click',()=>{if(page*30<total){page++;list();}});
  enter().catch(err=>showLogin(err.status===401?'':err.message));
})();
