import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../../../shared/api';
import { useI18n } from '../../../shared/i18n';
import { Button, ErrorState, Field, Panel, StatusBadge, SuccessNote } from '../../../shared/ui/primitives';
import { DrawerTag } from '../../../shared/ui/DrawerTag';
import { typedCode as digits } from '../../../shared/twoFactor';

interface MfaStatus {
  enabled: boolean;
  pending: boolean;
  required: boolean;
  recoveryCodesRemaining: number;
}

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

export function TwoFactorPanel({ onEnabled }: { onEnabled?: () => void }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api.get<MfaStatus>('/auth/mfa'));
      setLoadError(null);
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

  const begin = () =>
    run(async () => {
      const setup = await api.post<MfaSetup>('/auth/mfa/setup');
      setMode({ kind: 'setup', setup });
    });

  const confirm = (code: string, password: string) =>
    run(async () => {
      const res = await api.post<{ recoveryCodes: string[] }>('/auth/mfa/confirm', { code: digits(code), password });
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
      <div className="stack stack--tight">
        {note && <SuccessNote>{note}</SuccessNote>}
        {loadError && <ErrorState message={loadError} onRetry={() => void load()} retryLabel={t('ui.retry')} />}
        {error && <ErrorState message={error} />}

        {mode.kind === 'codes' ? (
          <RecoveryCodes codes={mode.codes} onDone={() => void codesSaved()} />
        ) : status === null ? null : status.enabled ? (
          <div className="request-form request-form--stacked">
            {/* Where it stands, on a card: what it asks for at every sign-in, and what is left of the way back in. */}
            <aside className="request-slip">
              <DrawerTag
                kicker={t('mfa.title')}
                status={<StatusBadge tone="success">{t('mfa.status.on')}</StatusBadge>}
                note={t('mfa.recovery.left', { count: status.recoveryCodesRemaining })}
              >
                <p className="drawer-tag-text">{t('mfa.enabledNote')}</p>
                {status.required && <p className="drawer-tag-text">{t('mfa.required.note')}</p>}
              </DrawerTag>
            </aside>

            {mode.kind === 'regenerate' ? (
              <div className="request-form-fields">
                <CodeForm
                  hint={t('mfa.recovery.newHint')}
                  submitLabel={t('mfa.recovery.make')}
                  busy={busy}
                  onSubmit={regenerate}
                  onCancel={() => setMode({ kind: 'idle' })}
                />
              </div>
            ) : mode.kind === 'disable' ? (
              <div className="request-form-fields">
                <DisableForm
                  busy={busy}
                  onSubmit={disable}
                  onCancel={() => setMode({ kind: 'idle' })}
                />
              </div>
            ) : (
              <div className="row request-form-actions">
                <Button onClick={() => setMode({ kind: 'regenerate' })}>{t('mfa.recovery.new')}</Button>
                {!status.required && (
                  <Button onClick={() => setMode({ kind: 'disable' })}>{t('mfa.disable')}</Button>
                )}
              </div>
            )}
          </div>
        ) : mode.kind === 'setup' ? (
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
                onSubmit={confirm}
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
            <div className="row request-form-actions">
              <Button variant="primary" loading={busy} onClick={() => void begin()}>
                {t('mfa.setup')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

function CodeForm({
  hint,
  submitLabel,
  busy,
  withPassword = false,
  onSubmit,
  onCancel,
}: {
  hint: string;
  submitLabel: string;
  busy: boolean;
  withPassword?: boolean;
  onSubmit: (code: string, password: string) => void;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit(code, password);
  }
  return (
    <form className="stack stack--tight" onSubmit={submit}>
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
        <Button
          variant="primary"
          type="submit"
          loading={busy}
          disabled={digits(code).length !== 6 || (withPassword && !password)}
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
