export function collectText(node: any): string {
  if (!node) return '';
  if (node.type === 'text' || node.type === 'cdata') return node.content || '';
  return (node.children || []).map(collectText).join('');
}

export function getText(root: any, name: string): string {
  const el = root?.findElement?.(name);
  return el ? collectText(el).trim() : '';
}

export function getAllText(root: any, name: string): string[] {
  const els = root?.findAllElements?.(name) || [];
  return els.map((e: any) => e.getTextContent().trim()).filter(Boolean);
}

export function parseTags(root: any, limit = 12): string[] {
  const tagsEl: any = root?.findElement?.('tags');
  const tags: string[] = (tagsEl?.findAllElements?.('tag') || [])
    .map((t: any) => t.getTextContent().trim())
    .filter(Boolean);
  return limit > 0 ? tags.slice(0, limit) : tags;
}

export function parseEntities(root: any): { persons: string[]; orgs?: string[]; artifacts?: string[]; places?: string[]; times?: string[]; others?: string[] } {
  const entitiesEl: any = root?.findElement?.('entities');
  const persons = (entitiesEl?.findAllElements?.('p') || []).map((t: any) => t.getTextContent().trim()).filter(Boolean);
  const orgs = (entitiesEl?.findAllElements?.('o') || []).map((t: any) => t.getTextContent().trim()).filter(Boolean);
  const artifacts = (entitiesEl?.findAllElements?.('a') || []).map((t: any) => t.getTextContent().trim()).filter(Boolean);
  const places = (entitiesEl?.findAllElements?.('pl') || []).map((t: any) => t.getTextContent().trim()).filter(Boolean);
  const times = (entitiesEl?.findAllElements?.('t') || []).map((t: any) => t.getTextContent().trim()).filter(Boolean);
  const others = (entitiesEl?.findAllElements?.('ot') || []).map((t: any) => t.getTextContent().trim()).filter(Boolean);
  return { persons, orgs, artifacts, places, times, others };
}

export function parseExtras(root: any): { omissions: string[]; text: string } {
  const extrasEl: any = root?.findElement?.('extras');
  const omissions = (extrasEl?.findAllElements?.('omission') || []).map((t: any) => t.getTextContent().trim()).filter(Boolean);
  const text = extrasEl ? collectText(extrasEl).trim() : '';
  return { omissions, text };
}
