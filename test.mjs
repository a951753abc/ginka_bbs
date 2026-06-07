import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';

globalThis.crypto ??= webcrypto;

import {
  normalizeBody, gameMsFromReal, formatGameTime, gameDateStr, parseGameTime,
  makeIdStr, parseBodyTokens,
} from './lib.js';

test('normalizeBody: CRLF/CR → LF', () => {
  assert.equal(normalizeBody('a\r\nb\rc\nd'), 'a\nb\nc\nd');
});

test('parseGameTime: "2002-01-12T15:23" → UTC ms', () => {
  assert.equal(parseGameTime('2002-01-12T15:23'), Date.UTC(2002, 0, 12, 15, 23));
  assert.throws(() => parseGameTime('2002/01/12 15:23'));
});

test('時鐘推導：gameBase 02/01/13 19:00、real 過 165 分 → 02/01/13(日) 21:45', () => {
  const clock = { gameBaseMs: Date.UTC(2002, 0, 13, 19, 0), realBaseServerMs: 1_000_000 };
  const gameMs = gameMsFromReal(1_000_000 + 165 * 60_000, clock);
  assert.equal(formatGameTime(gameMs), '02/01/13(日) 21:45');
  assert.equal(gameDateStr(gameMs), '02/01/13');
});

test('時鐘推導：跨日 → 02/01/14(一)、gameDateStr 換日', () => {
  const clock = { gameBaseMs: Date.UTC(2002, 0, 13, 19, 0), realBaseServerMs: 0 };
  const gameMs = gameMsFromReal(6 * 3600_000, clock);
  assert.equal(formatGameTime(gameMs), '02/01/14(一) 01:00');
  assert.equal(gameDateStr(gameMs), '02/01/14');
});

test('時鐘推導：realTs 早於基準（seed 倒推）→ 過去時刻', () => {
  const clock = { gameBaseMs: Date.UTC(2002, 0, 13, 19, 0), realBaseServerMs: 0 };
  assert.equal(formatGameTime(gameMsFromReal(-3600_000, clock)), '02/01/13(日) 18:00');
});

test('makeIdStr: 同 seed/loop/日 → 穩定同值；8 字元 base64url 無 padding', async () => {
  const a = await makeIdStr('seedhex', 3, '02/01/13');
  const b = await makeIdStr('seedhex', 3, '02/01/13');
  assert.equal(a, b);
  assert.equal(a.length, 8);
  assert.match(a, /^[A-Za-z0-9_-]{8}$/);
});

test('makeIdStr: 任一變因改變 → ID 改變', async () => {
  const base = await makeIdStr('seedhex', 3, '02/01/13');
  assert.notEqual(await makeIdStr('seedhe2', 3, '02/01/13'), base);
  assert.notEqual(await makeIdStr('seedhex', 4, '02/01/13'), base);
  assert.notEqual(await makeIdStr('seedhex', 3, '02/01/14'), base);
});

test('parseBodyTokens: 文字＋錨點混排', () => {
  assert.deepEqual(parseBodyTokens('>>1 同意\n還有>>23也是'), [
    { t: 'anchor', n: 1 },
    { t: 'text', v: ' 同意\n還有' },
    { t: 'anchor', n: 23 },
    { t: 'text', v: '也是' },
  ]);
});

test('parseBodyTokens: 純文字／全形＞＞／非錨點的 >', () => {
  assert.deepEqual(parseBodyTokens('沒有錨點'), [{ t: 'text', v: '沒有錨點' }]);
  assert.deepEqual(parseBodyTokens('＞＞5'), [{ t: 'anchor', n: 5 }]);
  assert.deepEqual(parseBodyTokens('> 引用文'), [{ t: 'text', v: '> 引用文' }]);
});

test('seed.json: 形狀與長度規範', async () => {
  const seed = JSON.parse(await readFile(new URL('./seed.json', import.meta.url), 'utf8'));
  const gameNow = parseGameTime(seed.gameNow);
  let totalPosts = 0;
  let sagePosts = 0;
  let anchorPosts = 0;
  let tombstones = 0;
  assert.ok(Array.isArray(seed.threads) && seed.threads.length >= 6);
  for (const t of seed.threads) {
    assert.ok(t.tid && /^[\w-]+$/.test(t.tid), t.tid);
    assert.ok(t.title.length <= 60, t.tid + ' title too long');
    assert.ok(['normal', 'sunk', 'pinned'].includes(t.status), t.tid);
    assert.ok(t.posts.length >= 1, t.tid);
    let prev = 0;
    for (const p of t.posts) {
      totalPosts += 1;
      if (p.mail === 'sage') sagePosts += 1;
      if (/(?:>>|＞＞)\d{1,4}/.test(p.body)) anchorPosts += 1;
      if (p.name === 'あぼーん' && p.body === 'あぼーん') tombstones += 1;
      assert.ok(p.name.length <= 30 && p.mail.length <= 30, t.tid);
      assert.ok(p.idStr.length <= 12, t.tid);
      assert.ok(p.body.length <= 1000 && !p.body.includes('\r'), t.tid);
      const ms = parseGameTime(p.gameTime);
      assert.ok(ms >= prev, t.tid + ' 貼文時間需遞增');
      assert.ok(ms <= gameNow, t.tid + ' 貼文時間不可晚於 gameNow');
      prev = ms;
    }
  }
  assert.ok(totalPosts >= 60 && totalPosts <= 80, 'seed 貼文量需像已有人使用');
  assert.ok(sagePosts >= 8, 'seed 需要足夠 sage 使用痕跡');
  assert.ok(anchorPosts >= 12, 'seed 需要足夠 >>n 引用痕跡');
  assert.ok(tombstones >= 1, 'seed 需要至少一則あぼーん痕跡');
});
