(() => {
  'use strict';
  const key='urmani_attribution_v1';
  try {
    if(sessionStorage.getItem(key))return;
    const params=new URLSearchParams(location.search),value={landing_path:location.pathname};
    for(const name of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term']){
      if(params.get(name))value[name]=params.get(name).slice(0,250);
    }
    if(document.referrer){try{value.referrer_host=new URL(document.referrer).hostname;}catch{}}
    if(params.has('yclid') || (/yandex|ya$/i.test(value.utm_source||'') && /cpc|ppc|paid/i.test(value.utm_medium||'')))value.source='Яндекс Директ';
    else if(value.utm_source)value.source=value.utm_source;
    else if(value.referrer_host && value.referrer_host!==location.hostname)value.source=/yandex|ya\.ru|google\./i.test(value.referrer_host)?'Поиск':'Переход по ссылке';
    else value.source='Прямой переход';
    sessionStorage.setItem(key,JSON.stringify(value));
  }catch{}
})();


(() => {
  'use strict';
  const siteHosts = ['xn--80aqkfm7f.xn--p1ai', 'юрмани.рф'];
  // The home page already initializes this counter in its HTML.
  if (!siteHosts.includes(location.hostname) || typeof window.ym === 'function') return;

  const metrika = window.ym = function () {
    (metrika.a ||= []).push(arguments);
  };
  metrika.l = Date.now();
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://mc.yandex.ru/metrika/tag.js';
  metrika(106315549, 'init', {
    clickmap: true,
    trackLinks: true,
    accurateTrackBounce: true
  });
  document.head.appendChild(script);
})();
