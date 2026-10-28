import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../../../shared/api';
import { dollarsToCents, formatDate, formatUsd } from '../../../shared/money';
import { useI18n } from '../../../shared/i18n';
import { channelLabel, type ConsignmentChannel, type ConsignmentEvent } from '../../../shared/market';
import { DrawerTag } from '../../../shared/ui/DrawerTag';
import { Button, Field, MoneyField, StatusBadge } from '../../../shared/ui/primitives';

export function ConsignmentForm({
  item,
  fee,
  onCancel,
  onDone,
  onError,
}: {
  item: { id: string; conditionGrade: string | null };
  /** What asking for this costs, as it is written (the service fee of the price list), when there is one. */
  fee?: string | null;
  onCancel: () => void;
  onDone: (message: string) => void;
  onError: (m: string) => void;
}) {
  const { t, locale } = useI18n();
  const heading = useRef<HTMLHeadingElement>(null);
  const [channels, setChannels] = useState<ConsignmentChannel[]>([]);
  const [events, setEvents] = useState<ConsignmentEvent[]>([]);
  const [channelKey, setChannelKey] = useState('');
  const [eventId, setEventId] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);

  // The menu this form took the place of is gone, and with it the control that was focused.
  useEffect(() => heading.current?.focus(), []);

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

  // What has not been chosen or typed yet is a dash, never a figure made up.
  const quiet = <span className="drawer-tag-quiet">—</span>;
  const show = events.find((ev) => ev.id === eventId);
  const lines: { label: string; value: ReactNode }[] = [
    { label: t('consign.channel'), value: channel ? channelLabel(t, channel.key) : quiet },
  ];
  if (channel?.requiresEvent) {
    lines.push({
      label: t('consign.show'),
      value: show ? <span dir="auto">{show.name}</span> : quiet,
    });
  }
  lines.push({
    label: t('consign.slip.payout'),
    value: channel
      ? t('consign.slip.payoutDays', { min: channel.payoutDaysMin, max: channel.payoutDaysMax })
      : quiet,
  });
  if (channel && channel.minAskingMinor > 0) {
    lines.push({ label: t('consign.slip.minimum'), value: formatUsd(channel.minAskingMinor) });
  }
  if (channel?.gradedOnly) {
    lines.push({ label: t('consign.slip.accepts'), value: t('consign.gradedOnly') });
  }
  if (fee) lines.push({ label: t('consign.slip.fee'), value: fee });

  return (
    <div className="stack stack--tight stack-top">
      <h3 className="drawer-heading" ref={heading} tabIndex={-1}>
        {t('consign.title')}
      </h3>

      <div className="request-form request-form--stacked">
        {/* The request as it will be read: what is asked for it, where it goes, what comes back and when. */}
        <aside className="request-slip">
          <DrawerTag
            kicker={t('consign.asking')}
            amount={cents !== null && cents > 0 ? formatUsd(cents) : '—'}
            lines={lines}
          />
        </aside>

        <div className="stack stack--tight request-form-fields">
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

          {channel?.requiresEvent && (
            <Field
              label={t('consign.show')}
              hint={events.length === 0 ? t('consign.noShows') : undefined}
            >
              <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
                <option value="">{t('consign.pickShow')}</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name} —{' '}
                    {t('consign.deadline', { date: formatDate(ev.requestDeadline, locale) })}
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
        </div>

        <div className="row request-form-actions">
          <Button variant="primary" disabled={busy || !ready} onClick={() => void submit()}>
            {t('consign.submit')}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {t('ui.cancel')}
          </Button>
        </div>
      </div>
    </div>
  );
}
