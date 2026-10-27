import { useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n } from '../../../shared/i18n';
import { itemName } from '../../../shared/itemClasses';
import { Code, ItemPick } from '../../../shared/ui/Serial';
import { DrawerTag } from '../../../shared/ui/DrawerTag';
import { SwapGlyph, TradeSide } from './TradeSides';
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

  /** A gift moves one item, so what was ticked for a swap is cut to the first of it. */
  function chooseGift(on: boolean) {
    setGift(on);
    if (on) {
      setOffered((prev) => {
        const first = Object.keys(prev).find((id) => prev[id]);
        return first ? { [first]: true } : {};
      });
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
      <div className="request-form">
        <div className="stack stack--tight request-form-fields">
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
            <input type="checkbox" checked={gift} onChange={(e) => chooseGift(e.target.checked)} />
            {t('market.propose.asGift')}
          </label>
          <p className="field-hint">{t(gift ? 'market.propose.giftHint' : 'market.propose.swapHint')}</p>

          {items.length === 0 ? (
            <EmptyState title={t('services.noItems')} text={t('market.sell.noItemsText')} icon={<IconBox />} />
          ) : (
            <fieldset className="field field--cards">
              <legend className="sr-only">{t('market.swaps.col.theyGet')}</legend>
              {/* A swap can be of several cards; a gift is of one, so it is a radio and says "1 of n". */}
              <ul className="check-list" key={gift ? 'one' : 'several'}>
                {items.map((item) => (
                  <li key={item.id}>
                    <label className="check">
                      <input
                        type={gift ? 'radio' : 'checkbox'}
                        name={gift ? 'gift-item' : undefined}
                        checked={!!offered[item.id]}
                        onChange={() =>
                          setOffered((prev) => (gift ? { [item.id]: true } : { ...prev, [item.id]: !prev[item.id] }))
                        }
                      />
                      <ItemPick serial={item.serialNumber} name={itemName(t, item)} />
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
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
                <ul className="check-list list-unbounded" aria-label={t('market.swaps.col.youGet')}>
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

        </div>

        {/* The proposal as the other side will read it: what they get, what you get, and who it is with. */}
        <aside className="request-slip">
          <DrawerTag
            kicker={t('market.propose.title')}
            status={
              <StatusBadge tone={gift ? 'gold' : 'info'} plain>
                {t(gift ? 'market.swaps.gift' : 'market.swaps.swap')}
              </StatusBadge>
            }
            note={t(gift ? 'market.propose.giftHint' : 'market.propose.swapHint')}
            lines={[
              {
                label: t('market.swaps.col.with'),
                value: counterparty ? <Code value={`@${counterparty.username}`} /> : '—',
              },
            ]}
          >
            <div className="trade-slip">
              <TradeSide label={t('market.swaps.col.theyGet')} items={items.filter((item) => offered[item.id])} area="give" t={t} />
              <SwapGlyph oneWay={gift} towardStart />
              <TradeSide label={t('market.swaps.col.youGet')} items={gift ? [] : wanted} area="get" t={t} />
            </div>
          </DrawerTag>
        </aside>

        <div className="row request-form-actions">
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
