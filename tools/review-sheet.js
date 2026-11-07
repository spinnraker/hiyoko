// Writes REVIEW.md: every word and sentence pattern Hiyoko says, for a native
// speaker to check. Generated from engine.js so it always matches the app.
// Run: npm run review
const fs = require('fs');
const path = require('path');
const E = require('../engine.js');

let n = 0;
const rows = [];
const row = (ja, en, note = '') => `| ${++n} | ${ja} | ${en} | ${note} | |`;
const head = '| # | Japanese | Meaning | Notes | OK? / suggestion |\n|---|---|---|---|---|';

const ex = (words) => words.map((id) => E.WORD[id]);
const [neko, inu] = ex(['neko', 'inu']);
const objs = [{ id: 'isu' }, { id: 'hako' }, { id: 'neko' }];

rows.push(`# Hiyoko: Japanese review sheet

Thank you for checking this. Hiyoko teaches complete beginners Japanese the way a parent talks to a small child: short, simple, casual (plain form, not です／ます). Learners hear these lines and respond by tapping or moving pictures, or by doing the action.

**Please check:**
- Is each line natural, in that casual parent-to-child style?
- Is anything wrong, odd or old-fashioned? Would a different word be more natural?
- Do the kanji in the "voice reads" column read the way the kana does? The phone's voice reads those versions.

Write "OK" or a suggestion in the last column. Lines with X, Y or A are patterns: the app puts any word from section 1 in that slot.

_Generated from engine.js by \`npm run review\`._
`);

rows.push('## 1. Words\n');
rows.push('| # | Japanese | Voice reads | Meaning | Picture | OK? / suggestion |\n|---|---|---|---|---|---|');
for (const w of E.WORDS) rows.push(`| ${++n} | ${w.ja} | ${w.say} | ${w.en} | ${w.pic} | |`);
for (const w of [...Object.values(E.ADJ), ...Object.values(E.REL)]) rows.push(`| ${++n} | ${w.ja} | ${w.say} | ${w.en} | | |`);

rows.push('\n## 2. Finding pictures (Look & point)\n');
rows.push(head);
rows.push(row(`これは X。 → これは ${neko.ja}。`, 'This is the X.', 'Introducing a word while pointing at it'));
rows.push(row(`X。 → ${neko.ja}。`, 'The X.', 'Said again after the line above'));
rows.push(row(`Xは どこ？ → ${neko.ja}は どこ？`, 'Where’s the X?', 'The main question'));
rows.push(row(`おおきい Xは どこ？ / ちいさい Xは どこ？`, 'Where’s the big / small X?', 'Two sizes of the same thing on screen'));
rows.push(row(`Xと Yは どこ？ → ${neko.ja}と ${inu.ja}は どこ？`, 'Where are the X and the Y?', 'Learner taps both'));
for (const p of ['そう！', 'そうそう！', 'いいね！', 'あたり！']) rows.push(row(`${p} X。 → ${p} ${neko.ja}。`, 'Yes! The X.', 'Praise after a right answer'));
rows.push(row(`そう！ これが X。`, 'Yes! This is the X.', 'Right answer when X was a brand-new word they guessed'));
rows.push(row(`それは Y。`, 'That’s the Y.', 'After a wrong tap: names what they tapped'));
rows.push(row(`Xは これ。`, 'The X is this one.', 'Then points at the right one'));
rows.push(row(`これが X。`, 'This one is the X.', 'Same, for a brand-new word'));

rows.push('\n## 3. Where things are (Look & point)\n');
rows.push(head);
rows.push(row(E.whereLine(objs, 2, 0, 'ue').ja, E.whereLine(objs, 2, 0, 'ue').en, 'Pattern: Xは Aの うえ／した／なか／よこ。 Said while the app moves it there'));
for (const [a, rel] of [[0, 'ue'], [0, 'shita'], [1, 'naka'], [1, 'yoko']]) {
  const l = E.putLine(objs, 2, a, rel);
  rows.push(row(l.ja, l.en, rel === 'naka' ? 'Pattern: Xを Aの なかに いれて。' : `Pattern: Xを Aの ${E.REL[rel].ja}に おいて。`));
}
rows.push(row(E.whereRightLine(objs, { mover: 2, anchor: 0, rel: 'ue' }, () => 0).ja, 'Yes! The cat is on the chair.', 'After a right move'));
rows.push(row(E.wherePlacedLine(objs, 0, 'shita').ja, 'That’s under the chair.', 'After a wrong move: says where they put it, then shows the right place'));
rows.push(`\nThings that get moved: ${E.MOVERS.map((id) => E.WORD[id].ja).join('、')}. Places: ${Object.entries(E.ANCHORS).map(([id, rels]) => `${E.WORD[id].ja} (${rels.map((r) => E.REL[r].ja).join('・')})`).join('、')}.\n`);

rows.push('\n## 4. Do it (narrated routines)\n');
for (const r of E.ROUTINES) {
  rows.push(`### ${r.name} (${r.ja})${r.shuffle ? ': said in random order' : ''}\n`);
  rows.push('| # | Japanese | Voice reads | Meaning | OK? / suggestion |\n|---|---|---|---|---|');
  for (const st of r.steps) rows.push(`| ${++n} | ${st.ja} | ${st.say} | ${st.en} | |`);
  rows.push('');
}

rows.push('## 5. Other lines\n');
rows.push(head);
rows.push(row('はじめよう。', 'Let’s start.', 'Start of a routine'));
rows.push(row('おしまい！ よく できました。', 'All done! Well done.', 'End of a routine'));
rows.push(row('こんにちは。ひよこです。いっしょに にほんごを ききましょう。', 'Hello, I’m Hiyoko. Let’s listen to Japanese together.', 'Voice sample in Settings'));

fs.writeFileSync(path.join(__dirname, '..', 'REVIEW.md'), rows.join('\n') + '\n');
console.log(`REVIEW.md: ${n} items`);
