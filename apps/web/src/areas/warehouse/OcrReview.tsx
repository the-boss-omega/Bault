import { useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { useI18n, type MessageKey } from '../../shared/i18n';
import { Button, Field } from '../../shared/ui/primitives';

export type OcrSubject = 'parcel' | 'item';

export const OCR_FIELDS: Record<OcrSubject, readonly string[]> = {
  parcel: ['trackingNumber', 'carrier', 'senderName', 'senderAddress'],
  item: ['cardName', 'setName', 'cardNumber', 'year', 'gradingBody', 'grade', 'certNumber'],
};

const CERT_DIGITS: Record<string, readonly [number, number]> = {
  PSA: [8, 8],
  BGS: [10, 10],
  CGC: [7, 10],
  SGC: [7, 8],
};

export function certShapeProblem(body: string, cert: string): { body: string; shape: string } | null {
  const digits = cert.replace(/\s+/g, '');
  if (!digits) return null;
  const key = body.trim().toUpperCase();
  const [min, max] = CERT_DIGITS[key] ?? [7, 10];
  if (/^\d+$/.test(digits) && digits.length >= min && digits.length <= max) return null;
  return { body: CERT_DIGITS[key] ? key : 'grading', shape: min === max ? `${min} digits` : `${min} to ${max} digits` };
}

interface Reading {
  ready: boolean;
  fields?: Record<string, string>;
  confidence?: Record<string, number>;
  consumedAt?: string | null;
}

type Phase = 'waiting' | 'ready' | 'nothing' | 'off' | 'saved' | 'dismissed';

const pathFor = (subject: OcrSubject, id: string) =>
  subject === 'parcel' ? `/parcels/${id}/ocr` : `/custody/items/${id}/ocr`;

export function OcrReview({
  subject,
  id,
  pollMs = 2_000,
  waitMs = 20_000,
  onSaved,
}: {
  subject: OcrSubject;
  id: string;
  pollMs?: number;
  waitMs?: number;
  onSaved?: () => void;
}) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>('waiting');
  const [values, setValues] = useState<Record<string, string>>({});
  const [read, setRead] = useState<Record<string, number>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const started = Date.now();
    setPhase('waiting');
    setValues({});
    setRead({});
    setChecked({});
    const poll = async () => {
      try {
        const reading = await api.get<Reading>(pathFor(subject, id));
        if (!live) return;
        if (reading.ready && reading.consumedAt) {
          setPhase('saved');
          return;
        }
        if (reading.ready) {
          const fields = reading.fields ?? {};
          const marks: Record<string, number> = {};
          for (const name of OCR_FIELDS[subject]) {
            if (fields[name]) marks[name] = reading.confidence?.[name] ?? 0;
          }
          setValues(fields);
          setRead(marks);
          setPhase(Object.keys(marks).length > 0 ? 'ready' : 'nothing');
          return;
        }
      } catch (e) {
        if (!live) return;
        if ((e as { status?: number }).status === 404 || /not found/i.test((e as Error).message)) {
          setPhase('off');
          return;
        }
      }
      if (Date.now() - started + pollMs > waitMs) {
        setPhase('nothing');
        return;
      }
      timer = setTimeout(() => void poll(), pollMs);
    };
    void poll();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [subject, id, pollMs, waitMs, round]);

  if (phase === 'off' || phase === 'dismissed') return null;

  const title = t(subject === 'parcel' ? 'ocr.title.label' : 'ocr.title.item');
  if (phase === 'waiting' || phase === 'nothing' || phase === 'saved') {
    const line = phase === 'waiting' ? t('ocr.waiting') : phase === 'saved' ? t('ocr.saved') : t('ocr.nothing');
    return (
      <section className="stack stack--tight" aria-label={title}>
        <p className="hint" role="status">
          {title}: {line}
        </p>
        {phase === 'nothing' && (
          <div className="row">
            <Button size="sm" variant="secondary" onClick={() => setRound((n) => n + 1)}>
              {t('warehouse.ocr.readAgain')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPhase('dismissed')}>
              {t('ocr.skip')}
            </Button>
          </div>
        )}
      </section>
    );
  }

  const unchecked = Object.keys(read).filter((name) => !checked[name]);
  const cert = subject === 'item' ? certShapeProblem(values.gradingBody ?? '', values.certNumber ?? '') : null;

  const edit = (name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setRead((prev) => {
      if (!(name in prev)) return prev;
      const { [name]: _gone, ...rest } = prev;
      return rest;
    });
    setError(null);
  };

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, string> = {};
      for (const name of OCR_FIELDS[subject]) {
        const value = (values[name] ?? '').trim();
        if (value) body[name] = value;
      }
      await api.post(`${pathFor(subject, id)}/confirm`, body);
      setPhase('saved');
      onSaved?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stack stack--tight" aria-label={title}>
      <h3>{title}</h3>
      <p className="hint">{t('ocr.intro')}</p>
      <div className="form-grid">
        {OCR_FIELDS[subject].map((name) => {
          const label = t(`ocr.field.${name}` as MessageKey);
          const marked = name in read;
          const hint = marked
            ? t('ocr.readFromPhoto', { confidence: `${Math.round((read[name] ?? 0) * 100)}%` })
            : undefined;
          const problem = name === 'certNumber' && cert ? t('ocr.certShape', cert) : undefined;
          return (
            <div key={name} className="stack stack--tight" data-ocr-field={name} data-read-from-photo={marked || undefined}>
              <Field label={label} hint={hint} error={problem}>
                {name === 'senderAddress' ? (
                  <textarea value={values[name] ?? ''} onChange={(e) => edit(name, e.target.value)} rows={3} dir="auto" />
                ) : (
                  <input
                    value={values[name] ?? ''}
                    onChange={(e) => edit(name, e.target.value)}
                    aria-invalid={problem ? true : undefined}
                    dir="auto"
                    autoComplete="off"
                    spellCheck={false}
                  />
                )}
              </Field>
              {marked && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={checked[name] === true}
                    onChange={(e) => setChecked((prev) => ({ ...prev, [name]: e.target.checked }))}
                  />
                  {t('ocr.matches')} · {label}
                </label>
              )}
            </div>
          );
        })}
      </div>
      {error && (
        <p className="hint" role="alert">
          {error}
        </p>
      )}
      <div className="row request-form-actions">
        <Button variant="primary" loading={busy} disabled={unchecked.length > 0 || cert !== null} onClick={() => void save()}>
          {t('ocr.save')}
        </Button>
        <Button variant="ghost" onClick={() => setPhase('dismissed')}>
          {t('ocr.skip')}
        </Button>
        {unchecked.length > 0 && <span className="hint">{t('ocr.toCheck', { count: unchecked.length })}</span>}
      </div>
    </section>
  );
}
