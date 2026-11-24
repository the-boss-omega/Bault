const STATE_WORDS: Record<string, string> = {
  received: 'still being checked in',
  stored: 'in the vault',
  listed: 'listed for sale',
  'on-hold': 'on hold',
  sold: 'sold',
  shipped: 'shipped',
  donated: 'donated',
  consigned: 'consigned',
  at_grader: 'away at a grader',
  discarded: 'discarded',
};

export function itemStateWords(state: string): string {
  return STATE_WORDS[state] ?? state.replace(/[_-]/g, ' ');
}
