# Wake word models (#537)

Loaded by `client/src/ui/wake/wakeModels.ts` only once the wake word is turned on (Settings → Voice → Wake word).
docs/voice.md "Wake word" has how they're used and how `hey_mimoun.onnx` is trained.

| File | What | Source | Licence |
| --- | --- | --- | --- |
| `melspectrogram.onnx` | openWakeWord's melspectrogram front end | https://github.com/dscripka/openWakeWord/releases/tag/v0.5.1 | Apache-2.0 (openWakeWord's code) |
| `embedding_model.onnx` | Google's speech embedding, re-implemented by openWakeWord | same release; https://tfhub.dev/google/speech_embedding/1 | Apache-2.0 |
| `hey_jarvis_v0.1.onnx` | openWakeWord's stock "hey jarvis" classifier | same release | CC BY-NC-SA 4.0 |
| `silero_vad.onnx` | Silero VAD (v4), as shipped by openWakeWord | same release; https://github.com/snakers4/silero-vad | MIT |
| `hey_mimoun.onnx` | the "Hey Mimoun" classifier, trained here by `scripts/wakeword/train_hey_mimoun.py` | this repo | CC BY-NC-SA 4.0, like openWakeWord's: it's trained on Piper voices made from datasets of mixed licences (LibriTTS-R, VCTK, ARU: CC BY 4.0; L2-ARCTIC: CC BY-NC 4.0; CMU ARCTIC: free) |

openWakeWord's stock models, and so Hey Mimoun, are **CC BY-NC-SA 4.0**: fine for this office, a private tool that isn't sold. Attribution:
"hey jarvis" model by David Scripka (openWakeWord), https://creativecommons.org/licenses/by-nc-sa/4.0/. Anyone selling a
product built on cubefarm should drop both classifiers, or retrain Hey Mimoun without the non-commercial voices
(`MULTI` and `SINGLE` in the script).
