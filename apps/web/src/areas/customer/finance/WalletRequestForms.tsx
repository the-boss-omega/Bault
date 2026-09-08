import { useMemo, useState } from 'react';
import { api } from '../../../shared/api';
import { CashOutQuotePanel } from './MoneyPanels';
import { dollarsToCents, formatUsd } from '../../../shared/money';
import { useI18n, type MessageKey } from '../../../shared/i18n';
import {
  FUNDING_SOURCES,
  MAX_NOTE_LENGTH,
  MAX_REFERENCE_LENGTH,
  WALLET_REQUEST_LIMITS,
  findOpenDuplicate,
  validateDraft,
  type WalletRequest,
  type WalletRequestType,
} from '../../../shared/walletRequests';
import { Button, ErrorState, Field, SuccessNote } from '../../../shared/ui/primitives';
import { IconArrowDown, IconUpload } from '../../../shared/ui/icons';

/**
 * The cash-in / cash-out request form.
 *
 * ONE component for both directions: the lifecycle, the validation and the
 * submission are identical, and only the field set differs (a cash-in names
 * where money comes FROM, a cash-out names where it goes TO). Splitting them
 * would mean maintaining the same rules twice.
 *
 * The form states plainly, before and after submission, that submitting does not
 * move money. That is the single most important thing a person can misunderstand
 * here, so it is on screen rather than implied by the word "request".
 *
 * Client-side validation mirrors the API's (see `shared/walletRequests.ts`) and
 * is a courtesy, not a gate: every rule is enforced again server-side, including
 * the balance check, which is re-run at completion time because a balance can
 * fall between submitting and approving.
 */
export function WalletRequestForm({
  type,
  availableMinor,
  existingRequests,
  onSubmitted,
}: {
  type: WalletRequestType;
  /** Current derived balance, used to warn about an over-balance cash-out. */
  availableMinor: number;
  /** The caller's own requests, so a duplicate is caught before submitting. */
  existingRequests: readonly WalletRequest[];
  onSubmitted: () => Promise<void> | void;
}) {
  const { t } = useI18n();
  const [amount, setAmount] = useState('');
  const [fundingSource, setFundingSource] = useState<string>('bank_transfer');
  const [destinationAccount, setDestinationAccount] = useState('');
  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [reference, setReference] = useState('');
  const [documentKey, setDocumentKey] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /** True once the user has tried to submit — errors stay quiet until then. */
  const [submitted, setSubmitted] = useState(false);

  const cents = dollarsToCents(amount);
  const limits = WALLET_REQUEST_LIMITS[type];

  const problems = useMemo(
    () =>
      validateDraft({
        type,
        amountMinor: cents,
        fundingSource,
        destinationAccount,
        beneficiaryName,
        reference,
        notes,
        availableMinor: type === 'cash_out' ? availableMinor : undefined,
      }),
    [type, cents, fundingSource, destinationAccount, beneficiaryName, reference, notes, availableMinor],
  );

  const duplicate = useMemo(
    () => findOpenDuplicate(existingRequests, { type, amountMinor: cents, reference }),
    [existingRequests, type, cents, reference],
  );

  const problemFor = (field: string) => problems.find((p) => p.field === field);
  /** Only surface a field's error once the user has engaged with the form. */
  const showProblem = (field: string) =>
    submitted || (field === 'amount' && amount.length > 0) ? problemFor(field) : undefined;

  async function submit() {
    setSubmitted(true);
    if (problems.length > 0 || cents === null || duplicate) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<{ code: string }>('/finance/wallet-requests', {
        type,
        amountMinor: cents,
        currency: 'USD',
        ...(type === 'cash_in'
          ? { fundingSource }
          : { destinationAccount: destinationAccount.trim(), beneficiaryName: beneficiaryName.trim() }),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        ...(documentKey.trim() ? { documentKey: documentKey.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      setDone(t('wallet.request.submitted', { code: created.code }));
      setAmount('');
      setReference('');
      setDocumentKey('');
      setNotes('');
      setSubmitted(false);
      await onSubmitted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const amountProblem = showProblem('amount');

  return (
    <div className="stack stack--tight" style={{ maxWidth: 560 }}>
      {/* Stated up front, not only in the confirmation. */}
      <p className="infobox">{t('wallet.request.noBalanceChange')}</p>

      <div className="field">
        <label className="field-label" htmlFor={`wr-amount-${type}`}>
          {t('wallet.request.amountLabel')}
        </label>
        <div className="money-input">
          <span aria-hidden="true">$</span>
          <input
            id={`wr-amount-${type}`}
            inputMode="decimal"
            dir="ltr"
            placeholder="0.00"
            value={amount}
            aria-invalid={Boolean(amountProblem)}
            aria-describedby={`wr-amount-hint-${type}`}
            onChange={(e) => {
              setAmount(e.target.value);
              setError(null);
              setDone(null);
            }}
          />
        </div>
        <p className={amountProblem ? 'field-error' : 'field-hint'} id={`wr-amount-hint-${type}`}>
          {amountProblem
            ? t(amountProblem.messageKey, amountProblem.vars)
            : type === 'cash_out'
              ? t('wallet.request.availableNote', { amount: formatUsd(availableMinor) })
              : `$${(limits.minMinor / 100).toFixed(2)} – $${(limits.maxMinor / 100).toFixed(2)}`}
        </p>
      </div>

      {/* What actually lands, before asking. Cashing out was free and no figure
          was quoted anywhere — which reads as generous and is really the
          collector finding out afterwards. */}
      {type === 'cash_out' && <CashOutQuotePanel amount={amount} />}

      {type === 'cash_in' ? (
        <Field
          label={t('wallet.request.fundingSource')}
          error={showProblem('fundingSource') ? t('wallet.request.error.fundingRequired') : undefined}
        >
          <select value={fundingSource} onChange={(e) => setFundingSource(e.target.value)}>
            {FUNDING_SOURCES.map((source) => (
              <option key={source} value={source}>
                {t(`wallet.request.funding.${source}` as MessageKey)}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <>
          <Field
            label={t('wallet.request.destination')}
            hint={t('wallet.request.destinationHint')}
            error={showProblem('destinationAccount') ? t('wallet.request.error.destinationRequired') : undefined}
          >
            <input
              dir="ltr"
              placeholder="IL00 0000 0000 0000"
              value={destinationAccount}
              aria-invalid={Boolean(showProblem('destinationAccount'))}
              onChange={(e) => setDestinationAccount(e.target.value)}
            />
          </Field>

          <Field
            label={t('wallet.request.beneficiary')}
            error={
              showProblem('beneficiaryName') ? t('wallet.request.error.beneficiaryRequired') : undefined
            }
          >
            <input
              value={beneficiaryName}
              aria-invalid={Boolean(showProblem('beneficiaryName'))}
              onChange={(e) => setBeneficiaryName(e.target.value)}
            />
          </Field>
        </>
      )}

      <Field label={t('wallet.request.reference')} hint={t('wallet.request.referenceHint')}>
        <input
          value={reference}
          maxLength={MAX_REFERENCE_LENGTH}
          onChange={(e) => setReference(e.target.value)}
        />
      </Field>

      <Field label={t('wallet.request.document')} hint={t('wallet.request.documentHint')}>
        <input dir="ltr" value={documentKey} onChange={(e) => setDocumentKey(e.target.value)} />
      </Field>

      <Field
        label={t('wallet.request.notes')}
        error={showProblem('notes') ? t('wallet.request.error.notesTooLong') : undefined}
      >
        <textarea
          rows={3}
          value={notes}
          maxLength={MAX_NOTE_LENGTH}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      {/* Caught here so a double-click reads as an explanation rather than as a
          server error, and so the user can find the request already in flight. */}
      {duplicate && <ErrorState message={t('wallet.request.error.duplicate', { code: duplicate.code })} />}
      {error && <ErrorState message={error} />}
      {done && <SuccessNote>{done}</SuccessNote>}

      <Button
        variant="gold"
        block
        icon={type === 'cash_in' ? <IconArrowDown /> : <IconUpload />}
        disabled={busy || Boolean(duplicate)}
        onClick={submit}
      >
        {busy ? t('wallet.request.submitting') : t('wallet.request.submit')}
      </Button>
    </div>
  );
}
