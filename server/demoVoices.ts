// The demo's Eleven v4 voices (#320): made-up names and ids, so a demo office shows the newest voices first.
import type { VoiceOption } from '../shared/types.ts';

const v4 = (id: string, name: string, accent: string, gender: string, age: string, description: string): Omit<VoiceOption, 'recommended'> => ({
  id,
  name,
  category: 'premade',
  labels: { accent, gender, age, description, use_case: 'conversational' },
  previewUrl: null,
  v4: true,
});

export const DEMO_V4_VOICES = [
  v4('demoV4Juniper000001', 'Juniper', 'american', 'female', 'young', 'bright, expressive'),
  v4('demoV4Rowan00000002', 'Rowan', 'irish', 'male', 'middle aged', 'warm storyteller'),
  v4('demoV4Saffron000003', 'Saffron', 'british', 'female', 'middle aged', 'dry wit'),
  v4('demoV4Tobias0000004', 'Tobias', 'american', 'male', 'old', 'deep and calm'),
  v4('demoV4Indigo0000005', 'Indigo', 'australian', 'non-binary', 'young', 'playful'),
  v4('demoV4Marlow0000006', 'Marlow', 'canadian', 'male', 'young', 'easy-going'),
];
