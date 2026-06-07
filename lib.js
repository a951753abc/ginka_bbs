// 純函式庫：browser 與 node 單測共用。不 import Firebase、不碰 DOM。

export function normalizeBody(text) {
  return text.replace(/\r\n?/g, '\n');
}

// ---- 遊戲內時鐘（spec §5.1 推導模型）----
// clock = /meta/gameClock = { gameBaseMs, realBaseServerMs }
export function gameMsFromReal(realTs, clock) {
  return clock.gameBaseMs + (realTs - clock.realBaseServerMs);
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const pad2 = (n) => String(n).padStart(2, '0');

// 遊戲時間無真實時區語意 → 一律 UTC getter，所有 client 顯示一致。
export function formatGameTime(gameMs) {
  const d = new Date(gameMs);
  return `${gameDateStr(gameMs)}(${WEEKDAYS[d.getUTCDay()]}) ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

export function gameDateStr(gameMs) {
  const d = new Date(gameMs);
  return `${pad2(d.getUTCFullYear() % 100)}/${pad2(d.getUTCMonth() + 1)}/${pad2(d.getUTCDate())}`;
}

// "2002-01-12T15:23"（datetime-local 與 seed.json 共用格式）→ UTC ms。
export function parseGameTime(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(str);
  if (!m) throw new Error('bad gameTime: ' + str);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

// ---- 每日 ID（spec §5.2）----
// idStr = base64url(SHA-256(localSeed + "\n" + loopId + "\n" + gameDateStr))[0:8]
export async function makeIdStr(localSeed, loopId, dateStr) {
  const data = new TextEncoder().encode(`${localSeed}\n${loopId}\n${dateStr}`);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  let bin = '';
  for (const b of hash) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 8);
}

// ---- `>>n` 引用解析（spec §4.1）----
// 回傳 token 陣列；渲染端把 anchor 換成 <a>、text 用 textContent（禁 innerHTML）。
export function parseBodyTokens(body) {
  const tokens = [];
  const re = /(?:>>|＞＞)(\d{1,4})/g;
  let last = 0;
  let m;
  while ((m = re.exec(body))) {
    if (m.index > last) tokens.push({ t: 'text', v: body.slice(last, m.index) });
    tokens.push({ t: 'anchor', n: +m[1] });
    last = m.index + m[0].length;
  }
  if (last < body.length) tokens.push({ t: 'text', v: body.slice(last) });
  return tokens;
}
