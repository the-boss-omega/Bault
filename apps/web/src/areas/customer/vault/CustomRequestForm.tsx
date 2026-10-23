import { useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n } from '../../../shared/i18n';
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
      <p className="hint">{t('custom.intro')}</p>

      <Field label={t('custom.summary')} hint={t('custom.summaryHint')}>
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          maxLength={120}
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
          aria-invalid={detail.length > 0 && !detailOk}
        />
      </Field>

      <p className="hint">{t('custom.freeNote')}</p>

      {error && <ErrorState message={error} />}

      <div className="row">
        <span className="spacer" />
        <Button variant="ghost" onClick={onCancel}>
          {t('ui.cancel')}
        </Button>
        <Button variant="gold" loading={busy} disabled={!summaryOk || !detailOk} onClick={() => void submit()}>
          {t('custom.submit')}
        </Button>
      </div>
    </div>
  );
}
