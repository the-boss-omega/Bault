import { useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { useVaultItems } from '../../../shared/useVaultItems';
import { CardPhotoThumb } from '../../../shared/CardPhoto';
import { formatUsd } from '../../../shared/money';
import { useT } from '../../../shared/i18n';

interface Listing {
  id: string;
  askingPrice: number;
  currency: string;
  itemId: string;
  serialNumber: string;
  typeClass: string;
  conditionGrade: string | null;
  description: string;
  imageUrl?: string;
}

/**
 * Marketplace. Browse/buy/offer on active listings; list one of your own STORED
 * items for sale (chosen from a vault dropdown — a real UUID, so no invalid-id 500).
 */
export function MarketplacePage() {
  const t = useT();
  const [listings, setListings] = useState<Listing[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const { items, reload: reloadItems } = useVaultItems(true);
  const [sellItemId, setSellItemId] = useState('');
  const [sellPrice, setSellPrice] = useState(50000);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!sellItemId && items[0]) setSellItemId(items[0].id);
  }, [items, sellItemId]);

  async function loadListings() {
    setListings(await api.get<Listing[]>(`/marketplace/listings?q=${encodeURIComponent(q)}`));
  }

  // Incremental search-as-you-type: debounce a refetch on every query change so
  // results update live from the partial query — no Enter/button required.
  useEffect(() => {
    const handle = setTimeout(() => {
      void loadListings();
    }, 250);
    // Deliberately keyed on `q` alone: loadListings closes over the same query.
    return () => clearTimeout(handle);
  }, [q]);

  async function buy(id: string) {
    try {
      await api.post(`/marketplace/listings/${id}/purchase`);
      setStatus(t('market.status.purchased'));
      await loadListings();
      await reloadItems();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function offer(id: string) {
    const amount = Number(prompt(t('market.offerPrompt')) ?? '0');
    if (!amount) return;
    try {
      await api.post(`/marketplace/listings/${id}/offers`, { amount });
      setStatus(t('market.status.offerSent'));
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function sell() {
    if (!sellItemId) {
      setStatus(t('market.status.selectItem'));
      return;
    }
    try {
      await api.post('/marketplace/listings', { itemId: sellItemId, askingPrice: sellPrice });
      setStatus(t('market.status.listed'));
      await loadListings();
      await reloadItems();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  return (
    <section>
      <h2>{t('market.title')}</h2>
      <div className="field-row">
        <input
          type="search"
          placeholder={t('market.searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {status && <p role="status">{status}</p>}

      <fieldset>
        <legend>{t('market.sellLegend')}</legend>
        <div className="field-row">
          <select value={sellItemId} onChange={(e) => setSellItemId(e.target.value)}>
            <option value="">{t('market.selectItemOption')}</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.typeClass} — {i.description}
              </option>
            ))}
          </select>
          <input type="number" value={sellPrice} onChange={(e) => setSellPrice(Number(e.target.value))} dir="ltr" />
          <button className="btn btn--accent" disabled={!sellItemId} onClick={sell}>{t('market.listForSale')}</button>
        </div>
      </fieldset>

      <ul className="card-grid">
        {listings.map((l) => (
          <li key={l.id} className="card">
            <CardPhotoThumb serialNumber={l.serialNumber} title={l.description || l.typeClass} />
            <h4 className="card-title">{l.typeClass}</h4>
            <p className="card-desc">{l.description || '—'}</p>
            <p className="price" dir="ltr">
              {formatUsd(l.askingPrice)}
            </p>
            <div className="actions">
              <button className="btn btn--primary" onClick={() => buy(l.id)}>{t('market.buy')}</button>
              <button className="btn btn--ghost" onClick={() => offer(l.id)}>{t('market.makeOffer')}</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
