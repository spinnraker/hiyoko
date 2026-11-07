const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');

const DAY = '2026-11-07';

// Deterministic random numbers.
function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

// Play `rounds` rounds, answering every ask right (or using `answer`).
function play(state, day, rounds, rng = seeded(), answer = () => true) {
  const out = [];
  for (let k = 0; k < rounds; k++) {
    const r = E.buildRound(state, day, rng);
    E.recordMeet(state, r.meet, day);
    for (const b of r.beats) if (b.type === 'ask' || b.type === 'put') E.recordAsk(state, b, day, answer(b, r));
    out.push(r);
  }
  return out;
}

test('first round names two things, then asks about them', () => {
  const s = E.emptyState();
  const r = E.buildRound(s, DAY, seeded());
  assert.equal(r.objects.length, 2);
  assert.deepEqual(r.meet, ['neko', 'inu']);
  assert.deepEqual(r.beats.slice(0, 2).map((b) => b.type), ['show', 'show']);
  assert.ok(r.beats.slice(2).every((b) => b.type === 'ask' && b.targets.length === 1));
  assert.equal(r.beats[0].lines[0].ja, 'これは ねこ。');
});

test('a new word arrives alone among familiar ones, as a guess that is not graded', () => {
  const s = E.emptyState();
  const [, second] = play(s, DAY, 2);
  const guess = second.beats[0];
  assert.equal(guess.isNew, true);
  assert.deepEqual(guess.log, []);
  const target = second.objects[guess.targets[0]].id;
  assert.equal(target, 'ringo');
  // Every other object in the scene was met before.
  for (const o of second.objects) if (o.id !== target) assert.ok(['neko', 'inu'].includes(o.id));
  // The new word is asked again (graded) later in the round.
  assert.ok(second.beats.filter((b) => b.type === 'ask' && b.log.includes('ringo')).length >= 2);
});

test('no new words while two are still shaky', () => {
  const s = E.emptyState();
  play(s, DAY, 1, seeded(), () => false);
  const r = E.buildRound(s, DAY, seeded(3));
  assert.deepEqual(r.meet, []);
  assert.ok(r.beats.every((b) => !b.isNew));
});

test('at most 6 new words a day', () => {
  const s = E.emptyState();
  play(s, DAY, 40);
  assert.equal(Object.values(s.met).filter((d) => d === DAY).length, 6);
  play(s, E.addDays(DAY, 1), 3);
  assert.ok(Object.keys(s.met).length > 6);
});

test('a word is known after 3 right answers spread over 2 days', () => {
  const s = E.emptyState();
  s.met.neko = DAY;
  s.asks.push([DAY, 'neko', 1], [DAY, 'neko', 1], [DAY, 'neko', 1]);
  assert.equal(E.itemStats(s).neko.known, false);
  s.asks.push([E.addDays(DAY, 1), 'neko', 1]);
  assert.equal(E.itemStats(s).neko.known, true);
  s.asks.push([E.addDays(DAY, 1), 'neko', 0]);
  assert.equal(E.itemStats(s).neko.known, false);
});

test('big and small appear once 6 words are known, shown before being asked', () => {
  const s = E.emptyState();
  const d2 = E.addDays(DAY, 1);
  for (const w of E.WORDS.slice(0, 6)) {
    s.met[w.id] = DAY;
    s.asks.push([DAY, w.id, 1], [DAY, w.id, 1], [d2, w.id, 1]);
  }
  // Keep new words from taking the round.
  for (const w of E.WORDS.slice(6, 12)) s.met[w.id] = d2;
  const r = E.buildRound(s, d2, seeded(5));
  assert.deepEqual(r.meet, ['ookii', 'chiisai']);
  assert.equal(r.beats[0].type, 'show');
  assert.match(r.beats[0].lines[0].ja, /^おおきい /);
  const sized = r.objects.filter((o) => o.size);
  assert.equal(sized.length, 2);
  assert.equal(sized[0].id, sized[1].id);
  const sizeAsks = r.beats.filter((b) => b.type === 'ask' && (b.log[0] === 'ookii' || b.log[0] === 'chiisai'));
  assert.equal(sizeAsks.length, 3);
  // Asks about other objects never point at the two-size word.
  for (const b of r.beats.filter((x) => x.type === 'ask' && !sizeAsks.includes(x))) {
    for (const t of b.targets) assert.equal(r.objects[t].size, null);
  }
});

test('every ask target is in the scene and the scene has no duplicates', () => {
  const s = E.emptyState();
  const rng = seeded(9);
  for (let day = 0; day < 12; day++) {
    const d = E.addDays(DAY, day);
    for (const r of play(s, d, 8, rng, () => rng() < 0.85)) {
      const keys = r.objects.map((o) => o.id + (o.size || ''));
      assert.equal(new Set(keys).size, keys.length);
      for (const b of r.beats) {
        const idx = b.type === 'show' ? [b.obj] : b.type === 'ask' ? b.targets : [b.mover, b.anchor];
        for (const i of idx) assert.ok(r.objects[i]);
        if (b.type === 'put' || b.type === 'demo') {
          assert.equal(r.objects[b.anchor].role, 'anchor');
          assert.equal(r.objects[b.mover].role, 'mover');
          assert.ok(E.ANCHORS[r.objects[b.anchor].id].includes(b.rel));
        }
      }
    }
  }
  assert.ok(E.knownCount(s) >= 10);
});

test('feedback lines', () => {
  const r = { objects: [{ id: 'neko', size: null }, { id: 'inu', size: null }] };
  const ask = { targets: [0], log: ['neko'] };
  assert.equal(E.rightLine(r, ask, () => 0).ja, 'そう！ ねこ。');
  assert.deepEqual(E.wrongLines(r, ask, 1).map((l) => l.ja), ['それは いぬ。', 'ねこは これ。']);
  const guess = { targets: [0], log: [], isNew: true };
  assert.equal(E.rightLine(r, guess, () => 0).ja, 'そう！ これが ねこ。');
  assert.deepEqual(E.wrongLines(r, guess, 1).map((l) => l.ja), ['それは いぬ。', 'これが ねこ。']);
  const sized = { objects: [{ id: 'neko', size: 'big' }, { id: 'neko', size: 'small' }] };
  assert.deepEqual(E.wrongLines(sized, { targets: [0], log: ['ookii'] }, 1).map((l) => l.ja), ['それは ちいさい ねこ。', 'おおきい ねこは これ。']);
  const pair = { targets: [0, 1], log: ['neko', 'inu'] };
  assert.equal(E.rightLine(r, pair, () => 0).ja, 'そう！ ねこと いぬ。');
});

test('voice text drops the spaces and uses kanji', () => {
  const s = E.emptyState();
  const r = E.buildRound(s, DAY, seeded());
  assert.equal(r.beats[2].line.say, '猫はどこ？');
  assert.ok(!r.beats.some((b) => (b.line || b.lines[0]).say.includes(' ')));
});

test('routines: shuffled ones are reordered and trimmed, long waits repeat', () => {
  const a = E.routineSteps('body', seeded(1)).map((s) => s.ja);
  const b = E.routineSteps('body', seeded(2)).map((s) => s.ja);
  assert.equal(a.length, 10);
  assert.notDeepEqual(a, b);
  const coffee = E.routineSteps('coffee');
  assert.equal(coffee[0].ja, 'キッチンに いこう。');
  assert.ok(coffee.some((st) => st.ja === 'カップを とって。'));
  assert.equal(coffee.find((s) => s.wait === 40).repeatAt, 20);
  assert.equal(coffee.find((s) => s.wait === 5).repeatAt, null);
  assert.deepEqual(E.routineSteps('nope'), []);
});

test('streak: 2 minutes counts, shields cover misses, today is never missed', () => {
  const s = E.emptyState();
  for (let i = 0; i < 7; i++) s.time[E.addDays(DAY, i)] = 130;
  let r = E.streak(s, E.addDays(DAY, 6));
  assert.equal(r.current, 7);
  assert.equal(r.shields, 1);
  // Day 7 missed, day 8 done: the shield covers it.
  s.time[E.addDays(DAY, 8)] = 600;
  r = E.streak(s, E.addDays(DAY, 8));
  assert.equal(r.current, 9);
  assert.equal(r.shields, 0);
  assert.deepEqual(r.shielded, [E.addDays(DAY, 7)]);
  // Today unfinished: streak stands.
  r = E.streak(s, E.addDays(DAY, 9));
  assert.equal(r.current, 9);
  assert.equal(r.doneToday, false);
  // Under 2 minutes doesn't count; a second miss with no shield breaks it.
  s.time[E.addDays(DAY, 9)] = 60;
  s.time[E.addDays(DAY, 11)] = 200;
  r = E.streak(s, E.addDays(DAY, 11));
  assert.equal(r.current, 1);
  assert.equal(r.best, 9);
  assert.equal(r.comeback, true);
});

test('journey counts hours toward the next milestone', () => {
  const s = E.emptyState();
  s.time[DAY] = 3 * 3600;
  const j = E.journey(s);
  assert.equal(j.prev, 1);
  assert.equal(j.next, 5);
  assert.equal(j.pct, 50);
});

test('romaji', () => {
  assert.equal(E.romaji('ねこは どこ？'), 'neko wa doko?');
  assert.equal(E.romaji('うえの は。'), 'ueno ha.');
  assert.equal(E.romaji('てを あげて。'), 'te o agete.');
  assert.equal(E.romaji('コーヒーを いれて。'), 'koohii o irete.');
  assert.equal(E.romaji('でんしゃ'), 'densha');
  assert.equal(E.romaji('いってきます！'), 'ittekimasu!');
  assert.equal(E.romaji('ちいさい'), 'chiisai');
  assert.equal(E.romaji('ボール'), 'booru');
  assert.equal(E.romaji('きんえん'), "kin'en");
});

test('normalize keeps good data and flags the rest', () => {
  const { state, dropped } = E.normalize({
    settings: { rate: 0.9, text: 'kana', goal: 15, voice: 'Kyoko' },
    met: { neko: DAY, bogus: DAY },
    asks: [[DAY, 'neko', 1], [DAY, 'neko', 2], ['x', 'neko', 1]],
    time: { [DAY]: 300, nope: 5 },
    seenIntro: true,
  });
  assert.equal(dropped, true);
  assert.deepEqual(state.settings, { rate: 0.9, text: 'kana', goal: 15, voice: 'Kyoko' });
  assert.deepEqual(state.met, { neko: DAY });
  assert.deepEqual(state.asks, [[DAY, 'neko', 1]]);
  assert.deepEqual(state.time, { [DAY]: 300 });
  assert.equal(state.seenIntro, true);
  assert.equal(E.normalize(E.emptyState()).dropped, false);
  assert.equal(E.normalize(null).dropped, true);
});

// Know `ids` as of `day` (three right answers over two days).
function know(s, ids, day) {
  for (const id of ids) {
    s.met[id] = E.addDays(day, -1);
    s.asks.push([E.addDays(day, -1), id, 1], [E.addDays(day, -1), id, 1], [day, id, 1]);
  }
}

test('where-rounds start once 8 words, 2 anchors and 2 movable things are known', () => {
  const s = E.emptyState();
  const day = E.addDays(DAY, 3);
  // Keep new words out of the way.
  for (const w of E.WORDS) s.met[w.id] = day;
  know(s, ['neko', 'inu', 'ringo', 'kuruma', 'hon', 'kutsu', 'sakana', 'isu'], day);
  assert.notEqual(E.buildRound(s, day, seeded(2)).kind, 'where'); // only one anchor known
  know(s, ['ki'], day);
  const r = E.buildRound(s, day, seeded(2));
  assert.equal(r.kind, 'where');
  assert.deepEqual(r.meet, ['ue', 'shita']);
  assert.deepEqual(r.beats.slice(0, 4).map((b) => b.type), ['demo', 'demo', 'demo', 'demo']);
  const puts = r.beats.filter((b) => b.type === 'put');
  assert.equal(puts.length, 4);
  for (const b of puts) {
    assert.ok(['ue', 'shita'].includes(b.rel));
    assert.deepEqual(b.log, [r.objects[b.mover].id, r.objects[b.anchor].id, b.rel]);
  }
});

test('"in" and "next to" wait for on/under to be steady and need a box or bag', () => {
  const s = E.emptyState();
  const day = E.addDays(DAY, 3);
  for (const w of E.WORDS) s.met[w.id] = day;
  know(s, ['neko', 'inu', 'ringo', 'kuruma', 'hon', 'kutsu', 'sakana', 'isu', 'ki'], day);
  s.met.ue = day; s.met.shita = day;
  s.asks.push([day, 'ue', 1], [day, 'shita', 0]);
  for (let k = 1; k < 20; k++) {
    const r = E.buildRound(s, day, seeded(k));
    if (r.kind === 'where') assert.deepEqual(r.meet, []);
  }
  s.asks.push([day, 'ue', 1], [day, 'shita', 1], [day, 'shita', 1]);
  // Steady now, but no box or bag known yet.
  for (let k = 1; k < 20; k++) {
    const r = E.buildRound(s, day, seeded(k));
    if (r.kind === 'where') assert.deepEqual(r.meet, []);
  }
  know(s, ['hako'], day);
  let saw = false;
  for (let k = 1; k < 40 && !saw; k++) {
    const r = E.buildRound(s, day, seeded(k));
    if (r.kind !== 'where') continue;
    saw = true;
    assert.deepEqual(r.meet, ['naka', 'yoko']);
    const ids = r.objects.filter((o) => o.role === 'anchor').map((o) => o.id);
    assert.ok(ids.includes('hako'));
    assert.ok(ids.some((id) => id === 'isu' || id === 'ki'), 'still able to show under');
  }
  assert.ok(saw);
});

test('where lines', () => {
  const objects = [{ id: 'isu' }, { id: 'hako' }, { id: 'neko' }];
  assert.deepEqual(E.putLine(objects, 2, 0, 'ue'), { ja: 'ねこを いすの うえに おいて。', say: '猫を椅子の上に置いて。', en: 'Put the cat on the chair.' });
  assert.deepEqual(E.putLine(objects, 2, 1, 'naka'), { ja: 'ねこを はこの なかに いれて。', say: '猫を箱の中に入れて。', en: 'Put the cat in the box.' });
  assert.equal(E.whereLine(objects, 2, 0, 'shita').ja, 'ねこは いすの した。');
  assert.equal(E.whereRightLine(objects, { mover: 2, anchor: 1, rel: 'yoko' }, () => 0).ja, 'そう！ ねこは はこの よこ。');
  assert.equal(E.wherePlacedLine(objects, 0, 'ue').ja, 'それは いすの うえ。');
});

test('judging where something was dropped', () => {
  const chair = { index: 0, id: 'isu', x: 100, y: 200, size: 100 };
  const box = { index: 1, id: 'hako', x: 300, y: 200, size: 100 };
  const j = (x, y) => E.judgeDrop(x, y, [chair, box]);
  assert.deepEqual(j(100, 130), { anchor: 0, rel: 'ue' });
  assert.deepEqual(j(100, 205), { anchor: 0, rel: 'ue' }); // on the seat
  assert.deepEqual(j(100, 270), { anchor: 0, rel: 'shita' });
  assert.deepEqual(j(30, 210), { anchor: 0, rel: 'yoko' });
  assert.deepEqual(j(300, 205), { anchor: 1, rel: 'naka' });
  assert.deepEqual(j(300, 130), { anchor: 1, rel: 'ue' });
  assert.deepEqual(j(380, 200), { anchor: 1, rel: 'yoko' });
  assert.equal(j(200, 40), null);
  // Where the app draws things is judged the same way.
  for (const rel of ['ue', 'shita', 'yoko']) {
    const p = E.placeFor(rel, chair, -1);
    assert.equal(j(p.x, p.y).rel, rel, rel);
  }
  for (const rel of ['naka', 'ue', 'yoko']) {
    const p = E.placeFor(rel, box, 1);
    assert.equal(j(p.x, p.y).rel, rel, rel);
  }
});
