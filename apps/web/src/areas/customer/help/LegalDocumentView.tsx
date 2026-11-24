import { useI18n } from '../../../shared/i18n';
import { CONSENT_DOCUMENT_IDS, DRAFT_NOTICE, LEGAL_DOCUMENTS, type LegalDocument } from './legalContent';

export type LegalBlock =
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'dl'; entries: { term: string; description: string }[] };

const join = (lines: string[]) => lines.map((l) => l.trim()).filter(Boolean).join(' ');

export function legalBlocks(body: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  for (const chunk of body.split(/\n\s*\n/)) {
    const lines = chunk.split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) continue;
    if (/^\s*- /.test(lines[0]!)) {
      const items: string[][] = [];
      for (const line of lines) {
        if (/^\s*- /.test(line)) items.push([line.replace(/^\s*- /, '')]);
        else items[items.length - 1]!.push(line);
      }
      blocks.push({ kind: 'ul', items: items.map(join) });
    } else if (/^ {2}\S/.test(lines[0]!)) {
      const entries: { term: string; rest: string[] }[] = [];
      for (const line of lines) {
        if (/^ {2}\S/.test(line)) {
          const [term, ...rest] = line.trim().split(/\s{2,}/);
          entries.push({ term: term ?? '', rest: [rest.join(' ')] });
        } else {
          entries[entries.length - 1]!.rest.push(line);
        }
      }
      blocks.push({ kind: 'dl', entries: entries.map((e) => ({ term: e.term, description: join(e.rest) })) });
    } else {
      blocks.push({ kind: 'p', text: join(lines) });
    }
  }
  return blocks;
}

export function LegalBody({ body, preformatted = false }: { body: string; preformatted?: boolean }) {
  if (preformatted) return <pre className="legal-pre">{body}</pre>;
  return (
    <div className="legal-prose">
      {legalBlocks(body).map((block, i) =>
        block.kind === 'p' ? (
          <p key={i}>{block.text}</p>
        ) : block.kind === 'ul' ? (
          <ul key={i}>
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ) : (
          <dl key={i}>
            {block.entries.map((entry, j) => (
              <div key={j}>
                <dt>{entry.term}</dt>
                {entry.description && <dd>{entry.description}</dd>}
              </div>
            ))}
          </dl>
        ),
      )}
    </div>
  );
}

export function DraftBanner({ doc }: { doc: Pick<LegalDocument, 'version'> }) {
  const { t } = useI18n();
  return (
    <div className="infobox legal-draft" role="note">
      <p>
        <strong>{DRAFT_NOTICE}</strong>
        {doc.version && <> · {doc.version}</>}
      </p>
      <p className="hint">{t('legal.draftExplain')}</p>
    </div>
  );
}

export function TermsReader({ id }: { id: string }) {
  const docs = CONSENT_DOCUMENT_IDS.map((docId) => LEGAL_DOCUMENTS.find((d) => d.id === docId)).filter(
    (d): d is LegalDocument => Boolean(d),
  );
  return (
    <div id={id} className="terms-reader" tabIndex={0}>
      {docs.map((doc) => (
        <section key={doc.id} className="terms-reader-doc" aria-labelledby={`${id}-${doc.id}`}>
          <h3 id={`${id}-${doc.id}`}>{doc.title}</h3>
          {doc.draft && <DraftBanner doc={doc} />}
          <div>
            {doc.sections.map((section) => (
              <div key={section.id} className="legal-section">
                <h4>{section.heading}</h4>
                <LegalBody body={section.body} preformatted={doc.preformatted} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
