// The demo's voices: made-up names and ids, Eleven v4 ones first (#320), so a demo office shows the newest voices first.
import type { VoiceOption } from '../shared/types.ts';

const v4 = (id: string, name: string, accent: string, gender: string, age: string, description: string): Omit<VoiceOption, 'recommended'> => ({
  id,
  name,
  category: 'premade',
  labels: { accent, gender, age, description, use_case: 'conversational' },
  previewUrl: null,
  v4: true,
});

const DEMO_V4_VOICES = [
  v4('demoV4Juniper000001', 'Juniper', 'american', 'female', 'young', 'bright, expressive'),
  v4('demoV4Rowan00000002', 'Rowan', 'irish', 'male', 'middle aged', 'warm storyteller'),
  v4('demoV4Saffron000003', 'Saffron', 'british', 'female', 'middle aged', 'dry wit'),
  v4('demoV4Tobias0000004', 'Tobias', 'american', 'male', 'old', 'deep and calm'),
  v4('demoV4Indigo0000005', 'Indigo', 'australian', 'non-binary', 'young', 'playful'),
  v4('demoV4Marlow0000006', 'Marlow', 'canadian', 'male', 'young', 'easy-going'),
];

export const DEMO_VOICES = [
  ...DEMO_V4_VOICES,
  { id: 'demoVoiceAvery00001', name: 'Avery', category: 'premade', labels: { accent: 'american', gender: 'female', age: 'middle aged', description: 'calm', use_case: 'conversational' }, previewUrl: null },
  { id: 'demoVoiceBasil00002', name: 'Basil', category: 'premade', labels: { accent: 'british', gender: 'male', age: 'middle aged', description: 'warm', use_case: 'narration' }, previewUrl: null },
  { id: 'demoVoiceCleo000003', name: 'Cleo', category: 'premade', labels: { accent: 'australian', gender: 'female', age: 'young', description: 'friendly', use_case: 'conversational' }, previewUrl: null },
];
