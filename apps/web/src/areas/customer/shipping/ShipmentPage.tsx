import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../shared/api';
import { formatUsd } from '../../../shared/money';
import { useT } from '../../../shared/i18n';
import { useVaultItems } from '../../../shared/useVaultItems';

interface Rate {
  carrier: string;
  serviceLevel: string;
  costMinor: number;
  currency: string;
}

interface Address {
  id: string;
  label: string;
  recipient: string;
  line1: string;
  city: string;
  country: string;
  postalCode: string;
  isDefault: boolean;
}

/** One-line rendering of a saved address, used both in the dropdown and as the
 *  free-text destination string persisted with the shipment. */
export function formatAddress(a: Address): string {
  return `${a.recipient}, ${a.line1}, ${a.city} ${a.postalCode}, ${a.country}`;
}

/**
 * Outbound shipping. The customer multi-selects items from their vault and picks a
 * saved shipping address (managed on the Profile page). One shipment request is
 * created with a single Shipment ID covering every selected item. Create → fetch
 * carrier rates → select a rate (auto-charged). The operator does the structured
 * scan-verified fulfillment in the warehouse console.
 */
export function ShipmentPage() {
  const t = useT();
  const { items, error, reload } = useVaultItems(true);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressId, setAddressId] = useState('');
  const [rush, setRush] = useState(false);
  const [shipmentCode, setShipmentCode] = useState('');
  const [shipmentId, setShipmentId] = useState('');
  const [rates, setRates] = useState<Rate[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([id]) => id),
    [selected],
  );

  useEffect(() => {
    void (async () => {
      try {
        const list = await api.get<Address[]>('/me/addresses');
        setAddresses(list);
        const def = list.find((a) => a.isDefault) ?? list[0];
        if (def) setAddressId(def.id);
      } catch (e) {
        setStatus((e as Error).message);
      }
    })();
  }, []);

  function toggle(id: string) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function create() {
    if (selectedIds.length === 0) {
      setStatus(t('shipping.selectItemFirst'));
      return;
    }
    const address = addresses.find((a) => a.id === addressId);
    if (!address) {
      setStatus(t('shipping.selectAddressFirst'));
      return;
    }
    try {
      const s = await api.post<{ id: string; code?: string }>('/shipping/shipments', {
        itemIds: selectedIds,
        destinationAddress: formatAddress(address),
        rush,
      });
      setShipmentId(s.id);
      setShipmentCode(s.code ?? s.id);
      setRates(await api.get<Rate[]>(`/shipping/shipments/${s.id}/rates`));
      setStatus(t('shipping.createdWithId', { id: s.code ?? s.id }));
      setSelected({});
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function select(rate: Rate) {
    try {
      await api.post(`/shipping/shipments/${shipmentId}/select-rate`, {
        carrier: rate.carrier,
        serviceLevel: rate.serviceLevel,
      });
      setStatus(
        t('shipping.rateSelected', {
          carrier: rate.carrier,
          serviceLevel: rate.serviceLevel,
          amount: formatUsd(rate.costMinor),
        }),
      );
      setRates([]);
      await reload();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  return (
    <section>
      <h2>{t('shipping.title')}</h2>
      <div className="card">
        <fieldset>
          <legend>{t('shipping.selectItems')}</legend>
          {items.length === 0 && <p className="hint">{t('shipping.noItems')}</p>}
          <ul className="check-list">
            {items.map((i) => (
              <li key={i.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={!!selected[i.id]}
                    onChange={() => toggle(i.id)}
                  />{' '}
                  {i.typeClass} — {i.description}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <div className="field-row">
          <select value={addressId} onChange={(e) => setAddressId(e.target.value)}>
            <option value="">{t('shipping.addressPlaceholder')}</option>
            {addresses.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}: {formatAddress(a)}
              </option>
            ))}
          </select>
          <label>
            <input type="checkbox" checked={rush} onChange={(e) => setRush(e.target.checked)} />{' '}
            {t('shipping.rush')}
          </label>
          <button className="btn btn--primary" disabled={selectedIds.length === 0} onClick={create}>
            {t('shipping.createAndGetRates')}
          </button>
        </div>
        {addresses.length === 0 && <p className="hint">{t('shipping.manageAddressesHint')}</p>}
      </div>

      {shipmentCode && <p className="hint">{t('shipping.shipmentIdLabel', { id: shipmentCode })}</p>}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}

      <ul className="card-grid">
        {rates.map((r) => (
          <li key={`${r.carrier}-${r.serviceLevel}`} className="card">
            <h4 className="card-title">{r.carrier}</h4>
            <p className="card-desc">{r.serviceLevel}</p>
            <p className="price" dir="ltr">
              {formatUsd(r.costMinor)}
            </p>
            <div className="actions">
              <button className="btn btn--accent" onClick={() => select(r)}>{t('shipping.selectRate')}</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
