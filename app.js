import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, signInAnonymously, onAuthStateChanged, signInWithEmailAndPassword, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getDatabase, ref, onValue, push, update, set, runTransaction, serverTimestamp,
  query, orderByChild, limitToLast,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';
import {
  normalizeBody, gameMsFromReal, formatGameTime, gameDateStr, parseGameTime,
  makeIdStr, parseBodyTokens,
} from './lib.js';

const $ = (id) => document.getElementById(id);

let db = null;
let auth = null;
let meta = null;
let currentLoopId = null;
let summaries = {};
let currentTid = null;
let currentPosts = [];
let isGM = false;
let unsubSummaries = null;
let unsubThread = null;
let authStarted = false;

function fatal(msg) {
  $('fatal').textContent = msg;
  $('fatal').hidden = false;
}

function isConfigured(config) {
  return Boolean(
    config?.apiKey && config.apiKey !== 'REPLACE_ME'
    && config?.projectId && config.projectId !== 'REPLACE_ME'
    && config?.databaseURL && !config.databaseURL.includes('REPLACE_ME'),
  );
}

function startFirebase() {
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getDatabase(app);
  } catch (e) {
    fatal('連線設定錯誤：' + e.message);
    return;
  }

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      isGM = false;
      $('gm-panel').hidden = true;
      signInAnonymously(auth).catch((e) => fatal('登入失敗：' + e.message));
      return;
    }
    isGM = !user.isAnonymous;
    $('gm-panel').hidden = !isGM;
    if (isGM) $('gm-login').hidden = true;
    if (!authStarted) {
      authStarted = true;
      startMetaListener();
      startConnectionBanner();
    }
    route();
  });
}

// ---- localSeed（spec §5.2）----
function getLocalSeed() {
  let s = localStorage.getItem('ginkaSeed');
  if (!s) {
    const buf = crypto.getRandomValues(new Uint8Array(16));
    s = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('ginkaSeed', s);
  }
  return s;
}

// ---- /meta listener ＋ loopId gate（spec §5.7 兩道防線之「重掛」）----
function startMetaListener() {
  onValue(ref(db, 'meta'), (snap) => {
    meta = snap.val();
    const loopId = meta?.loopId ?? null;
    if (loopId !== currentLoopId) {
      currentLoopId = loopId;
      resetLocalState();
    }
    renderBoard();
    if (currentTid && currentPosts.length) renderPosts(currentTid, currentPosts);
  }, (err) => fatal('讀取失敗：' + err.message));
}

function resetLocalState() {
  if (unsubSummaries) {
    unsubSummaries();
    unsubSummaries = null;
  }
  if (unsubThread) {
    unsubThread();
    unsubThread = null;
  }
  summaries = {};
  currentPosts = [];
  $('thread-list').textContent = '';
  $('posts').textContent = '';
  if (currentLoopId !== null) listenSummaries();
  route();
}

function listenSummaries() {
  unsubSummaries = onValue(ref(db, 'threadSummaries'), (snap) => {
    summaries = snap.val() || {};
    renderBoard();
    if (currentTid) $('thread-title').textContent = summaries[currentTid]?.title ?? '';
  }, (err) => fatal('讀取失敗：' + err.message));
}

// ---- 斷線顯示（spec §5.8）----
function startConnectionBanner() {
  onValue(ref(db, '.info/connected'), (snap) => {
    const ok = snap.val() === true;
    $('banner').textContent = ok ? '' : '板娘維護中…（連線中斷，恢復後自動更新）';
    $('banner').hidden = ok;
  });
}

// ---- 板首渲染 ----
const STATUS_MARK = { pinned: '[推]', sunk: '[沉]' };

function renderBoard() {
  const list = $('thread-list');
  list.textContent = '';
  if (!db) {
    const p = document.createElement('p');
    p.className = 'dim';
    p.textContent = 'Firebase 尚未設定。';
    list.appendChild(p);
    return;
  }
  if (meta === null) {
    const p = document.createElement('p');
    p.className = 'dim';
    p.textContent = '板娘準備中…（板尚未初始化）';
    list.appendChild(p);
    return;
  }
  const rank = { pinned: 0, normal: 1, sunk: 2 };
  const rows = Object.entries(summaries)
    .filter(([, s]) => s.loopId === currentLoopId)
    .sort(([, a], [, b]) =>
      (rank[a.status] ?? 1) - (rank[b.status] ?? 1)
      || (Number(b.lastUpdateAt) || 0) - (Number(a.lastUpdateAt) || 0));

  if (!rows.length) {
    const p = document.createElement('p');
    p.className = 'dim';
    p.textContent = '目前沒有傳聞。';
    list.appendChild(p);
    return;
  }

  rows.forEach(([tid, s], i) => {
    const row = document.createElement('div');
    row.className = 'thread-row';

    const no = document.createElement('span');
    no.className = 'num';
    no.textContent = `${i + 1}: `;
    row.appendChild(no);

    if (STATUS_MARK[s.status]) {
      const m = document.createElement('span');
      m.className = 'marker';
      m.textContent = STATUS_MARK[s.status] + ' ';
      row.appendChild(m);
    }

    const a = document.createElement('a');
    a.href = '#/t/' + tid;
    a.className = 'title';
    a.textContent = s.title;
    row.appendChild(a);

    const metaSpan = document.createElement('span');
    metaSpan.className = 'meta';
    const stamp = meta?.gameClock && s.lastUpdateAt
      ? formatGameTime(gameMsFromReal(Number(s.lastUpdateAt), meta.gameClock))
      : '';
    metaSpan.textContent = `（${s.postCount}） 最終更新 ${stamp}`;
    row.appendChild(metaSpan);
    list.appendChild(row);
  });
}

// ---- hash router ----
function showView(view) {
  $('board-view').hidden = view !== 'board';
  $('thread-view').hidden = view !== 'thread';
}

function route() {
  const h = location.hash;
  if (h.startsWith('#/t/')) {
    showView('thread');
    openThread(h.slice(4));
  } else if (h === '#gm') {
    if (!isGM) $('gm-login').hidden = false;
    showView('board');
  } else if (h === '' || h === '#') {
    showView('board');
    if (unsubThread) {
      unsubThread();
      unsubThread = null;
    }
    currentTid = null;
    currentPosts = [];
    $('posts').textContent = '';
  }
}
window.addEventListener('hashchange', route);

// ---- 串內 view ----
function openThread(tid) {
  currentTid = tid;
  if (unsubThread) unsubThread();
  $('thread-title').textContent = summaries[tid]?.title ?? '';
  currentPosts = [];
  $('posts').textContent = '';
  if (!db) return;

  const q = query(ref(db, 'threadPosts/' + tid), orderByChild('realTs'), limitToLast(200));
  unsubThread = onValue(q, (snap) => {
    const posts = [];
    snap.forEach((c) => {
      posts.push({ key: c.key, ...c.val() });
    });
    currentPosts = posts;
    $('thread-title').textContent = summaries[tid]?.title ?? '';
    renderPosts(tid, posts);
  }, (err) => fatal('讀取失敗：' + err.message));
}

function renderPosts(tid, posts) {
  const wrap = $('posts');
  wrap.textContent = '';
  posts
    .filter((p) => p.loopId === currentLoopId)
    .sort((a, b) => a.displayNo - b.displayNo || a.realTs - b.realTs)
    .forEach((p) => wrap.appendChild(renderPost(tid, p)));
}

const TOMB = 'あぼーん';

function renderPost(tid, p) {
  const div = document.createElement('div');
  div.className = 'post';
  div.id = 'p' + p.displayNo;

  const head = document.createElement('div');
  head.className = 'post-head';
  div.appendChild(head);

  const isTomb = p.name === TOMB && p.body === TOMB;
  if (isTomb) {
    div.classList.add('aborn');
    head.textContent = `${p.displayNo} ${TOMB}`;
    const body = document.createElement('div');
    body.className = 'post-body';
    body.textContent = TOMB;
    div.appendChild(body);
    return div;
  }

  const no = document.createElement('span');
  no.className = 'no';
  no.textContent = String(p.displayNo) + ' ';

  const label = document.createTextNode('名前：');

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = p.mail ? `${p.name}[${p.mail}]` : p.name;

  const stamp = document.createElement('span');
  stamp.className = 'stamp';
  const timeStr = meta?.gameClock && p.realTs
    ? formatGameTime(gameMsFromReal(Number(p.realTs), meta.gameClock))
    : '';
  stamp.textContent = `  ${timeStr}  ID:${p.idStr}`;
  head.append(no, label, name, stamp);

  if (isGM) head.appendChild(makeDeleteButton(tid, p.key));

  const body = document.createElement('div');
  body.className = 'post-body';
  String(p.body ?? '').split('\n').forEach((line, i) => {
    if (i > 0) body.appendChild(document.createElement('br'));
    for (const tok of parseBodyTokens(line)) {
      if (tok.t === 'anchor') {
        const a = document.createElement('a');
        a.href = '#p' + tok.n;
        a.textContent = '>>' + tok.n;
        body.appendChild(a);
      } else {
        body.appendChild(document.createTextNode(tok.v));
      }
    }
  });
  div.appendChild(body);
  return div;
}

// ---- 二段確認按鈕（刪文／重置共用；不用原生 confirm）----
function makeArmedHandler(btn, label, fn) {
  let timer = null;
  btn.addEventListener('click', () => {
    if (btn.dataset.armed === '1') {
      clearTimeout(timer);
      btn.dataset.armed = '';
      btn.textContent = label;
      fn();
    } else {
      btn.dataset.armed = '1';
      btn.textContent = '再按一次確認';
      timer = setTimeout(() => {
        btn.dataset.armed = '';
        btn.textContent = label;
      }, 3000);
    }
  });
}

function makeDeleteButton(tid, postKey) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'gm-del';
  btn.textContent = '刪除';
  makeArmedHandler(btn, '刪除', () => deletePost(tid, postKey));
  return btn;
}

async function deletePost(tid, postKey) {
  try {
    await update(ref(db, `threadPosts/${tid}/${postKey}`), {
      name: TOMB,
      mail: '',
      body: TOMB,
      idStr: '???',
    });
  } catch (err) {
    gmMsg('刪文失敗：' + err.message);
  }
}

function gmMsg(text) {
  $('gm-msg').textContent = text;
  setTimeout(() => {
    $('gm-msg').textContent = '';
  }, 5000);
}

// ---- 發文共用 ----
function showFormError(el, msg) {
  el.textContent = msg;
  setTimeout(() => {
    el.textContent = '';
  }, 5000);
}

function currentGameDateStr() {
  if (!meta?.gameClock) throw new Error('遊戲內時鐘尚未設定');
  return gameDateStr(gameMsFromReal(Date.now(), meta.gameClock));
}

async function buildIdStr() {
  const custom = isGM ? $('gm-custom-id').value.trim() : '';
  if (custom) return custom.slice(0, 12);
  return makeIdStr(getLocalSeed(), currentLoopId, currentGameDateStr());
}

$('reply-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('reply-error');
  if (!db) return showFormError(errEl, 'Firebase 尚未設定');
  if (!currentTid || meta === null) return showFormError(errEl, '板尚未初始化');

  const name = $('reply-name').value.trim() || '無名氏';
  const mail = $('reply-mail').value.trim();
  const body = normalizeBody($('reply-body').value).replace(/^\n+|\n+$/g, '');
  if (!body) return showFormError(errEl, '請輸入內容');

  try {
    const idStr = await buildIdStr();
    const tx = await runTransaction(
      ref(db, `threadSummaries/${currentTid}/postCount`),
      (n) => (n ?? 0) + 1,
    );
    if (!tx.committed) throw new Error('樓號分配失敗');
    const displayNo = tx.snapshot.val();
    const postKey = push(ref(db, `threadPosts/${currentTid}`)).key;
    await update(ref(db), {
      [`threadPosts/${currentTid}/${postKey}`]: {
        displayNo,
        name,
        mail,
        body,
        idStr,
        realTs: serverTimestamp(),
        loopId: currentLoopId,
      },
      [`threadSummaries/${currentTid}/lastUpdateAt`]: serverTimestamp(),
    });
    $('reply-body').value = '';
    $('reply-mail').value = '';
  } catch (err) {
    showFormError(errEl, '書き込み失敗：' + err.message);
  }
});

$('new-thread-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('nt-error');
  if (!db) return showFormError(errEl, 'Firebase 尚未設定');
  if (meta === null) return showFormError(errEl, '板尚未初始化');

  const title = $('nt-title').value.trim();
  const name = $('nt-name').value.trim() || '無名氏';
  const mail = $('nt-mail').value.trim();
  const body = normalizeBody($('nt-body').value).replace(/^\n+|\n+$/g, '');
  if (!title || !body) return showFormError(errEl, '標題與內容必填');

  try {
    const idStr = await buildIdStr();
    const tid = push(ref(db, 'threadSummaries')).key;
    const postKey = push(ref(db, `threadPosts/${tid}`)).key;
    await update(ref(db), {
      [`threadSummaries/${tid}`]: {
        title,
        status: 'normal',
        postCount: 1,
        lastUpdateAt: serverTimestamp(),
        loopId: currentLoopId,
      },
      [`threadPosts/${tid}/${postKey}`]: {
        displayNo: 1,
        name,
        mail,
        body,
        idStr,
        realTs: serverTimestamp(),
        loopId: currentLoopId,
      },
    });
    $('nt-title').value = '';
    $('nt-body').value = '';
    location.hash = '#/t/' + tid;
  } catch (err) {
    showFormError(errEl, '建立失敗：' + err.message);
  }
});

// ============ GM 後台（spec §5.5）============
$('gm-login-btn').addEventListener('click', async () => {
  if (!auth) return showFormError($('gm-login-error'), 'Firebase 尚未設定');
  try {
    await signInWithEmailAndPassword(auth, $('gm-email').value.trim(), $('gm-password').value);
    $('gm-password').value = '';
    location.hash = '';
  } catch (err) {
    showFormError($('gm-login-error'), '登入失敗：' + err.message);
  }
});

$('gm-logout').addEventListener('click', () => {
  if (auth) signOut(auth);
});

$('gm-reroll').addEventListener('click', () => {
  localStorage.removeItem('ginkaSeed');
  getLocalSeed();
  gmMsg('ID seed 已重 roll（下一則貼文起生效）');
});

$('preset-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.version !== 1 || !Array.isArray(data.groups)) {
      throw new Error('格式不符（需 version:1 與 groups 陣列）');
    }
    localStorage.setItem('gmPresets', JSON.stringify(data));
    renderPresets();
    gmMsg(`已匯入 ${data.groups.length} 組 preset`);
  } catch (err) {
    gmMsg('匯入失敗：' + err.message);
  } finally {
    e.target.value = '';
  }
});

$('preset-clear').addEventListener('click', () => {
  localStorage.removeItem('gmPresets');
  renderPresets();
});

function renderPresets() {
  const wrap = $('preset-list');
  wrap.textContent = '';
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem('gmPresets') || 'null');
  } catch {
    localStorage.removeItem('gmPresets');
  }
  if (!data) return;

  for (const group of data.groups || []) {
    const det = document.createElement('details');
    det.className = 'preset-group';

    const sum = document.createElement('summary');
    sum.textContent = group.topic;
    det.appendChild(sum);

    for (const r of group.replies || []) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `[${r.depth}] ${r.label}`;
      btn.addEventListener('click', () => {
        $('reply-name').value = r.name || '無名氏';
        $('reply-body').value = r.body || '';
        $('reply-body').focus();
      });
      det.appendChild(btn);
    }
    wrap.appendChild(det);
  }
}

$('gm-set-clock').addEventListener('click', async () => {
  if (!db) return gmMsg('Firebase 尚未設定');
  try {
    const gameBaseMs = parseGameTime($('gm-clock').value);
    await update(ref(db), {
      'meta/gameClock': { gameBaseMs, realBaseServerMs: serverTimestamp() },
    });
    gmMsg('時鐘已設定（全板顯示時間整體平移）');
  } catch (err) {
    gmMsg('設定失敗：' + err.message);
  }
});

async function setThreadStatus(status) {
  if (!db) return gmMsg('Firebase 尚未設定');
  if (!currentTid) return gmMsg('請先進入要操作的串');
  try {
    await set(ref(db, `threadSummaries/${currentTid}/status`), status);
  } catch (err) {
    gmMsg('操作失敗：' + err.message);
  }
}

$('gm-sink').addEventListener('click', () => setThreadStatus('sunk'));
$('gm-pin').addEventListener('click', () => setThreadStatus('pinned'));
$('gm-unmark').addEventListener('click', () => setThreadStatus('normal'));

makeArmedHandler($('gm-reset'), 'LOOP 重置（恢復種子狀態）', loopReset);

async function loopReset() {
  if (!db) return gmMsg('Firebase 尚未設定');
  try {
    const res = await fetch(`./seed.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('seed.json 載入失敗 HTTP ' + res.status);
    const seed = await res.json();
    const newLoopId = (meta?.loopId ?? 0) + 1;
    const gameBaseMs = parseGameTime($('gm-clock').value || seed.gameNow);
    const nowMs = Date.now();
    const summariesObj = {};
    const postsObj = {};

    for (const t of seed.threads) {
      const posts = {};
      let lastTs = 0;
      t.posts.forEach((p, i) => {
        const realTs = nowMs + (parseGameTime(p.gameTime) - gameBaseMs);
        lastTs = Math.max(lastTs, realTs);
        posts['p' + String(i + 1).padStart(3, '0')] = {
          displayNo: i + 1,
          name: p.name,
          mail: p.mail || '',
          body: p.body,
          idStr: p.idStr,
          realTs,
          loopId: newLoopId,
        };
      });
      summariesObj[t.tid] = {
        title: t.title,
        status: t.status || 'normal',
        postCount: t.posts.length,
        lastUpdateAt: lastTs,
        loopId: newLoopId,
      };
      postsObj[t.tid] = posts;
    }

    await update(ref(db), {
      'meta/loopId': newLoopId,
      'meta/gameClock': { gameBaseMs, realBaseServerMs: serverTimestamp() },
      threadSummaries: summariesObj,
      threadPosts: postsObj,
    });
    location.hash = '';
    gmMsg(`LOOP ${newLoopId} 開始`);
  } catch (err) {
    gmMsg('重置失敗：' + err.message);
  }
}

renderBoard();
renderPresets();
route();

if (isConfigured(firebaseConfig)) {
  startFirebase();
} else {
  fatal('Firebase 尚未設定：請填寫 firebase-config.js 後重新整理。');
}
