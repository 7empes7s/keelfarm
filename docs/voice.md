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

### Agents speak when clicked

With ElevenLabs on and a key set, clicking or pressing **E** on an agent in 3D, or tapping them in the team list or
their window's avatar, has them say one short line in their own voice: what they're on ("I'm on #301, lighter QA
browser. Going well!"), testing, fixing, stuck and needing you, waiting for memory, free, a fresh merge, or sleepy late
at night. The CEO gives a one-line company status. In 3D the line comes from their head with their speech bubble; a
busy agent's window still opens, and the line plays as it does. Lines are templates filled with real facts
(`shared/agentLines.ts`), never a model call; Eleven v4's audio tags (`[laughs]`, `[sighs]`, `[yawns]`, `[whispers]`)
reach ElevenLabs only with a v4 model. Clips are cached by voice, model, speed and words, so repeated lines are free;
an agent gets at most one new line every 20 s (a click sooner says the last one again). Settings → Voice → **Agents
speak when clicked** turns it off; muted, during a time-lapse or without a key they babble as before. Captions show
the line. Settings → Voice shows the characters sent to ElevenLabs today next to the model's price. The demo, without
a key, uses the browser's voice. `window.__swarmLines` says who would speak (`voice`) and `speak(id)` tries one.

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

Every CEO message has a ▶ in the chat (the phone, pocket mode and the 3D office's chat), also one that arrived with
the voice off or while the app was closed (#532). It plays the clip saved under the message when there is one:
`clips.json` in the cache folder records which clips belong to which message, so a message keeps its clip after you
pick another voice or model, and replaying it is free. With no clip yet (or a deleted one), the tap makes it: the ▶
spins ("Getting the audio ready…"; tap it again to cancel), the office makes the clip in the current voice (ElevenLabs
when a key is saved and the browser's voice isn't picked, even with Speak messages off), saves it under the message and
plays it as soon as it's ready. Only a tap costs characters, counted in today's characters as usual. Without a key, and
for a message the browser's voice read before, the browser says it (free). The ⋯ menu's **Read the whole message**
works the same way. While it plays the button shows ⏹; replaying stops whatever is being read, and a new message stops
a replay. When it can't play, the message says why in plain words ("Couldn't make the audio: ElevenLabs rejected the
key.") with **Retry** and **Use the phone's voice**.

Phones only let sound start from a tap, so the tap itself wakes the office's audio and plays a moment of silence on
the `<audio>` element replays use; the clip then plays on that element when it arrives. Every tap also wakes the
office's AudioContext again: iOS stops it while the app is in the background (its state goes `suspended` or
`interrupted`), and before #532 only the first tap after loading started it, so after the app came back from the
background new messages fell silent and ▶ did nothing until a reload. While the voice is on, the first tap also unlocks
that element, so a message arriving while iOS keeps the AudioContext asleep plays on it instead.

The cache is tidied when the office starts and on its housekeeping timer (every 15 minutes): clips older than
**Keep voice clips for N days** (Settings → Voice, 1–90, default 7) go, then the oldest beyond 200, but the clips of the
newest 20 CEO messages always stay. Settings → Voice also shows the cache's size and has **Clear saved clips**.

## Talking instead of typing

Every message box has a 🎙️ next to Send: the phone's CEO chat, an agent's panel and the CEO tab of the manager's
console. **Hold** it, or hold **V** while the caret is in the box (or anywhere on that phone or panel outside another
field), and speak: the words fill the box as you go, and letting go leaves them there to edit before you send. A quick
tap of V still types a "v"; only a press held for 0.3 s talks, and V never talks in other fields. A **tap** of the 🎙️
listens until you stop talking (3 s of quiet), or until you tap it again; if nobody speaks it gives up after 8 s.
**Pause before I'm done** (1.5, 3, 5 or 8 s, saved per device) sets that quiet, for hands-free and calls too. Words
left hanging ("…on the, uh", "…and", a trailing comma) wait 3 times as long (15 s at most), and fillers at the end
aren't sent. While it's quiet a ring drains round the 🎙️: keep talking to keep it open, or tap to finish now. Phone
browsers stop recognising by themselves after a short quiet; the 🎙️ starts them again and keeps the words.
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

**Send automatically when I stop talking** (off by default) sends what you said after that pause, instead of
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
- **Turns:** the mic listens all through the call (with echo cancellation), with the same rules as hands-free (the
  pause before you're done ends your turn) but no chime each time. Talking over the CEO for about 0.3 s stops its voice at once
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

### The Jarvis voice: ElevenLabs Agents (#534)

With an ElevenLabs key, a call talks through [ElevenLabs Agents](https://elevenlabs.io/docs/eleven-agents/overview)
instead: ElevenLabs listens, decides when you've finished, lets you talk over it and speaks, and the office is the
agent's brain through ElevenLabs' [custom LLM](https://elevenlabs.io/docs/eleven-agents/customization/llm/custom-llm)
option. It feels like a conversation rather than messages read out:

- **Answers at once** from the office's own data, with no model call: the company's status ("how are we doing?"),
  a floor's board ("what's floor 4 doing?"), the decisions waiting on you ("anything for me?") and IT's health checks
  ("how's the server?"). Rules in `shared/voiceBrain.ts`.
- **Real work goes to the CEO** like a typed message: "On it, I'm asking Mimoun…" is said within a second, the
  CEO's progress lines (Talk while working) are said as they come, then its answer (its ```spoken summary, plus
  "the full answer's in the chat" when there's more).
- **Asks before changing anything:** "approve it" (the decision last read out, or "the second one") and requests like
  "file an issue…" or "hire…" get "Should I…?", and happen only on a spoken yes.
- **The screens stay:** the call screen, captions, Mute, Speaker, Pause, Skip and End work as before. The orb is
  [ElevenLabs UI's Orb](https://ui.elevenlabs.io/docs/components/orb) (MIT), ported to plain WebGL2 so a phone never
  loads three.js (`client/src/ui/AgentOrb.tsx`); it leads the phone's call screen and moves with listening, thinking
  and talking. **"That's all"** (or "bye") ends the conversation but not the call: tap the orb to talk again. An
  iPhone browser can't listen in the background, so a hidden tab ends the conversation and a new one starts when
  you're back.
- **Transcripts:** your words and the voice's answers go into the CEO chat as messages marked `voiceCall` (never read
  aloud again); a hand-off is your message to the CEO, as if typed.
- **iPhone:** the call's audio starts inside the tap on Call (iOS only plays sound from a tap), the audio session is
  set to play-and-record (Safari 16.4+), the mic asks for echo cancellation, a new route (AirPods, a car) gets a new mic
  stream, and audio iOS interrupts (a phone call, Siri) wakes on the next tap.

**Cost:** ElevenLabs Agents costs about **$0.08 a minute** ([pricing](https://elevenlabs.io/pricing/agents)).
Settings → Voice shows the minutes used today and this month with the estimate, and **Monthly limit** (15 h by default)
caps it: past it, calls use today's voice mode until the next month. A call is counted from its start to its end (a
started minute counts); a tab that vanished is counted to its last turn.

**What it needs:** the key (with the **ElevenLabs Agents** permission if you restrict it), and the office reachable by
ElevenLabs at an https address, set in Settings → Notifications → Office address (a Tailscale Funnel or Cloudflare
Tunnel URL, for example): ElevenLabs calls `<address>/v1/chat/completions` with a bearer token the office made, kept
in `<SWARM_HOME>/voice-agent.json` (mode 600) with the agent's id and the minutes. The office creates the agent
("<company> office voice", the CEO's voice, Flash v2) and its secret on your ElevenLabs workspace on the first call,
and updates it when the voice or address changes. The browser gets only a short-lived signed URL for each conversation,
never the key. Without a key or address, over the limit, with the switch off, or when ElevenLabs can't be reached,
the call is exactly today's voice mode (a toast says why when it falls back).
A mic that stays silent for 5 s never drops the Jarvis voice: the call screen says so under the status (and the
office gets an IT ticket), and the first sound clears it. On iPhones opening the mic can stop the call's audio: the
call starts it again, or asks for a tap on the screen (#648).

The demo office talks to a fake agent socket on itself (`/ws/voice-agent`, `server/voiceAgentFake.ts`) that speaks
ElevenLabs' protocol and "speaks" a soft tone; `__swarmCall.agent` is the conversation's mode (`off`, `connecting`,
`live`, `idle`), `__swarmCall.say(text)` types a turn to it (there's no mic in a headless browser) and
`__swarmCall.agentProbe()` gives the last turn's `ackMs`, what was said and heard, and interruptions.
`e2e/voiceAgent.spec.ts` walks it through at 390 px (Chromium, and WebKit where installed).

### Wake word (#537)

Settings → Voice → **Wake word**: say **"Hey Mimoun"** (or the stock **"Hey Jarvis"**) while the office is open on
screen and the call starts, no tap: a soft chime, the orb, and the Jarvis voice (or today's voice mode without it), as
if you'd tapped Call. It's paused for the whole call (its mic is the call's), so during one, tap the orb to talk again.

- **On this device only, off by default.** It's this device's mic, so the switch, the word and the **Sensitivity**
  (Strict · Balanced · Easy) are saved in this browser (`localStorage` `cubefarm:wake`). Turning it on asks for the mic
  once. A reload needs one tap anywhere before audio can run (browsers' rule); the header's light says so.
- **Nothing leaves the device until it fires.** The mic goes through an AudioWorklet, down to 16 kHz, into
  [openWakeWord](https://github.com/dscripka/openWakeWord)'s models on
  [onnxruntime-web](https://onnxruntime.ai/docs/tutorials/web/) (WASM, one thread), all in the page. It's loaded only
  once the wake word is on (about 3 MB of models and the 14 MB runtime, cached after).
- **Cheap when nobody talks:** an 80 ms chunk too quiet to be speech costs a level check; anything louder asks
  [Silero VAD](https://github.com/snakers4/silero-vad); only speech runs the wake word's models, replaying the 2 s
  before it so the start of the phrase isn't lost, until 2 s after it ends. `wakePipeline.test.ts` logs the CPU of an
  idle room (quiet, and with a fan) and fails over 5% of a core: about 0.1% and 1% here.
- **One wake per phrase:** a score over the threshold (0.8 Strict … 0.5 Balanced … 0.2 Easy) wakes once, then not again
  for 2 s and until the score has dropped (`WakeGate`, `client/src/ui/wake/wakeWord.ts`).
- **The mic light:** whenever it listens, a mic with an orange dot sits in the header (the 3D office's HUD, the phone
  HUD and pocket mode); a tap opens Settings → Voice. It pauses, and lets go of the mic, during a call, while the
  message box's mic listens, while the office is in the background (another tab, the phone locked, the app switched
  away) and on low battery (unplugged at 20% or less, where the browser says: Chrome's Battery API; Safari doesn't
  tell).
- **iPhone:** foreground only. Safari stops the mic when the page is hidden or the screen locks, so it listens while
  the office is on screen, and starts again when you're back.

**The models** are in `client/public/wake/` with their licences (`LICENSES.md`): openWakeWord's melspectrogram and
speech embedding (Apache-2.0), Silero VAD (MIT), the stock "hey jarvis" classifier (**CC BY-NC-SA 4.0**:
non-commercial, fine for this private office tool) and "Hey Mimoun", trained here, under the same licence (some of
its training voices come from non-commercial datasets).

**Training "Hey Mimoun"** (`scripts/wakeword/train_hey_mimoun.py`, openWakeWord's synthetic-voice recipe made small
enough for a CPU: about an hour on this server's spare cores): Piper TTS says the phrase (spelt and phonetic variants
of "mee-MOON") at random speeds in 500 LibriTTS-R voices, every speaker of VCTK, L2-ARCTIC (accented English), ARCTIC
and ARU, and seven single-speaker voices; the same voices say near-misses ("hey Simon", "hey moon", "hey" and a
sound-alike name or any word) and random sentences; 30% stay clean (a mic with noise suppression), the rest are mixed
with noise at random levels; all of it goes through openWakeWord's frozen features and a small network
(1536 → 64 → 1, dropout and weight decay) learns the phrase, a false wake counting 30 times a miss (`--neg-weight`).
It's written as an ONNX model with openWakeWord's input, so the browser runs it like a stock one, and the test clips
(`client/src/ui/wake/fixtures/`, two voices it never heard) are written next to the tests.

On 40 LibriTTS-R voices it never trained on, the shipped model wakes on 38 of 40 "Hey Mimoun"s, and 7 of 200
near-miss clips ("hey Simone", "hey Mona"…) woke it; ordinary sentences, noise and silence never did. It's trained on
synthetic voices only, so a real voice may need Easy (or Strict, if it wakes by mistake); "Hey Jarvis", the stock
model trained on far more data, is the steadier choice until it's retrained with recordings. To retrain (a new spelling,
more voices, a different `--neg-weight`; `--cache` keeps the features so a retrain takes minutes):

```bash
python3 -m venv venv && venv/bin/pip install piper-tts numpy onnx
venv/bin/python -m piper.download_voices en_US-libritts_r-medium en_US-lessac-medium en_GB-alan-medium \
  en_GB-vctk-medium en_US-l2arctic-medium en_US-arctic-medium en_GB-aru-medium en_US-amy-medium en_US-ryan-medium \
  en_US-joe-medium en_GB-jenny_dioco-medium en_GB-northern_english_male-medium en_US-hfc_female-medium en_US-kristin-medium
gh release download v0.5.1 -R dscripka/openWakeWord -p melspectrogram.onnx -p embedding_model.onnx -D oww
venv/bin/python -I scripts/wakeword/train_hey_mimoun.py --voices . --oww oww --repo . --cache features.npz
```

It prints the held-out voices' recall and how many near-miss clips woke it. openWakeWord's full notebook
(`notebooks/automatic_model_training.ipynb`: thousands of voices, room impulse responses and ~2,000 hours of
precomputed negative speech, on a GPU) makes a sturdier model; its output drops into the same file.

`window.__swarmWake` is the probe (`status`: `''` listening, `off`, `call`, `dictating`, `hidden`, `battery`, `no-mic`, `starting`,
`tap`, `error`; `wakes`; `stats()`). `e2e/wakeWord.spec.ts` plays the clips into a fake mic stream at 390 px
(Chromium, and WebKit where installed): on shows the light, a near-miss is ignored, the phrase starts the demo's call,
a hidden tab lets go of the mic.

### The meeting room (#369)

Every call happens in the meeting room, the glass room in the lobby's west wing (south of the manager's office, round
the west window). While a call is on the CEO walks over from the corner office and stands at the table's head in
front of the wall screen, which shows the call's status and captions; they wave as it connects, nod while they listen,
look down at the table while they think and talk with their hands while they speak, and walk back to their desk when
it ends. The sign over the door says who's on the call and its light turns red.

- **Join in person:** walk in and press **E** at any chair ("Join the call"; with no call on, "Sit down and call …"
  starts one). You sit facing the CEO; on a narrow screen the call screen folds to its pill so the room shows. Walking,
  Space or **E** gets you up: the call goes on. Leaving the lobby gets you up too.
- **Join from the call window:** the phone's call screen and the desktop's call card show a live view of the room, the
  CEO at the table, like a video call's tile (`world/MeetingTile.tsx`: a small renderer of its own, so it works on
  any floor and in pocket mode). It draws 12 frames a second at most, and nothing while the window is folded to its
  pill or orb, the tab is hidden, the tile is off screen or you sit in the room yourself.

The rules are pure and tested in `client/src/world/meeting.ts` (the call's moments → where the CEO is and what they
do, what E at a chair does and the view from it, the tile's frame throttle); the room's place is in `layout.ts`.
The demo office shows a call there with `?meeting=call` (a call on, the CEO at the table: the call card's live view)
or `?meeting=seat` (you sat at the far head too); `e2e/meeting.spec.ts` walks it through.

### Their camera (#539)

Say or type "turn on your camera" (or "show yourself", "camera on") on a call or in the CEO's or an agent's chat, or
tap the camera button (the call screen's header, the call card's, an agent chat's **Camera** chip): their character
shows live in a picture-in-picture tile, head and shoulders at their desk with their task glowing on the monitor
behind them, in their floor's theme colours. They wave as it comes on, breathe, blink, talk with the voice's level
(the Jarvis voice's, or a speech-like rhythm for the other voices and their greeting) and look thoughtful while the CEO
works on an answer. Drag the tile anywhere; × or "turn off your camera" hides it. The words never reach the agent and
nothing is sent: it's off by default, uses no camera or mic of yours, and a busy agent (a merge conflict, a fix, a
test) may refuse playfully once, from a template; ask again and they turn it on. The tile is its own small renderer
(`world/AgentCamTile.tsx`, 360 px square, 15 frames a second at most, none while the tab is hidden or the tile off
screen). The rules are pure and tested in `client/src/ui/agentCamera.ts`; `window.__swarmAgentCam` is its probe
(`state`, `mouth`, `frames`, `on(id)`, `off()`, `level(v)` for fake audio). The demo opens with one on via
`?camera=ceo` (or an agent's id); `e2e/agentCamera.spec.ts` walks it through.

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
| Turn-taking | listens and speaks at once; how it decides you're done isn't documented [2] | "listens continuously and responds to natural pauses"; push-to-talk as an option [3] | eagerness: eager, normal or patient; "take turn after silence" 1-30 s [5] | 3 s of quiet ends your turn (1.5-8 s per device; longer after "uh" or "and"); tap-to-talk without a mic |
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

### Call traces (#650)

Every call reports what the real browser did, so a call that can't hear is diagnosed from the device, not from
fakes. The client (`client/src/ui/callTrace.ts`) sends one compact trace to `POST /api/voice/trace` as the call
starts (before any mic code runs, so it arrives even when that code throws), every 5 s and at hang-up. The office
(`shared/callTrace.ts` `cleanTrace`, the only way in) keeps known fields only, redacts secrets, logs one line
`voice: call trace {…}` and keeps the last 20 calls (`GET /api/voice/traces`). Fields: the short user agent (` app`
for the home-screen app), the mode (`jarvis`, `office`, `tap`) and listen provider, getUserMedia's result (`ok` or the
error's name), the track (label, enabled, muted, readyState, sample rate, channels), the call's audio context and the
office voice's meter (`state Hz`), the Jarvis worklet (`ok` or its error) and its message count, the mic's max and
mean RMS, the user_audio_chunk count, bytes and non-zero bytes, the input format ElevenLabs asked for, the
MediaRecorder's type, chunks and bytes, each transcribe answer's status and error, ElevenLabs' socket messages by
type, its close code and reason, and `events`: every voice switch, silent-mic, tap-to-talk and fallback decision with
its reason. Never audio, never a key. Every voice route's answer is logged too: `voice: POST /api/voice/transcribe
200 (812 ms)` (a session id never), so a request that never reached the office shows as a missing line.

When ElevenLabs closes the conversation in the middle of a call, the call dials it again once; a second close hands
the call to the office's own voice, whose mic goes on hearing the manager, and the toast says ElevenLabs' code and
reason. Before #650 the call rested deaf instead (its mic off, the CEO's replies in the backup voice).

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
| `GET /api/voice/talk/:id` | an ack or progress line the office just sent in a `voiceLine` event (the latest 20), made once per wording and cached; 404 when the voice isn't ElevenLabs or the line is gone |
| `POST /api/voice/lines/:agent` `{ hour }` | a clicked agent's line (`hour`: the manager's local hour) → `{ text, clip }`; `clip` says ElevenLabs will say it. The same line within 20 s |
| `GET /api/voice/lines/:agent` | that line as `audio/mpeg` in their voice (the CEO's: the office voice), cached; 404 when agents aren't voiced by ElevenLabs or nothing was said yet |
| `GET /api/voice/standup?n=3&part=morning` | the CEO's line at a stand-up in the 3D office ("Morning team, three new features today!"; `part` is `morning`, `afternoon` or `evening`), made once per wording and cached; 404 when the voice isn't ElevenLabs |
| `POST /api/voice/agent/start` | a Jarvis call (#534): makes or updates the office's ElevenLabs agent, then `{ session, url }` (a signed URL for one conversation); 409 without a key or address, over the limit or switched off, 502 when ElevenLabs fails |
| `POST /api/voice/agent/:session/end` | the conversation ended: its minutes are counted (again is harmless) |
| `POST /v1/chat/completions` | ElevenLabs' custom LLM: OpenAI's chat completion (streamed with `stream: true`) for the call's latest turn; 401 without the agent's bearer token |
| `POST /api/voice/trace` | a call's trace from the browser (#650, below); 400 without an id |
| `GET /api/voice/traces` | the last 20 calls' traces, newest last |

Settings travel in `settings.voice` (`PATCH /api/settings`): `{ provider: 'off' | 'browser' | 'elevenlabs', voiceId,
voiceName, model, speakOffice, keepDays, speed, favourites, agentsSpeak, talk: 'off' | 'milestones' | 'regular', agent: { on, capHours } }`, and listening in `settings.listen`: `{ provider: 'off' | 'browser' |
'elevenlabs', autoSend, handsFree }`. The snapshot has `voiceKeySet`, `voiceKeyHint` and `voiceCache`
(`{ clips, bytes, saved, charsToday }`, `saved` being the message ids the ▶ can replay, `charsToday` the characters sent to ElevenLabs today); a `voiceKey` event follows every key change
and a `voiceCache` event every change to the cache. A phone message's `voice` says who read it when it arrived. One clip is made at a time (20 s timeout); requests for a clip that's being made share that call.

The demo office (`--demo`) fakes all of it with no network: any key except one containing "bad" is accepted, there are
nine voices (six of them v4, from `server/demoVoices.ts`), every message is a short generated chime (a WAV), pitched by the voice, cached and replayed like a
real clip. Its Speech to Text hears "What's everyone working on?" in any recording. The server logs `voice: made a new
clip …` for every clip it makes and `voice: transcribed a 2.4 s clip (30 KB)` for every transcription (never the words).
