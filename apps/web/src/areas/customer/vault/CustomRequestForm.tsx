import { useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n } from '../../../shared/i18n';
import { Button, ErrorState, Field } from '../../../shared/ui/primitives';

/**
 * "Can you also…" — asking for something the service list has no button for.
 *
 * The nine services in the drawer are fixed things Bault decided to sell. A
 * collector who wanted anything else — sleeve these before you ship them, weigh
 * this box, check the seal is intact — had one route: a support ticket, which is
 * a conversation with no price, no queue, no completion and no link to the
 * collectible it is about.
 *
 * The form says plainly that ASKING IS FREE and that nothing is charged until
 * they see a price and agree to it, because the reasonable fear about a box
 * marked "custom" is exactly that it will cost something unknown.
 */
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

  // Mirrors the API's own minimums, so the button disables for exactly the input
  // the server would refuse.
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

      {/* The reasonable fear about a box marked "custom" is that it will cost
          something unknown. Answering it here is cheaper than answering it in
          support afterwards. */}
      <p className="hint">{t('custom.freeNote')}</p>

      {error && <ErrorState message={error} />}

      {/* Same order as every other form in the drawer: the action, then Cancel. */}
      <div className="row">
        <Button variant="gold" loading={busy} disabled={!summaryOk || !detailOk} onClick={() => void submit()}>
          {t('custom.submit')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('ui.cancel')}
        </Button>
      </div>
    </div>
  );
}
