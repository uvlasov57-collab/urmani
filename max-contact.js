(() => {
  'use strict';
  const PROFILE_URL = 'https://max.ru/u/f9LHodD0cOLaHA3tCZoG0DjXYAP4ytX60VM6HWRPrIgbrQ4GWo4Pu-tjIyA';
  let sending = false;
  const style = document.createElement('style');
  style.textContent = `.max-contact-dialog{box-sizing:border-box;width:min(480px,calc(100% - 24px));max-height:90dvh;overflow:auto;border:0;border-radius:20px;padding:28px;color:#142b44;background:#fff;box-shadow:0 20px 80px #10243f40;font:16px/1.5 system-ui,sans-serif}.max-contact-dialog::backdrop{background:#10243faa}.max-contact-dialog h2{margin:0 36px 12px 0;font-size:24px}.max-contact-dialog p{margin:12px 0}.max-contact-dialog button,.max-contact-dialog .max-open{display:block;box-sizing:border-box;width:100%;padding:12px 16px;border:1px solid #ced9e2;border-radius:10px;background:#fff;color:#142b44;text-align:center;font:inherit;cursor:pointer;text-decoration:none;margin-top:10px}.max-contact-dialog .max-open{background:#137d62;color:white;border:0}.max-contact-dialog .max-close{position:absolute;right:12px;top:10px;width:36px;margin:0;padding:4px;font-size:24px}.max-contact-dialog textarea{box-sizing:border-box;width:100%;height:150px;font:14px/1.5 system-ui;border:1px solid #ced9e2;border-radius:10px;padding:10px}.max-contact-dialog [hidden]{display:none!important}.max-contact-dialog .max-phone{font-size:22px;font-weight:700;white-space:nowrap}.max-contact-dialog .max-status{font-size:14px;min-height:21px}`;
  document.head.append(style);
  const dialog = document.createElement('dialog');
  dialog.className = 'max-contact-dialog';
  dialog.id = 'max-contact';
  dialog.setAttribute('aria-labelledby', 'max-title');
  dialog.innerHTML = `<button type="button" class="max-close" aria-label="Закрыть">×</button><h2 id="max-title">Связаться в MAX</h2><p>Юрмани · менеджер</p><p class="max-phone">+7 (951) 534-44-80</p><button type="button" data-copy-phone>Скопировать номер</button><p>Скопируйте заявку, нажмите «Открыть чат в MAX» и вставьте список в сообщение менеджеру.</p><div class="max-request" hidden><label for="max-request-text">Ваша заявка — скопируйте её и вставьте в чат с менеджером:</label><textarea id="max-request-text" readonly></textarea><button type="button" data-copy-request>Скопировать заявку</button></div><a class="max-open" href="https://max.ru/u/f9LHodD0cOLaHA3tCZoG0DjXYAP4ytX60VM6HWRPrIgbrQ4GWo4Pu-tjIyA" target="_blank" rel="noopener noreferrer">Открыть чат в MAX</a><p class="max-status" role="status" aria-live="polite"></p>`;
  document.body.append(dialog);
  let trigger;
  const status = dialog.querySelector('.max-status');
  function open(text = '') {
    trigger = document.activeElement;
    dialog.querySelector('.max-request').hidden = !text;
    dialog.querySelector('textarea').value = text;
    status.textContent = '';
    if (!dialog.open) dialog.showModal();
  }
  async function copyText(text) {
    // Keep the selection inside the active native dialog, including on local HTTP previews.
    const previous = document.activeElement;
    const field = document.createElement('textarea');
    field.value = text;
    field.readOnly = true;
    field.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px';
    (document.querySelector('dialog[open]') || document.body).append(field);
    field.focus();field.select();field.setSelectionRange(0, field.value.length);
    let copied = false;
    try { copied = document.execCommand('copy'); } catch {}
    field.remove();previous?.focus({preventScroll:true});
    if (!copied) try { await navigator.clipboard.writeText(text); copied = true; } catch {}
    return copied;
  }
  async function copy(text, message) {
    const copied = await copyText(text);
    status.textContent = copied ? message : 'Не удалось скопировать автоматически. Выделите текст и скопируйте вручную.';
  }
  document.addEventListener('urmani:max', async event => {
    const text = event.detail?.text || '';
    if (!event.detail?.copyAndOpen) { open(text);return; }
    if (sending || !text) return;
    sending = true;
    const button = document.querySelector('#sendRequest');
    if (button) button.disabled = true;
    try {
      const copied = await copyText(text);
      if (copied) {
        // Same-tab navigation avoids a popup blocker after asynchronous clipboard permission.
        location.assign(PROFILE_URL);
      } else {
        open(text);
        status.textContent = 'Браузер не разрешил копирование. Нажмите на текст заявки, выделите всё и скопируйте, затем откройте чат в MAX.';
        const field = dialog.querySelector('textarea');field.focus();field.select();
      }
    } catch {
      open(text);
      status.textContent = 'Заявка сохранена здесь. Скопируйте список и откройте чат в MAX кнопкой ниже.';
    } finally {
      sending = false;
      if (button?.isConnected) button.disabled = false;
    }
  });
  dialog.querySelector('.max-close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => trigger?.focus());
  dialog.querySelector('[data-copy-phone]').onclick = () => copy('+79515344480', 'Номер скопирован');
  dialog.querySelector('[data-copy-request]').onclick = () => copy(dialog.querySelector('textarea').value, 'Заявка скопирована. Вставьте её в чат и отправьте менеджеру.');
})();
