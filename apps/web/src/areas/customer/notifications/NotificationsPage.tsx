import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n, type MessageKey } from '../../../shared/i18n';
import { formatDayHeading, formatTime } from '../../../shared/money';
import { useNavigation, useRoute } from '../../../shared/routing';
import { EVENT_TYPES, byDay, channelLabel, eventLabel, notificationBarcode, renderContent } from '../../../shared/notifications';
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
  TabPanel,
} from '../../../shared/ui/primitives';
import { IconBell } from '../../../shared/ui/icons';

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
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const tabs = TABS.map((key) => ({ key, label: t(`notifications.tab.${key}` as MessageKey) }));

  return (
    <>
      <ContextTabs label={t('notifications.title')} tabs={tabs} active={tab} onSelect={goTab} />

      {(error || feed.error) && (
        <ErrorState message={error ?? feed.error ?? ''} onRetry={() => void feed.reload()} retryLabel={t('ui.retry')} />
      )}

      {tab === 'feed' && (
        <TabPanel tab="feed">
          <Panel title={t('notifications.mine', { n: feed.items.length })} flush>
            {feed.loading ? (
              <SkeletonTable rows={5} columns={3} />
            ) : feed.items.length === 0 ? (
              <EmptyState title={t('notifications.empty')} text={t('notifications.emptyText')} icon={<IconBell />} />
            ) : (
              <div className="register-days">
                {byDay(feed.items).map(({ key, items, first }) => (
                  <div key={key} className="register-day-group">
                    <h3 className="register-day" id={`day-${key}`}>
                      <span className="date">{formatDayHeading(first.createdAt, locale)}</span>
                    </h3>
                    <ul className="timeline timeline--stamped" aria-labelledby={`day-${key}`}>
                      {items.map((n: AppNotification) => {
                        const barcode = notificationBarcode(n.content);
                        const kind = eventLabel(t, n.eventType);
                        return (
                          <li key={n.id}>
                            <span className="hint date">{formatTime(n.createdAt, locale)}</span>
                            <div className="register-body">
                              <NotificationMark n={n} />
                              <div className="register-text">
                                <span className="register-kind">{kind}</span>
                                {/* What the server wrote is usually English: an island of its own direction, so its full stop stays at its end. */}
                                <p className="register-entry">
                                  <bdi dir="auto">{renderContent(n.content, kind)}</bdi>
                                </p>
                                {barcode && <Serial value={barcode} quiet />}
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
                    <span key={channel} className="row" style={{ gap: 'var(--sp-2)' }}>
                      <Button size="sm" variant="ghost" disabled={saving} onClick={() => void toggleChannel(channel, true)}>
                        {t('notifications.allOn', { channel: channelLabel(t, channel) })}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={saving} onClick={() => void toggleChannel(channel, false)}>
                        {t('notifications.allOff', { channel: channelLabel(t, channel) })}
                      </Button>
                    </span>
                  ))}
                </div>

                {prefs.categories.map((category) => {
                  const rows = prefs.events.filter((e) => e.category === category);
                  if (rows.length === 0) return null;
                  return (
                    <div key={category} style={{ marginBlockEnd: 'var(--sp-5)' }}>
                      <h3 className="drawer-heading">{t(`notifications.cat.${category}` as MessageKey)}</h3>
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
