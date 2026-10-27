import { useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n } from '../../../shared/i18n';
import { itemName } from '../../../shared/itemClasses';
import { ItemPick } from '../../../shared/ui/Serial';
import { useVaultItems } from '../../../shared/useVaultItems';
import { isValidUsername, normalizeUsername } from '../../../shared/names';
import { Button, EmptyState, Field, Panel, StatusBadge } from '../../../shared/ui/primitives';
import { IconBox, IconSearch } from '../../../shared/ui/icons';

interface Collector {
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
}

interface TradableItem {
  id: string;
  serialNumber: string;
  typeClass: string;
  description: string;
  ownerUsername: string;
}

export function ProposeTradePanel({
  onProposed,
  onError,
}: {
  onProposed: (message: string) => Promise<void> | void;
  onError: (m: string) => void;
}) {
  const { t } = useI18n();
  const { items } = useVaultItems(true);

  const [username, setUsername] = useState('');
  const [counterparty, setCounterparty] = useState<Collector | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [offered, setOffered] = useState<Record<string, boolean>>({});
  const [wanted, setWanted] = useState<TradableItem[]>([]);
  const [serial, setSerial] = useState('');
  const [gift, setGift] = useState(false);
  const [busy, setBusy] = useState(false);

  const normalized = normalizeUsername(username);
  const usernameOk = isValidUsername(normalized);
  const offeredIds = Object.entries(offered)
    .filter(([, v]) => v)
    .map(([id]) => id);

  useEffect(() => {
    setCounterparty(null);
    setWanted([]);
  }, [username]);

  async function lookup() {
    setLookingUp(true);
    try {
      setCounterparty(await api.get<Collector>(`/marketplace/collectors/${normalized}`));
    } catch (e) {
      setCounterparty(null);
      onError((e as Error).message);
    } finally {
      setLookingUp(false);
    }
  }

  async function addWanted() {
    if (!counterparty) return;
    try {
      const found = await api.get<TradableItem>(
        `/marketplace/collectors/${counterparty.username}/items/${encodeURIComponent(serial.trim())}`,
      );
      setWanted((prev) => (prev.some((w) => w.id === found.id) ? prev : [...prev, found]));
      setSerial('');
    } catch (e) {
      onError((e as Error).message);
    }
  }

  async function propose() {
    if (!counterparty || offeredIds.length === 0) return;
    setBusy(true);
    try {
      if (gift) {
        const challenge = await api.post<{ confirmationToken: string }>('/marketplace/transfers', {
          itemId: offeredIds[0],
          toUsername: counterparty.username,
        });
        await api.post('/marketplace/transfers/confirm', {
          confirmationToken: challenge.confirmationToken,
        });
        await onProposed(t('market.propose.giftSent', { username: counterparty.username }));
      } else {
        await api.post('/marketplace/swaps', {
          responderUsername: counterparty.username,
          offeredItemIds: offeredIds,
          requestedItemIds: wanted.map((w) => w.id),
        });
        await onProposed(t('market.propose.sent', { username: counterparty.username }));
      }
      setOffered({});
      setWanted([]);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={t('market.propose.title')} subtitle={t('market.propose.subtitle')}>
      <div className="stack stack--tight" style={{ maxWidth: 620 }}>
        <div className="row" style={{ alignItems: 'start' }}>
          <Field
            label={t('market.propose.username')}
            hint={t('market.propose.usernameHint')}
            className="field--grow"
          >
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              aria-invalid={username.length > 0 && !usernameOk}
              dir="ltr"
            />
          </Field>
          <Button
            variant="secondary"
            className="btn--field-aligned"
            icon={<IconSearch />}
            disabled={!usernameOk || lookingUp}
            onClick={() => void lookup()}
          >
            {t('market.propose.find')}
          </Button>
        </div>

        {counterparty && (
          <p className="field-hint">
            <StatusBadge tone="success">{t('market.propose.found')}</StatusBadge>{' '}
            <code dir="ltr">{counterparty.username}</code>
          </p>
        )}

        <label className="check">
          <input type="checkbox" checked={gift} onChange={(e) => setGift(e.target.checked)} />
          {t('market.propose.asGift')}
        </label>
        <p className="field-hint">{t(gift ? 'market.propose.giftHint' : 'market.propose.swapHint')}</p>

        {items.length === 0 ? (
          <EmptyState title={t('services.noItems')} text={t('market.sell.noItemsText')} icon={<IconBox />} />
        ) : (
          <ul className="check-list">
            {items.map((item) => (
              <li key={item.id}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={!!offered[item.id]}
                    onChange={() =>
                      setOffered((prev) =>
                        gift ? { [item.id]: !prev[item.id] } : { ...prev, [item.id]: !prev[item.id] },
                      )
                    }
                  />
                  <ItemPick serial={item.serialNumber} name={itemName(t, item)} />
                </label>
              </li>
            ))}
          </ul>
        )}

        {!gift && counterparty && (
          <>
            <div className="row" style={{ alignItems: 'start' }}>
              <Field
                label={t('market.propose.wantSerial')}
                hint={t('market.propose.wantHint')}
                className="field--grow"
              >
                <input value={serial} onChange={(e) => setSerial(e.target.value)} dir="ltr" />
              </Field>
              <Button
                variant="secondary"
                className="btn--field-aligned"
                disabled={!serial.trim()}
                onClick={() => void addWanted()}
              >
                {t('market.propose.addWanted')}
              </Button>
            </div>
            {wanted.length > 0 && (
              <ul className="check-list list-unbounded">
                {wanted.map((w) => (
                  <li key={w.id}>
                    <ItemPick serial={w.serialNumber} name={itemName(t, w)} />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setWanted((prev) => prev.filter((x) => x.id !== w.id))}
                    >
                      {t('ui.cancel')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <div className="row">
          <Button
            variant="gold"
            disabled={busy || !counterparty || offeredIds.length === 0 || (!gift && wanted.length === 0)}
            onClick={() => void propose()}
          >
            {t(gift ? 'market.propose.sendGift' : 'market.propose.send')}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
