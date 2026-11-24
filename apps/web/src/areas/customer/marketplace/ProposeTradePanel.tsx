import { useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n } from '../../../shared/i18n';
import { itemName } from '../../../shared/itemClasses';
import { Code, ItemPick } from '../../../shared/ui/Serial';
import { DrawerTag } from '../../../shared/ui/DrawerTag';
import { SwapGlyph, TradeSide } from './TradeSides';
import { useVaultItems } from '../../../shared/useVaultItems';
import { isValidUsername } from '../../../shared/names';
import { typedUsername } from '../../../shared/market';
import { Button, EmptyState, ErrorState, Field, Panel, SkeletonBlock, StatusBadge } from '../../../shared/ui/primitives';
import { ConfirmationModal } from '../../../shared/ui/DetailDrawer';
import { isolate } from '../../../shared/money';
import { LIST_TOOLS_FROM } from './ListTools';
import { IconBox, IconSearch } from '../../../shared/ui/icons';

interface Collector {
  username: string;
}

interface TradableItem {
  id: string;
  serialNumber: string;
  typeClass: string;
  description: string;
  ownerUsername: string;
}

export function ProposeTradePanel({
  initialUsername,
  initialSerial,
  onProposed,
}: {
  initialUsername?: string;
  initialSerial?: string;
  onProposed: (message: string) => Promise<void> | void;
  onError?: (m: string) => void;
}) {
  const { t } = useI18n();
  const { items, loaded } = useVaultItems(true);

  const [username, setUsername] = useState(initialUsername ?? '');
  const [counterparty, setCounterparty] = useState<Collector | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [offered, setOffered] = useState<Record<string, boolean>>({});
  const [wanted, setWanted] = useState<TradableItem[]>([]);
  const [serial, setSerial] = useState(initialSerial ?? '');
  const [gift, setGift] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [wantError, setWantError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [confirmGift, setConfirmGift] = useState(false);
  const [find, setFind] = useState('');

  const normalized = typedUsername(username);
  const usernameOk = isValidUsername(normalized);
  const offeredIds = Object.entries(offered)
    .filter(([, v]) => v)
    .map(([id]) => id);

  useEffect(() => {
    setCounterparty(null);
    setWanted([]);
    setLookupError(null);
  }, [username]);

  async function lookup() {
    if (!usernameOk) {
      setLookupError(t('market.propose.usernameBad'));
      return;
    }
    setLookingUp(true);
    setLookupError(null);
    try {
      setCounterparty(await api.get<Collector>(`/marketplace/collectors/${normalized}`));
    } catch (e) {
      setCounterparty(null);
      setLookupError((e as Error).message);
    } finally {
      setLookingUp(false);
    }
  }

  useEffect(() => {
    const who = typedUsername(initialUsername ?? '');
    if (!isValidUsername(who)) return;
    let live = true;
    setLookingUp(true);
    api
      .get<Collector>(`/marketplace/collectors/${who}`)
      .then((found) => {
        if (live) setCounterparty(found);
      })
      .catch((e: unknown) => {
        if (live) setLookupError((e as Error).message);
      })
      .finally(() => {
        if (live) setLookingUp(false);
      });
    return () => {
      live = false;
    };
  }, [initialUsername]);

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
    if (!counterparty || !serial.trim()) return;
    setWantError(null);
    try {
      const found = await api.get<TradableItem>(
        `/marketplace/collectors/${counterparty.username}/items/${encodeURIComponent(serial.trim())}`,
      );
      setWanted((prev) => (prev.some((w) => w.id === found.id) ? prev : [...prev, found]));
      setSerial('');
    } catch (e) {
      setWantError((e as Error).message);
    }
  }

  const missing = !counterparty
    ? t('market.propose.needCollector')
    : offeredIds.length === 0
      ? t(gift ? 'market.propose.needGiftItem' : 'market.propose.needOffered')
      : !gift && wanted.length === 0
        ? t('market.propose.needWanted')
        : null;

  async function propose() {
    if (!counterparty || offeredIds.length === 0) return;
    setBusy(true);
    setSendError(null);
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
      setConfirmGift(false);
    } catch (e) {
      setSendError((e as Error).message);
      setConfirmGift(false);
    } finally {
      setBusy(false);
    }
  }

  const giftItem = gift ? items.find((item) => offered[item.id]) : undefined;
  const needle = find.trim().toLowerCase();
  const pickable = needle
    ? items.filter(
        (item) => offered[item.id] || `${item.serialNumber ?? ''} ${itemName(t, item)}`.toLowerCase().includes(needle),
      )
    : items;

  return (
    <>
    <Panel title={t('market.propose.title')} subtitle={t('market.propose.subtitle')}>
      <div className="request-form">
        <div className="stack stack--tight request-form-fields">
          <form
            className="row"
            style={{ alignItems: 'start' }}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void lookup();
            }}
          >
            <Field
              label={t('market.propose.username')}
              hint={t('market.propose.usernameHint')}
              error={lookupError ?? undefined}
              className="field--grow"
            >
              <input
                value={username}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setUsername(e.target.value)}
                aria-invalid={Boolean(lookupError) || (username.length > 0 && !usernameOk) || undefined}
                dir="ltr"
              />
            </Field>
            <Button
              type="submit"
              variant="secondary"
              className="btn--field-aligned"
              icon={<IconSearch />}
              disabled={lookingUp}
            >
              {t('market.propose.find')}
            </Button>
          </form>

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

          {!loaded ? (
            <SkeletonBlock className="skel-metric" />
          ) : items.length === 0 ? (
            <EmptyState title={t('services.noItems')} text={t('market.sell.noItemsText')} icon={<IconBox />} />
          ) : (
            <fieldset className="field field--cards">
              <legend className="field-label">
                {t(gift ? 'market.propose.giftLegend' : 'market.propose.offerLegend')}
              </legend>
              {items.length > LIST_TOOLS_FROM && (
                <div className="search">
                  <IconSearch />
                  <input
                    type="search"
                    placeholder={t('market.sell.find')}
                    aria-label={t('market.sell.find')}
                    value={find}
                    onChange={(e) => setFind(e.target.value)}
                  />
                </div>
              )}
              {/* A swap can be of several cards; a gift is of one, so it is a radio and says "1 of n". */}
              <ul className="check-list" key={gift ? 'one' : 'several'}>
                {pickable.map((item) => (
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
              <form
                className="row"
                style={{ alignItems: 'start' }}
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  void addWanted();
                }}
              >
                <Field
                  label={t('market.propose.wantSerial')}
                  hint={t('market.propose.wantHint')}
                  error={wantError ?? undefined}
                  className="field--grow"
                >
                  <input
                    value={serial}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={wantError ? true : undefined}
                    onChange={(e) => {
                      setSerial(e.target.value);
                      setWantError(null);
                    }}
                    dir="ltr"
                  />
                </Field>
                <Button type="submit" variant="secondary" className="btn--field-aligned" disabled={!serial.trim()}>
                  {t('market.propose.addWanted')}
                </Button>
              </form>
              {wanted.length > 0 && (
                <ul className="check-list list-unbounded" aria-label={t('market.swaps.col.youGet')}>
                  {wanted.map((w) => (
                    <li key={w.id}>
                      <ItemPick serial={w.serialNumber} name={itemName(t, w)} />
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t('market.propose.removeWanted', { serial: w.serialNumber })}
                        onClick={() => setWanted((prev) => prev.filter((x) => x.id !== w.id))}
                      >
                        {t('market.propose.remove')}
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
              <TradeSide decorative label={t('market.swaps.col.theyGet')} items={items.filter((item) => offered[item.id])} area="give" t={t} />
              <SwapGlyph oneWay={gift} towardStart />
              <TradeSide decorative label={t('market.swaps.col.youGet')} items={gift ? [] : wanted} area="get" t={t} />
            </div>
          </DrawerTag>
        </aside>

        <div className="stack stack--tight request-form-actions">
          {sendError && <ErrorState message={sendError} />}
          <div className="row">
            <Button
              variant="primary"
              disabled={busy || missing !== null}
              aria-describedby={missing ? 'propose-missing' : undefined}
              onClick={() => (gift ? setConfirmGift(true) : void propose())}
            >
              {t(gift ? 'market.propose.sendGift' : 'market.propose.send')}
            </Button>
          </div>
          {missing && (
            <p className="field-hint" id="propose-missing">
              {missing}
            </p>
          )}
        </div>
      </div>
    </Panel>

    {confirmGift && counterparty && giftItem && (
      <ConfirmationModal
        title={t('market.propose.giftConfirmTitle')}
        body={
          <p>
            {t('market.propose.giftConfirmBody', {
              item: isolate(itemName(t, giftItem).split(' · ')[0]!),
              username: counterparty.username,
            })}
          </p>
        }
        confirmLabel={t('market.propose.sendGift')}
        cancelLabel={t('ui.cancel')}
        busy={busy}
        onConfirm={() => void propose()}
        onCancel={() => setConfirmGift(false)}
      />
    )}
    </>
  );
}
