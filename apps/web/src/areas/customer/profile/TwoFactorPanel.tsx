import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { api } from '../../../shared/api';
import { useI18n } from '../../../shared/i18n';
import { Button, ErrorState, Field, Panel, StatusBadge, SuccessNote } from '../../../shared/ui/primitives';
import { DrawerTag } from '../../../shared/ui/DrawerTag';
import { typedCode as digits, useSecondsUntil, waitText, type MfaMethod } from '../../../shared/twoFactor';

interface MfaStatus {
  enabled: boolean;
  pending: boolean;
  method?: MfaMethod | null;
  pendingMethod?: MfaMethod | null;
  /** The methods this account may choose, the one to offer first first. */
  methods?: MfaMethod[];
  /** Where emailed codes go, or would go. */
  email?: string | null;
  required: boolean;
  recoveryCodesRemaining: number;
}

interface MfaSetup {
  otpauthUri: string;
  secret: string;
  qrCode: string;
}

/** Whether a code has been emailed for the form on screen, and when another may be asked for. */
interface Mail {
  sent: boolean;
  resendAt: number | null;
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'choose' }
  | { kind: 'setup'; setup: MfaSetup }
  | { kind: 'setup-email'; email: string; mail: Mail }
  | { kind: 'codes'; codes: string[]; fromSetup: boolean }
  | { kind: 'regenerate'; mail: Mail }
  | { kind: 'disable'; mail: Mail };

const NOT_SENT: Mail = { sent: false, resendAt: null };
const after = (seconds: number) => (seconds > 0 ? Date.now() + seconds * 1000 : null);

function methodsOf(status: MfaStatus): MfaMethod[] {
  return status.methods ?? (status.required ? ['totp'] : ['email', 'totp']);
}

export function TwoFactorPanel({ onEnabled }: { onEnabled?: () => void }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [choice, setChoice] = useState<MfaMethod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await api.get<MfaStatus>('/auth/mfa');
      setStatus(next);
      setLoadError(null);
      // A setup by email left half done comes back to its code: the code may already be in the inbox.
      if (!next.enabled && next.pending && next.pendingMethod === 'email') {
        setMode((m) =>
          m.kind === 'idle' ? { kind: 'setup-email', email: next.email ?? '', mail: { sent: true, resendAt: null } } : m,
        );
      }
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  function go(next: Mode) {
    setError(null);
    setNote(null);
    setMode(next);
  }

  const begin = (method: MfaMethod) =>
    run(async () => {
      if (method === 'email') {
        const res = await api.post<{ email: string; resendAfterSeconds: number }>('/auth/mfa/setup', { method });
        setMode({ kind: 'setup-email', email: res.email, mail: { sent: true, resendAt: after(res.resendAfterSeconds) } });
      } else {
        setMode({ kind: 'setup', setup: await api.post<MfaSetup>('/auth/mfa/setup', { method }) });
      }
    });

  /** Emails a code for the form on screen: the address being proved, or a change to emailed codes. */
  async function sendCode() {
    if (!('mail' in mode)) return;
    const wasSent = mode.mail.sent;
    setSending(true);
    setError(null);
    setNote(null);
    try {
      const res = await api.post<{ email: string; resendAfterSeconds: number }>('/auth/mfa/email/code');
      const mail: Mail = { sent: true, resendAt: after(res.resendAfterSeconds) };
      setMode((m) => ('mail' in m ? ({ ...m, mail } as Mode) : m));
      setNote(wasSent ? t('mfa.email.resent', { email: res.email }) : t('mfa.email.sent', { email: res.email }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const confirm = (method: MfaMethod) => (code: string, password: string) =>
    run(async () => {
      const res = await api.post<{ recoveryCodes: string[] }>('/auth/mfa/confirm', {
        method,
        code: digits(code),
        password,
      });
      setMode({ kind: 'codes', codes: res.recoveryCodes, fromSetup: true });
    });

  const regenerate = (code: string) =>
    run(async () => {
      const res = await api.post<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', { code: digits(code) });
      setMode({ kind: 'codes', codes: res.recoveryCodes, fromSetup: false });
    });

  const disable = (code: string, password: string) =>
    run(async () => {
      await api.post('/auth/mfa/disable', { password, code: digits(code) });
      setMode({ kind: 'idle' });
      setChoice(null);
      setNote(t('mfa.disabled'));
      await load();
    });

  async function codesSaved(fromSetup: boolean) {
    setMode({ kind: 'idle' });
    await load();
    if (fromSetup) {
      setNote(t('mfa.enabled'));
      onEnabled?.();
    }
  }

  const methods = status ? methodsOf(status) : [];
  const byEmail = status?.method === 'email';
  // A role that requires a second factor requires the app; emailed codes it already has do not count for it.
  const owesApp = Boolean(status?.enabled && status.required && byEmail);
  const mailFor = (m: Mode) => ('mail' in m ? m.mail : NOT_SENT);
  const emailCode = (m: Mode) => ({ ...mailFor(m), sending, onSend: () => void sendCode() });

  return (
    <Panel title={t('mfa.title')} subtitle={t('mfa.panel.subtitle')}>
      <div className="stack stack--tight">
        {note && <SuccessNote>{note}</SuccessNote>}
        {loadError && <ErrorState message={loadError} onRetry={() => void load()} retryLabel={t('ui.retry')} />}
        {error && <ErrorState message={error} />}

        {mode.kind === 'codes' ? (
          <RecoveryCodes codes={mode.codes} onDone={() => void codesSaved(mode.fromSetup)} />
        ) : status === null ? null : mode.kind === 'setup' ? (
          <div className="request-form request-form--stacked">
            {/* The key, on a card: to be scanned, or typed by hand. It is read first, so it comes first on a phone. */}
            <aside className="request-slip">
              <DrawerTag kicker={t('mfa.setup')}>
                <p className="drawer-tag-text">{t('mfa.setup.scan')}</p>
                <span className="barcode mfa-qr">
                  <img
                    src={mode.setup.qrCode}
                    alt={t('mfa.setup.qrAlt')}
                    width={200}
                    height={200}
                  />
                </span>
                <div className="mfa-key">
                  <span className="slip-label">{t('mfa.setup.key')}</span>
                  <code className="code-inline" dir="ltr">
                    {mode.setup.secret}
                  </code>
                </div>
              </DrawerTag>
            </aside>
            <div className="request-form-fields">
              <CodeForm
                hint={t('mfa.setup.confirmHint')}
                submitLabel={t('mfa.setup.turnOn')}
                busy={busy}
                withPassword
                onSubmit={confirm('totp')}
              />
            </div>
          </div>
        ) : owesApp ? (
          <div className="request-form request-form--stacked">
            <aside className="request-slip">
              <DrawerTag
                kicker={t('mfa.title')}
                status={<StatusBadge tone="warning">{t('mfa.status.notForRole')}</StatusBadge>}
              >
                <p className="drawer-tag-text">{t('mfa.staffNeedsApp')}</p>
              </DrawerTag>
            </aside>
            <div className="row request-form-actions">
              <Button variant="primary" loading={busy} onClick={() => void begin('totp')}>
                {t('mfa.setupApp')}
              </Button>
            </div>
          </div>
        ) : status.enabled ? (
          <div className="request-form request-form--stacked">
            {/* Where it stands, on a card: what it asks for at every sign-in, and what is left of the way back in. */}
            <aside className="request-slip">
              <DrawerTag
                kicker={t('mfa.title')}
                status={<StatusBadge tone="success">{t('mfa.status.on')}</StatusBadge>}
                note={t('mfa.recovery.left', { count: status.recoveryCodesRemaining })}
              >
                <p className="drawer-tag-text">
                  {byEmail ? t('mfa.email.enabledNote', { email: status.email ?? '' }) : t('mfa.enabledNote')}
                </p>
                {status.required ? (
                  <p className="drawer-tag-text">{t('mfa.required.note')}</p>
                ) : (
                  methods.length > 1 && <p className="drawer-tag-text">{t('mfa.switchHint')}</p>
                )}
              </DrawerTag>
            </aside>

            {mode.kind === 'regenerate' ? (
              <div className="request-form-fields">
                <CodeForm
                  hint={byEmail ? t('mfa.email.recoveryHint') : t('mfa.recovery.newHint')}
                  submitLabel={t('mfa.recovery.make')}
                  busy={busy}
                  email={byEmail ? emailCode(mode) : undefined}
                  onSubmit={regenerate}
                  onCancel={() => go({ kind: 'idle' })}
                />
              </div>
            ) : mode.kind === 'disable' ? (
              <div className="request-form-fields">
                <CodeForm
                  intro={byEmail ? t('mfa.email.disableHint') : t('mfa.disable.hint')}
                  submitLabel={t('mfa.disable.confirm')}
                  submitVariant="secondary"
                  busy={busy}
                  withPassword
                  email={byEmail ? emailCode(mode) : undefined}
                  onSubmit={disable}
                  onCancel={() => go({ kind: 'idle' })}
                />
              </div>
            ) : (
              <div className="row request-form-actions">
                <Button onClick={() => go({ kind: 'regenerate', mail: NOT_SENT })}>{t('mfa.recovery.new')}</Button>
                {!status.required && (
                  <Button onClick={() => go({ kind: 'disable', mail: NOT_SENT })}>{t('mfa.disable')}</Button>
                )}
              </div>
            )}
          </div>
        ) : mode.kind === 'setup-email' ? (
          <div className="request-form request-form--stacked">
            <aside className="request-slip">
              <DrawerTag kicker={t('mfa.setup')}>
                <p className="drawer-tag-text">{t('mfa.email.sent', { email: mode.email })}</p>
              </DrawerTag>
            </aside>
            <div className="request-form-fields">
              <CodeForm
                hint={t('mfa.email.confirmHint')}
                submitLabel={t('mfa.setup.turnOn')}
                busy={busy}
                withPassword
                email={emailCode(mode)}
                onSubmit={confirm('email')}
                onCancel={() => go({ kind: 'choose' })}
              />
            </div>
          </div>
        ) : (
          <div className="request-form request-form--stacked">
            <aside className="request-slip">
              <DrawerTag
                kicker={t('mfa.title')}
                status={<StatusBadge>{t('mfa.status.off')}</StatusBadge>}
              >
                {status.required && <p className="drawer-tag-text">{t('mfa.required.note')}</p>}
              </DrawerTag>
            </aside>
            <div className="request-form-fields stack stack--tight">
              {methods.length > 1 && (
                <MethodChoice
                  methods={methods}
                  chosen={choice ?? methods[0]!}
                  email={status.email ?? ''}
                  onChoose={setChoice}
                />
              )}
              <div className="row request-form-actions">
                <Button variant="primary" loading={busy} onClick={() => void begin(choice ?? methods[0] ?? 'totp')}>
                  {t('mfa.setup')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

/** The two ways to be asked for the second step, as tiles: a radio each, its name, and a line on what it means. */
function MethodChoice({
  methods,
  chosen,
  email,
  onChoose,
}: {
  methods: MfaMethod[];
  chosen: MfaMethod;
  email: string;
  onChoose: (method: MfaMethod) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  return (
    <fieldset className="choice-set">
      <legend className="field-label">{t('mfa.method.legend')}</legend>
      <ul className="choice-tiles mfa-methods">
        {methods.map((method) => (
          <li key={method}>
            <label className="check choice-tile">
              <input
                type="radio"
                name={`${id}-method`}
                value={method}
                checked={chosen === method}
                onChange={() => onChoose(method)}
                aria-labelledby={`${id}-${method}-name`}
                aria-describedby={`${id}-${method}-hint`}
              />
              <span className="choice-tile-text">
                <span className="choice-tile-name" id={`${id}-${method}-name`}>
                  {method === 'email' ? t('mfa.method.email') : t('mfa.method.totp')}
                </span>
                <span className="field-hint" id={`${id}-${method}-hint`}>
                  {method === 'email' ? t('mfa.method.emailHint', { email }) : t('mfa.method.totpHint')}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

interface EmailCode extends Mail {
  sending: boolean;
  onSend: () => void;
}

/**
 * A code, and the password where the change needs it. A code that comes by email is asked for first ("Email me a
 * code"), then typed; another can be asked for once the wait is over.
 */
function CodeForm({
  intro,
  hint,
  submitLabel,
  submitVariant = 'primary',
  busy,
  withPassword = false,
  email,
  onSubmit,
  onCancel,
}: {
  intro?: string;
  hint?: string;
  submitLabel: string;
  submitVariant?: 'primary' | 'secondary';
  busy: boolean;
  withPassword?: boolean;
  email?: EmailCode;
  onSubmit: (code: string, password: string) => void;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const wait = useSecondsUntil(email?.resendAt ?? null);
  const codeShown = !email || email.sent;
  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit(code, password);
  }
  return (
    <form className="stack stack--tight" onSubmit={submit}>
      {intro && <p className="hint">{intro}</p>}
      {withPassword && (
        <Field label={t('auth.password')}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            dir="ltr"
          />
        </Field>
      )}
      {codeShown && (
        <Field label={email ? t('mfa.email.code') : t('mfa.code')} hint={hint}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={9}
            dir="ltr"
          />
        </Field>
      )}
      {!codeShown && hint && <p className="field-hint">{hint}</p>}
      {email && (
        <div className="row mfa-resend">
          <Button size="sm" disabled={wait > 0} loading={email.sending} onClick={email.onSend}>
            {email.sent ? t('mfa.email.resend') : t('mfa.email.send')}
          </Button>
          {wait > 0 && <span className="field-hint">{waitText(t, wait)}</span>}
        </div>
      )}
      <div className="row">
        <Button
          variant={submitVariant}
          type="submit"
          loading={busy}
          disabled={!codeShown || digits(code).length !== 6 || (withPassword && !password)}
        >
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

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useI18n();
  const [saved, setSaved] = useState(false);
  return (
    <div className="stack stack--tight mfa-codes">
      {/* The codes are a sheet to keep: they are shown once, and the sheet is what is printed or saved. */}
      <DrawerTag kicker={t('mfa.title')} title={t('mfa.recovery.title')} titleAs="h3">
        <p className="drawer-tag-text">{t('mfa.recovery.body')}</p>
        <ol className="recovery-codes" dir="ltr">
          {codes.map((code) => (
            <li key={code}>
              <code className="code-inline">{code}</code>
            </li>
          ))}
        </ol>
      </DrawerTag>
      <label className="check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        {t('mfa.recovery.saved')}
      </label>
      <div className="row">
        <Button variant="primary" disabled={!saved} onClick={onDone}>
          {t('mfa.recovery.done')}
        </Button>
      </div>
    </div>
  );
}
