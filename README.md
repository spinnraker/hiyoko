# Hiyoko ひよこ

Learn Japanese the way small children do: by hearing it in context and showing you understood, not by translating, typing or drilling. Same look and setup as Habito and DTF: black and white, no account, works offline.

## Use it

```sh
npm start          # http://localhost:8080
npm test           # engine tests
```

No dependencies and no build step. To put it on your iPhone, host the folder on any static host (GitHub Pages works), open it in Safari, then Share → Add to Home Screen. Data stays on the device; use Settings → Export backup to keep a copy.

**Voice:** it uses your phone's Japanese voice. On iPhone, download an Enhanced one for much better sound: Settings → Accessibility → Spoken Content → Voices → Japanese. Pick it in Hiyoko → Settings.

## How children learn, and what the app does about it

| Children… | So Hiyoko… |
|---|---|
| understand for months before they speak | only asks you to listen and point. No speaking or typing. |
| get meaning from the situation, never from translation | has no English on screen. The **?** button shows the words and meaning of one line when you're stuck. |
| work out new words by elimination ("the thing I don't have a name for yet") | introduces each new word as a guess: one unfamiliar picture among familiar ones. |
| learn words attached to actions ("put on your shoes") | narrates real routines (**Do it**) while you do them. The picture comes a moment after the words, so you try to understand first. |
| hear simplified, slow, repetitive speech | uses a slowed voice, short sentences, the same patterns over and over, and brings weak words back more often. |
| need thousands of hours of input | measures progress in **listening time**, with milestones at 1, 5, 10, 25 … 1000 hours. |

## Look & point

Rounds of 3 to 6 pictures. The voice asks 「ねこは どこ？」 ("Where's the cat?") and you tap it.

- **Right:** 「そう！ ねこ。」
- **Wrong:** it names what you tapped (「それは いぬ。」), points at the right one (「ねこは これ。」) and asks again. Only the first tap is graded.
- **New words:** at most 6 a day, and only once the earlier words are steady (the last two answers right).
- **Unlocks:** big and small (おおきい／ちいさい) arrive once 6 words are understood, and pairs (「ねこと いぬは どこ？」) at 10.
- **Understood** means three right in a row, on at least two different days.

## Do it

Hands-free routines. Put the phone down and do what you hear:

- **Move your body:** 10 commands like stand up, touch your nose, close your eyes. Shuffled every time, so you have to listen.
- **Coffee, Brush your teeth, Heading out:** real routines, said as you do them.

Long steps repeat the line halfway through. Use Again, Pause and Next as needed. The screen stays awake.

## Streaks (Habito's rules)

- Two minutes counts for the day. The daily goal (10 minutes by default) is a target, not a requirement.
- Every 7-day run earns a shield, up to 3. A shield covers a missed day automatically.
- Coming back after a break is welcomed, not punished.
- Time only counts while a session is open, on screen, and something happened in the last 45 seconds.

## How it works

- `engine.js` is pure logic with tests. It holds the content (31 words, 4 routines), builds rounds, judges what you know from the answer log, and works out the streak, shields and listening journey. It also has a kana → romaji converter for the optional captions.
- `app.js` handles the UI, voice (Web Speech API, `ja-JP`) and storage (`localStorage`, key `hiyoko:v1`). Saved and imported data is checked on load. Anything that can't be read is kept under a `hiyoko:v1:unreadable:*` key instead of being overwritten.
- The voice reads kanji versions of each line (`say`), so it pronounces particles and short words correctly. The screen shows kana with spaces between words, like a children's book (`ja`).
- The pictures are your device's emoji, shown in grayscale.
- `sw.js` caches the app for offline use. Bump `CACHE` when you ship changes.

## Next ideas

- More scenes: where things are (on, under, in), counting, colours by word.
- Short picture stories that use known words plus one new one, retold with small changes.
- Optional shadowing: the voice says a line, you repeat it.
- Have a native speaker check or record the lines. Phone voices sometimes get pitch accent wrong.
