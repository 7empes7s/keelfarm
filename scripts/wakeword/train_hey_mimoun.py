"""Trains the "Hey Mimoun" wake word (#537, docs/voice.md "Wake word") on synthetic voices only.

openWakeWord's recipe, small enough for a CPU: Piper speaks the phrase in hundreds of LibriTTS voices, near-misses and
ordinary sentences are spoken by the same voices, everything is mixed with noise, turned into openWakeWord's frozen
features (melspectrogram.onnx + embedding_model.onnx, 16 x 96 per 1.28 s window) and a small network (1536 -> 64 -> 1)
learns the phrase (dropout and weight decay, against learning the training voices). The result is written as an ONNX model with openWakeWord's input shape [1, 16, 96], so the browser
runs it like a stock model. Also writes the test clips (other voices than training) to client/src/ui/wake/fixtures/.

  python3 -m venv venv && venv/bin/pip install piper-tts numpy onnx
  venv/bin/python -m piper.download_voices en_US-libritts_r-medium en_US-lessac-medium en_GB-alan-medium \\
      en_GB-vctk-medium en_US-l2arctic-medium en_US-arctic-medium en_GB-aru-medium \\
      en_US-amy-medium en_US-ryan-medium en_US-joe-medium en_GB-jenny_dioco-medium en_GB-northern_english_male-medium \\
      en_US-hfc_female-medium en_US-kristin-medium
  venv/bin/python -I scripts/wakeword/train_hey_mimoun.py --voices <folder of the .onnx voices> --oww <folder with
      melspectrogram.onnx and embedding_model.onnx from openWakeWord's v0.5.1 release> --repo .
"""
import argparse
import os
import random
import wave

import numpy as np
import onnx
import onnxruntime as ort
from onnx import TensorProto, helper, numpy_helper
from piper import PiperVoice, SynthesisConfig

PHRASES = ['Hey Mimoun', 'Hey Mimoun!', 'Hey, Mimoun.', 'Hey Meemoon', 'Hey Mee moon', '[[ hˈeɪ miːmˈuːn ]]', '[[ hˈeɪ mɪmˈuːn ]]', '[[ hˈeɪ miːmˈun ]]']
NEAR = ['Hey moon', 'Hey Simon', 'Hey Simone', 'Hey Ramon', 'Hey man', 'Hey mom', 'Hey minion', 'Hey Jarvis', 'Hey Mitch',
        'Hey Mimi', 'Hey Damon', 'My moon', 'Hey you', 'Hey Monday', 'Hey Raymond', 'Hey Simba', 'Hey mister', 'Hey there',
        'Hey Muhammad', 'Mimosa', 'Hey human', 'Okay Mimi', 'Hey me too', 'Hey Neymar', 'The moon', 'Hey Lemon', 'Hey Solomon',
        'Hey Simeon', 'Hey Ma\'am', 'Hey Mia', 'Hey movie', 'Hey Maroon', 'Hey Marion', 'Hey Remo', 'Hey Nemo']
WORDS = ('the office agent build test merge issue please open phone call later today morning coffee meeting review pull '
         'request deploy server memory cheap fast slow window desk chair floor team lunch what when where who how is are '
         'was were can could should would will my your our their this that these those one two three four five ready '
         'done waiting moment minute second hour tonight tomorrow yesterday great fine sure okay right left new old '
         'music movie money monday mountain machine message mission manager simple summer silver moment woman human').split()
RATE = 16_000
WIN = 16  # embedding frames per window (1.28 s)
# other voice models' speakers (name: how many), every one of them, so it doesn't learn one model's way of speaking
MULTI = {'en_GB-vctk-medium': 109, 'en_US-l2arctic-medium': 24, 'en_US-arctic-medium': 18, 'en_GB-aru-medium': 12}
SINGLE = ['en_US-amy-medium', 'en_US-ryan-medium', 'en_US-joe-medium', 'en_GB-jenny_dioco-medium', 'en_GB-northern_english_male-medium', 'en_US-hfc_female-medium', 'en_US-kristin-medium']


def to16k(pcm: np.ndarray, rate: int) -> np.ndarray:
    """Band-limited resample by FFT (short clips only)."""
    n = int(round(len(pcm) * RATE / rate))
    spec = np.fft.rfft(pcm.astype(np.float64))
    keep = n // 2 + 1
    out = np.fft.irfft(spec[:keep], n) * (n / len(pcm))
    return out.astype(np.float32)


def say(voice: PiperVoice, text: str, rng: random.Random, speaker) -> np.ndarray:
    cfg = SynthesisConfig(speaker_id=speaker, length_scale=rng.uniform(0.75, 1.35), noise_scale=rng.uniform(0.4, 0.9), noise_w_scale=rng.uniform(0.5, 1.0))
    chunks = list(voice.synthesize(text, syn_config=cfg))
    pcm = np.concatenate([c.audio_int16_array for c in chunks]).astype(np.float32)
    return to16k(pcm, chunks[0].sample_rate)


def noise(n: int, rng: np.random.Generator) -> np.ndarray:
    white = rng.standard_normal(n)
    if rng.random() < 0.5:
        return white.astype(np.float32)
    pink = np.cumsum(white)  # brown-ish: low rumble like a room or a fan
    pink -= np.convolve(pink, np.ones(400) / 400, 'same')
    return (pink / (np.std(pink) + 1e-9)).astype(np.float32)


def mix(clip: np.ndarray, total: int, end_at: int, rng: np.random.Generator, bed: np.ndarray | None) -> np.ndarray:
    """The clip in `total` samples ending at `end_at`, at a random level over noise (and maybe other speech)."""
    out = np.zeros(total, np.float32)
    start = max(0, end_at - len(clip))
    seg = clip[len(clip) - (end_at - start):]
    gain = 10 ** rng.uniform(-1.2, 0.2)  # about -24..+4 dB
    out[start:start + len(seg)] += seg * gain
    if rng.random() < 0.3:
        return out  # clean, like a mic with noise suppression
    level = np.sqrt(np.mean(seg ** 2) + 1e-9) * gain
    snr = rng.uniform(5, 40)
    out += noise(total, rng) * level / (10 ** (snr / 20))
    if bed is not None and rng.random() < 0.3:
        b = np.resize(bed, total) * level * 10 ** rng.uniform(-1.5, -0.7)
        out += b
    return np.clip(out, -32768, 32767)


class Features:
    def __init__(self, oww: str):
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 2
        self.mel = ort.InferenceSession(os.path.join(oww, 'melspectrogram.onnx'), opts)
        self.emb = ort.InferenceSession(os.path.join(oww, 'embedding_model.onnx'), opts)

    def __call__(self, audio: np.ndarray) -> np.ndarray:
        """Embeddings (frames x 96) of a clip, every 80 ms, as openWakeWord computes them."""
        mel = self.mel.run(None, {'input': audio[None, :].astype(np.float32)})[0].squeeze() / 10 + 2
        starts = list(range(0, mel.shape[0] - 76 + 1, 8))
        if not starts:
            return np.zeros((0, 96), np.float32)
        batch = np.stack([mel[s:s + 76] for s in starts])[..., None].astype(np.float32)
        return self.emb.run(None, {'input_1': batch})[0].reshape(len(starts), 96)


def windows(emb: np.ndarray, last_only: int = 0) -> np.ndarray:
    n = emb.shape[0] - WIN + 1
    if n <= 0:
        return np.zeros((0, WIN * 96), np.float32)
    idx = range(max(0, n - last_only), n) if last_only else range(n)
    return np.stack([emb[i:i + WIN].reshape(-1) for i in idx])


def write_wav(path: str, audio: np.ndarray):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(np.clip(audio, -32768, 32767).astype('<i2').tobytes())


def train(x: np.ndarray, y: np.ndarray, w: np.ndarray, seed=0, epochs=30, hidden=64, l2=1e-3, drop=0.3):
    rng = np.random.default_rng(seed)
    mu, sd = x.mean(0), x.std(0) + 1e-6
    xn = (x - mu) / sd
    p = {'w1': rng.standard_normal((x.shape[1], hidden)).astype(np.float32) * np.sqrt(2 / x.shape[1]), 'b1': np.zeros(hidden, np.float32),
         'w2': rng.standard_normal((hidden, 1)).astype(np.float32) * np.sqrt(1 / hidden), 'b2': np.zeros(1, np.float32)}
    m = {k: np.zeros_like(v) for k, v in p.items()}
    v2 = {k: np.zeros_like(v) for k, v in p.items()}
    t, lr, bs = 0, 1e-3, 256
    for ep in range(epochs):
        order = rng.permutation(len(xn))
        for i in range(0, len(order), bs):
            b = order[i:i + bs]
            xb, yb, wb = xn[b], y[b], w[b]
            h = np.maximum(0, xb @ p['w1'] + p['b1'])
            keep = (rng.random(h.shape) > drop) / (1 - drop)  # dropout: no voice's quirks to lean on
            h = h * keep
            z = (h @ p['w2'] + p['b2']).ravel()
            s = 1 / (1 + np.exp(-z))
            g = ((s - yb) * wb / wb.sum())[:, None]
            grads = {'w2': h.T @ g, 'b2': g.sum(0)}
            gh = (g @ p['w2'].T) * (h > 0) * keep
            grads['w1'] = xb.T @ gh + l2 * p['w1']
            grads['b1'] = gh.sum(0)
            t += 1
            for k in p:
                m[k] = 0.9 * m[k] + 0.1 * grads[k]
                v2[k] = 0.999 * v2[k] + 0.001 * grads[k] ** 2
                p[k] -= lr * (m[k] / (1 - 0.9 ** t)) / (np.sqrt(v2[k] / (1 - 0.999 ** t)) + 1e-8)
        if ep % 10 == 9:
            print('epoch', ep + 1, flush=True)
    # fold the normalisation into the first layer
    w1 = p['w1'] / sd[:, None]
    b1 = p['b1'] - (mu / sd) @ p['w1']
    return w1.astype(np.float32), b1.astype(np.float32), p['w2'], p['b2']


def predict(params, x):
    w1, b1, w2, b2 = params
    h = np.maximum(0, x @ w1 + b1)
    return 1 / (1 + np.exp(-(h @ w2 + b2).ravel()))


def export(params, path: str):
    w1, b1, w2, b2 = (np.asarray(a, np.float32) for a in params)  # Gemm needs one type throughout
    init = [numpy_helper.from_array(a, n) for a, n in [(w1, 'w1'), (b1, 'b1'), (w2, 'w2'), (b2, 'b2'), (np.array([1, WIN * 96], np.int64), 'shape')]]
    nodes = [helper.make_node('Reshape', ['x', 'shape'], ['flat']), helper.make_node('Gemm', ['flat', 'w1', 'b1'], ['h0']),
             helper.make_node('Relu', ['h0'], ['h']), helper.make_node('Gemm', ['h', 'w2', 'b2'], ['z']), helper.make_node('Sigmoid', ['z'], ['score'])]
    graph = helper.make_graph(nodes, 'hey_mimoun', [helper.make_tensor_value_info('x', TensorProto.FLOAT, [1, WIN, 96])],
                              [helper.make_tensor_value_info('score', TensorProto.FLOAT, [1, 1])], init)
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid('', 13)], producer_name='cubefarm scripts/wakeword')
    model.ir_version = 8
    onnx.checker.check_model(model)
    onnx.save(model, path)


NAMES = 'Simon Ramon Damon Raymond Mona Ramona Monica Lemon Solomon Timon Simone Naomi Moana Muna Mimi Nemo Mohammed Mounir Mahmoud Marion Maroon Harmony Lemonade Common Salmon Diamond Lima Kimono Simba Amon Ammon'.split()


def near(rng: random.Random) -> str:
    """A near-miss: a stock one, "hey" and a name that sounds like it, or "hey" and any word."""
    r = rng.random()
    if r < 0.4:
        return rng.choice(NEAR)
    if r < 0.75:
        return f'Hey {rng.choice(NAMES)}'
    return f'Hey {rng.choice(WORDS)}'


def synth_part(job):
    """Features for some speakers: (positive windows, negative windows, held-out positive clips, held-out negative clips)."""
    voices, oww, speakers, held_out, seed, voice = job
    rng, nrng = random.Random(seed), np.random.default_rng(seed)
    feats = Features(oww)
    multi = PiperVoice.load(os.path.join(voices, f'{voice}.onnx'))
    pos, neg, ev_pos, ev_neg = [], [], [], []
    bed = say(multi, 'the quick brown fox jumps over the lazy dog while the office hums along', rng, speakers[0])
    for i, spk in enumerate(speakers):
        if held_out:
            clip = say(multi, rng.choice(PHRASES), rng, spk)
            ev_pos.append(windows(feats(mix(clip, len(clip) + RATE * 2, len(clip) + RATE, nrng, None))))
            for _ in range(5):
                clip = say(multi, near(rng), rng, spk)
                ev_neg.append(windows(feats(mix(clip, len(clip) + RATE * 2, len(clip) + RATE, nrng, None))))
            continue
        for _ in range(4):
            clip = say(multi, rng.choice(PHRASES), rng, spk)
            total = len(clip) + int(RATE * rng.uniform(2.0, 2.8))
            audio = mix(clip, total, total - int(RATE * rng.uniform(0.05, 0.5)), nrng, bed)
            pos.append(windows(feats(audio), last_only=4))
        for _ in range(6):
            clip = say(multi, near(rng), rng, spk)
            total = len(clip) + int(RATE * 2.2)
            neg.append(windows(feats(mix(clip, total, total - int(RATE * rng.uniform(0.05, 0.6)), nrng, bed))))
        sentence = ' '.join(rng.choice(WORDS) for _ in range(rng.randint(6, 14)))
        clip = say(multi, sentence, rng, spk)
        neg.append(windows(feats(mix(clip, len(clip) + RATE * 2, len(clip) + RATE, nrng, bed))))
        if i % 50 == 49:
            print(seed, i + 1, 'speakers', flush=True)
    if not held_out:
        for _ in range(150):  # noise and silence only
            neg.append(windows(feats(mix(np.zeros(10, np.float32), RATE * 3, RATE, nrng, bed))))
    return pos, neg, ev_pos, ev_neg


def synthesise(args):
    import multiprocessing
    rng = random.Random(537)
    speakers = list(range(904))  # en_US-libritts_r-medium's voices
    rng.shuffle(speakers)
    train_spk, test_spk = speakers[:args.speakers], speakers[args.speakers:args.speakers + 40]
    jobs = [(args.voices, args.oww, train_spk[k::args.jobs], False, 537 + k, 'en_US-libritts_r-medium') for k in range(args.jobs)]
    # single-speaker voices too, each said 10 times as often (None: their only speaker)
    jobs += [(args.voices, args.oww, [None] * 25, False, 600 + k, v) for k, v in enumerate(SINGLE)]
    jobs += [(args.voices, args.oww, list(range(n)) * 2, False, 700 + k, v) for k, (v, n) in enumerate(MULTI.items())]
    jobs += [(args.voices, args.oww, test_spk, True, 999, 'en_US-libritts_r-medium')]
    with multiprocessing.get_context('spawn').Pool(args.jobs) as pool:
        parts = pool.map(synth_part, jobs)
    flat = lambda k: [w for part in parts for w in part[k]]
    xp, xn = np.concatenate(flat(0)), np.concatenate(flat(1))
    ev_pos, ev_neg = flat(2), flat(3)
    return xp, xn, ev_pos, ev_neg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--voices', required=True)
    ap.add_argument('--oww', required=True)
    ap.add_argument('--repo', default='.')
    ap.add_argument('--speakers', type=int, default=420)
    ap.add_argument('--jobs', type=int, default=2)
    ap.add_argument('--neg-weight', type=float, default=30, help='how much a false wake costs against a miss (higher: fewer false wakes, more misses)')
    ap.add_argument('--cache', help='an .npz to keep the features in, to retrain without synthesising again')
    args = ap.parse_args()
    if args.cache and os.path.exists(args.cache):
        c = np.load(args.cache, allow_pickle=True)
        xp, xn, ev_pos, ev_neg = c['xp'], c['xn'], list(c['ev_pos']), list(c['ev_neg'])
    else:
        print('synthesising', flush=True)
        xp, xn, ev_pos, ev_neg = synthesise(args)
        if args.cache:
            np.savez(args.cache, xp=xp, xn=xn, ev_pos=np.array(ev_pos, dtype=object), ev_neg=np.array(ev_neg, dtype=object))
    print('windows', xp.shape, xn.shape, flush=True)
    x = np.concatenate([xp, xn]).astype(np.float32)
    y = np.concatenate([np.ones(len(xp)), np.zeros(len(xn))]).astype(np.float32)
    w = np.concatenate([np.full(len(xp), len(xn) / len(xp)), np.full(len(xn), args.neg_weight)]).astype(np.float32)  # false wakes cost more
    params = train(x, y, w)

    # held-out voices: recall on the phrase, false wakes on near-misses
    train_fa = float((predict(params, xn) > 0.5).mean())
    hits = sum(predict(params, e).max() > 0.5 for e in ev_pos)
    fa = sum((predict(params, e) > 0.5).any() for e in ev_neg)
    print(f'held-out recall {hits}/{len(ev_pos)}, near-miss clips waking {fa}/{len(ev_neg)}; training windows over 0.5: {train_fa:.4f}', flush=True)

    feats = Features(args.oww)
    fixtures = os.path.join(args.repo, 'client', 'src', 'ui', 'wake', 'fixtures')
    os.makedirs(fixtures, exist_ok=True)
    alan = PiperVoice.load(os.path.join(args.voices, 'en_GB-alan-medium.onnx'))
    lessac = PiperVoice.load(os.path.join(args.voices, 'en_US-lessac-medium.onnx'))
    clean = lambda v, text: np.concatenate([np.zeros(RATE // 2, np.float32), say(v, text, random.Random(7), None) * 0.6, np.zeros(RATE, np.float32)])
    for name, audio in [('hey-mimoun-lessac', clean(lessac, 'Hey Mimoun')), ('hey-mimoun-alan', clean(alan, '[[ hˈeɪ miːmˈuːn ]]')),
                        ('hey-jarvis-lessac', clean(lessac, 'Hey Jarvis')), ('hey-simon-lessac', clean(lessac, 'Hey Simon')),
                        ('hey-moon-alan', clean(alan, 'Hey moon')), ('sentence-lessac', clean(lessac, 'The build finished and the merge is waiting on review.'))]:
        write_wav(os.path.join(fixtures, f'{name}.wav'), audio)
        print(name, round(float(predict(params, windows(feats(audio))).max()), 3), flush=True)
    export(params, os.path.join(args.repo, 'client', 'public', 'wake', 'hey_mimoun.onnx'))
    print('wrote the model', flush=True)


if __name__ == '__main__':
    main()
