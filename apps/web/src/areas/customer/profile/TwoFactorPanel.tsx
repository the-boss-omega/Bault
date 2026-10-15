import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../../../shared/api';
import { useI18n } from '../../../shared/i18n';
import { Button, ErrorState, Field, Panel, StatusBadge, SuccessNote } from '../../../shared/ui/primitives';
import { typedCode as digits } from '../../../shared/twoFactor';

/** `GET /auth/mfa`. Never a secret and never a recovery code. */
interface MfaStatus {
  enabled: boolean;
  pending: boolean;
  required: boolean;
  recoveryCodesRemaining: number;
}

/** `POST /auth/mfa/setup`. */
interface MfaSetup {
  otpauthUri: string;
  secret: string;
  qrCode: string;
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'setup'; setup: MfaSetup }
  | { kind: 'codes'; codes: string[] }
  | { kind: 'regenerate' }
  | { kind: 'disable' };

/**
 * Two-factor sign-in on the account-security screen: enrol, see how many
 * recovery codes are left, replace them, turn it off.
 *
 * Enrolment is three steps and none is skipped. The secret is shown two ways —
 * a QR code to scan and the key to type — then a code from the app proves it
 * arrived, and only then is it on. The recovery codes come back with that
 * confirmation and are shown ONCE: the API keeps no copy it can read, so this
 * screen makes saving them a step of its own, with "Done" held until the person
 * says they have. Leaving the screen any other way loses them, which is why the
 * acknowledgement is not optional.
 *
 * Turning it off is not offered to a role that requires it — the API would
 * refuse it, and a button that always fails is worse than an explanation.
 */
export function TwoFactorPanel({ onEnabled }: { onEnabled?: () => void }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api.get<MfaStatus>('/auth/mfa'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Run one request with the busy flag and the error line handled the same way every time. */
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const begin = () =>
    run(async () => {
      const setup = await api.post<MfaSetup>('/auth/mfa/setup');
      setMode({ kind: 'setup', setup });
    });

  const confirm = (code: string) =>
    run(async () => {
      const res = await api.post<{ recoveryCodes: string[] }>('/auth/mfa/confirm', { code: digits(code) });
      setMode({ kind: 'codes', codes: res.recoveryCodes });
    });

  const regenerate = (code: string) =>
    run(async () => {
      const res = await api.post<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', { code: digits(code) });
      setMode({ kind: 'codes', codes: res.recoveryCodes });
    });

  const disable = (password: string, code: string) =>
    run(async () => {
      await api.post('/auth/mfa/disable', { password, code: digits(code) });
      setMode({ kind: 'idle' });
      setNote(t('mfa.disabled'));
      await load();
    });

  async function codesSaved() {
    const wasEnabling = !status?.enabled;
    setMode({ kind: 'idle' });
    await load();
    if (wasEnabling) {
      setNote(t('mfa.enabled'));
      onEnabled?.();
    }
  }

  return (
    <Panel title={t('mfa.title')} subtitle={t('mfa.panel.subtitle')}>
      <div className="stack stack--tight" style={{ maxWidth: 560 }}>
        {note && <SuccessNote>{note}</SuccessNote>}
        {error && <ErrorState message={error} />}

        {mode.kind === 'codes' ? (
          <RecoveryCodes codes={mode.codes} onDone={() => void codesSaved()} />
        ) : status === null ? null : status.enabled ? (
          <>
            <p>
              <StatusBadge tone="success">{t('mfa.status.on')}</StatusBadge> {t('mfa.enabledNote')}
            </p>
            <p className="hint">{t('mfa.recovery.left', { count: status.recoveryCodesRemaining })}</p>
            {status.required && <p className="hint">{t('mfa.required.note')}</p>}

            {mode.kind === 'regenerate' ? (
              <CodeForm
                hint={t('mfa.recovery.newHint')}
                submitLabel={t('mfa.recovery.make')}
                busy={busy}
                onSubmit={regenerate}
                onCancel={() => setMode({ kind: 'idle' })}
              />
            ) : mode.kind === 'disable' ? (
              <DisableForm busy={busy} onSubmit={disable} onCancel={() => setMode({ kind: 'idle' })} />
            ) : (
              <div className="row">
                <Button onClick={() => setMode({ kind: 'regenerate' })}>{t('mfa.recovery.new')}</Button>
                {!status.required && (
                  <Button variant="ghost" onClick={() => setMode({ kind: 'disable' })}>
                    {t('mfa.disable')}
                  </Button>
                )}
              </div>
            )}
          </>
        ) : mode.kind === 'setup' ? (
          <>
            <p>{t('mfa.setup.scan')}</p>
            {/* A data URL made by the API, shown as an image: no server markup
                is ever put into the page as HTML. */}
            <img src={mode.setup.qrCode} alt={t('mfa.setup.qrAlt')} width={200} height={200} />
            <div>
              <span className="field-label">{t('mfa.setup.key')}</span>{' '}
              <code className="code-inline" dir="ltr">
                {mode.setup.secret}
              </code>
            </div>
            <CodeForm hint={t('mfa.setup.confirmHint')} submitLabel={t('mfa.setup.turnOn')} busy={busy} onSubmit={confirm} />
          </>
        ) : (
          <>
            <p>
              <StatusBadge>{t('mfa.status.off')}</StatusBadge>
            </p>
            {status.required && <p className="hint">{t('mfa.required.note')}</p>}
            <div className="row">
              <Button variant="gold" loading={busy} onClick={() => void begin()}>
                {t('mfa.setup')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

/** A code from the app, and one action. */
function CodeForm({
  hint,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  hint: string;
  submitLabel: string;
  busy: boolean;
  onSubmit: (code: string) => void;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit(code);
  }
  return (
    <form className="stack stack--tight" onSubmit={submit}>
      <Field label={t('mfa.code')} hint={hint}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={9}
          dir="ltr"
        />
      </Field>
      <div className="row">
        <Button variant="gold" type="submit" loading={busy} disabled={digits(code).length !== 6}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            {t('ui.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}

/** The password and a current code: what turning the second factor off costs. */
function DisableForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (password: string, code: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit(password, code);
  }
  return (
    <form className="stack stack--tight" onSubmit={submit}>
      <p className="hint">{t('mfa.disable.hint')}</p>
      <Field label={t('auth.password')}>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          dir="ltr"
        />
      </Field>
      <Field label={t('mfa.code')}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={9}
          dir="ltr"
        />
      </Field>
      <div className="row">
        <Button variant="secondary" type="submit" loading={busy} disabled={!password || digits(code).length !== 6}>
          {t('mfa.disable.confirm')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('ui.cancel')}
        </Button>
      </div>
    </form>
  );
}

/**
 * The recovery codes, the one time they exist outside the person's own copy.
 * "Done" waits for the box to be ticked: closing this is losing them.
 */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useI18n();
  const [saved, setSaved] = useState(false);
  return (
    <div className="stack stack--tight">
      <h3>{t('mfa.recovery.title')}</h3>
      <p>{t('mfa.recovery.body')}</p>
      <ol className="recovery-codes" dir="ltr">
        {codes.map((code) => (
          <li key={code}>
            <code className="code-inline">{code}</code>
          </li>
        ))}
      </ol>
      <label className="check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        {t('mfa.recovery.saved')}
      </label>
      <div className="row">
        <Button variant="gold" disabled={!saved} onClick={onDone}>
          {t('mfa.recovery.done')}
        </Button>
      </div>
    </div>
  );
}
