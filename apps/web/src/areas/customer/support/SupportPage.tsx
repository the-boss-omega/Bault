import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../shared/api';
import { formatDateTime } from '../../../shared/money';
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
        <div className="dt-wrap dt-wrap--stack">
          <table className="data-table">
            <caption>{t('support.list.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('support.col.subject')}</th>
                <th scope="col">{t('support.col.category')}</th>
                <th scope="col">{t('support.col.status')}</th>
                <th scope="col">{t('support.col.activity')}</th>
                <th scope="col" className="td-tight" />
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr
                  key={ticket.id}
                  className={'is-clickable' + (ticket.id === openId ? ' is-selected' : '')}
                  tabIndex={0}
                  onClick={() => onOpen(ticket.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpen(ticket.id);
                    }
                  }}
                >
                  <td data-label={t('support.col.subject')} className="dt-primary">
                    {ticket.subject}
                    <span className="dt-sub" dir="ltr">
                      {ticket.code}
                    </span>
                  </td>
                  <td data-label={t('support.col.category')}>
                    {ticketCategoryLabel(t, ticket.category)}
                  </td>
                  <td data-label={t('support.col.status')}>
                    <StatusBadge tone={TICKET_TONE[ticket.status] ?? 'neutral'}>
                      {ticketStatusLabel(t, ticket.status)}
                    </StatusBadge>
                  </td>
                  <td data-label={t('support.col.activity')}>
                    {formatDateTime(ticket.lastMessageAt, locale)}
                  </td>
                  <td className="td-tight">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(ticket.id);
                      }}
                    >
                      {t('support.open')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
      <div className="stack stack--tight" style={{ maxWidth: 620 }}>
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
          <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
        </label>

        <Field label={t('support.message')} hint={t('support.messageHint')}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={7}
            maxLength={5000}
          />
        </Field>

        <div className="row">
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
                  <span className="hint" dir="ltr">
                    {formatDateTime(m.createdAt, locale)}
                  </span>
                </div>
                <p style={{ marginBlockStart: 4, fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{m.body}</p>
              </li>
            ))}
          </ul>

          {resolved && <p className="field-hint">{t('support.resolvedHint')}</p>}

          <label className="field" style={{ marginBlockStart: 'var(--sp-5)' }}>
            <span className="field-label">{t('support.reply')}</span>
            <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={5} maxLength={5000} />
          </label>
        </>
      )}
    </DetailDrawer>
  );
}

export type { TranslateFn };
