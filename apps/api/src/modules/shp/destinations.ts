/**
 * What a collector needs to know about sending a card across a particular
 * border: what happens to the parcel once it lands, beyond the invoice.
 *
 * **Bault must not invent customs facts.** Duty thresholds move, GST rules
 * change, and a confident figure made up here is a number somebody will plan
 * around. So every destination-specific claim carries the URL of the authority
 * that issues it, and anything Bault has not verified is absent rather than
 * approximated. Each destination states three things and no more:
 *
 *   1. WHAT BAULT DOES: knowable from the code, and the same everywhere.
 *   2. WHO PAYS: the recipient of record, always, which is a Bault policy
 *      rather than a foreign rule and can therefore be stated flatly.
 *   3. WHERE THE RULES LIVE: a link to the destination's own customs
 *      authority, so the collector reads the current thresholds from the body
 *      that sets them.
 *
 * `notes` carries only mechanics Bault has confirmed and can act on. A known
 * requirement at a destination that Bault does NOT handle is listed in
 * `notHandled` and named as an absence.
 */

export interface DestinationGuidance {
  /** ISO 3166-1 alpha-2, upper case. */
  country: string;
  name: string;
  /** The body that sets import rules for this destination. */
  authority: { name: string; url: string };
  /** Mechanics Bault has confirmed and performs. Never a duty figure. */
  notes: string[];
  /** Known requirements at this destination that Bault does not perform. */
  notHandled: string[];
}

/**
 * The destinations Bault has written guidance for.
 *
 * Short on purpose: a named entry has been checked, so an unnamed one falling
 * back to the generic guidance is an honest signal rather than a gap papered
 * over with a plausible-sounding paragraph.
 */
export const DESTINATIONS: readonly DestinationGuidance[] = [
  {
    country: 'AU',
    name: 'Australia',
    authority: {
      name: 'Australian Border Force',
      url: 'https://www.abf.gov.au/importing-exporting-and-manufacturing/importing',
    },
    notes: [
      'Every line of the commercial invoice carries its own declared value, description and country of origin, which is the form Australian clearance expects.',
    ],
    notHandled: [
      'Bault does not lodge a FedEx assembly order or any other broker-side clearance instruction on your behalf. If your carrier asks the recipient for one, the recipient answers it directly.',
      'Bault does not register for, collect or remit Australian GST. It is not the seller of your cards.',
    ],
  },
  {
    country: 'CA',
    name: 'Canada',
    authority: {
      name: 'Canada Border Services Agency',
      url: 'https://www.cbsa-asfc.gc.ca/import/menu-eng.html',
    },
    notes: [
      'Collectible cards are declared under the invoice’s stated HS code with the value you entered.',
    ],
    notHandled: [
      'Bault does not act as importer of record and does not pre-pay duty or brokerage. Carrier brokerage fees are billed to the recipient on delivery.',
    ],
  },
  {
    country: 'GB',
    name: 'United Kingdom',
    authority: {
      name: 'HM Revenue & Customs',
      url: 'https://www.gov.uk/goods-sent-from-abroad',
    },
    notes: [
      'The invoice states the declared value per item, which is what UK import VAT is assessed against.',
    ],
    notHandled: [
      'Bault is not registered for UK VAT and does not charge it at checkout. Anything due is collected by the carrier from the recipient.',
    ],
  },
  {
    country: 'IL',
    name: 'Israel',
    authority: {
      name: 'Israel Tax Authority — Customs',
      url: 'https://www.gov.il/en/departments/israel_tax_authority',
    },
    notes: [
      'The parcel travels with a per-item commercial invoice naming the declared value in the shipment’s currency.',
    ],
    notHandled: [
      'Bault does not clear the parcel or appoint a local broker. Clearance is arranged by the recipient with the carrier.',
    ],
  },
];

const BY_COUNTRY = new Map(DESTINATIONS.map((d) => [d.country, d]));

/**
 * What Bault does on every international parcel, regardless of destination.
 *
 * Stated once here and returned with every lookup so a destination with no
 * specific entry still gets a real answer rather than an empty page.
 */
export const UNIVERSAL_CUSTOMS_NOTES: readonly string[] = [
  'A commercial invoice is generated for every international parcel, with one line per item: description, declared value, HS code, country of origin and weight.',
  'The declared value is the one you entered, per item. Bault never adjusts, reduces or omits it — under-declaring to lower somebody’s duty is customs fraud committed in their name.',
  'Import duty, VAT and any carrier brokerage are payable by the recipient on arrival. They are not included in the shipping price you are quoted.',
  'Where an item was never weighed, the invoice uses its class’s typical weight and the shipment marks that figure as an estimate rather than presenting it as measured.',
];

/**
 * Guidance for a destination.
 *
 * A country with no entry is not an error and does not return nothing: it gets
 * the universal notes with `specific: null`, which the UI renders as "we have
 * not written specific guidance for this destination yet".
 */
export function destinationGuidance(country: string | null | undefined): {
  universal: readonly string[];
  specific: DestinationGuidance | null;
} {
  const code = country?.trim().toUpperCase() ?? '';
  return { universal: UNIVERSAL_CUSTOMS_NOTES, specific: BY_COUNTRY.get(code) ?? null };
}
