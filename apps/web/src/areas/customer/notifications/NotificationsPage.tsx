import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { useT } from '../../../shared/i18n';
import type { MessageKey } from '../../../shared/i18n';

/** Message key per known notification event type. */
const EVENT_LABEL_KEY: Record<string, MessageKey> = {
  item_received: 'notifications.event.item_received',
  item_sold: 'notifications.event.item_sold',
  offer_received: 'notifications.event.offer_received',
  shipment_out: 'notifications.event.shipment_out',
  hold_placed: 'notifications.event.hold_placed',
};
const EVENT_TYPES = Object.keys(EVENT_LABEL_KEY);

interface AppNotification {
  id: string;
  eventType: string;
  content: unknown; // jsonb — may be an object; render defensively (never as a raw React child)
  channel: string;
  status: string;
  createdAt: string;
}

/**
 * Render a notification as a proper sentence (Requirement 6.1).
 *
 * The dispatcher writes a rendered `message` into every notification's content, so
 * that is what is displayed. Older rows (or an unexpected shape) fall back to a
 * readable "Key: value" summary of the payload — never a raw JSON dump, and never
 * the tuple-of-strings this used to render as.
 */
function renderContent(content: unknown, eventLabel: string): string {
  if (content == null) return eventLabel;
  if (typeof content === 'string') return content;
  if (typeof content !== 'object') return String(content);

  const record = content as Record<string, unknown>;
  if (typeof record.message === 'string' && record.message.trim() !== '') return record.message;

  // Fallback: a readable field list, skipping opaque ids and internal plumbing.
  const skip = new Set(['recipientIds', 'ownerId', 'userId', 'sellerId', 'buyerId', 'donorId', 'responderId']);
  const parts = Object.entries(record)
    .filter(([key, value]) => !skip.has(key) && value != null && typeof value !== 'object')
    .map(([key, value]) => {
      const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
      return `${label}: ${String(value)}`;
    });
  return parts.length > 0 ? `${eventLabel} — ${parts.join(', ')}` : eventLabel;
}

interface Preference {
  eventType: string;
  enabled: boolean;
}

/**
 * The api client only exposes get/post/patch/del; preferences use PUT, so this
 * one call follows the same fetch conventions (cookie session, uniform errors).
 */
async function putPreference(eventType: string, enabled: boolean): Promise<void> {
  const res = await fetch('/api/v1/notifications/preferences', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventType, enabled }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? res.statusText);
  }
}

/**
 * Customer notification feed (NOT). Shows the user's notifications newest-first
 * plus per-event-type opt-in/out toggles. Every event type defaults to enabled
 * unless the server returned an explicit `enabled: false` preference.
 */
export function NotificationsPage() {
  const t = useT();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [prefs, setPrefs] = useState<Preference[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, preferences] = await Promise.all([
        api.get<AppNotification[]>('/notifications'),
        api.get<Preference[]>('/notifications/preferences'),
      ]);
      list.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
      setNotifications(list);
      setPrefs(preferences);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function isEnabled(eventType: string): boolean {
    const pref = prefs.find((p) => p.eventType === eventType);
    return pref ? pref.enabled : true;
  }

  async function toggle(eventType: string, enabled: boolean) {
    setSaving(true);
    try {
      await putPreference(eventType, enabled);
      setPrefs(await api.get<Preference[]>('/notifications/preferences'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function eventLabel(eventType: string): string {
    const key = EVENT_LABEL_KEY[eventType];
    return key ? t(key) : eventType;
  }

  return (
    <section>
      <h2>{t('notifications.title')}</h2>
      {error && <p role="alert">{error}</p>}

      <div className="card">
        <h4>{t('notifications.preferences.title')}</h4>
        <p className="hint">{t('notifications.preferences.hint')}</p>
        <div className="field-row">
          {EVENT_TYPES.map((et) => (
            <label key={et}>
              <input
                type="checkbox"
                checked={isEnabled(et)}
                disabled={saving}
                onChange={(e) => toggle(et, e.target.checked)}
              />
              {eventLabel(et)}
            </label>
          ))}
        </div>
      </div>

      <h3>{t('notifications.mine', { n: notifications.length })}</h3>
      {notifications.length === 0 ? (
        <p className="hint">{t('notifications.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('notifications.col.event')}</th>
                <th>{t('notifications.col.content')}</th>
                <th>{t('notifications.col.date')}</th>
              </tr>
            </thead>
            <tbody>
              {notifications.map((n) => (
                <tr key={n.id}>
                  <td>
                    <span className="badge badge--info">{eventLabel(n.eventType)}</span>
                  </td>
                  <td>{renderContent(n.content, eventLabel(n.eventType))}</td>
                  <td dir="ltr">{n.createdAt?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
