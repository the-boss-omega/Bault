import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../shared/api';
import { dollarsToCents, formatDate, formatUsd } from '../../../shared/money';
import { useI18n } from '../../../shared/i18n';
import { channelLabel, type ConsignmentChannel, type ConsignmentEvent } from '../../../shared/market';
import { Button, Field, MoneyField, StatusBadge } from '../../../shared/ui/primitives';

/**
 * Choose where a card is sold, and for how much.
 *
 * Consignment used to be a single button that posted `channel: 'eBay'`. The
 * seller could not choose a route, could not see what each one cost or how long
 * it took, and could not set a price — the three things that actually differ
 * between them.
 *
 * Eligibility is mirrored from the API rather than only enforced there, so a
 * seller is told "graded cards only" before they submit and are charged a
 * service fee, not after. The API re-checks everything regardless; this is the
 * courtesy, not the control.
 */
export function ConsignmentForm({
  item,
  onCancel,
  onDone,
  onError,
}: {
  item: { id: string; conditionGrade: string | null };
  onCancel: () => void;
  onDone: (message: string) => void;
  onError: (m: string) => void;
}) {
  const { t, locale } = useI18n();
  const [channels, setChannels] = useState<ConsignmentChannel[]>([]);
  const [events, setEvents] = useState<ConsignmentEvent[]>([]);
  const [channelKey, setChannelKey] = useState('');
  const [eventId, setEventId] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const data = await api.get<{ channels: ConsignmentChannel[]; events: ConsignmentEvent[] }>(
          '/services/consignment/channels',
        );
        setChannels(data.channels);
        setEvents(data.events);
        if (data.channels[0]) setChannelKey(data.channels[0].key);
      } catch (e) {
        onError((e as Error).message);
      }
    })();
  }, [onError]);

  const channel = useMemo(() => channels.find((c) => c.key === channelKey), [channels, channelKey]);
  const cents = dollarsToCents(price);

  /**
   * The same three rules the API enforces, evaluated here for the message rather
   * than for the decision.
   */
  const problems: string[] = [];
  if (channel) {
    const grade = (item.conditionGrade ?? '').trim();
    if (channel.gradedOnly && (!grade || /^raw$/i.test(grade))) {
      problems.push(t('consign.problem.gradedOnly'));
    }
    if (cents !== null && channel.minAskingMinor > 0 && cents < channel.minAskingMinor) {
      problems.push(t('consign.problem.minimum', { amount: formatUsd(channel.minAskingMinor) }));
    }
    if (channel.requiresEvent && !eventId) problems.push(t('consign.problem.event'));
  }

  const ready = Boolean(channel) && cents !== null && cents > 0 && problems.length === 0;

  async function submit() {
    if (!channel || cents === null) return;
    setBusy(true);
    try {
      await api.post('/services/consignment', {
        itemId: item.id,
        channel: channel.key,
        askingMinor: cents,
        eventId: channel.requiresEvent ? eventId : undefined,
      });
      onDone(t('services.consignmentRequested'));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack stack--tight stack-top">
      <h3 className="drawer-heading">{t('consign.title')}</h3>

      <label className="field">
        <span className="field-label">{t('consign.channel')}</span>
        <select value={channelKey} onChange={(e) => setChannelKey(e.target.value)}>
          {channels.map((c) => (
            <option key={c.key} value={c.key}>
              {channelLabel(t, c.key)}
            </option>
          ))}
        </select>
      </label>

      {channel && (
        <p className="field-hint">
          {t('consign.payout', { min: channel.payoutDaysMin, max: channel.payoutDaysMax })}
          {channel.gradedOnly && ` · ${t('consign.gradedOnly')}`}
          {channel.minAskingMinor > 0 &&
            ` · ${t('consign.minimum', { amount: formatUsd(channel.minAskingMinor) })}`}
        </p>
      )}

      {channel?.requiresEvent && (
        <Field
          label={t('consign.show')}
          hint={events.length === 0 ? t('consign.noShows') : undefined}
        >
          <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value="">{t('consign.pickShow')}</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name} — {t('consign.deadline', { date: formatDate(ev.requestDeadline, locale) })}
              </option>
            ))}
          </select>
        </Field>
      )}

      <MoneyField
        label={t('consign.asking')}
        value={price}
        onChange={setPrice}
        hint={t('consign.askingHint')}
      />

      {problems.length > 0 && (
        <ul className="check-list list-unbounded">
          {problems.map((p) => (
            <li key={p}>
              <StatusBadge tone="error" plain>
                {p}
              </StatusBadge>
            </li>
          ))}
        </ul>
      )}

      <div className="row">
        <Button variant="gold" disabled={busy || !ready} onClick={() => void submit()}>
          {t('consign.submit')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('ui.cancel')}
        </Button>
      </div>
    </div>
  );
}
