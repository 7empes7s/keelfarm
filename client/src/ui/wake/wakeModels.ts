// The wake word's models on onnxruntime (#537): openWakeWord's melspectrogram and embedding (shared by every wake
// word), the chosen word's classifier and Silero VAD, from client/public/wake/ (licences in its LICENSES.md). The
// runtime is passed in: onnxruntime-web's WASM build in the browser (wakeEngine.ts), the same package in the tests.
import type * as Ort from 'onnxruntime-web';
import type { WakeModels } from './wakePipeline';

type OrtModule = Pick<typeof Ort, 'InferenceSession' | 'Tensor'>;

const SHARED_MODELS = ['melspectrogram.onnx', 'embedding_model.onnx', 'silero_vad.onnx'] as const;

/** The four sessions for one wake word; `load` reads a file from /wake/. */
export async function loadWakeModels(ort: OrtModule, load: (file: string) => Promise<Uint8Array>, classifier: string): Promise<WakeModels> {
  const open = async (file: string) => ort.InferenceSession.create(await load(file), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  const [melS, embS, vadS, wordS] = await Promise.all([...SHARED_MODELS.map(open), open(classifier)]);
  const T = ort.Tensor;
  const sr = new T('int64', BigInt64Array.from([16000n]), []);
  let h = new T('float32', new Float32Array(128), [2, 1, 64]);
  let c = new T('float32', new Float32Array(128), [2, 1, 64]);
  const first = (out: Record<string, Ort.Tensor>, name: string) => out[name].data as Float32Array;
  return {
    async mel(audio) {
      const out = await melS.run({ [melS.inputNames[0]]: new T('float32', audio, [1, audio.length]) });
      return first(out, melS.outputNames[0]);
    },
    async embed(mel) {
      const out = await embS.run({ [embS.inputNames[0]]: new T('float32', mel, [1, 76, 32, 1]) });
      return first(out, embS.outputNames[0]).slice(0, 96);
    },
    async score(window) {
      const out = await wordS.run({ [wordS.inputNames[0]]: new T('float32', window, [1, 16, 96]) });
      return first(out, wordS.outputNames[0])[0];
    },
    async vad(frame) {
      const out = await vadS.run({ input: new T('float32', frame, [1, frame.length]), sr, h, c });
      h = out.hn as typeof h;
      c = out.cn as typeof c;
      return (out.output.data as Float32Array)[0];
    },
    resetVad() {
      h = new T('float32', new Float32Array(128), [2, 1, 64]);
      c = new T('float32', new Float32Array(128), [2, 1, 64]);
    },
  };
}
