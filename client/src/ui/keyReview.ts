// Whether the found keys' review sheet (#367) is open: the "Keys found" notification's Review opens it from anywhere.
import { create } from 'zustand';

export const useKeyReview = create<{ open: boolean }>(() => ({ open: false }));
