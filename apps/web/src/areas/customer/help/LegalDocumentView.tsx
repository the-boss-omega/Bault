import { useI18n } from '../../../shared/i18n';
import { CONSENT_DOCUMENT_IDS, DRAFT_NOTICE, LEGAL_DOCUMENTS, type LegalDocument } from './legalContent';

/**
 * The banner every draft carries, wherever it is shown.
 *
 * The drafts were written from the code and nobody qualified has reviewed them.
 * Presenting one without this would let a customer — or a colleague — read an
 * engineer's draft as a reviewed agreement. The banner text is the document's
 * own (`DRAFT_NOTICE`), in the document's language, so it cannot be translated
 * into something softer; the line under it explains it in the reader's.
 */
export function DraftBanner({ doc }: { doc: Pick<LegalDocument, 'version'> }) {
  const { t } = useI18n();
  return (
    <div className="infobox legal-draft" role="note">
      <p lang="en" dir="ltr">
        <strong>{DRAFT_NOTICE}</strong>
        {doc.version && <> · {doc.version}</>}
      </p>
      <p className="hint">{t('legal.draftExplain')}</p>
    </div>
  );
}

/**
 * The documents a new account agrees to, readable on the sign-up form itself.
 *
 * Sign-up is a signed-out page and FAQ & Legal is not, so a link to the terms
 * would have led somebody who has not got an account to a page they cannot
 * open — asking them to accept a text they had no way to read. The text is the
 * same `LEGAL_DOCUMENTS` entry the Legal tab renders, so there is one copy.
 */
export function TermsReader({ id }: { id: string }) {
  const docs = CONSENT_DOCUMENT_IDS.map((docId) => LEGAL_DOCUMENTS.find((d) => d.id === docId)).filter(
    (d): d is LegalDocument => Boolean(d),
  );
  return (
    <div id={id} className="terms-reader" tabIndex={0}>
      {docs.map((doc) => (
        <section key={doc.id} className="terms-reader-doc" aria-labelledby={`${id}-${doc.id}`}>
          <h3 id={`${id}-${doc.id}`} lang="en" dir="ltr">
            {doc.title}
          </h3>
          {doc.draft && <DraftBanner doc={doc} />}
          <div lang="en" dir="ltr">
            {doc.sections.map((section) => (
              <div key={section.id} className="legal-section">
                <h4>{section.heading}</h4>
                <pre className="legal-pre">{section.body}</pre>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
