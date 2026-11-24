import { describe, expect, it } from 'vitest';
import { legalBlocks } from '../../apps/web/src/areas/customer/help/LegalDocumentView';
import { LEGAL_DOCUMENTS } from '../../apps/web/src/areas/customer/help/legalContent';

const accountTerms = LEGAL_DOCUMENTS.find((d) => d.sections.some((s) => s.id === 'debt'))!;
const section = (id: string) => accountTerms.sections.find((s) => s.id === id)!.body;

describe('the account terms read as paragraphs, lists and definitions, not as hard-wrapped text', () => {
  it('joins a hard-wrapped paragraph into one line', () => {
    const [first] = legalBlocks(section('one-account-one-person'));
    expect(first).toEqual({
      kind: 'p',
      text: expect.stringMatching(/^A Card Embassy account belongs to one person\. Sharing an account — handing your sign-in credentials/),
    });
    expect((first as { text: string }).text).not.toContain('\n');
  });

  it('turns the space-aligned table of section 6 into terms and their descriptions', () => {
    const blocks = legalBlocks(section('debt'));
    const dl = blocks.find((b) => b.kind === 'dl');
    expect(dl).toEqual({
      kind: 'dl',
      entries: [
        { term: 'Grace period', description: 'A debt costs nothing for a grace period.' },
        {
          term: 'Interest',
          description:
            'After that, interest accrues daily on the outstanding debt, added as an ordinary entry on your ledger where you can see it. It compounds until the debt clears.',
        },
        {
          term: 'Suspension',
          description:
            'If your balance falls below the suspension threshold, your account is suspended automatically until the debt clears.',
        },
      ],
    });
  });

  it('turns a dashed list into list items', () => {
    const list = legalBlocks(section('items-we-cannot-accept')).find((b) => b.kind === 'ul');
    expect(list).toMatchObject({ kind: 'ul' });
    expect((list as { items: string[] }).items).toContain('liquids, glass, oils or gases;');
    expect((list as { items: string[] }).items).toHaveLength(7);
  });

  it('keeps every word of every section, in order', () => {
    for (const doc of LEGAL_DOCUMENTS.filter((d) => !d.preformatted)) {
      for (const s of doc.sections) {
        const words = (text: string) => text.replace(/^\s*- /gm, '').split(/\s+/).filter(Boolean);
        const rendered = legalBlocks(s.body).flatMap((b) =>
          b.kind === 'p' ? [b.text] : b.kind === 'ul' ? b.items : b.entries.flatMap((e) => [e.term, e.description]),
        );
        expect(words(rendered.join(' ')), `${doc.id} ${s.id}`).toEqual(words(s.body));
      }
    }
  });

  it('leaves the font licence as it was published', () => {
    expect(LEGAL_DOCUMENTS.find((d) => d.id === 'ofl-1-1')?.preformatted).toBe(true);
  });
});
