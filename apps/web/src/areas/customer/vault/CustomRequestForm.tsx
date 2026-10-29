import { useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n } from '../../../shared/i18n';
import { DrawerTag } from '../../../shared/ui/DrawerTag';
import { Button, ErrorState, Field } from '../../../shared/ui/primitives';

export function CustomRequestForm({
  itemId,
  onCancel,
  onDone,
  onError,
}: {
  itemId?: string;
  onCancel: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const [summary, setSummary] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const summaryOk = summary.trim().length >= 3;
  const detailOk = detail.trim().length >= 10;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<{ code: string }>('/services/custom', {
        itemId,
        summary: summary.trim(),
        detail: detail.trim(),
      });
      onDone(t('custom.raised', { code: created.code }));
    } catch (e) {
      setError((e as Error).message);
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack stack--tight">
      <h3 className="drawer-heading">{t('custom.action')}</h3>
      <p className="hint">{t('custom.intro')}</p>

      <div className="request-form request-form--stacked">
        {/* The request as it will be read by the person who prices it: what is wanted, and how it is put. */}
        <aside className="request-slip">
          <DrawerTag
            kicker={t('custom.slip.kicker')}
            title={
              summary.trim() || <span className="drawer-tag-quiet">{t('custom.summary')}</span>
            }
            note={t('custom.freeNote')}
          >
            <div className="ticket-note">
              <span className="slip-label">{t('custom.detail')}</span>
              <p>{detail.trim() || '—'}</p>
            </div>
          </DrawerTag>
        </aside>

        <div className="stack stack--tight request-form-fields">
          <Field label={t('custom.summary')} hint={t('custom.summaryHint')}>
            <input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              maxLength={120}
              dir="auto"
              autoFocus
            />
          </Field>

          <Field
            label={t('custom.detail')}
            hint={t('custom.detailHint')}
            error={detail.length > 0 && !detailOk ? t('custom.detailTooShort') : undefined}
          >
            <textarea
              rows={4}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              maxLength={2000}
              dir="auto"
              aria-invalid={detail.length > 0 && !detailOk}
            />
          </Field>

          {error && <ErrorState message={error} />}
        </div>

        <div className="row request-form-actions">
          <Button
            variant="primary"
            loading={busy}
            disabled={!summaryOk || !detailOk}
            onClick={() => void submit()}
          >
            {t('custom.submit')}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {t('ui.cancel')}
          </Button>
        </div>
      </div>
    </div>
  );
}
