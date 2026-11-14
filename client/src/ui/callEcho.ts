// A Jarvis call's echo (#682, msg 4563): the agent's own voice from the speaker, heard back by the mic and transcribed
// as the manager's words (the check itself is shared/callHeard.ts, #694). Pure: the mic's processing the browser
// didn't apply, named for the trace.

/** The mic processing a call asks for that the browser didn't apply (its track's getSettings()). */
export function micProcessingOff(s: { echoCancellation?: boolean | string; noiseSuppression?: boolean; autoGainControl?: boolean }): string[] {
  return (['echoCancellation', 'noiseSuppression', 'autoGainControl'] as const).filter((k) => s[k] !== true && !(typeof s[k] === 'string' && s[k] !== 'none')); // newer browsers: echoCancellation 'all' | 'remote-only'
}
