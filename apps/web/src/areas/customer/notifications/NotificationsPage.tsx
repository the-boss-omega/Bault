import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n, type MessageKey } from '../../../shared/i18n';
import { formatDayHeading, formatTime } from '../../../shared/money';
import { navigate, useNavigation, useRoute } from '../../../shared/routing';
import {
  EVENT_TYPES,
  byDay,
  channelLabel,
  eventLabel,
  notificationBarcode,
  notificationGlyph,
  notificationMessage,
  type NotificationGlyph,
} from '../../../shared/notifications';
import type { AppNotification, useNotificationFeed } from '../../../shared/hooks';
import { NotificationMark } from '../../../shared/ui/NotificationMark';
import { Serial } from '../../../shared/ui/Serial';
import {
  Button,
  ContextTabs,
  EmptyState,
  ErrorState,
  Panel,
  SkeletonTable,
  SuccessNote,
  TabPanel,
} from '../../../shared/ui/primitives';
import { IconBell, IconSearch, IconVault } from '../../../shared/ui/icons';

interface ChannelPreference {
  channel: string;
  enabled: boolean;
  isDefault: boolean;
  mandatory: boolean;
}

interface PreferenceRow {
  eventType: string;
  category: string;
  label: string;
  channels: ChannelPreference[];
}

interface PreferenceMatrix {
  categories: string[];
  channels: string[];
  events: PreferenceRow[];
}

const putJson = (path: string, body: unknown) => api.put(`/notifications/${path}`, body);

const TABS = ['feed', 'preferences'] as const;

const KINDS = ['all', 'card', 'market', 'escrow', 'wallet', 'shipping', 'inbox', 'help'] as const;
type Kind = (typeof KINDS)[number];

export function filterFeed(
  items: readonly AppNotification[],
  kind: Kind,
  needle: string,
  labelOf: (n: AppNotification) => string,
): AppNotification[] {
  const q = needle.trim().toLowerCase();
  return items.filter((n) => {
    if (kind !== 'all' && notificationGlyph(n.eventType) !== (kind as NotificationGlyph)) return false;
    if (!q) return true;
    return [labelOf(n), notificationMessage(n.content) ?? '', notificationBarcode(n.content) ?? '']
      .some((v) => v.toLowerCase().includes(q));
  });
}
type NotificationsTab = (typeof TABS)[number];

export function NotificationsPage({
  feed,
  onSeen,
}: {
  feed: ReturnType<typeof useNotificationFeed>;
  onSeen: () => void;
}) {
  const { t, locale } = useI18n();
  const route = useRoute();
  const { goTab } = useNavigation(route);
  const [prefs, setPrefs] = useState<PreferenceMatrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind>('all');

  const tab: NotificationsTab = (TABS as readonly string[]).includes(route.tab ?? '')
    ? (route.tab as NotificationsTab)
    : 'feed';

  const loadPrefs = useCallback(async () => {
    try {
      setPrefs(await api.get<PreferenceMatrix>('/notifications/preferences'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setPrefs(null);
    }
  }, []);

  useEffect(() => {
    void loadPrefs();
  }, [loadPrefs]);

  useEffect(() => {
    onSeen();
  }, [onSeen]);

  async function toggle(eventType: string, channel: string, enabled: boolean) {
    setSaving(true);
    try {
      await putJson('preferences', { eventType, channel, enabled });
      await loadPrefs();
      setSaved(
        t(enabled ? 'notif.savedOn' : 'notif.savedOff', {
          event: EVENT_TYPES.includes(eventType) ? eventLabel(t, eventType) : eventType,
          channel: channelLabel(t, channel),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleChannel(channel: string, enabled: boolean) {
    setSaving(true);
    try {
      await putJson('preferences/channel', { channel, enabled });
      await loadPrefs();
      setSaved(t(enabled ? 'notif.savedAllOn' : 'notif.savedAllOff', { channel: channelLabel(t, channel) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const tabs = TABS.map((key) => ({ key, label: t(`notifications.tab.${key}` as MessageKey) }));

  const presentKinds = useMemo(
    () => new Set(feed.items.map((n) => notificationGlyph(n.eventType))),
    [feed.items],
  );
  const shown = useMemo(
    () => filterFeed(feed.items, kind, q, (n) => eventLabel(t, n.eventType)),
    [feed.items, kind, q, t],
  );
  const filtering = kind !== 'all' || q.trim() !== '';

  return (
    <>
      <ContextTabs label={t('notifications.title')} tabs={tabs} active={tab} onSelect={goTab} />

      {(error || feed.error) && (
        <ErrorState
          message={error ?? feed.error ?? ''}
          onRetry={() => {
            setError(null);
            if (feed.error) void feed.reload();
            void loadPrefs();
          }}
          retryLabel={t('ui.retry')}
        />
      )}

      {tab === 'feed' && (
        <TabPanel tab="feed">
          <Panel title={t('notifications.mine', { n: feed.items.length })} flush>
            {feed.items.length > 0 && (
              <div className="vault-command">
                <div className="vault-search">
                  <IconSearch />
                  <input
                    type="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={t('notif.searchPlaceholder')}
                    aria-label={t('notif.search')}
                  />
                </div>
                <select value={kind} aria-label={t('notif.kind.label')} onChange={(e) => setKind(e.target.value as Kind)}>
                  {KINDS.filter((k) => k === 'all' || presentKinds.has(k as NotificationGlyph)).map((k) => (
                    <option key={k} value={k}>
                      {t(`notif.kind.${k}` as MessageKey)}
                    </option>
                  ))}
                </select>
                {filtering && (
                  <span className="vault-count" role="status">
                    {t('notif.matches', { count: shown.length })}
                  </span>
                )}
              </div>
            )}
            {feed.loading ? (
              <SkeletonTable rows={5} columns={3} />
            ) : feed.items.length === 0 ? (
              <EmptyState title={t('notifications.empty')} text={t('notifications.emptyText')} icon={<IconBell />} />
            ) : shown.length === 0 ? (
              <EmptyState
                title={t('notif.noMatch')}
                text={t('notif.noMatchText')}
                icon={<IconSearch />}
                action={
                  <Button
                    size="sm"
                    onClick={() => {
                      setQ('');
                      setKind('all');
                    }}
                  >
                    {t('notif.clearFilters')}
                  </Button>
                }
              />
            ) : (
              <div className="register-days">
                {byDay(shown).map(({ key, items, first }) => (
                  <div key={key} className="register-day-group">
                    <h3 className="register-day" id={`day-${key}`}>
                      <span className="date">{formatDayHeading(first.createdAt, locale)}</span>
                    </h3>
                    <ul className="timeline timeline--stamped" aria-labelledby={`day-${key}`}>
                      {items.map((n: AppNotification) => {
                        const barcode = notificationBarcode(n.content);
                        const kind = eventLabel(t, n.eventType);
                        const message = notificationMessage(n.content);
                        return (
                          <li key={n.id}>
                            <span className="hint date">{formatTime(n.createdAt, locale)}</span>
                            <div className="register-body">
                              <NotificationMark n={n} />
                              <div className="register-text">
                                <span className="register-kind">{kind}</span>
                                {message && (
                                  <p className="register-entry">
                                    <bdi dir="auto">{message}</bdi>
                                  </p>
                                )}
                                {barcode && <Serial value={barcode} quiet />}
                                {barcode && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    icon={<IconVault />}
                                    onClick={() => navigate({ section: 'vault', tab: 'active', params: { q: barcode } })}
                                  >
                                    {t('notif.findInVault')}
                                  </Button>
                                )}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </TabPanel>
      )}

      {tab === 'preferences' && (
        <TabPanel tab="preferences">
          <Panel title={t('notifications.preferences.title')} subtitle={t('notifications.preferences.hint')}>
            {prefs === null ? (
              <SkeletonTable rows={6} columns={3} />
            ) : (
              <>
                <div className="row" style={{ gap: 'var(--sp-2)', marginBlockEnd: 'var(--sp-4)', flexWrap: 'wrap' }}>
                  {prefs.channels.map((channel) => (
                    <span
                      key={channel}
                      className="row"
                      role="group"
                      aria-label={channelLabel(t, channel)}
                      style={{ gap: 'var(--sp-2)' }}
                    >
                      <span className="field-hint">{channelLabel(t, channel)}</span>
                      <Button size="sm" variant="ghost" disabled={saving} onClick={() => void toggleChannel(channel, true)}>
                        {t('notif.allOn')}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={saving} onClick={() => void toggleChannel(channel, false)}>
                        {t('notif.allOff')}
                      </Button>
                    </span>
                  ))}
                </div>

                {saved && <SuccessNote>{saved}</SuccessNote>}

                {prefs.categories.length > 1 && (
                  <nav className="row" aria-label={t('notif.jump')} style={{ gap: 'var(--sp-2)', flexWrap: 'wrap', marginBlockEnd: 'var(--sp-4)' }}>
                    {prefs.categories
                      .filter((category) => prefs.events.some((e) => e.category === category))
                      .map((category) => (
                        <Button
                          key={category}
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            document.getElementById(`notif-cat-${category}`)?.scrollIntoView({ block: 'start' })
                          }
                        >
                          {t(`notifications.cat.${category}` as MessageKey)}
                        </Button>
                      ))}
                  </nav>
                )}

                {prefs.categories.map((category) => {
                  const rows = prefs.events.filter((e) => e.category === category);
                  if (rows.length === 0) return null;
                  return (
                    <div key={category} style={{ marginBlockEnd: 'var(--sp-5)' }}>
                      <h3 className="drawer-heading" id={`notif-cat-${category}`} tabIndex={-1}>
                        {t(`notifications.cat.${category}` as MessageKey)}
                      </h3>
                      <div className="dt-wrap">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th scope="col">{t('notifications.col.event')}</th>
                              {prefs.channels.map((channel) => (
                                <th key={channel} scope="col">
                                  {channelLabel(t, channel)}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((row) => (
                              <tr key={row.eventType}>
                                <td className="dt-primary">
                                  {EVENT_TYPES.includes(row.eventType) ? eventLabel(t, row.eventType) : row.label}
                                </td>
                                {row.channels.map((c) => (
                                  <td key={c.channel} data-label={channelLabel(t, c.channel)}>
                                    <label className="check">
                                      <input
                                        type="checkbox"
                                        aria-label={`${
                                          EVENT_TYPES.includes(row.eventType)
                                            ? eventLabel(t, row.eventType)
                                            : row.label
                                        } · ${channelLabel(t, c.channel)}`}
                                        checked={c.enabled}
                                        disabled={saving || c.mandatory}
                                        onChange={(e) => void toggle(row.eventType, c.channel, e.target.checked)}
                                      />
                                      {c.mandatory && <span className="hint">{t('notifications.always')}</span>}
                                    </label>
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}

                <p className="field-hint">{t('notifications.emailHint')}</p>
              </>
            )}
          </Panel>
        </TabPanel>
      )}
    </>
  );
}
