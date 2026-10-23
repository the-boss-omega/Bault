import { useI18n } from '../../../shared/i18n';
import { CONSENT_DOCUMENT_IDS, DRAFT_NOTICE, LEGAL_DOCUMENTS, type LegalDocument } from './legalContent';

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
