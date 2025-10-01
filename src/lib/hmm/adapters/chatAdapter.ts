import { ParsedItem } from '@/lib/hmm/types';

export function buildChatDoc(
  items: ParsedItem[],
  opts: { roleMap: Record<string, string>; interlocutor: string; personaName: string }
): { docs: string; allowedNames: string[] } {
  const roleMap = opts.roleMap || {};
  const mapRole = (r: 'user' | 'assistant' | 'unknown'): string => {
    const key = r === 'unknown' ? 'user' : r;
    if (key === 'assistant') return roleMap['assistant'] || opts.personaName || 'Assistant';
    return roleMap['user'] || opts.interlocutor || 'User';
  };
  const docs = items.map(m => `${mapRole(m.role as any)}: ${m.content}`).join('\n');
  const allowed = Array.from(new Set([opts.personaName, opts.interlocutor, roleMap['assistant'], roleMap['user']].filter(Boolean))) as string[];
  return { docs, allowedNames: allowed };
}

