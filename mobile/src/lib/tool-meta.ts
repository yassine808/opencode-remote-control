/** What kind of work a tool call is — its icon, and how it is counted in a summary. */

export interface Kind {
  /** stable key used to group counts */
  key: string;
  set: 'ionicons' | 'mci';
  icon: string;
  one: string;
  many: string;
}

export const THOUGHT: Kind = { key: 'thought', set: 'mci', icon: 'brain', one: 'thought', many: 'thoughts' };

const KINDS: Record<string, Kind> = {
  command: { key: 'command', set: 'ionicons', icon: 'terminal-outline', one: 'command', many: 'commands' },
  read: { key: 'read', set: 'ionicons', icon: 'document-text-outline', one: 'read', many: 'reads' },
  edit: { key: 'edit', set: 'ionicons', icon: 'create-outline', one: 'edit', many: 'edits' },
  search: { key: 'search', set: 'ionicons', icon: 'search-outline', one: 'search', many: 'searches' },
  web: { key: 'web', set: 'ionicons', icon: 'globe-outline', one: 'web search', many: 'web searches' },
  agent: { key: 'agent', set: 'ionicons', icon: 'git-branch-outline', one: 'subagent', many: 'subagents' },
  plan: { key: 'plan', set: 'ionicons', icon: 'checkbox-outline', one: 'plan update', many: 'plan updates' },
  question: { key: 'question', set: 'ionicons', icon: 'help-circle-outline', one: 'question', many: 'questions' },
  other: { key: 'other', set: 'ionicons', icon: 'construct-outline', one: 'tool call', many: 'tool calls' },
};

const BY_NAME: Record<string, string> = {
  bash: 'command',
  shell: 'command',
  read: 'read',
  edit: 'edit',
  write: 'edit',
  patch: 'edit',
  glob: 'search',
  grep: 'search',
  find: 'search',
  list: 'search',
  webfetch: 'web',
  websearch: 'web',
  task: 'agent',
  todowrite: 'plan',
  todoread: 'plan',
  question: 'question',
};

export function kindOfTool(name: string): Kind {
  return KINDS[BY_NAME[name] ?? 'other'];
}

export function plural(kind: Kind, n: number): string {
  return `${n} ${n === 1 ? kind.one : kind.many}`;
}
