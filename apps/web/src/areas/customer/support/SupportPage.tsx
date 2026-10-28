import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { formatDateTime, formatDayHeading, formatTime } from '../../../shared/money';
import { inDays } from '../../../shared/days';
import { useI18n, type MessageKey, type TranslateFn } from '../../../shared/i18n';
import { useNavigation, useRoute } from '../../../shared/routing';
import {
  TICKET_CATEGORIES,
  TICKET_TONE,
  ticketCategoryLabel,
  ticketStatusLabel,
  type SupportThread,
  type SupportTicket,
} from '../../../shared/support';
import {
  Button,
  ContextTabs,
  EmptyState,
  ErrorState,
  Field,
  Panel,
  SkeletonTable,
  StatusBadge,
  SuccessNote,
  TabPanel,
} from '../../../shared/ui/primitives';
import { DetailDrawer } from '../../../shared/ui/DetailDrawer';
import { DrawerTag } from '../../../shared/ui/DrawerTag';
import { IconAsk, IconPlus } from '../../../shared/ui/icons';

const TABS = ['tickets', 'new'] as const;
type SupportTab = (typeof TABS)[number];

export function SupportPage({ suspended = false }: { suspended?: boolean }) {
  const { t } = useI18n();
  const route = useRoute();
  const { goTab, openRecord, closeRecord } = useNavigation(route);

  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tab: SupportTab = (TABS as readonly string[]).includes(route.tab ?? '')
    ? (route.tab as SupportTab)
    : 'tickets';

  const load = useCallback(async () => {
    try {
      setTickets(await api.get<SupportTicket[]>('/support/tickets'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setTickets([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const tabs = TABS.map((key) => ({ key, label: t(`support.tab.${key}` as MessageKey) }));

  return (
    <>
      <ContextTabs label={t('support.title')} tabs={tabs} active={tab} onSelect={goTab} />

      {suspended && <SuccessNote tone="warning">{t('support.suspendedNotice')}</SuccessNote>}
      {status && <SuccessNote>{status}</SuccessNote>}
      {error && <ErrorState message={error} onRetry={() => void load()} retryLabel={t('ui.retry')} />}

      {tab === 'tickets' && (
        <TabPanel tab="tickets">
          <TicketList
            tickets={tickets}
            openId={route.params.ticket ?? null}
            onOpen={(id) => openRecord('ticket', id)}
            onNew={() => goTab('new')}
          />
        </TabPanel>
      )}

      {tab === 'new' && (
        <TabPanel tab="new">
          <NewTicketForm
            onOpened={async (code) => {
              setStatus(t('support.opened', { code }));
              await load();
              goTab('tickets');
            }}
            onError={setError}
          />
        </TabPanel>
      )}

      {route.params.ticket && (
        <ThreadDrawer
          ticketId={route.params.ticket}
          staff={false}
          onClose={() => closeRecord('ticket')}
          onChanged={load}
        />
      )}
    </>
  );
}

function TicketList({
  tickets,
  openId,
  onOpen,
  onNew,
}: {
  tickets: SupportTicket[] | null;
  openId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const { t, locale } = useI18n();

  return (
    <Panel
      title={t('support.list.title')}
      subtitle={t('support.list.subtitle')}
      flush
      tools={
        <Button size="sm" variant="gold" icon={<IconPlus />} onClick={onNew}>
          {t('support.new')}
        </Button>
      }
    >
      {tickets === null ? (
        <SkeletonTable rows={3} columns={4} />
      ) : tickets.length === 0 ? (
        <EmptyState title={t('support.empty')} text={t('support.emptyText')} icon={<IconAsk />} />
      ) : (
        <div className="register-days panel-body">
          {inDays(
            [...tickets].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)),
            (ticket) => ticket.lastMessageAt,
          ).map(({ key, items, first }) => (
            <div key={key} className="register-day-group">
              <h3 className="register-day" id={`tickets-${key}`}>
                <span className="date">{formatDayHeading(first.lastMessageAt, locale)}</span>
              </h3>
              <ul className="timeline timeline--stamped" aria-labelledby={`tickets-${key}`}>
                {items.map((ticket) => (
                  <li
                    key={ticket.id}
                    className={'is-clickable' + (ticket.id === openId ? ' is-selected' : '')}
                    onClick={() => onOpen(ticket.id)}
                  >
                    <span className="hint date">{formatTime(ticket.lastMessageAt, locale)}</span>
                    <div className="register-text">
                      <span className="register-kind">
                        <StatusBadge tone={TICKET_TONE[ticket.status] ?? 'neutral'}>
                          {ticketStatusLabel(t, ticket.status)}
                        </StatusBadge>
                      </span>
                      <p className="register-entry">
                        <button
                          type="button"
                          className="register-link"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpen(ticket.id);
                          }}
                        >
                          {ticket.subject}
                        </button>
                      </p>
                      <p className="register-meta">
                        <span className="code-inline" dir="ltr">
                          {ticket.code}
                        </span>
                        {' · '}
                        {ticketCategoryLabel(t, ticket.category)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function NewTicketForm({
  onOpened,
  onError,
}: {
  onOpened: (code: string) => Promise<void>;
  onError: (m: string) => void;
}) {
  const { t } = useI18n();
  const [category, setCategory] = useState(TICKET_CATEGORIES[0]?.key ?? 'other');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const ready = subject.trim() !== '' && body.trim() !== '';

  async function submit() {
    setBusy(true);
    try {
      const created = await api.post<{ code: string }>('/support/tickets', {
        category,
        subject: subject.trim(),
        body: body.trim(),
      });
      setSubject('');
      setBody('');
      await onOpened(created.code);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={t('support.newTitle')} subtitle={t('support.newSubtitle')}>
      <div className="request-form">
        <div className="stack stack--tight request-form-fields">
          <label className="field">
            <span className="field-label">{t('support.col.category')}</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {TICKET_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {t(c.labelKey)}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">{t('support.col.subject')}</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              dir="auto"
            />
          </label>

          <Field label={t('support.message')} hint={t('support.messageHint')}>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={7}
              maxLength={5000}
              dir="auto"
            />
          </Field>
        </div>

        {/* The ticket as it will be filed: its subject, its kind, how it begins, where it will stand. */}
        <aside className="request-slip">
          <DrawerTag
            kicker={t('support.newTitle')}
            title={
              subject.trim() || <span className="drawer-tag-quiet">{t('support.col.subject')}</span>
            }
            status={
              <StatusBadge tone={TICKET_TONE.open ?? 'neutral'}>
                {ticketStatusLabel(t, 'open')}
              </StatusBadge>
            }
            lines={[{ label: t('support.col.category'), value: ticketCategoryLabel(t, category) }]}
          >
            <div className="ticket-note">
              <span className="slip-label">{t('support.message')}</span>
              <p>{body.trim() || '—'}</p>
            </div>
          </DrawerTag>
        </aside>

        <div className="row request-form-actions">
          <Button variant="gold" disabled={busy || !ready} onClick={() => void submit()}>
            {t('support.submit')}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

export function ThreadDrawer({
  ticketId,
  staff,
  onClose,
  onChanged,
}: {
  ticketId: string;
  staff: boolean;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const { t, locale } = useI18n();
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setThread(await api.get<SupportThread>(`/support/tickets/${ticketId}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [ticketId]);

  useEffect(() => {
    void load();
  }, [load]);

  const resolved = thread?.ticket.status === 'resolved';

  async function send() {
    setBusy(true);
    try {
      await api.post(`/support/tickets/${ticketId}/messages`, { body: reply.trim() });
      setReply('');
      await load();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resolve() {
    setBusy(true);
    try {
      await api.post(`/support/tickets/${ticketId}/resolve`);
      await load();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DetailDrawer
      title={thread?.ticket.subject ?? t('support.title')}
      subtitle={thread ? thread.ticket.code : undefined}
      onClose={onClose}
      dirty={reply.trim() !== ''}
      footer={
        <>
          <Button variant="gold" disabled={busy || reply.trim() === ''} onClick={() => void send()}>
            {t('support.send')}
          </Button>
          {staff && !resolved && (
            <Button variant="secondary" disabled={busy} onClick={() => void resolve()}>
              {t('support.resolve')}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            {t('ui.close')}
          </Button>
        </>
      }
    >
      {error && <ErrorState message={error} />}

      {thread && (
        <>
          <dl className="detail-list">
            <div className="detail-row">
              <dt className="detail-label">{t('support.col.status')}</dt>
              <dd className="detail-value">
                <StatusBadge tone={TICKET_TONE[thread.ticket.status] ?? 'neutral'}>
                  {ticketStatusLabel(t, thread.ticket.status, staff)}
                </StatusBadge>
              </dd>
            </div>
            <div className="detail-row">
              <dt className="detail-label">{t('support.col.category')}</dt>
              <dd className="detail-value">{ticketCategoryLabel(t, thread.ticket.category)}</dd>
            </div>
          </dl>

          <h3 className="drawer-heading">{t('support.conversation')}</h3>
          <ul className="timeline">
            {thread.messages.map((m) => (
              <li key={m.id} className="detail-row" style={{ display: 'block' }}>
                <div className="row" style={{ gap: 'var(--sp-2)' }}>
                  <StatusBadge tone={m.authorRole === 'staff' ? 'gold' : 'info'} plain>
                    {m.authorRole === 'staff' ? t('support.fromStaff') : t('support.fromYou')}
                  </StatusBadge>
                  <span className="hint date">{formatDateTime(m.createdAt, locale)}</span>
                </div>
                <p className="bidi" style={{ marginBlockStart: 4, fontSize: 13.5, whiteSpace: 'pre-wrap' }}>
                  {m.body}
                </p>
              </li>
            ))}
          </ul>

          {resolved && <p className="field-hint">{t('support.resolvedHint')}</p>}

          <label className="field" style={{ marginBlockStart: 'var(--sp-5)' }}>
            <span className="field-label">{t('support.reply')}</span>
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={5}
              maxLength={5000}
              dir="auto"
            />
          </label>
        </>
      )}
    </DetailDrawer>
  );
}

export type { TranslateFn };
