import { LuciformXMLParser } from '@luciformresearch/xmlparser';

const xml = `<l1><summary><![CDATA[Hello world]]></summary><tags><tag>test</tag></tags><entities><p>Alice</p><o>Org</o><pl>Paris</pl><t>2025-10-01</t></entities></l1>`;

const parser = new LuciformXMLParser(xml, { mode: 'luciform-permissive', maxTextLength: 10000 });
const parsed = parser.parse();
if (!parsed.document || !parsed.document.root) {
  console.error('No document/root parsed');
  process.exit(2);
}
const root: any = parsed.document.root;
console.log('root.name =', root.name);

const collectText = (node: any): string => {
  if (!node) return '';
  if (node.type === 'text' || node.type === 'cdata') return node.content || '';
  return (node.children || []).map(collectText).join('');
};

const summaryEl = root.findElement('summary');
const summaryText = summaryEl ? collectText(summaryEl).trim() : '';
console.log('summary =', summaryText);

const tagsEl = root.findElement('tags');
const tags = (tagsEl?.findAllElements('tag') || []).map((t: any) => t.getTextContent().trim());
console.log('tags =', tags);

const entities = root.findElement('entities');
const persons = (entities?.findAllElements('p') || []).map((t: any) => t.getTextContent().trim());
console.log('persons =', persons);

if (root.name !== 'l1' || summaryText !== 'Hello world' || tags[0] !== 'test' || persons[0] !== 'Alice') {
  console.error('Unexpected parsing behavior');
  process.exit(3);
}

console.log('xmlparser package integration OK');
