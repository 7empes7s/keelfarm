# Voice messages

The office can read the CEO's phone messages aloud the moment they arrive, in a voice you pick, without opening the
phone. Two voices are on offer:

- **Browser:** your browser's own text-to-speech. Free, offline, robotic.
- **ElevenLabs:** natural voices from [ElevenLabs](https://elevenlabs.io), with your own API key. Costs a little per
  message (below).

Office notes (merges, errors, decisions) are spoken too only if you turn on **Speak office notes**.

It listens too: you can talk to the CEO and the agents instead of typing ([Talking instead of typing](#talking-instead-of-typing)).

Facts about ElevenLabs below were checked against its docs and pricing pages in October 2026.

## Getting an ElevenLabs key

1. Sign up at [elevenlabs.io](https://elevenlabs.io). Library voices, including the shortlist below, need a paid plan
   to be used through the API ("Voice Library voices are not available via the API to free tier users").
2. Open **Developers → API Keys** and create a key. If you restrict it, allow **Text to Speech** and **Voices (read)**.
   You can also give it a credit quota there, as a spending cap for the office.
3. Paste it into the office's voice settings. The office checks it with one call (listing one voice) before saving it.

Where the key lives: `<SWARM_HOME>/secrets.json` (`~/.cubefarm/secrets.json` by default), readable only by you where the
OS has file modes. It is never written to `state.json`, never sent to the browser (the settings show its last 4
characters), never logged and never given to agents. A demo office keeps its own `demo-secrets.json`. Clear the key in
the settings to delete it.

If ElevenLabs ever answers with 401 (the key was revoked or deleted), the office tells you once on the phone and stops
calling ElevenLabs until you enter a new key.

## Model and cost

Settings → Voice → **Model** shows each model with its API price per 1,000 characters. A new office starts on
**`eleven_v4`** (#282: messages are short spoken summaries now, so the best model costs little); an office set up
before keeps the model it saved (Eleven v4 Turbo, and before it Flash v2.5, were the old defaults). The labels say
quality versus speed in plain words.

| Model | Label | Price / 1,000 chars | Why |
| --- | --- | --- | --- |
| `eleven_v4` (new offices) | Best quality | $0.08 | the richest delivery, up to 10,000 characters a request; a moment slower |
| `eleven_v4_turbo` | Natural and quick | $0.04 | Eleven v4's real-time model (~100–150 ms): expressive, inline audio tags such as `[laughs]`, `[sighs]`, `[whispers]` |
| `eleven_multilingual_v2` | Steady | $0.08 | older high-quality model, consistent |
| `eleven_flash_v2_5` | Fastest | $0.04 | fastest (~75 ms), plain |

Every clip is sent with `voice_settings` ([API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)):
stability 0.5, similarity boost 0.8, style 0.15 and speaker boost on, a little livelier than ElevenLabs' defaults; they
are part of a clip's cache name, so changing them makes new clips.

Eleven v4 and v4 Turbo launched on 28 September 2026 ([blog](https://elevenlabs.io/blog/eleven-v4),
[models](https://elevenlabs.io/docs/models)); v4 prices from [OpenRouter](https://openrouter.ai/elevenlabs/eleven-v4).

What a message costs: Flash and v4 Turbo cost about **$0.04 per 1,000 characters** (Multilingual v2 and v4: $0.08). A CEO
message is heard as its spoken summary, at most 300 characters (usually 100–200), so about **1–2 cents** on Eleven v4
(under a cent on v4 Turbo); "Read the whole message" speaks up to about 1,500 characters (about 12 cents on v4). On a
subscription plan the same text uses credits from your monthly allowance instead. Each message is synthesized once and
cached (`<SWARM_HOME>/voice/`, at most 200 clips, kept 7 days by default), so replaying it is free. The settings' **Test** button
speaks one short line (about 60 characters) and caches it too.

## Speed

Settings → Voice → **Speed**: 0.7× to 1.2× in steps of 0.05, 1× by default. ElevenLabs gets it as
`voice_settings.speed` on every clip ("available for all voices and all models",
[help centre](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/can-i-change-the-pace-of-the-voice.md));
note that ElevenLabs' [Eleven v4 page](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4) says
v4 has no Speed slider, so a v4 voice may keep its own pace. The speed is part of a clip's cache name, so a new speed
makes new clips. The browser's voice uses the same number as its rate.

## Favourites, the newest voices and a voice for every agent

Every voice picker (Settings → Voice, and each profile: agent window → Profile) has a search, a star on each voice and
a preview. Starred voices (`settings.voice.favourites`, ids only, at most 50) come first everywhere, then the
**Eleven v4** voices, then the shortlist below, then the rest. The office knows a v4 voice from ElevenLabs' own
metadata in the voice list (a voice whose `high_quality_base_model_ids` or `verified_languages` name an `eleven_v4`
model), rather than a hard-coded list of the 21 voices v4 shipped with: ElevenLabs' docs don't publish their ids.

Each agent has a voice of their own (`voiceId` / `voiceName` on the agent). A new agent gets one by themselves, from
the favourites, else the v4 voices, else the shortlist, one nobody on their floor has while there are enough; so does
everyone still without one when a key is saved or ElevenLabs is turned on. Change it in their profile, or tap
**Shuffle** for another. The CEO's profile shows the office voice (`settings.voice.voiceId`): it is the one that reads
messages aloud and talks in voice mode, so changing it there or in Settings → Voice changes both. The pickers show
only while ElevenLabs is on with a key; otherwise the profile says so, with a button to Settings → Voice.

## Shortlisted voices

ElevenLabs' old Default voices (Rachel, Sarah, George, …) **expire on 31 December 2026**, and accounts created after
March 2026 never had them. The shortlist is therefore taken from the new voices ElevenLabs recommends as their
replacements, which stay usable for good. They're in the Voice Library and can be used by id without saving them; save
one to **My Voices** to see it on elevenlabs.io too. The office marks these `recommended` in the voice list and shows
them as **Recommended**, after your favourites and the v4 voices and before the rest of your account's voices.

| Voice | Id | Why it suits a calm, friendly CEO |
| --- | --- | --- |
| Talia: Warm Soft Guide | `OZ0L6eISlOejga3XjDFt` | gentle and warm; good news and bad news both land softly. The default. |
| Eddie: Helpful and Comforting | `l7kNoIfnJKPg7779LI2t` | reassuring, never pushy: right for "here's what's blocked and why". |
| Caleb: Trusted Guide | `AaOhDHYJ1XLZk74lXhdE` | steady and credible; sounds like someone who has the plan in hand. |
| Darian: Warm Grounded Storyteller | `gOupLcAkjEnguROwi4oS` | relaxed and grounded; makes a progress summary sound like a story. |
| Alicia: Polished Global Anchor | `BFd5oBc2DDna33pSi4Gf` | clear newsreader delivery; easy to follow over music or office noise. |
| Maisie: Friendly Casual Neighbor | `QtY3JBOUKEB5xzrRfOKc` | chatty and informal, for a startup that doesn't do corporate. |
| Wyatt: Seasoned Mentor | `FrS6cKLB1wg4WYgPa9GW` | older, calm and unhurried; a CEO who has seen it all. |
| Eldrin: Crisp British Baritone | `6WwXjDDEMyNmFG95zycZ` | deep and composed, with a British accent. |

They replace Sarah, Eric, Chris, Roger, Alice, Matilda, Bill and George respectively. Listen to them (the Test button,
or ElevenLabs' Voice Library) before you choose: tone matters more than the description.

## What gets read

The CEO ends each message with a short ```` ```spoken ```` block (#282): 1–3 sentences, under 300 characters, the useful
news and what it needs, said the way a colleague would on the phone. That's what both voices read, not the text. A
message without one (older messages, office notes) is heard as its first paragraph, at most three sentences.
Bookkeeping ("I've answered message 1865 on your phone"), and a job's closing text after it already answered with the
reply tool, is never read aloud. The ⋯ menu's **Read the whole message** reads all of it.

Before speaking, a message is tidied for the ear (`shared/speech.ts`, used by both voices): markdown and emoji are
removed, `#123` becomes "number 123", a URL becomes "a link", and long messages are cut at a sentence end after about
1,500 characters.

## In the office

A message is spoken as it arrives, whether the phone is open or not, and also while the office tab is in the
background. Browsers only allow sound after your first click or key in the tab, so anything that arrived before that,
and anything already on the phone when the page loads, stays silent. Messages are read one at a time, in order; at
most 3 wait their turn and anything older than 2 minutes is skipped. With several office tabs open, only one reads
each message (the one you're looking at, if any).

The **Voice** slider in the sound settings (help, **H**) sets its level under the master volume, and **M** mutes it
like every other sound. Other office sounds dip by about 8 dB while a message is spoken. A 🔊 on the phone icon shows
it's speaking; click it to stop. If the clip can't be fetched (no key, ElevenLabs down), you hear the usual message
chirp instead. `window.__swarmVoice` lists the messages read aloud (`id`, `provider`, `start`, `end`, `volume`, and
`replay: true` for a replay).

## While the CEO works

When you send a message (typed or spoken) while the CEO is in the middle of a job, the office says a short ack in the
CEO's voice within about a second when the speaker is free: "Got it, I'll fold that in.", "Heard you, one moment." and so on, from a fixed list,
so it costs no model call, and never two within 20 s. The CEO is asked to answer you right away with a sentence or two
and carry on, so you hear it mid-job rather than at the end. If another message is being read, the ack waits briefly
for it to finish, ahead of the next reply; a reply arriving while the ack loads or plays waits for the ack to finish.
Acks waiting longer than twenty seconds are dropped, and barge-in clears both playing and waiting lines.

**Talk while working** (Settings → Voice) adds short spoken progress from the CEO's step log: **Milestones** (an issue
filed, waiting on QA or a merge, a PR sent back) or **Regular** (also a line about once a minute, e.g. "Still reading a
pull request's changes."). It's Off by default; during a call Off means Milestones. Lines never carry issue numbers,
paths or markdown, never start while your mic is open or something else is being said, and stop when a message
arrives or you talk over them. Acks and progress show as a small chip under the CEO's live reply, never as chat
messages. With ElevenLabs each is a short clip: an ack is about 25 characters and made once ever (cached by its
words), a progress line about 40, so an hour of Regular at fifty-second intervals is roughly 72 × 40 = 2,880
characters, plus milestones. Actual cost depends on the ElevenLabs plan and cache hits.
`window.__swarmVoiceLines` lists the lines a tab said (`id`, `kind`, `text`, `provider`). The demo office talks after
seconds rather than a minute, so its short jobs can be heard.

## Replaying a message

Every CEO message that was read aloud has a ▶ in the phone chat. It plays the clip saved when the message first
arrived, never a new one: `clips.json` in the cache folder records which clips belong to which message, so a message
keeps its clip after you pick another voice or model. A message read by the browser's voice is said again by the
browser (free). While it plays the button shows ⏹; replaying stops whatever is being read, and a new message stops a
replay. When a clip has been deleted, the ▶ is greyed out with "Audio no longer saved". Messages that arrived with the
voice off have no button.

The cache is tidied when the office starts and on its housekeeping timer (every 15 minutes): clips older than
**Keep voice clips for N days** (Settings → Voice, 1–90, default 7) go, then the oldest beyond 200, but the clips of the
newest 20 CEO messages always stay. Settings → Voice also shows the cache's size and has **Clear saved clips**.

## Talking instead of typing

Every message box has a 🎙️ next to Send: the phone's CEO chat, an agent's panel and the CEO tab of the manager's
console. **Hold** it, or hold **V** while the caret is in the box (or anywhere on that phone or panel outside another
field), and speak: the words fill the box as you go, and letting go leaves them there to edit before you send. A quick
tap of V still types a "v"; only a press held for 0.3 s talks, and V never talks in other fields. A **tap** of the 🎙️
listens until you stop talking (about 1.2 s of quiet), or until you tap it again; if nobody speaks it gives up after 8 s.
**Esc** stops listening (without closing the phone or the panel), typing in the box takes over from the mic, and
sending by hand stops it too. Typing works exactly as before.

Settings → Voice → **Talk instead of type** picks who turns speech into text:

- **Browser** (the default): the browser's own speech recognition (the Web Speech API's `SpeechRecognition`), free.
  Chrome, Edge and Safari have it; where the browser doesn't (Firefox), the 🎙️ is dimmed and says so when pressed.
  The live transcript appears as you speak. Chrome and Edge send the audio to their makers' speech services to
  recognise it.
- **ElevenLabs Speech to Text**: the browser records the clip (MediaRecorder, WebM/Opus in Chromium) and sends it to the
  office, which sends it to ElevenLabs (`POST /v1/speech-to-text`, model `scribe_v2`, audio-event tags off) with the key
  above; the text comes back when you let go. A clip is at most 60 seconds and 5 MB. ElevenLabs charges by the length
  of the audio; a restricted key needs the **Speech to Text** permission. The key is handled exactly like the voice's:
  it never reaches the browser, the logs or the snapshot.
- **Off**: no 🎙️ anywhere.

**Send automatically when I stop talking** (off by default) sends what you said after about 1.2 s of quiet, instead of
leaving it in the box; letting go of a hold sends it too.

**Hands-free** (the 🎧 on the phone's chat, off by default; also in Settings → Voice) is a conversation without
touching anything: when the CEO's reply has been read aloud, a soft chime plays and the phone listens for up to 8 s with
a pulsing 🎙️. Say something and it's sent once you stop; say nothing and it closes (with a falling chime). **Esc** or
**M** closes it straight away. It needs the CEO's voice on, the phone open on the chat in the tab you're looking at, and
an empty message box; it never asks for the microphone on its own (turning it on asks, from that click). For a
conversation that goes on whatever is on screen, on a desktop too, call the CEO instead ([Calling the CEO](#calling-the-ceo)).

Manners: the browser asks for the microphone the first time you press the 🎙️ (or turn hands-free on), and a refusal
is explained in one line. The mic is only ever on while you hold the button or V, or while the pulsing 🎙️ shows
(a tap, hands-free). While it listens, the jukebox and other sounds dip, a message being read dips by about 15 dB (the
browser's voice pauses), the office's cues (merge, QA, errors) wait until it closes, and the merge gong stays quiet.

`window.__swarmMic` shows the 🎙️'s `state` (`idle`, `listening`, `transcribing` or `error`), `mode` (`hold`, `tap`,
`handsfree`), whether the mic is `live`, the last `transcript`, the `provider`, the last `error`, what this browser
`supported`s, the hands-free state and a `history` of sessions with their outcome. Headless browsers have no mic:
`__swarmMic.fake()` swaps the browser's recognition for a stand-in, and `__swarmMic.say(text, final = true)` is what it
hears (with ElevenLabs, `say()` marks speech for the silence detector). The rules are pure and tested:
`client/src/ui/micSilence.ts` (when you've stopped talking), `handsFree.ts`, `micKeys.ts`, `micText.ts` and
`shared/clipLimits.ts`.

## Calling the CEO

**Call** (the 📞 in the CEO chat's toolbar) starts a voice call with the CEO, on a phone, a desktop or in pocket mode.
You just talk; the CEO answers aloud; you talk again. Talking while the CEO speaks interrupts it. The call goes on
whatever you open: panels, sheets, Settings, other pages, the chat closed, the 3D/pocket switch.

- **Phone and home-screen app:** a call screen like a phone call: the CEO's orb (a ring while it talks, green while
  it listens), the name, a call timer, live captions, and **Mute**, **Speaker**, **Pause**, **Skip**, **Captions** and
  a red **End**. ⌄ folds it into a pill at the top while you use the app; tap the pill to come back. 💬 opens the chat
  without ending the call.
- **Desktop and tablet:** the chat tucks away and a CEO orb follows you across every page. Drag it to any corner (the
  top ones sit below the panels' headers, so it never covers a ✕). Click it for the call card with the same controls
  and **Open chat**.
- **Keys** (not while typing or in a terminal): **Space** pauses or resumes (or talks, in tap-to-talk), **→** skips
  to the next sentence, **M** mutes the mic (not the office), **Esc** ends the call from the call screen or card (anywhere
else it still closes what's open).
- **Mute** turns the mic off; the CEO still talks. **Pause** stops the CEO's voice where it is and turns the mic off;
  **Resume** carries on from there (the browser's voice starts that sentence again). **Skip** moves to the next
  sentence. **Speaker** off reads at about a third of the volume, like a phone's earpiece. **End** hangs up and brings
  the chat back, with every turn of the call in it.
- **Turns:** the mic listens all through the call (with echo cancellation), with the same rules as hands-free (about
  1.2 s of quiet ends your turn) but no chime each time. Talking over the CEO for about 0.3 s stops its voice at once
  and becomes your next message; a cough, a short noise or "mm-hm" doesn't.
- **Away:** leaving the tab or locking the phone puts the call on hold: the mic closes (it never records in the
  background) and opens again when you're back. Closing the tab ends the call. The office's new client never loads
  during a call (#216): it waits for **End**.
- **Quiet during a call:** the office's cues, the merge gong, toasts, desktop notifications and Web Push / chat-app
  notifications (on every device) wait. Each is still in the notifications list, and the toasts show when the call
  ends. Only the CEO's voice reaches you, so urgent things come from the CEO.
- **Voices:** the CEO speaks in the voice from Settings → Voice; with Speak messages off, a call still speaks, in the
  browser's voice. It listens with Talk instead of type's provider, or the browser's recognition when that's off.
- **No mic:** when the mic is refused or the browser can't listen, the call says why in one line and falls back to
  tap-to-talk: a **Talk** button (or Space) for each turn.

Nothing else changed: the 🎧 hands-free switch, hold/tap/V to talk, saved clips, ▶ replay and the dips work as
before, and with no call on nothing opens the mic or starts reading by itself unless those settings say so.

`window.__swarmCall` is the call's probe: `id` (the session, the same for the whole call), `phase` (`idle`,
`connecting`, `listening`, `thinking`, `speaking`, `ended`), `state` (also `muted`, `paused`, `away`, `tapToTalk`,
`reply`, `held` notifications, `heard`, `minimised`), `position()` (the reply being read: `{ id, sentence, ms }`),
`start()` and `end()`. The demo office calls with the fake mic (`__swarmMic.fake()` and `say()`) and the demo's
voice; its clips last about as long as reading the message would (up to 6 s), so there's time to pause, skip and
talk over them. The rules are pure and tested: `client/src/ui/voiceCall.ts` (the session's state machine, barge-in,
sentences); `voiceCallEngine.ts` runs it and `CallScreens.tsx` draws it.

## How a voice call behaves

What the call is modelled on: ChatGPT Voice, Claude's voice mode and ElevenLabs' conversational agents, from their
public help pages (read in November 2026; OpenAI's pages were read through search extracts, as they refuse automated
fetches).

| | ChatGPT Voice | Claude voice mode | ElevenLabs | The office |
| --- | --- | --- | --- | --- |
| Entering and leaving | the Voice icon; the exit icon ends it [1] | the sound-wave button; it stays in voice mode until **Stop** [3] | the app starts and ends a session | **Call** in the chat; only **End** (or closing the tab) ends it |
| Where it shows | inside the chat by default, or a separate full-screen orb (Settings → Voice → Separate Mode) [2] | in the chat | the app's own | a call screen on phones, an orb and card on desktops; the chat stays one tap away |
| Turn-taking | listens and speaks at once; how it decides you're done isn't documented [2] | "listens continuously and responds to natural pauses"; push-to-talk as an option [3] | eagerness: eager, normal or patient; "take turn after silence" 1-30 s [5] | ~1.2 s of quiet ends your turn (micSilence's hands-free rules); tap-to-talk without a mic |
| Interrupting | speak while it talks; noise or other voices can interrupt by mistake [1] | "just start talking. Claude will stop and listen" [3] | speaking mid-response cancels the reply [4]; interruptions can be turned off [5] | ~0.3 s of real speech stops the voice; noise and "mm-hm" don't |
| Mute | a mic button bottom-left [1] | not documented | not documented | **Mute** or M: mic off, the call and the CEO's voice go on |
| Switching apps, locking | goes on in the background if Background Conversations is on; Live Activity on the lock screen [1] | not documented | not documented | the call stays on across every screen; a hidden tab or locked phone stops listening and resumes on return |
| Notifications during a call | not documented | not documented | not documented | held: in the list, toasts after the call, no pushes; the CEO says what matters |
| Pause, skip | not documented | not documented | a "skip turn" tool lets the agent wait when you ask for a second [6] | **Pause**/**Resume** where it was, **Skip** a sentence |
| Captions, transcript | a transcript lands in the chat afterwards [7] | transcripts saved in the chat history [3] | not documented | live captions on the call screen; every turn is a chat message |

Choices that follow from it: the call never depends on what's on screen (both apps keep a voice session going outside
the chat); barge-in needs a few hundred ms of speech that isn't a backchannel, because OpenAI warns that noise
interrupts by mistake [1]; nothing listens in a background tab, since a browser tab can't show a lock-screen indicator
the way ChatGPT's Live Activity does [1]; and as none of them say what happens to notifications, the office keeps them
for after the call so nothing talks over the CEO.

1. OpenAI, Voice Mode FAQ: https://help.openai.com/en/articles/8400625-voice-mode-faq
2. OpenAI, ChatGPT release notes (voice in the chat, Nov 2025; GPT-Live-1, Jul 2026): https://help.openai.com/en/articles/6825453-chatgpt-release-notes
3. Anthropic, Use voice mode: https://support.claude.com/en/articles/11101966-use-voice-mode
4. ElevenLabs, Speech Engine: https://elevenlabs.io/docs/overview/capabilities/speech-engine
5. ElevenLabs, Conversation flow (turn eagerness, interruptions, timeouts): https://elevenlabs.io/docs/eleven-agents/customization/conversation-flow
6. ElevenLabs, Skip turn: https://elevenlabs.io/docs/eleven-agents/customization/tools/system-tools/skip-turn
7. OpenAI, ChatGPT Voice: https://help.openai.com/en/articles/20001274-chatgpt-voice

## API

| Route | What it does |
| --- | --- |
| `PUT /api/voice/key` `{ key }` | checks and saves the key; `""` removes it. 400 if ElevenLabs rejects it |
| `GET /api/voice/voices` | `[{ id, name, category, labels: { accent, gender, age, description, use_case }, previewUrl, recommended, v4? }]`, cached 10 minutes; 409 without a key |
| `PATCH /api/agents/:id` `{ voiceId, voiceName }` | an agent's voice; `""` clears it. 400 for the CEO (theirs is `settings.voice`) or a bad id |
| `GET /api/voice/messages/:id` | `audio/mpeg` for a CEO message (or an office note with Speak office notes on); 404 when the voice isn't ElevenLabs or there's no such message, 502 when ElevenLabs fails |
| `GET /api/voice/messages/:id?cached=1&part=N` | the phone's ▶: part N of the message's saved clips (`X-Voice-Parts` says how many), or 404 when none is saved. Never calls ElevenLabs |
| `DELETE /api/voice/cache` | deletes every saved clip |
| `GET /api/voice/sample?voiceId=…` | the Test line in that voice (default: the chosen one) |
| `POST /api/voice/transcribe` | the 🎙️ with ElevenLabs: the recorded clip as the body (`Content-Type` its audio type, `X-Clip-Ms` its length) → `{ text }`. 409 when ElevenLabs isn't the provider or there's no key, 413 over 60 s or 5 MB, 415 for anything but WebM, Ogg, MP4, MP3 or WAV, 502 when ElevenLabs fails |
| `GET /api/voice/lines/:id` | an ack or progress line the office just sent in a `voiceLine` event (the latest 20), made once per wording and cached; 404 when the voice isn't ElevenLabs or the line is gone |
| `GET /api/voice/standup?n=3&part=morning` | the CEO's line at a stand-up in the 3D office ("Morning team, three new features today!"; `part` is `morning`, `afternoon` or `evening`), made once per wording and cached; 404 when the voice isn't ElevenLabs |

Settings travel in `settings.voice` (`PATCH /api/settings`): `{ provider: 'off' | 'browser' | 'elevenlabs', voiceId,
voiceName, model, speakOffice, keepDays, speed, favourites, talk: 'off' | 'milestones' | 'regular' }`, and listening in `settings.listen`: `{ provider: 'off' | 'browser' |
'elevenlabs', autoSend, handsFree }`. The snapshot has `voiceKeySet`, `voiceKeyHint` and `voiceCache`
(`{ clips, bytes, saved }`, `saved` being the message ids the ▶ can replay); a `voiceKey` event follows every key change
and a `voiceCache` event every change to the cache. A phone message's `voice` says who read it when it arrived. One clip is made at a time (20 s timeout); requests for a clip that's being made share that call.

The demo office (`--demo`) fakes all of it with no network: any key except one containing "bad" is accepted, there are
nine voices (six of them v4, from `server/demoVoices.ts`), every message is a short generated chime (a WAV), pitched by the voice, cached and replayed like a
real clip. Its Speech to Text hears "What's everyone working on?" in any recording. The server logs `voice: made a new
clip …` for every clip it makes and `voice: transcribed a 2.4 s clip (30 KB)` for every transcription (never the words).
