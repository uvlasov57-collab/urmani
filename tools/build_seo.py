"""Rebuild crawlable pages after updating products.json. Run from any directory."""
from pathlib import Path
from collections import Counter
from datetime import date
from hashlib import sha256
from html import escape
from urllib.parse import quote, urlencode
import json
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://xn--80aqkfm7f.xn--p1ai'
VERSION = 'seo-20261022-1'
CATEGORIES = {
    'Контейнера': ('konteynery', 'Контейнеры для еды'),
    'Одноразовая посуда': ('odnorazovaya-posuda', 'Одноразовая посуда'),
    'Пакеты/Фасовка': ('pakety-fasovka', 'Пакеты и фасовка'),
    'Бумажная продукция': ('bumazhnaya-produktsiya', 'Бумажная продукция'),
    'Бытовая химия': ('bytovaya-himiya', 'Бытовая химия'),
    'Мусорные мешки': ('musornye-meshki', 'Мешки для мусора'),
    'Прочее': ('hoztovary', 'Хозяйственные товары'),
}
e = lambda s: escape(str(s), quote=True)
jd = lambda o: json.dumps(o, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
def positions(n):
    noun = 'позиция' if n % 10 == 1 and n % 100 != 11 else 'позиции' if n % 10 in [2,3,4] and n % 100 not in [12,13,14] else 'позиций'
    return f'{n} {noun}'

money = lambda p: f'{float(p):,.2f}'.replace(',', ' ').replace('.', ',') + ' ₽'
data = json.loads((ROOT / 'products.json').read_text())
assert set(p['category'] for p in data) == set(CATEGORIES)
used_keys = set()
paths = {}
for i, p in enumerate(data):
    key = str(p.get('id') or p.get('slug') or p['name'])
    if key in used_keys:
        key += '::' + p['image']
    if key in used_keys:
        key += '::' + str(i)
    used_keys.add(key)
    p['_key'] = key
    p['_page'] = 'products/p-' + sha256((key + '\0' + p['image']).encode()).hexdigest()[:16] + '.html'
    paths[p['name'] + '|' + p['image']] = p['_page']
assert len({p['_page'] for p in data}) == len(data)
seo_data = {'products': paths, 'categories': {c: 'categories/' + slug + '.html' for c, (slug, title) in CATEGORIES.items()}}
(ROOT / 'seo-data.js').write_text('window.URMANI_SEO=' + jd(seo_data) + ';\n')

catalog = (ROOT / 'catalog.html').read_text()
symbols = re.search(r'<svg xmlns=.*?</svg>', catalog, re.S)[0]
header = re.search(r'<header class="site-header">.*?</header>', catalog, re.S)[0]
header = re.sub(r'<button class="btn btn-primary header-request".*?</button>', '<a class="btn btn-primary header-request" href="catalog.html?request=1">Моя заявка <b class="cart-count">0</b></a>', header, flags=re.S)
footer = re.search(r'<footer class="site-footer">.*?</footer>', catalog, re.S)[0]
organization = {'@context': 'https://schema.org', '@type': 'Organization', '@id': ORIGIN + '/#organization', 'name': 'Юрмани', 'url': ORIGIN + '/', 'telephone': '+79515344480', 'email': 'union161@yandex.ru', 'address': {'@type': 'PostalAddress', 'streetAddress': 'ул. Пороховая Балка, 15а, офис 1', 'addressLocality': 'Аксай', 'addressRegion': 'Ростовская область', 'addressCountry': 'RU'}}


def crumbs(items):
    body = '<nav class="breadcrumbs seo-breadcrumbs" aria-label="Хлебные крошки">' + ''.join((f'<a href="{e(path)}">{e(label)}</a>' if path else f'<span aria-current="page">{e(label)}</span>') + ('<span aria-hidden="true">/</span>' if i < len(items)-1 else '') for i, (label, path) in enumerate(items)) + '</nav>'
    schema = {'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [{'@type': 'ListItem', 'position': i+1, 'name': label, **({'item': ORIGIN + '/' + path} if path else {})} for i, (label, path) in enumerate(items)]}
    return body, schema


def document(path, title, description, body, schemas=(), image='images/og-image.jpg'):
    absolute = ORIGIN + '/' + path
    return f'''<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="../"><title>{e(title)}</title><meta name="description" content="{e(description)}"><link rel="canonical" href="{e(absolute)}"><meta name="robots" content="index,follow"><meta property="og:type" content="website"><meta property="og:title" content="{e(title)}"><meta property="og:description" content="{e(description)}"><meta property="og:url" content="{e(absolute)}"><meta property="og:image" content="{e(ORIGIN + '/' + quote(image))}"><meta property="og:locale" content="ru_RU"><meta name="theme-color" content="#162a4c"><link rel="icon" href="favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="catalog.css?v={VERSION}"><link rel="stylesheet" href="seo-pages.css?v={VERSION}">{''.join('<script type="application/ld+json">'+jd(s)+'</script>' for s in schemas)}<script src="product-page.js?v={VERSION}" defer></script></head><body>{symbols}<a class="skip-link" href="#page-main">Перейти к содержимому</a><div class="utility"><div class="wrap"><span>Ростов-на-Дону и Ростовская область</span><a href="index.html#delivery">Доставка от 3 000 ₽ бесплатно</a></div></div>{header}<main id="page-main" class="wrap seo-main">{body}</main>{footer}<div id="seo-status" role="status" aria-live="polite"></div></body></html>'''


def product_card(p):
    return f'<article class="product"><a class="product-photo" href="{e(p["_page"])}"><img src="{e(p["image"])}" alt="{e(p["name"])}" width="400" height="400" loading="lazy" decoding="async"></a><div class="product-body"><div class="category">{e(CATEGORIES[p["category"]][1])}</div><h3><a href="{e(p["_page"])}">{e(p["name"])}</a></h3><div class="price">{money(p["price"])}</div><p class="price-caption">Цена по каталогу. Единицу продажи уточнит менеджер.</p><a class="btn btn-outline" href="{e(p["_page"])}">Подробнее и в заявку</a></div></article>'


generated = []
def save(path, html):
    p = ROOT / path
    p.parent.mkdir(exist_ok=True, parents=True)
    p.write_text(html)
    generated.append(path)


for p in data:
    cat_slug, cat_title = CATEGORIES[p['category']]
    cat_path = f'categories/{cat_slug}.html'
    breadcrumb, schema = crumbs([('Главная', 'index.html'), ('Каталог', 'categories/index.html'), (cat_title, cat_path), (p['name'], '')])
    desc = f'{p["name"]}. {cat_title} в Юрмани. Цена по каталогу {money(p["price"])}. Единицу продажи, фасовку, наличие и доставку уточнит менеджер.'
    product_schema = {'@context': 'https://schema.org', '@type': 'Product', 'name': p['name'], 'image': ORIGIN + '/' + quote(p['image']), 'url': ORIGIN + '/' + p['_page'], 'category': cat_title, 'description': desc}
    # No invented stock, ratings, retail units or Google merchant Offer claims.
    payload = {k: p[k] for k in ['_key', 'name', 'price', 'image']}
    body = f'''{breadcrumb}<section class="seo-product" aria-labelledby="product-title"><div class="seo-photo"><img src="{e(p['image'])}" alt="{e(p['name'])}" width="640" height="640" fetchpriority="high"></div><div class="seo-copy"><p class="eyebrow">{e(cat_title)}</p><h1 id="product-title">{e(p['name'])}</h1><p class="seo-price">{money(p['price'])}</p><p class="seo-price-note">Цена по каталогу. Единицу продажи, фасовку и наличие подтвердит менеджер.</p><form id="seo-add-form"><label for="seo-quantity">Количество для заявки</label><div class="seo-actions"><input id="seo-quantity" type="number" min="1" max="999999" step="1" inputmode="numeric" value="1" required><button type="submit" class="btn btn-primary" id="seo-add-button">Добавить в заявку</button></div></form><p id="seo-add-status" role="status" aria-live="polite"></p><a class="btn btn-outline" href="catalog.html?request=1">Открыть мою заявку →</a><p class="seo-contact">Нужно уточнить характеристики?<br><a href="https://max.ru/u/f9LHodD0cOLaHA3tCZoG0DjXYAP4ytX60VM6HWRPrIgbrQ4GWo4Pu-tjIyA" target="_blank" rel="noopener noreferrer">Написать в MAX ↗</a> · <a href="tel:+79515344480">Позвонить</a></p><details><summary>Полное наименование из прайса</summary><p>{e(p['name'])}</p></details></div></section><section class="seo-delivery"><h2>Заказ и доставка</h2><p>Добавьте товар в заявку. Менеджер подтвердит единицы продажи, итоговую сумму, наличие и дату поставки. По Ростову-на-Дону и области доставка от 3 000 ₽ бесплатна; маршрут согласуем при подтверждении.</p><a class="text-button" href="{e(cat_path)}">Все товары: {e(cat_title)} →</a></section><script id="seo-product-data" type="application/json">{jd(payload)}</script><noscript><p>Для добавления в заявку включите JavaScript или позвоните: <a href="tel:+79515344480">+7 (951) 534-44-80</a>.</p></noscript>'''
    save(p['_page'], document(p['_page'], p['name'] + ' — Юрмани, Ростов-на-Дону', desc, body, [product_schema, schema], p['image']))

for c, (slug, title) in CATEGORIES.items():
    items = [p for p in data if p['category'] == c]
    pages = (len(items) + 47) // 48
    for page in range(pages):
        path = f'categories/{slug}' + (f'-{page+1}' if page else '') + '.html'
        heading = title + (f' — страница {page+1}' if page else '')
        breadcrumb, schema = crumbs([('Главная', 'index.html'), ('Каталог', 'categories/index.html'), (heading, '')])
        shown = items[page*48:(page+1)*48]
        description = f'{title}: {positions(len(items))} в каталоге Юрмани. Цены из прайса, заявка менеджеру, доставка по Ростову-на-Дону и Ростовской области.' + (f' Страница {page+1}.' if page else '')
        pagination = '<nav class="seo-pagination" aria-label="Страницы категории">' + ''.join(f'<a href="categories/{slug}{"-"+str(i+1) if i else ""}.html"' + (' aria-current="page"' if i == page else '') + f'>{i+1}</a>' for i in range(pages)) + '</nav>'
        body = f'{breadcrumb}<section class="seo-category-intro"><p class="eyebrow">Ассортимент Юрмани</p><h1>{e(heading)}</h1><p>{e(description)}</p><a class="btn btn-primary" href="catalog.html?{e(urlencode({"category":c}))}">Поиск и фильтры в этом разделе →</a></section><p class="catalog-note">Единицу цены, фасовку и наличие подтвердит менеджер.</p><div class="product-grid">'+''.join(product_card(p) for p in shown)+'</div>'+pagination
        itemlist = {'@context': 'https://schema.org', '@type': 'ItemList', 'name': heading, 'itemListElement': [{'@type': 'ListItem', 'position': page*48+i+1, 'url': ORIGIN+'/'+p['_page'], 'name': p['name']} for i, p in enumerate(shown)]}
        save(path, document(path, heading + ' — каталог Юрмани', description, body, [schema, itemlist]))

breadcrumb, schema = crumbs([('Главная', 'index.html'), ('Разделы каталога', '')])
counts = Counter(p['category'] for p in data)
body = breadcrumb + '<section class="seo-category-intro"><h1>Разделы каталога Юрмани</h1><p>Упаковка, одноразовая посуда и расходные материалы для бизнеса в Ростове-на-Дону и области.</p><a class="btn btn-primary" href="catalog.html">Открыть каталог с поиском →</a></section><div class="seo-category-grid">'
for c, (slug, title) in CATEGORIES.items():
    first = next(p for p in data if p['category'] == c)
    body += f'<a class="seo-category-link" href="categories/{slug}.html"><img src="{e(first["image"])}" alt="" width="120" height="120" loading="lazy"><strong>{e(title)}</strong><span>{positions(counts[c])} →</span></a>'
body += '</div>'
save('categories/index.html', document('categories/index.html', 'Разделы каталога — Юрмани, Ростов-на-Дону', 'Все разделы каталога Юрмани: контейнеры, посуда, пакеты, бытовая химия, бумажная продукция и хозяйственные товары.', body, [schema]))

# Source pages: canonical, company data, crawlable category/product links.
p = ROOT / 'index.html'
home = p.read_text()
home = re.sub(r'<script type="application/ld\+json" id="seo-company">.*?</script>', '', home, flags=re.S)
home = home.replace('</head>', '<script type="application/ld+json" id="seo-company">'+jd(organization)+'</script></head>')
home = home.replace('<h1>Упаковка, посуда<br><span>и расходные материалы для бизнеса</span></h1>', '<h1>Всё нужное.<br><span>В одной поставке.</span></h1>')
for c, path in seo_data['categories'].items():
    home = home.replace('href="catalog.html?'+e(urlencode({'category':c}))+'"', 'href="'+path+'"')
# Server-visible featured cards are already in HTML. Their links follow the image identity.
def feature_link(match):
    block = match[0]
    img = re.search(r'src="home-assets/([^"]+)"', block)
    if img:
        product = next((p for p in data if p['image'].split('/')[-1] == img[1]), None)
        if product: block = re.sub(r'href="[^"]+"', 'href="'+product['_page']+'"', block, count=1)
    return block
home = re.sub(r'<a class="home-product".*?</a>', feature_link, home, flags=re.S)
home = re.sub(r'<script src="seo-data.js[^"<]*" defer></script>', '', home)
home = home.replace('<script src="home-data.js"', '<script src="seo-data.js?v='+VERSION+'" defer></script><script src="home-data.js"')
home = re.sub(r'src="home.js(?:\?[^"]*)?"', 'src="home.js?v='+VERSION+'"', home)
p.write_text(home)

catalog = (ROOT/'catalog.html').read_text()
catalog = re.sub(r'<script type="application/ld\+json" id="seo-company">.*?</script>', '', catalog, flags=re.S)
catalog = catalog.replace('</head>', '<script type="application/ld+json" id="seo-company">'+jd(organization)+'</script></head>')
if 'id="seo-categories-link"' not in catalog:
    catalog = catalog.replace('<a href="price.pdf" class="price-download"', '<a id="seo-categories-link" href="categories/index.html" class="price-download"><strong>Все разделы каталога →</strong></a><a href="price.pdf" class="price-download"')
catalog = re.sub(r'<script src="seo-data.js[^"<]*" defer></script>', '', catalog)
catalog = re.sub(r'<script src="catalog.js[^"<]*" defer></script>', '<script src="seo-data.js?v='+VERSION+'" defer></script><script src="catalog.js?v='+VERSION+'" defer></script>', catalog)
if '<meta property="og:title"' not in catalog:
    catalog = catalog.replace('</head>', '<meta property="og:type" content="website"><meta property="og:title" content="Каталог упаковки и посуды — Юрмани"><meta property="og:description" content="Подбор товаров для бизнеса, цены по прайсу и заявка менеджеру."><meta property="og:url" content="'+ORIGIN+'/catalog.html"><meta property="og:image" content="'+ORIGIN+'/images/og-image.jpg"></head>')
(ROOT/'catalog.html').write_text(catalog)

# A real error page: do not redirect unknown URLs into a soft-404 catalog.
(ROOT/'404.html').write_text(fr'<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>Страница не найдена — Юрмани</title></head><body style="font:18px/1.6 Arial;max-width:650px;margin:12vh auto;padding:24px;color:#162a4c"><h1>Страница не найдена</h1><p>Возможно, ссылка устарела. Найдите товар в каталоге или обратитесь к менеджеру.</p><p><a href="/catalog.html">Открыть каталог</a> · <a href="/">На главную</a> · <a href="tel:+79515344480">+7 (951) 534-44-80</a></p><script>const legacy=location.pathname.match(/^\/catalog\/([^/?#]+)\/?$/);if(legacy){{try{{location.replace("/catalog.html?product="+encodeURIComponent(decodeURIComponent(legacy[1])));}}catch{{}}}}</script></body></html>')
urls = ['','catalog.html'] + generated
namespace = 'http://www.sitemaps.org/schemas/sitemap/0.9'
ET.register_namespace('', namespace)
xml = ET.Element('{'+namespace+'}urlset')
for path in urls:
    u = ET.SubElement(xml, '{'+namespace+'}url')
    ET.SubElement(u, '{'+namespace+'}loc').text = ORIGIN+'/'+path
    ET.SubElement(u, '{'+namespace+'}lastmod').text = date.today().isoformat()
ET.indent(xml)
(ROOT/'sitemap.xml').write_bytes(ET.tostring(xml, encoding='utf-8', xml_declaration=True))
(ROOT/'robots.txt').write_text('User-agent: *\nAllow: /\n\nSitemap: '+ORIGIN+'/sitemap.xml\n')
(ROOT/'.nojekyll').touch()
print(json.dumps({'products':len(data),'category_pages':len(generated)-len(data),'sitemap_urls':len(urls)}, ensure_ascii=False))
