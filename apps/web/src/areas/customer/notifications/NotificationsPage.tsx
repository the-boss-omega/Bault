import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n, type MessageKey } from '../../../shared/i18n';
import { formatDateTime } from '../../../shared/money';
import { useNavigation, useRoute } from '../../../shared/routing';
import { EVENT_TYPES, channelLabel, eventLabel, renderContent } from '../../../shared/notifications';
import type { AppNotification, useNotificationFeed } from '../../../shared/hooks';
import {
  Button,
  ContextTabs,
  EmptyState,
  ErrorState,
  Panel,
  SkeletonTable,
  StatusBadge,
  TabPanel,
} from '../../../shared/ui/primitives';
import { IconBell } from '../../../shared/ui/icons';

/** One switch: an event type on a channel. */
interface ChannelPreference {
  channel: string;
  enabled: boolean;
  /** True when this is the default rather than something the user chose. */
  isDefault: boolean;
  /** Bad news cannot be switched off in the app. */
  mandatory: boolean;
}

interface PreferenceRow {
  eventType: string;
  category: string;
  /** The server's own English label, used when this build has no translation. */
  label: string;
  channels: ChannelPreference[];
}

interface PreferenceMatrix {
  categories: string[];
  channels: string[];
  events: PreferenceRow[];
}

/**
 * The api client only exposes get/post/patch/del; preferences use PUT, so these
 * calls follow the same fetch conventions (cookie session, uniform errors).
 */
async function putJson(path: string, body: unknown): Promise<void> {
  const res = await fetch(`/api/v1/notifications/${path}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? res.statusText);
  }
}

const TABS = ['feed', 'preferences'] as const;
type NotificationsTab = (typeof TABS)[number];

/**
 * Customer notification feed (NOT). Newest-first list plus per-event-type
 * opt-in/out toggles. Every event type defaults to enabled unless the server
 * returned an explicit `enabled: false` preference.
 *
 * The feed itself is owned by the shell (so the header bell and this page never
 * disagree); opening the page marks everything as seen.
 */
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

  // Landing on the page means the user has looked at the feed.
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

  /** "Stop emailing me", in one action rather than twenty-eight. */
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
              <div className="dt-wrap dt-wrap--stack">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">{t('notifications.col.event')}</th>
                      <th scope="col">{t('notifications.col.content')}</th>
                      <th scope="col">{t('notifications.col.date')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feed.items.map((n: AppNotification) => (
                      <tr key={n.id}>
                        <td data-label={t('notifications.col.event')}>
                          <StatusBadge tone="info">{eventLabel(t, n.eventType)}</StatusBadge>
                        </td>
                        <td data-label={t('notifications.col.content')}>
                          {renderContent(n.content, eventLabel(t, n.eventType))}
                        </td>
                        <td data-label={t('notifications.col.date')}>
                          <span dir="ltr">{formatDateTime(n.createdAt, locale)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                {/* The one thing somebody arriving here in irritation actually
                    wants to say. Making them tick twenty-eight boxes to say it
                    would be a dark pattern. */}
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
