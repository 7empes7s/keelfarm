// When a chat message is long enough to fold behind "Show more" (#51). Pure.

const LONG_CHARS = 1400;
const LONG_LINES = 24;

export const isLong = (text: string) => text.length > LONG_CHARS || text.split('\n').length > LONG_LINES;
