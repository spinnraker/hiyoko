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
    for (const b of r.beats) if (b.type === 'ask') E.recordAsk(state, b, day, answer(b, r));
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
        const idx = b.type === 'show' ? [b.obj] : b.targets;
        for (const i of idx) assert.ok(r.objects[i]);
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
