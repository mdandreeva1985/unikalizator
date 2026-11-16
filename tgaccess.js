// Доступ без кода — через Telegram-бот @Marya_andreeva_Bot.
// В Telegram (мини-апп): просим у сервера одноразовый пропуск и открываем приложение в браузере.
// В браузере: обмениваем пропуск (#pass=…) на доступ для этого устройства и запоминаем его.
// Один и тот же файл лежит в обоих приложениях (Easy Reels и Уникализатор).
export const API = 'https://apps-access.easy-reels-bot.workers.dev';
export const BOT = 'Marya_andreeva_Bot';

const post = (path, body) => fetch(API + path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json()).catch(() => ({ ok: false, error: 'network' }));

// данные запуска из Telegram (Telegram добавляет их в адрес: #tgWebAppData=…)
export function tgInitData() {
  const h = new URLSearchParams(location.hash.slice(1));
  return h.get('tgWebAppData') || '';
}
// Команды Telegram напрямую, без скрипта с telegram.org (он часто медленно грузится или не грузится в России)
function postEvent(type, data = {}) {
  try {
    if (window.TelegramWebviewProxy?.postEvent) return window.TelegramWebviewProxy.postEvent(type, JSON.stringify(data));
    if (window.external?.notify) return window.external.notify(JSON.stringify({ eventType: type, eventData: data }));
    window.parent.postMessage(JSON.stringify({ eventType: type, eventData: data }), '*');
  } catch {}
}
export const tg = {
  ready: () => postEvent('web_app_ready'),
  expand: () => postEvent('web_app_expand'),
  close: () => postEvent('web_app_close'),
  openLink: (url) => postEvent('web_app_open_link', { url }),
  openTelegramLink: (url) => postEvent('web_app_open_tg_link', { path_full: url.replace(/^https:\/\/t\.me/, '') }),
};
const loadTelegram = async () => tg;

// экран поверх приложения (внутри Telegram)
function screen({ title, text, button, onClick, link }) {
  let el = document.getElementById('tgScreen');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tgScreen';
    el.style.cssText = 'position:fixed;inset:0;z-index:100;display:grid;place-items:center;padding:24px 18px;background:var(--bg,#fff);color:var(--ink,#111);font-family:inherit;text-align:center';
    document.body.appendChild(el);
  }
  el.innerHTML = `<div style="max-width:420px;display:flex;flex-direction:column;gap:14px">
    <b style="font-size:24px">${title}</b>
    <p style="margin:0;opacity:.75;line-height:1.45">${text}</p>
    ${button ? `<button type="button" id="tgScreenBtn" style="height:56px;border:0;border-radius:18px;font:700 17px inherit;color:#fff;background:linear-gradient(90deg,var(--a1,#b22349),var(--a2,#d4466a))">${button}</button>` : ''}
    ${link ? `<a href="${link.href}" style="color:inherit;opacity:.7">${link.text}</a>` : ''}
  </div>`;
  if (button) document.getElementById('tgScreenBtn').onclick = onClick;
}

// Внутри Telegram. Возвращает true, если приложение открыто как мини-апп (дальше его не запускаем).
export async function runInTelegram({ product, name, price, about }) {
  const initData = tgInitData();
  if (!initData) return false;
  screen({ title: name, text: 'Открываем приложение…' });
  const tg = await loadTelegram();
  tg.ready(); tg.expand();
  const r = await post('/pass', { initData, product });
  if (r.ok) {
    const open = () => tg.openLink(r.url);
    screen({
      title: name,
      text: 'Приложение откроется в браузере — там ролики сохраняются в галерею. Установите его на экран «Домой», и дальше открывайте прямо с иконки.',
      button: 'Открыть приложение', onClick: open,
    });
    open();
  } else if (r.error === 'not_bought') {
    screen({
      title: name, text: `${about}<br><br>Стоимость: <b>${price}</b> один раз и навсегда.`,
      button: `Купить ${name}`,
      onClick: () => { tg.openTelegramLink(`https://t.me/${BOT}?start=${product}`); setTimeout(() => tg.close(), 300); },
    });
  } else {
    screen({ title: name, text: r.error === 'network'
      ? 'Нет связи с сервером. Проверьте интернет и откройте приложение ещё раз.'
      : `Не получилось проверить доступ. Закройте и откройте приложение снова через бота @${BOT}.` });
  }
  return true;
}

// В браузере: пропуск из адреса → доступ на этом устройстве. Возвращает {token} или {error}.
export async function redeemPass({ product, kv, key }) {
  const p = new URLSearchParams(location.hash.slice(1)).get('pass');
  if (!p) return null;
  history.replaceState(null, '', location.pathname + location.search);   // пропуск одноразовый — убираем из адреса
  let device = (await kv.get('tg-device')).find((d) => /^[0-9a-f]{32}$/.test(d));
  if (!device) {
    device = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    await kv.set('tg-device', device);
  }
  const r = await post('/redeem', { pass: p, product, device });
  if (!r.ok) return { error: r.error };
  await kv.set(key, r.token);
  try { await navigator.storage?.persist?.(); } catch {}
  return { token: r.token };
}

// Сохранённый доступ этого устройства (без интернета — просто есть ли он).
export async function savedToken({ kv, key, product }) {
  const t = (await kv.get(key)).find((x) => new RegExp(`^\\d+\\.${product}\\.[0-9a-f]{32}\\.[0-9a-f]{64}$`).test(x));
  return t || null;
}
// Когда есть интернет — проверяем, что доступ не отозван (раз в сутки достаточно).
export async function recheck({ kv, key, token }) {
  if (!navigator.onLine) return true;
  const r = await post('/check', { token });
  if (r.ok || r.error === 'network' || r.error === 'server') return true;
  await kv.set(key, '');
  return false;
}

export const ERRORS = {
  devices: 'Доступ уже открыт на двух устройствах. Если сменили телефон, напишите @marya_andreeva — откроем доступ на новом.',
  used: 'Эта ссылка уже использована. Откройте приложение заново через бота — кнопкой «Открыть».',
  expired: 'Ссылка устарела. Откройте приложение заново через бота — кнопкой «Открыть».',
  bad_pass: 'Ссылка не подходит. Откройте приложение через бота — кнопкой «Открыть».',
  network: 'Нет интернета. Подключитесь и откройте приложение снова через бота.',
};
