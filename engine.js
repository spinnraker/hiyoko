/*
 * Hiyoko engine.
 *
 * Pure logic, no DOM. Learn Japanese the way small children do: by hearing it
 * in context and showing you understood (pointing, doing), not by translating.
 *
 * - Look & point: the engine builds "rounds": a scene of pictures and a list of
 *   beats ("show" one thing while naming it, or "ask" you to find something).
 *   New words are met the way toddlers meet them: one unfamiliar picture among
 *   familiar ones, and you work out which one the new word means.
 * - Do it: routines narrated in Japanese while you do them.
 * - Progress is listening time, with Habito's forgiving streak rules.
 *
 * Everything shown in Progress is recomputed from the stored logs.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HiyokoEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- dates (local calendar days as YYYY-MM-DD) ----------

  const pad = (n) => String(n).padStart(2, '0');

  function toKey(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function fromKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d, 12);
  }

  function addDays(key, n) {
    const d = fromKey(key);
    d.setDate(d.getDate() + n);
    return toKey(d);
  }

  function diffDays(a, b) {
    const da = fromKey(a);
    const db = fromKey(b);
    return Math.round((Date.UTC(db.getFullYear(), db.getMonth(), db.getDate()) - Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())) / 86400000);
  }

  const isKey = (k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);

  // ---------- content ----------

  // Introduction order. `ja` is shown (kana, spaced like a children's book);
  // `say` is what the voice reads (kanji where it helps the voice read the
  // word and the particle after it correctly).
  const WORDS = [
    { id: 'neko', ja: 'ねこ', say: '猫', en: 'cat', pic: '🐈' },
    { id: 'inu', ja: 'いぬ', say: '犬', en: 'dog', pic: '🐕' },
    { id: 'ringo', ja: 'りんご', say: 'りんご', en: 'apple', pic: '🍎' },
    { id: 'kuruma', ja: 'くるま', say: '車', en: 'car', pic: '🚗' },
    { id: 'hon', ja: 'ほん', say: '本', en: 'book', pic: '📕' },
    { id: 'kutsu', ja: 'くつ', say: '靴', en: 'shoe', pic: '👟' },
    { id: 'sakana', ja: 'さかな', say: '魚', en: 'fish', pic: '🐟' },
    { id: 'ki', ja: 'き', say: '木', en: 'tree', pic: '🌳' },
    { id: 'tori', ja: 'とり', say: '鳥', en: 'bird', pic: '🐦' },
    { id: 'kagi', ja: 'かぎ', say: '鍵', en: 'key', pic: '🔑' },
    { id: 'banana', ja: 'バナナ', say: 'バナナ', en: 'banana', pic: '🍌' },
    { id: 'boushi', ja: 'ぼうし', say: '帽子', en: 'hat', pic: '🧢' },
    { id: 'ie', ja: 'いえ', say: 'いえ', en: 'house', pic: '🏠' },
    { id: 'kasa', ja: 'かさ', say: '傘', en: 'umbrella', pic: '☂️' },
    { id: 'hoshi', ja: 'ほし', say: '星', en: 'star', pic: '⭐' },
    { id: 'tsuki', ja: 'つき', say: '月', en: 'moon', pic: '🌙' },
    { id: 'kaban', ja: 'かばん', say: 'かばん', en: 'bag', pic: '👜' },
    { id: 'hana', ja: 'はな', say: '花', en: 'flower', pic: '🌷' },
    { id: 'tamago', ja: 'たまご', say: '卵', en: 'egg', pic: '🥚' },
    { id: 'isu', ja: 'いす', say: '椅子', en: 'chair', pic: '🪑' },
    { id: 'booru', ja: 'ボール', say: 'ボール', en: 'ball', pic: '⚽' },
    { id: 'densha', ja: 'でんしゃ', say: '電車', en: 'train', pic: '🚃' },
    { id: 'pan', ja: 'パン', say: 'パン', en: 'bread', pic: '🍞' },
    { id: 'tokei', ja: 'とけい', say: '時計', en: 'clock', pic: '⏰' },
    { id: 'uma', ja: 'うま', say: '馬', en: 'horse', pic: '🐎' },
    { id: 'onigiri', ja: 'おにぎり', say: 'おにぎり', en: 'rice ball', pic: '🍙' },
    { id: 'kuma', ja: 'くま', say: 'くま', en: 'bear', pic: '🐻' },
    { id: 'usagi', ja: 'うさぎ', say: 'うさぎ', en: 'rabbit', pic: '🐇' },
    { id: 'tegami', ja: 'てがみ', say: '手紙', en: 'letter', pic: '✉️' },
    { id: 'fune', ja: 'ふね', say: '船', en: 'boat', pic: '⛵' },
    { id: 'hikouki', ja: 'ひこうき', say: '飛行機', en: 'airplane', pic: '✈️' },
  ];
  const WORD = Object.fromEntries(WORDS.map((w) => [w.id, w]));

  // Describing words, unlocked once enough nouns are known.
  const ADJ = {
    ookii: { id: 'ookii', ja: 'おおきい', say: '大きい', en: 'big' },
    chiisai: { id: 'chiisai', ja: 'ちいさい', say: '小さい', en: 'small' },
  };
  const SIZE_UNLOCK = 6; // known nouns before big/small appears
  const AND_UNLOCK = 10; // known nouns before "X と Y" appears

  const ITEM_IDS = new Set([...WORDS.map((w) => w.id), ...Object.keys(ADJ)]);

  const PRAISE = [
    { ja: 'そう！', say: 'そう！', en: 'Yes!' },
    { ja: 'そうそう！', say: 'そうそう！', en: 'That’s it!' },
    { ja: 'いいね！', say: 'いいね！', en: 'Nice!' },
    { ja: 'あたり！', say: 'あたり！', en: 'Got it!' },
  ];

  // Narrated routines. `wait` is the time given to do the thing, in seconds.
  // `shuffle` routines are reordered every time, so you have to listen.
  const ROUTINES = [
    {
      id: 'body', name: 'Move your body', ja: 'からだ', pic: '🙆', shuffle: true, pick: 10,
      blurb: 'Stand up, touch your nose, close your eyes. Shuffled every time.',
      steps: [
        { ja: 'たって。', say: '立って。', en: 'Stand up.', pic: '🧍', wait: 4 },
        { ja: 'すわって。', say: '座って。', en: 'Sit down.', pic: '🪑', wait: 4 },
        { ja: 'てを あげて。', say: '手を上げて。', en: 'Raise your hands.', pic: '🙌', wait: 4 },
        { ja: 'てを さげて。', say: '手を下げて。', en: 'Lower your hands.', pic: '👐', wait: 4 },
        { ja: 'あたまを さわって。', say: '頭を触って。', en: 'Touch your head.', pic: '👤', wait: 4 },
        { ja: 'はなを さわって。', say: '鼻を触って。', en: 'Touch your nose.', pic: '👃', wait: 4 },
        { ja: 'みみを さわって。', say: '耳を触って。', en: 'Touch your ears.', pic: '👂', wait: 4 },
        { ja: 'くちを あけて。', say: '口を開けて。', en: 'Open your mouth.', pic: '👄', wait: 4 },
        { ja: 'くちを とじて。', say: '口を閉じて。', en: 'Close your mouth.', pic: '🤐', wait: 4 },
        { ja: 'めを とじて。', say: '目を閉じて。', en: 'Close your eyes.', pic: '😌', wait: 4 },
        { ja: 'めを あけて。', say: '目を開けて。', en: 'Open your eyes.', pic: '👀', wait: 4 },
        { ja: 'あしを あげて。', say: '足を上げて。', en: 'Raise your foot.', pic: '🦶', wait: 4 },
        { ja: 'てを たたいて。', say: '手をたたいて。', en: 'Clap your hands.', pic: '👏', wait: 4 },
      ],
    },
    {
      id: 'coffee', name: 'Coffee', ja: 'コーヒー', pic: '☕',
      blurb: 'From the kitchen to the first sip.',
      steps: [
        { ja: 'キッチンに いこう。', say: 'キッチンに行こう。', en: 'Let’s go to the kitchen.', pic: '🚶', wait: 10 },
        { ja: 'コップを とって。', say: 'コップを取って。', en: 'Get a cup.', pic: '☕', wait: 8 },
        { ja: 'コップを テーブルに おいて。', say: 'コップをテーブルに置いて。', en: 'Put the cup on the table.', pic: '☕', wait: 6 },
        { ja: 'コーヒーを いれて。', say: 'コーヒーを入れて。', en: 'Make the coffee.', pic: '☕', wait: 40 },
        { ja: 'コップを もって。', say: 'コップを持って。', en: 'Hold the cup.', pic: '☕', wait: 5 },
        { ja: 'あつい？ あついね。', say: '熱い？熱いね。', en: 'Hot? It’s hot, huh.', pic: '♨️', wait: 5 },
        { ja: 'のんで。', say: '飲んで。', en: 'Drink.', pic: '☕', wait: 8 },
        { ja: 'おいしい？', say: 'おいしい？', en: 'Is it good?', pic: '😋', wait: 4 },
        { ja: 'おいしいね。', say: 'おいしいね。', en: 'It’s good, isn’t it.', pic: '😋', wait: 4 },
      ],
    },
    {
      id: 'teeth', name: 'Brush your teeth', ja: 'はみがき', pic: '🪥',
      blurb: 'Two minutes at the sink.',
      steps: [
        { ja: 'せんめんじょに いこう。', say: '洗面所に行こう。', en: 'Let’s go to the sink.', pic: '🚶', wait: 10 },
        { ja: 'はブラシを とって。', say: '歯ブラシを取って。', en: 'Get your toothbrush.', pic: '🪥', wait: 6 },
        { ja: 'はみがきこを つけて。', say: '歯磨き粉をつけて。', en: 'Put on toothpaste.', pic: '🪥', wait: 8 },
        { ja: 'はを みがいて。', say: '歯を磨いて。', en: 'Brush your teeth.', pic: '🪥', wait: 20 },
        { ja: 'うえの は。', say: '上の歯。', en: 'The top teeth.', pic: '⬆️', wait: 25 },
        { ja: 'したの は。', say: '下の歯。', en: 'The bottom teeth.', pic: '⬇️', wait: 25 },
        { ja: 'みずで ゆすいで。', say: '水でゆすいで。', en: 'Rinse with water.', pic: '💧', wait: 10 },
        { ja: 'きれいに なったね。', say: 'きれいになったね。', en: 'All clean now.', pic: '✨', wait: 4 },
      ],
    },
    {
      id: 'out', name: 'Heading out', ja: 'でかける', pic: '🚪',
      blurb: 'Shoes, hat, keys, bag, door.',
      steps: [
        { ja: 'くつを はいて。', say: '靴を履いて。', en: 'Put on your shoes.', pic: '👟', wait: 20 },
        { ja: 'ぼうしを かぶって。', say: '帽子をかぶって。', en: 'Put on your hat.', pic: '🧢', wait: 6 },
        { ja: 'かぎを もった？', say: '鍵を持った？', en: 'Got your keys?', pic: '🔑', wait: 6 },
        { ja: 'かばんを もって。', say: 'かばんを持って。', en: 'Take your bag.', pic: '👜', wait: 6 },
        { ja: 'ドアを あけて。', say: 'ドアを開けて。', en: 'Open the door.', pic: '🚪', wait: 5 },
        { ja: 'そとに でよう。', say: '外に出よう。', en: 'Let’s go outside.', pic: '🌤️', wait: 6 },
        { ja: 'ドアを しめて。', say: 'ドアを閉めて。', en: 'Close the door.', pic: '🚪', wait: 5 },
        { ja: 'いってきます！', say: '行ってきます！', en: 'I’m off!', pic: '👋', wait: 3 },
      ],
    },
  ];
  const ROUTINE = Object.fromEntries(ROUTINES.map((r) => [r.id, r]));

  // ---------- small helpers ----------

  function pickOne(arr, rng) {
    return arr[Math.floor(rng() * arr.length) % arr.length];
  }

  function shuffled(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function line(ja, say, en) {
    return { ja, say, en };
  }

  // ---------- state ----------

  const DEFAULT_SETTINGS = { rate: 0.8, text: 'off', goal: 10, voice: '' };

  function emptyState() {
    return { v: 1, settings: { ...DEFAULT_SETTINGS }, met: {}, asks: [], time: {}, seenIntro: false };
  }

  /**
   * Validate saved or imported data. Returns { state, dropped } where dropped
   * says whether anything had to be thrown away.
   */
  function normalize(raw) {
    const s = emptyState();
    let dropped = false;
    if (!raw || typeof raw !== 'object') return { state: s, dropped: true };

    const st = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    if (typeof st.rate === 'number' && st.rate >= 0.5 && st.rate <= 1.2) s.settings.rate = st.rate;
    if (['off', 'kana', 'both'].includes(st.text)) s.settings.text = st.text;
    if (Number.isInteger(st.goal) && st.goal >= 2 && st.goal <= 120) s.settings.goal = st.goal;
    if (typeof st.voice === 'string') s.settings.voice = st.voice.slice(0, 200);

    if (raw.met && typeof raw.met === 'object') {
      for (const [id, day] of Object.entries(raw.met)) {
        if (ITEM_IDS.has(id) && isKey(day)) s.met[id] = day;
        else dropped = true;
      }
    }
    if (Array.isArray(raw.asks)) {
      for (const a of raw.asks) {
        if (Array.isArray(a) && isKey(a[0]) && ITEM_IDS.has(a[1]) && (a[2] === 0 || a[2] === 1)) s.asks.push([a[0], a[1], a[2]]);
        else dropped = true;
      }
    }
    if (raw.time && typeof raw.time === 'object') {
      for (const [day, sec] of Object.entries(raw.time)) {
        if (isKey(day) && Number.isFinite(sec) && sec >= 0 && sec < 86400) s.time[day] = Math.round(sec);
        else dropped = true;
      }
    }
    s.seenIntro = raw.seenIntro === true;
    return { state: s, dropped };
  }

  // ---------- word knowledge (recomputed from the log) ----------

  /**
   * Per item: how often it was asked, recent first-try results, and whether
   * it's understood. "Known" means the last 3 asks were right first time and
   * they happened on at least 2 different days, so it stuck overnight.
   */
  function itemStats(state) {
    const stats = {};
    for (const id of Object.keys(state.met)) stats[id] = { id, asks: 0, right: 0, results: [], days: [], last: state.met[id] };
    for (const [day, id, ok] of state.asks) {
      const s = stats[id] || (stats[id] = { id, asks: 0, right: 0, results: [], days: [], last: day });
      s.asks++;
      s.right += ok;
      s.results.push(ok);
      s.days.push(day);
      if (day > s.last) s.last = day;
    }
    for (const s of Object.values(stats)) {
      const r3 = s.results.slice(-3);
      const d3 = s.days.slice(-3);
      s.solid = s.results.length >= 2 && s.results.slice(-2).every((x) => x === 1);
      s.known = r3.length === 3 && r3.every((x) => x === 1) && new Set(d3).size >= 2;
    }
    return stats;
  }

  function metWords(state) {
    return WORDS.filter((w) => state.met[w.id]);
  }

  function knownCount(state, stats = itemStats(state)) {
    return WORDS.filter((w) => stats[w.id] && stats[w.id].known).length;
  }

  // ---------- Look & point: building a round ----------

  const NEW_PER_DAY = 6;
  const ASKS_PER_ROUND = 6;

  function sceneSize(metCount) {
    if (metCount < 4) return 3;
    if (metCount < 10) return 4;
    if (metCount < 18) return 5;
    return 6;
  }

  // Weaker and longer-unseen words come first; a little randomness keeps it fresh.
  function priority(id, stats, today, rng) {
    const s = stats[id];
    if (!s) return 10 + rng();
    let p = s.known ? 0 : 3;
    p += Math.min(diffDays(s.last, today), 14) * 0.4;
    p += s.results.slice(-3).filter((x) => x === 0).length;
    return p + rng() * 1.5;
  }

  function nextNewWord(state) {
    return WORDS.find((w) => !state.met[w.id]) || null;
  }

  function canMeetNew(state, stats, today) {
    const met = metWords(state);
    if (met.length < 2) return true;
    const newToday = Object.values(state.met).filter((d) => d === today).length;
    if (newToday >= NEW_PER_DAY) return false;
    const shaky = met.filter((w) => !(stats[w.id] && stats[w.id].solid)).length;
    return shaky < 2;
  }

  function objFor(w, size) {
    return { id: w.id, pic: w.pic, size: size || null };
  }

  function nounPhrase(w, size) {
    if (!size) return { ja: w.ja, say: w.say, en: `the ${w.en}` };
    const a = size === 'big' ? ADJ.ookii : ADJ.chiisai;
    return { ja: `${a.ja} ${w.ja}`, say: `${a.say}${w.say}`, en: `the ${a.en} ${w.en}` };
  }

  function askLine(np) {
    return line(`${np.ja}は どこ？`, `${np.say}はどこ？`, `Where’s ${np.en}?`);
  }

  function andLine(a, b) {
    return line(`${a.ja}と ${b.ja}は どこ？`, `${a.say}と${b.say}はどこ？`, `Where are the ${a.en} and the ${b.en}?`);
  }

  /**
   * Build one round: a scene (objects, in random slots) and its beats.
   * Beat types:
   *   show  { obj, lines }               the app points at obj and names it
   *   ask   { targets, line, log, isNew } you find target(s); `log` lists the
   *                                        item ids to record (none for a guess)
   * Objects are referred to by index into round.objects.
   */
  function buildRound(state, today, rng = Math.random) {
    const stats = itemStats(state);
    const met = metWords(state);
    const beats = [];
    const objects = [];
    const meet = []; // item ids first met in this round

    const addObj = (w, size) => objects.push(objFor(w, size)) - 1;

    // Very first round: name two things, then ask about them.
    if (met.length < 2) {
      const first = WORDS.filter((w) => !state.met[w.id]).slice(0, 2 - met.length);
      const words = [...met, ...first];
      words.forEach((w) => addObj(w));
      for (const w of first) meet.push(w.id);
      words.forEach((w, i) => {
        beats.push({ type: 'show', obj: i, lines: [line(`これは ${w.ja}。`, `これは${w.say}。`, `This is the ${w.en}.`), line(`${w.ja}。`, `${w.say}。`, `The ${w.en}.`)] });
      });
      for (const i of [0, 1, 1, 0]) beats.push({ type: 'ask', targets: [i], line: askLine(nounPhrase(words[i])), log: [words[i].id] });
      return finish();
    }

    const known = knownCount(state, stats);
    const n = sceneSize(met.length);
    const fresh = canMeetNew(state, stats, today) ? nextNewWord(state) : null;

    // Big/small round: two sizes of one familiar thing.
    const sizeOn = known >= SIZE_UNLOCK;
    const sizeRound = sizeOn && !fresh && (!state.met.ookii || rng() < 0.35);

    const ranked = met.slice().sort((a, b) => priority(b.id, stats, today, rng) - priority(a.id, stats, today, rng));
    let pool;
    let sizeWord = null;
    if (sizeRound) {
      sizeWord = ranked.find((w) => stats[w.id] && stats[w.id].known) || ranked[0];
      pool = [sizeWord, ...ranked.filter((w) => w !== sizeWord).slice(0, n - 2)];
    } else {
      pool = ranked.slice(0, fresh ? n - 1 : n);
      if (fresh) pool.push(fresh);
    }

    // Lay objects out in shuffled order.
    const layout = shuffled(pool.flatMap((w) => (w === sizeWord ? [[w, 'big'], [w, 'small']] : [[w, null]])), rng);
    const idx = {};
    for (const [w, size] of layout) idx[w.id + (size ? `:${size}` : '')] = addObj(w, size);

    const plainIds = pool.filter((w) => w !== sizeWord && w !== fresh);
    const asks = [];

    if (sizeWord) {
      const big = idx[`${sizeWord.id}:big`];
      const small = idx[`${sizeWord.id}:small`];
      if (!state.met.ookii) {
        meet.push('ookii', 'chiisai');
        beats.push({ type: 'show', obj: big, lines: [line(`おおきい ${sizeWord.ja}。`, `大きい${sizeWord.say}。`, `A big ${sizeWord.en}.`)] });
        beats.push({ type: 'show', obj: small, lines: [line(`ちいさい ${sizeWord.ja}。`, `小さい${sizeWord.say}。`, `A small ${sizeWord.en}.`)] });
      }
      const sizes = shuffled(['big', 'small', rng() < 0.5 ? 'big' : 'small'], rng);
      for (const sz of sizes) asks.push({ type: 'ask', targets: [sz === 'big' ? big : small], line: askLine(nounPhrase(sizeWord, sz)), log: [sz === 'big' ? 'ookii' : 'chiisai'] });
    }

    if (fresh) {
      // The toddler move: hear a new word, pick the one thing you don't have a name for yet.
      meet.push(fresh.id);
      const i = idx[fresh.id];
      beats.push({ type: 'ask', targets: [i], line: askLine(nounPhrase(fresh)), log: [], isNew: true });
    }

    // Familiar words, weakest first, each at least once where there's room.
    const want = ASKS_PER_ROUND - asks.length - (fresh ? 2 : 0);
    const order = [];
    for (let k = 0; order.length < want && plainIds.length; k++) order.push(plainIds[k % plainIds.length]);
    const andOn = known >= AND_UNLOCK && plainIds.length >= 2;
    for (const w of order) {
      if (andOn && rng() < 0.3) {
        const other = pickOne(plainIds.filter((x) => x !== w), rng);
        asks.push({ type: 'ask', targets: [idx[w.id], idx[other.id]], line: andLine(w, other), log: [w.id, other.id] });
      } else {
        asks.push({ type: 'ask', targets: [idx[w.id]], line: askLine(nounPhrase(w)), log: [w.id] });
      }
    }
    if (fresh) {
      const i = idx[fresh.id];
      const again = { type: 'ask', targets: [i], line: askLine(nounPhrase(fresh)), log: [fresh.id] };
      asks.splice(Math.min(2, asks.length), 0, again);
      asks.push({ ...again });
    }
    beats.push(...shuffleKeepingApart(asks, rng));
    return finish();

    function finish() {
      return { objects, beats, meet };
    }
  }

  // Shuffle asks, but avoid asking the same thing twice in a row.
  function shuffleKeepingApart(asks, rng) {
    let best = asks;
    for (let tries = 0; tries < 12; tries++) {
      const a = shuffled(asks, rng);
      if (a.every((x, i) => i === 0 || x.targets.join() !== a[i - 1].targets.join())) return a;
      best = a;
    }
    return best;
  }

  function praise(rng = Math.random) {
    return pickOne(PRAISE, rng);
  }

  /** What the app says when you tap the right thing. */
  function rightLine(round, beat, rng = Math.random) {
    const p = praise(rng);
    const np = phraseForTargets(round, beat.targets);
    if (beat.isNew) return line(`${p.ja} これが ${np.ja}。`, `${p.say}これが${np.say}。`, `${p.en} This is ${np.en}.`);
    return line(`${p.ja} ${np.ja}。`, `${p.say}${np.say}。`, `${p.en} ${cap(np.en)}.`);
  }

  /** What the app says when you tap the wrong thing, then while pointing at the right one. */
  function wrongLines(round, beat, tappedIndex) {
    const t = round.objects[tappedIndex];
    const tw = nounPhrase(WORD[t.id], sizeShown(round, tappedIndex));
    const target = beat.targets.length === 1 ? beat.targets[0] : null;
    const first = line(`それは ${tw.ja}。`, `それは${tw.say}。`, `That’s ${tw.en}.`);
    if (target == null) return [first];
    const np = nounPhrase(WORD[round.objects[target].id], sizeShown(round, target));
    if (beat.isNew) return [first, line(`これが ${np.ja}。`, `これが${np.say}。`, `This one is ${np.en}.`)];
    return [first, line(`${np.ja}は これ。`, `${np.say}はこれ。`, `${cap(np.en)} is this one.`)];
  }

  // Only say big/small when both sizes are in the scene.
  function sizeShown(round, i) {
    const o = round.objects[i];
    return o.size && round.objects.some((x, j) => j !== i && x.id === o.id) ? o.size : null;
  }

  function phraseForTargets(round, targets) {
    const nps = targets.map((i) => nounPhrase(WORD[round.objects[i].id], sizeShown(round, i)));
    if (nps.length === 1) return nps[0];
    return { ja: nps.map((x) => x.ja).join('と '), say: nps.map((x) => x.say).join('と'), en: nps.map((x) => x.en).join(' and ') };
  }

  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /** Record an answered ask. `ok` is whether the first tap was right. */
  function recordAsk(state, beat, today, ok) {
    for (const id of beat.log) state.asks.push([today, id, ok ? 1 : 0]);
  }

  function recordMeet(state, ids, today) {
    for (const id of ids) if (!state.met[id]) state.met[id] = today;
  }

  // ---------- Do it: compiling a routine ----------

  /** Steps for one run of a routine. Long waits get the line said again halfway. */
  function routineSteps(id, rng = Math.random) {
    const r = ROUTINE[id];
    if (!r) return [];
    let steps = r.steps;
    if (r.shuffle) steps = shuffled(steps, rng).slice(0, r.pick || steps.length);
    return steps.map((s) => ({ ...s, repeatAt: s.wait >= 12 ? Math.round(s.wait / 2) : null }));
  }

  // ---------- listening time and streaks ----------

  const TINY = 120; // two minutes keeps the streak alive
  const SHIELD_EVERY = 7;
  const MAX_SHIELDS = 3;
  const HOURS = [1, 5, 10, 25, 50, 100, 250, 500, 1000];

  function totalSeconds(state) {
    return Object.values(state.time).reduce((a, b) => a + b, 0);
  }

  /**
   * Streak with Habito's rules: 2 minutes counts, every 7-day run earns a
   * shield (up to 3), and a shield absorbs a missed day automatically.
   * Today never counts as missed.
   */
  function streak(state, today) {
    const days = Object.keys(state.time).filter((d) => state.time[d] >= TINY && d <= today).sort();
    const result = { current: 0, best: 0, shields: 0, shielded: [], comeback: false, doneToday: (state.time[today] || 0) >= TINY };
    if (!days.length) return result;
    const done = new Set(days);
    let cur = 0;
    let run = 0; // consecutive real days since last shield was earned
    let shields = 0;
    let broke = false;
    for (let d = days[0]; d <= today; d = addDays(d, 1)) {
      if (done.has(d)) {
        if (broke && d === today) result.comeback = true;
        broke = false;
        cur++;
        run++;
        if (run % SHIELD_EVERY === 0 && shields < MAX_SHIELDS) shields++;
      } else if (d === today) {
        // still time today
      } else if (shields > 0) {
        shields--;
        result.shielded.push(d);
        cur++;
      } else {
        cur = 0;
        run = 0;
        broke = true;
      }
      result.best = Math.max(result.best, cur);
    }
    result.current = cur;
    result.shields = shields;
    return result;
  }

  function journey(state) {
    const hours = totalSeconds(state) / 3600;
    const next = HOURS.find((h) => h > hours) || null;
    const prev = [...HOURS].reverse().find((h) => h <= hours) || 0;
    return { hours, next, prev, pct: next ? Math.round(((hours - prev) / (next - prev)) * 100) : 100 };
  }

  // ---------- kana → romaji (Hepburn), for the optional caption ----------

  const KANA = {
    あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o', か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
    さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so', た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
    な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no', は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
    ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo', や: 'ya', ゆ: 'yu', よ: 'yo',
    ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro', わ: 'wa', を: 'o', ん: 'n',
    が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go', ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
    だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do', ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
    ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po', ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o',
  };
  const SMALL_Y = { ゃ: 'a', ゅ: 'u', ょ: 'o' };
  const PUNCT = { '。': '.', '、': ',', '？': '?', '！': '!', '　': ' ', 'ー': '-' };

  function toHiragana(ch) {
    const c = ch.charCodeAt(0);
    return c >= 0x30a1 && c <= 0x30f6 ? String.fromCharCode(c - 0x60) : ch;
  }

  /** Romaji for a kana string. The particles は and を (attached to the word before them) read " wa" and " o". */
  function romaji(text) {
    const chars = [...text];
    let out = '';
    let doubleNext = false;
    for (let i = 0; i < chars.length; i++) {
      const raw = chars[i];
      if (raw === 'ー') {
        const m = out.match(/[aeiou]$/);
        out += m ? m[0] : '';
        continue;
      }
      const ch = toHiragana(raw);
      if (ch === 'っ') { doubleNext = true; continue; }
      if (PUNCT[raw] != null) { out += PUNCT[raw]; continue; }
      let syl = KANA[ch];
      if (syl == null) { out += raw; continue; }
      const nextCh = chars[i + 1] ? toHiragana(chars[i + 1]) : '';
      if (SMALL_Y[nextCh]) {
        const base = syl.slice(0, -1);
        syl = ['sh', 'ch', 'j'].includes(base) ? base + SMALL_Y[nextCh] : base + 'y' + SMALL_Y[nextCh];
        i++;
      }
      // Particle は before a break reads "wa".
      const after = chars[i + 1];
      if (ch === 'は' && raw === 'は' && i > 0 && (after === ' ' || after === '　' || after == null || PUNCT[after] != null) && chars[i - 1] !== ' ') syl = ' wa';
      if (ch === 'を' && i > 0 && chars[i - 1] !== ' ') syl = ' o';
      if (ch === 'ん' && /^[aeiouy]/.test(KANA[toHiragana(chars[i + 1] || '')] || '')) syl = "n'";
      if (doubleNext) {
        syl = (syl.startsWith('ch') ? 't' : syl[0]) + syl;
        doubleNext = false;
      }
      out += syl;
    }
    return out;
  }

  return {
    toKey, fromKey, addDays, diffDays,
    WORDS, WORD, ADJ, ROUTINES, ROUTINE, SIZE_UNLOCK, AND_UNLOCK, TINY, HOURS, DEFAULT_SETTINGS,
    emptyState, normalize, itemStats, metWords, knownCount,
    buildRound, rightLine, wrongLines, recordAsk, recordMeet,
    routineSteps, totalSeconds, streak, journey, romaji,
  };
});
