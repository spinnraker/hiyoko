(function () {
  'use strict';

  const E = window.HiyokoEngine;
  const STORE = 'hiyoko:v1';
  const IDLE_MS = 45000; // stop counting listening time after this long with nothing happening
  const PIC_DELAY = 2200; // Do it: hear first, the picture comes a moment later
  const REASK_MS = 12000;

  const app = document.getElementById('app');
  const sheetEl = document.getElementById('sheet');
  const toastEl = document.getElementById('toast');

  let state = load();
  let view = 'today';
  let play = null; // running Look & point or Do it session

  // ---------- storage ----------

  function load() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORE);
      if (raw) {
        const { state: s, dropped } = E.normalize(JSON.parse(raw));
        if (dropped) localStorage.setItem(`${STORE}:unreadable:${Date.now()}`, raw);
        return s;
      }
    } catch (e) {
      try { if (raw) localStorage.setItem(`${STORE}:unreadable:${Date.now()}`, raw); } catch (e2) { /* storage unavailable */ }
    }
    return E.emptyState();
  }

  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
  }

  // ---------- helpers ----------

  const today = () => E.toKey(new Date());
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

  function minutes(sec) { return Math.floor(sec / 60); }

  function clock(sec) {
    const m = Math.floor(sec / 60);
    return `${m}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  }

  function duration(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (!h) return `${m} min`;
    return m ? `${h} h ${m} min` : `${h} h`;
  }

  function longDate(key) {
    return new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  function bar(pct, label) {
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    return `<div class="bar" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}"><i style="width:${p}%"></i></div>`;
  }

  // ---------- toast ----------

  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  // ---------- voice ----------

  const Voice = {
    list: [],
    refresh() {
      if (!('speechSynthesis' in window)) return;
      this.list = speechSynthesis.getVoices().filter((v) => /^ja/i.test(v.lang));
    },
    pick() {
      const want = state.settings.voice;
      const byName = this.list.find((v) => v.name === want);
      if (byName) return byName;
      const score = (v) => (/enhanced|premium|siri/i.test(v.name) ? 2 : 0) + (/kyoko|o-ren|otoya|hattori/i.test(v.name) ? 1 : 0) + (v.localService ? 0.5 : 0);
      return this.list.slice().sort((a, b) => score(b) - score(a))[0] || null;
    },
    available() { return 'speechSynthesis' in window; },
    hasJapanese() { return this.list.length > 0; },
    say(text) {
      return new Promise((resolve) => {
        if (!this.available()) { setTimeout(resolve, 600); return; }
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'ja-JP';
        const v = this.pick();
        if (v) u.voice = v;
        u.rate = state.settings.rate;
        let done = false;
        const finish = () => { if (!done) { done = true; clearTimeout(t); resolve(); } };
        // Some browsers never fire `end`; don't hang on them.
        const t = setTimeout(finish, 1500 + (text.length * 320) / state.settings.rate);
        u.onend = finish;
        u.onerror = finish;
        if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
        speechSynthesis.speak(u);
        if (play) play.active = Date.now();
      });
    },
    stop() { if (this.available()) speechSynthesis.cancel(); },
  };
  Voice.refresh();
  if (Voice.available()) speechSynthesis.addEventListener('voiceschanged', () => { Voice.refresh(); if (!play) render(); });

  // ---------- listening timer ----------

  // Counts a second of listening time when a session is open, visible, not
  // paused, and something happened in the last 45 seconds.
  setInterval(() => {
    if (!play || play.paused || document.hidden) return;
    if (Date.now() - play.active > IDLE_MS) return;
    const d = today();
    state.time[d] = (state.time[d] || 0) + 1;
    play.seconds++;
    const t = document.getElementById('timer');
    if (t) t.textContent = clock(play.seconds);
    if (play.seconds % 10 === 0) save();
  }, 1000);

  // ---------- wake lock ----------

  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && 'wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!on && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch (e) { /* not supported or refused */ }
  }

  document.addEventListener('visibilitychange', () => {
    if (!play) return;
    if (document.hidden) {
      if (play.kind === 'do' && !play.paused) togglePause();
      Voice.stop();
    } else if (play.kind === 'do') {
      keepAwake(true);
    }
  });

  // ---------- captions ----------

  // What's on screen for the line just spoken: nothing, kana, or kana + romaji
  // (Settings), or everything including English while help is open.
  function caption(ln) {
    if (!play) return;
    play.line = ln;
    const el = document.getElementById('caption');
    if (!el) return;
    const mode = play.help ? 'help' : state.settings.text;
    if (!ln || mode === 'off') { el.innerHTML = ''; return; }
    el.innerHTML = `<p class="cap-ja" lang="ja">${esc(ln.ja)}</p>${mode === 'both' || mode === 'help' ? `<p class="cap-ro">${esc(E.romaji(ln.ja))}</p>` : ''}${mode === 'help' ? `<p class="cap-en">${esc(ln.en)}</p>` : ''}`;
  }

  async function speak(ln) {
    caption(ln);
    await Voice.say(ln.say);
  }

  function toggleHelp() {
    if (!play) return;
    play.help = !play.help;
    const b = document.querySelector('[data-action="help"]');
    if (b) b.setAttribute('aria-pressed', String(play.help));
    caption(play.line);
  }

  // ---------- Look & point ----------

  function startPoint() {
    play = { kind: 'point', token: {}, seconds: 0, active: Date.now(), help: false, line: null, round: null, pending: null, busy: false, met: [] };
    renderPlay();
    document.getElementById('scene').addEventListener('click', onSceneTap);
    runPoint(play.token);
  }

  async function runPoint(token) {
    const live = () => play && play.token === token;
    while (live()) {
      const d = today();
      const round = E.buildRound(state, d);
      E.recordMeet(state, round.meet, d);
      for (const id of round.meet) if (E.WORD[id]) play.met.push(id);
      save();
      play.round = round;
      if (round.kind === 'where') renderWhere(round);
      else renderScene(round);
      await sleep(500);
      for (const beat of round.beats) {
        if (!live()) return;
        if (beat.type === 'show') await showBeat(beat, live);
        else if (beat.type === 'demo') await demoBeat(beat, live);
        else if (beat.type === 'put') await putBeat(beat, live);
        else await askBeat(beat, live);
        if (!live()) return;
        await sleep(450);
      }
      if (!live()) return;
      await sleep(400);
      const scene = document.getElementById('scene');
      if (scene) scene.classList.add('leaving');
      await sleep(350);
    }
  }

  async function showBeat(beat, live) {
    mark(beat.obj, 'point');
    for (const ln of beat.lines) {
      if (!live()) return;
      await speak(ln);
      await sleep(350);
    }
    mark(beat.obj, 'point', false);
  }

  function askBeat(beat, live) {
    return new Promise((resolve) => {
      const p = { beat, remaining: new Set(beat.targets), firstTry: true, resolve, timer: null, repeats: 0 };
      play.pending = p;
      const reask = () => {
        clearTimeout(p.timer);
        if (!live() || play.pending !== p) return;
        if (p.repeats >= 2) return; // after that, leave it be; time stops counting when idle
        p.timer = setTimeout(async () => {
          if (!live() || play.pending !== p || play.busy) return reask();
          p.repeats++;
          await speak(beat.line);
          reask();
        }, REASK_MS);
      };
      p.reask = reask;
      speak(beat.line).then(() => { if (live()) reask(); });
    });
  }

  async function tapObject(i) {
    const p = play && play.pending;
    if (!p || play.busy || play.round.kind === 'where') return;
    play.active = Date.now();
    const round = play.round;
    clearTimeout(p.timer);

    if (p.remaining.has(i)) {
      p.remaining.delete(i);
      mark(i, 'hit');
      if (p.remaining.size) {
        // First of a pair: name it and wait for the other.
        const w = E.WORD[round.objects[i].id];
        Voice.say(w.say);
        p.reask();
        return;
      }
      play.busy = true;
      play.pending = null;
      E.recordAsk(state, p.beat, today(), p.firstTry);
      save();
      await speak(E.rightLine(round, p.beat));
      p.beat.targets.forEach((t) => mark(t, 'hit', false));
      play.busy = false;
      p.resolve();
      return;
    }

    // Wrong: name what was tapped, point at the right one, ask again.
    play.busy = true;
    p.firstTry = false;
    mark(i, 'miss');
    setTimeout(() => mark(i, 'miss', false), 500);
    const lines = E.wrongLines(round, p.beat, i);
    await speak(lines[0]);
    const targets = [...p.remaining];
    targets.forEach((t) => mark(t, 'point'));
    if (lines[1]) await speak(lines[1]);
    await sleep(300);
    if (!play || play.pending !== p) return;
    await speak(p.beat.line);
    targets.forEach((t) => mark(t, 'point', false));
    play.busy = false;
    p.reask();
  }

  function mark(i, cls, on = true) {
    const el = document.querySelector(`.obj[data-i="${i}"]`);
    if (el) el.classList.toggle(cls, on);
  }

  // Objects go in a grid with a little jitter so scenes don't look like a test.
  function renderScene(round) {
    const scene = document.getElementById('scene');
    if (!scene) return;
    const n = round.objects.length;
    const cols = n <= 4 ? 2 : 3;
    const rows = Math.ceil(n / cols);
    const w = scene.clientWidth || 320;
    const h = scene.clientHeight || 360;
    const cell = Math.min(w / cols, h / rows);
    const slots = [];
    for (let r = 0; r < rows; r++) {
      const inRow = Math.min(cols, n - r * cols);
      for (let c = 0; c < inRow; c++) slots.push({ x: ((c + 0.5) * w) / inRow, y: ((r + 0.5) * h) / rows });
    }
    scene.classList.remove('leaving', 'where');
    scene.innerHTML = round.objects.map((o, i) => {
      const s = slots[i];
      const jx = (Math.random() - 0.5) * cell * 0.18;
      const jy = (Math.random() - 0.5) * cell * 0.18;
      const k = o.size === 'big' ? 0.72 : o.size === 'small' ? 0.32 : 0.5;
      const word = E.WORD[o.id];
      return `<button class="obj" data-i="${i}" style="left:${s.x + jx}px;top:${s.y + jy}px;font-size:${Math.round(cell * k)}px" aria-label="${esc(word.en)}${o.size ? ` (${o.size})` : ''}"><span>${o.pic}</span></button>`;
    }).join('');
  }

  // ---------- Look & point: where things are ----------

  // Two anchors (chair, tree, box, bag) low in the scene; the things you
  // move wait in a row along the top.
  function renderWhere(round) {
    const scene = document.getElementById('scene');
    if (!scene) return;
    const w = scene.clientWidth || 320;
    const h = scene.clientHeight || 360;
    const big = Math.round(Math.min(w * 0.3, h * 0.3));
    const small = Math.round(big * 0.5);
    const anchors = [];
    const home = {};
    const movers = round.objects.map((o, i) => i).filter((i) => round.objects[i].role === 'mover');
    let ax = 0;
    round.objects.forEach((o, i) => {
      if (o.role === 'anchor') {
        const left = ax++ === 0;
        anchors.push({ index: i, id: o.id, x: w * (left ? 0.29 : 0.71), y: h * 0.6, size: big, side: left ? -1 : 1 });
      }
    });
    movers.forEach((i, k) => { home[i] = { x: (w * (k + 1)) / (movers.length + 1), y: h * 0.13 }; });
    play.geo = { anchors, home, w, h, size: small };
    scene.classList.remove('leaving');
    scene.classList.add('where');
    scene.innerHTML = round.objects.map((o, i) => {
      const word = E.WORD[o.id];
      const a = anchors.find((x) => x.index === i);
      const pos = a || home[i];
      return `<div class="obj ${o.role}" data-i="${i}" role="img" aria-label="${esc(word.en)}" style="left:${pos.x}px;top:${pos.y}px;font-size:${a ? big : small}px"><span>${o.pic}</span></div>`;
    }).join('');
    scene.querySelectorAll('.obj.mover').forEach((el) => el.addEventListener('pointerdown', onMoverDown));
  }

  function moveTo(i, x, y, scale = 1, animate = true) {
    const el = document.querySelector(`.obj[data-i="${i}"]`);
    if (!el || !play || !play.geo) return;
    const g = play.geo;
    const r = (g.size * scale) / 2;
    el.classList.toggle('moving', animate);
    el.style.left = `${Math.max(r, Math.min(g.w - r, x))}px`;
    el.style.top = `${Math.max(r, Math.min(g.h - r, y))}px`;
    el.style.setProperty('--s', scale);
  }

  function moveHome(i) {
    const p = play && play.geo && play.geo.home[i];
    if (p) moveTo(i, p.x, p.y);
  }

  function placeAt(i, anchorIndex, rel) {
    const a = play.geo.anchors.find((x) => x.index === anchorIndex);
    const p = E.placeFor(rel, a, a.side);
    moveTo(i, p.x, p.y, p.scale);
  }

  async function demoBeat(beat, live) {
    placeAt(beat.mover, beat.anchor, beat.rel);
    await sleep(550);
    if (!live()) return;
    await speak(beat.line);
    await sleep(700);
    if (!live()) return;
    moveHome(beat.mover);
    await sleep(450);
  }

  function putBeat(beat, live) {
    return new Promise((resolve) => {
      const p = { beat, firstTry: true, resolve, timer: null, repeats: 0, put: true };
      play.pending = p;
      play.selected = null;
      p.reask = () => {
        clearTimeout(p.timer);
        if (!live() || play.pending !== p || p.repeats >= 2) return;
        p.timer = setTimeout(async () => {
          if (!live() || play.pending !== p || play.busy) return p.reask();
          p.repeats++;
          await speak(beat.line);
          p.reask();
        }, REASK_MS);
      };
      speak(beat.line).then(() => { if (live()) p.reask(); });
    });
  }

  // Drag a mover; or tap it, then tap where it should go.
  function onMoverDown(e) {
    if (!play || !play.geo || play.busy) return;
    const el = e.currentTarget;
    const i = Number(el.dataset.i);
    const start = { x: e.clientX, y: e.clientY };
    const origin = { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
    let moved = false;
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    play.active = Date.now();
    const move = (ev) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 8) return;
      moved = true;
      moveTo(i, origin.x + dx, origin.y + dy, 1, false);
    };
    const up = (ev) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      if (!moved) {
        selectMover(play && play.selected === i ? null : i);
        return;
      }
      selectMover(null);
      dropMover(i, origin.x + (ev.clientX - start.x), origin.y + (ev.clientY - start.y));
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    e.preventDefault();
  }

  function selectMover(i) {
    if (!play) return;
    play.selected = i;
    document.querySelectorAll('.obj.mover').forEach((el) => el.classList.toggle('selected', Number(el.dataset.i) === i));
  }

  function onSceneTap(e) {
    if (!play || play.selected == null || e.target.closest('.obj.mover')) return;
    const box = e.currentTarget.getBoundingClientRect();
    const i = play.selected;
    selectMover(null);
    dropMover(i, e.clientX - box.left, e.clientY - box.top);
  }

  async function dropMover(i, x, y) {
    const p = play && play.pending;
    if (!p || !p.put || play.busy) { moveHome(i); return; }
    play.active = Date.now();
    clearTimeout(p.timer);
    const { beat } = p;
    const objects = play.round.objects;
    const hit = E.judgeDrop(x, y, play.geo.anchors);

    if (i !== beat.mover) {
      // Wrong thing: name it, put it back, ask again.
      play.busy = true;
      p.firstTry = false;
      moveHome(i);
      await speak({ ja: `それは ${E.WORD[objects[i].id].ja}。`, say: `それは${E.WORD[objects[i].id].say}。`, en: `That’s the ${E.WORD[objects[i].id].en}.` });
      if (!play || play.pending !== p) return;
      await speak(beat.line);
      play.busy = false;
      p.reask();
      return;
    }
    if (!hit) {
      // Not near anything: no harm done, try again.
      moveHome(i);
      p.reask();
      return;
    }
    play.busy = true;
    placeAt(i, hit.anchor, hit.rel);
    if (hit.anchor === beat.anchor && hit.rel === beat.rel) {
      play.pending = null;
      E.recordAsk(state, beat, today(), p.firstTry);
      save();
      await speak(E.whereRightLine(objects, beat));
      await sleep(400);
      moveHome(i);
      await sleep(400);
      play.busy = false;
      p.resolve();
      return;
    }
    // Somewhere else: say where it is, show the right place, then your turn again.
    p.firstTry = false;
    await speak(E.wherePlacedLine(objects, hit.anchor, hit.rel));
    await sleep(600);
    if (!play || play.pending !== p) return;
    placeAt(i, beat.anchor, beat.rel);
    await sleep(500);
    await speak(E.whereLine(objects, beat.mover, beat.anchor, beat.rel));
    await sleep(500);
    moveHome(i);
    await sleep(450);
    if (!play || play.pending !== p) return;
    await speak(beat.line);
    play.busy = false;
    p.reask();
  }

  // ---------- Do it ----------

  function startDo(id) {
    const r = E.ROUTINE[id];
    if (!r) return;
    play = { kind: 'do', id, token: {}, seconds: 0, active: Date.now(), help: false, line: null, steps: E.routineSteps(id), at: 0, paused: false, skip: false, again: false };
    renderPlay();
    keepAwake(true);
    runDo(play.token);
  }

  async function runDo(token) {
    const live = () => play && play.token === token;
    const waitUnpaused = async () => { while (live() && play.paused) await sleep(200); };
    await speak({ ja: 'はじめよう。', say: 'はじめよう。', en: 'Let’s start.' });
    await sleep(600);
    while (live() && play.at < play.steps.length) {
      const step = play.steps[play.at];
      renderStep(step);
      await waitUnpaused();
      if (!live()) return;
      const shownAt = Date.now();
      setTimeout(() => { if (live() && play.steps[play.at] === step) showPic(); }, PIC_DELAY);
      await speak(step);
      // Time to do it, with the line said again halfway through long ones.
      let waited = 0;
      let repeated = false;
      play.skip = false;
      play.again = false;
      while (live() && waited < step.wait * 1000 && !play.skip) {
        await sleep(200);
        if (!live()) return;
        if (play.paused) continue;
        if (play.again) {
          play.again = false;
          await speak(step);
          continue;
        }
        waited += 200;
        play.active = Date.now();
        if (step.repeatAt && !repeated && waited >= step.repeatAt * 1000) {
          repeated = true;
          await speak(step);
        }
      }
      if (!live()) return;
      if (Date.now() - shownAt < PIC_DELAY) showPic();
      play.at++;
      await sleep(300);
    }
    if (!live()) return;
    await speak({ ja: 'おしまい！ よく できました。', say: 'おしまい！よくできました。', en: 'All done! Well done.' });
    finish();
  }

  function renderStep(step) {
    const pic = document.getElementById('do-pic');
    if (pic) { pic.textContent = step.pic; pic.classList.remove('shown'); }
    const n = document.getElementById('do-count');
    if (n) n.textContent = `${play.at + 1} of ${play.steps.length}`;
  }

  function showPic() {
    const pic = document.getElementById('do-pic');
    if (pic) pic.classList.add('shown');
  }

  function togglePause() {
    if (!play || play.kind !== 'do') return;
    play.paused = !play.paused;
    if (play.paused) Voice.stop();
    else play.again = true;
    const b = document.querySelector('[data-action="pause"]');
    if (b) b.textContent = play.paused ? 'Resume' : 'Pause';
    document.querySelector('.play')?.classList.toggle('paused', play.paused);
  }

  // ---------- ending a session ----------

  function finish() {
    if (!play) return;
    const done = play;
    clearTimeout(done.pending && done.pending.timer);
    play = null;
    Voice.stop();
    keepAwake(false);
    save();
    if (done.seconds < 5) { render(); return; }
    const s = E.streak(state, today());
    const met = done.met || [];
    sheetEl.innerHTML = `<div class="sheet-inner summary">
      <p class="eyebrow">${done.kind === 'do' ? esc(E.ROUTINE[done.id].name) : 'Look & point'}</p>
      <h2>${esc(clock(done.seconds))} of Japanese</h2>
      <p class="muted">${minutes(state.time[today()] || 0)} of ${state.settings.goal} min today${s.current ? ` · ${plural(s.current, 'day')} in a row` : ''}</p>
      ${met.length ? `<p class="sum-label">New today</p><div class="met">${met.map((id) => { const w = E.WORD[id]; return `<button class="met-word" data-action="hear" data-id="${id}"><span class="pic">${w.pic}</span><span lang="ja">${esc(w.ja)}</span></button>`; }).join('')}</div>` : ''}
      <button class="btn block" data-action="close-sheet">Done</button>
    </div>`;
    sheetEl.hidden = false;
    render();
  }

  // ---------- rendering ----------

  function render() {
    if (play) return;
    app.innerHTML = `${tabs()}${view === 'today' ? todayView() : view === 'progress' ? progressView() : settingsView()}`;
    if (!state.seenIntro && sheetEl.hidden) showIntro();
  }

  function tabs() {
    const t = (id, label) => `<button class="tab" data-action="view" data-view="${id}" ${view === id ? 'aria-current="page"' : ''}>${label}</button>`;
    return `<header class="top"><nav class="tabs">${t('today', 'Today')}${t('progress', 'Progress')}${t('settings', 'Settings')}</nav></header>`;
  }

  function voiceWarning() {
    if (!Voice.available()) return `<p class="warn">This browser can’t speak. Open Hiyoko in Safari or Chrome.</p>`;
    if (!Voice.hasJapanese()) return `<p class="warn">No Japanese voice found yet. Search iPhone Settings for “Voices”, open Japanese and download one, then come back.</p>`;
    return '';
  }

  function todayView() {
    const d = today();
    const sec = state.time[d] || 0;
    const goal = state.settings.goal * 60;
    const s = E.streak(state, d);
    const metCount = E.metWords(state).length;
    const shield = s.shields ? ` · ${plural(s.shields, 'shield')}` : '';
    let note = '';
    if (s.comeback && sec < E.TINY + 60) note = 'Welcome back. Coming back is the part that counts.';
    else if (sec >= goal) note = 'Goal done for today. Anything more is a bonus.';
    else if (s.doneToday) note = 'Your streak is safe for today.';
    else if (s.current) note = 'Two minutes keeps your streak going.';

    return `
      <p class="date">${esc(longDate(d))}</p>
      <h1>${minutes(sec)} <span class="of">of ${state.settings.goal} min</span></h1>
      <div class="level">
        <div class="level-row"><span>${s.current ? `${plural(s.current, 'day')} in a row${shield}` : 'Start a streak today'}</span><span>${metCount ? `${metCount} words met` : ''}</span></div>
        ${bar((sec / goal) * 100, 'Listening today')}
      </div>
      ${note ? `<p class="note">${esc(note)}</p>` : ''}
      ${voiceWarning()}
      <button class="hero" data-action="point">
        <span class="hero-pics" aria-hidden="true">🐈 🍎 🚗</span>
        <span class="hero-title">Look &amp; point</span>
        <span class="hero-sub">Hear a word, tap the picture.</span>
      </button>
      <h2 class="section">Do it</h2>
      <p class="section-sub">Do what you hear, while you do it for real.</p>
      <div class="list">
        ${E.ROUTINES.map((r) => `<button class="routine" data-action="do" data-id="${r.id}">
          <span class="r-pic" aria-hidden="true">${r.pic}</span>
          <span class="r-text"><b>${esc(r.name)} <span lang="ja">${esc(r.ja)}</span></b><span>${esc(r.blurb)}</span></span>
        </button>`).join('')}
      </div>`;
  }

  function progressView() {
    const d = today();
    const total = E.totalSeconds(state);
    const j = E.journey(state);
    const s = E.streak(state, d);
    const stats = E.itemStats(state);
    const met = E.metWords(state);
    const known = met.filter((w) => stats[w.id] && stats[w.id].known);
    const left = E.WORDS.length - met.length;

    return `
      <p class="date">Listening</p>
      <h1>${esc(duration(total))}</h1>
      <div class="level">
        <div class="level-row"><span>${j.next ? `Next: ${plural(j.next, 'hour')}` : 'Every milestone reached'}</span><span>${j.prev ? `${j.prev} h reached` : ''}</span></div>
        ${bar(j.pct, 'Listening journey')}
      </div>
      <p class="note">Children hear thousands of hours before they say much. Every minute here counts toward that.</p>

      <div class="stats">
        <div><b>${s.current}</b><span>day streak</span></div>
        <div><b>${s.best}</b><span>best</span></div>
        <div><b>${s.shields}</b><span>${s.shields === 1 ? 'shield' : 'shields'}</span></div>
      </div>
      ${calendar(d, s)}

      <h2 class="section">Words</h2>
      <p class="section-sub">${known.length} understood · ${met.length - known.length} still settling${left ? ` · ${left} to meet` : ''}</p>
      ${met.length ? `<div class="words">${met.map((w) => {
        const k = stats[w.id] && stats[w.id].known;
        return `<button class="word ${k ? 'known' : ''}" data-action="hear" data-id="${w.id}" aria-label="${esc(w.ja)}, ${k ? 'understood' : 'still settling'}"><span class="pic">${w.pic}</span><span lang="ja">${esc(w.ja)}</span></button>`;
      }).join('')}</div>
      <p class="fine">Tap a word to hear it. A word counts as understood once you’ve found it three times in a row, on at least two different days.</p>` : '<p class="fine">Words you meet in Look &amp; point show up here.</p>'}
      ${extrasView(stats)}`;
  }

  // Describing and where words, once met.
  function extrasView(stats) {
    const items = [...Object.values(E.ADJ), ...Object.values(E.REL)].filter((x) => state.met[x.id]);
    const next = [];
    if (!state.met.ookii) next.push(`big and small after ${E.SIZE_UNLOCK} words`);
    if (!state.met.ue) next.push(`where things are after ${E.WHERE_UNLOCK} words, including a chair or tree and a box or bag`);
    return `<h2 class="section">Describing and where</h2>
      ${items.length ? `<div class="chips">${items.map((x) => {
        const k = stats[x.id] && stats[x.id].known;
        return `<button class="chip ${k ? 'known' : ''}" data-action="hear-item" data-say="${esc(x.say)}" data-ja="${esc(x.ja)}" data-en="${esc(x.en)}"><span lang="ja">${esc(x.ja)}</span></button>`;
      }).join('')}</div>` : ''}
      <p class="fine">${next.length ? `Coming up: ${esc(next.join('; '))}.` : 'Tap one to hear it.'}</p>`;
  }

  // The last five weeks, Monday first. Filled: goal met. Ring: 2+ minutes. Dot: shield used.
  function calendar(d, s) {
    const shielded = new Set(s.shielded);
    const start = E.addDays(d, -((E.fromKey(d).getDay() + 6) % 7) - 28);
    const cells = [];
    for (let i = 0; i < 35; i++) {
      const k = E.addDays(start, i);
      const sec = state.time[k] || 0;
      let cls = 'day';
      if (k > d) cls += ' future';
      else if (sec >= state.settings.goal * 60) cls += ' goal';
      else if (sec >= E.TINY) cls += ' tiny';
      else if (shielded.has(k)) cls += ' shield';
      if (k === d) cls += ' today';
      cells.push(`<i class="${cls}" title="${esc(k)}: ${minutes(sec)} min"></i>`);
    }
    return `<div class="cal" aria-hidden="true">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((l) => `<b>${l}</b>`).join('')}${cells.join('')}</div>
      <p class="legend" aria-hidden="true"><i class="day goal"></i> goal <i class="day tiny"></i> 2+ min <i class="day shield"></i> shield</p>`;
  }

  function seg(name, options, current) {
    return `<div class="seg" role="radiogroup">${options.map(([value, label]) => `<button role="radio" aria-checked="${String(value) === String(current)}" data-action="set" data-key="${name}" data-value="${value}">${label}</button>`).join('')}</div>`;
  }

  function settingsView() {
    const st = state.settings;
    const current = Voice.pick();
    return `
      <p class="date">Settings</p>
      <h1>Settings</h1>
      <div class="field"><span>Voice speed</span>${seg('rate', [[0.65, 'Slow'], [0.8, 'Gentle'], [0.95, 'Natural']], st.rate)}</div>
      <div class="field"><span>Words on screen</span>${seg('text', [['off', 'Off'], ['kana', 'Kana'], ['both', 'Kana + romaji']], st.text)}
        <p class="fine">Children learn by ear first, so this starts off. The ? button shows the words and the English for one line whenever you need it.</p></div>
      <div class="field"><span>Daily goal</span>${seg('goal', [[5, '5'], [10, '10'], [15, '15'], [20, '20'], [30, '30']], st.goal)}
        <p class="fine">Minutes a day. Two minutes always keeps your streak.</p></div>
      <div class="field"><span>Japanese voice</span>
        ${Voice.list.length ? `<select data-action="voice" aria-label="Japanese voice">${Voice.list.map((v) => `<option value="${esc(v.name)}" ${current && v.name === current.name ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>` : '<p class="fine">None found</p>'}
        <button class="link" data-action="test-voice">Play a sample</button>
        <p class="fine">${Voice.list.length === 1 ? 'This is the only Japanese voice your browser shares with Hiyoko. ' : ''}For a better voice, search iPhone Settings for “Voices”, open Japanese and download an Enhanced or Premium one. If it doesn’t appear here, close Hiyoko completely and reopen it, or restart your phone. Some iOS versions don’t share downloaded voices with web apps.</p>
      </div>
      ${voiceWarning()}
      <div class="list" style="margin-top:28px">
        <button class="row-btn" data-action="intro">How Hiyoko works</button>
        <button class="row-btn" data-action="export">Export backup<span>JSON</span></button>
        <button class="row-btn" data-action="import">Restore from backup<span>Replaces data</span></button>
        <button class="row-btn" data-action="reset">Start over<span>Erases everything</span></button>
      </div>
      <p class="fine">Data stays on this device. Pictures are your device’s emoji.</p>`;
  }

  function renderPlay() {
    const isDo = play.kind === 'do';
    const r = isDo ? E.ROUTINE[play.id] : null;
    app.innerHTML = `<div class="play ${play.kind}">
      <div class="play-top">
        <button class="link" data-action="end">End</button>
        <span class="timer" id="timer">${clock(play.seconds)}</span>
        <button class="help" data-action="help" aria-pressed="false" aria-label="Show the words and English">?</button>
      </div>
      ${isDo
        ? `<p class="do-title">${esc(r.name)} <span id="do-count"></span></p><div class="do-stage"><span id="do-pic" class="do-pic" aria-hidden="true"></span></div>`
        : '<div class="scene" id="scene"></div>'}
      <div class="caption" id="caption" aria-live="polite"></div>
      <div class="play-bottom">
        <button class="btn ghost" data-action="again">Again</button>
        ${isDo ? '<button class="btn ghost" data-action="pause">Pause</button><button class="btn ghost" data-action="skip">Next</button>' : ''}
      </div>
    </div>`;
  }

  function showIntro() {
    sheetEl.innerHTML = `<div class="sheet-inner intro">
      <p class="eyebrow">ひよこ · Hiyoko</p>
      <h2>Learn Japanese the way kids do</h2>
      <ol class="how">
        <li><b>Listen first.</b> You don’t need to read or speak yet. Children understand for months before they talk.</li>
        <li><b>Find what you hear.</b> Tap the picture. When you hear a word you don’t know, guess: it’s probably the thing you don’t have a name for yet. That’s how toddlers do it.</li>
        <li><b>Do what you hear.</b> Narrated routines for real life: coffee, teeth, heading out, moving around.</li>
        <li><b>No English, unless you ask.</b> The ? button shows the words and meaning of one line.</li>
        <li><b>Minutes, not scores.</b> Two minutes keeps your streak. Shields cover the odd missed day.</li>
      </ol>
      <p class="fine">Turn your sound on. On iPhone, check the ringer switch.</p>
      <button class="btn block" data-action="intro-done">Start</button>
    </div>`;
    sheetEl.hidden = false;
  }

  // ---------- backup ----------

  function exportData() {
    const json = JSON.stringify(state, null, 2);
    const name = `hiyoko-${today()}.json`;
    const touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare && typeof File === 'function') {
      const file = new File([json], name, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: 'Hiyoko backup' }).catch((e) => { if (e && e.name !== 'AbortError') download(json, name); });
        return;
      }
    }
    download(json, name);
  }

  function download(json, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.hidden = true;
    document.body.appendChild(input);
    input.onchange = () => {
      const file = input.files[0];
      input.remove();
      if (!file) return;
      file.text().then((text) => {
        const raw = JSON.parse(text);
        const { state: next, dropped } = E.normalize(raw);
        if (!raw || raw.v !== 1) throw new Error('not a backup');
        const note = dropped ? ' Some entries in it can’t be read and will be skipped.' : '';
        if (!confirm(`Replace all current data with this backup?${note}`)) return;
        state = next;
        save();
        render();
        toast('Backup restored');
      }).catch(() => toast('That file isn’t a Hiyoko backup'));
    };
    input.click();
  }

  // ---------- events ----------

  app.addEventListener('click', (e) => {
    const obj = e.target.closest('.obj');
    if (obj) { tapObject(Number(obj.dataset.i)); return; }
    const b = e.target.closest('[data-action]');
    if (b) act(b.dataset.action, b);
  });
  sheetEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (b) act(b.dataset.action, b);
  });
  app.addEventListener('change', (e) => {
    if (e.target.matches('[data-action="voice"]')) {
      state.settings.voice = e.target.value;
      save();
      Voice.say('こんにちは。');
    }
  });

  function act(action, b) {
    switch (action) {
      case 'view': view = b.dataset.view; render(); window.scrollTo(0, 0); break;
      case 'point': startPoint(); break;
      case 'do': startDo(b.dataset.id); break;
      case 'end': finish(); break;
      case 'help': toggleHelp(); break;
      case 'again':
        if (!play) break;
        play.active = Date.now();
        if (play.kind === 'do') play.again = true;
        else if (play.line && !play.busy) Voice.say(play.line.say);
        break;
      case 'pause': togglePause(); break;
      case 'skip': if (play) { play.skip = true; Voice.stop(); } break;
      case 'hear-item': Voice.say(b.dataset.say); toast(`${b.dataset.ja} · ${E.romaji(b.dataset.ja)} · ${b.dataset.en}`); break;
      case 'hear': { const w = E.WORD[b.dataset.id]; if (w) { Voice.say(w.say); toast(`${w.ja} · ${E.romaji(w.ja)} · ${w.en}`); } break; }
      case 'set': {
        const k = b.dataset.key;
        const v = b.dataset.value;
        state.settings[k] = k === 'text' ? v : k === 'goal' ? parseInt(v, 10) : parseFloat(v);
        save();
        render();
        if (k === 'rate') Voice.say('ねこは どこ？');
        break;
      }
      case 'test-voice': Voice.say('こんにちは。ひよこです。いっしょに にほんごを ききましょう。'); break;
      case 'intro': showIntro(); break;
      case 'intro-done': state.seenIntro = true; save(); closeSheet(); break;
      case 'close-sheet': closeSheet(); break;
      case 'export': exportData(); break;
      case 'import': importData(); break;
      case 'reset':
        if (confirm('Erase all words, listening time and settings?')) {
          state = E.emptyState();
          state.seenIntro = true;
          save();
          render();
          toast('Started over');
        }
        break;
      default: break;
    }
  }

  function closeSheet() {
    sheetEl.hidden = true;
    sheetEl.innerHTML = '';
    render();
  }

  // Refresh the date-dependent screens when the day changes or the app returns.
  let lastDay = today();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    // A voice may have been downloaded while the app was in the background.
    const before = Voice.list.map((v) => v.name).join();
    Voice.refresh();
    const voicesChanged = Voice.list.map((v) => v.name).join() !== before;
    if (today() !== lastDay || voicesChanged) { lastDay = today(); render(); }
  });

  render();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support unavailable */ });
  }
})();
