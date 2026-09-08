import {
  DISPOSAL_CATEGORIES,
  DISPOSAL_OUTCOMES,
  ITEM_CLASSES,
  LOT_MIN_SIZE,
  type DisposalOutcome,
} from './item-classes';

/**
 * What Bault accepts, what it refuses, and what happens to the difference —
 * published.
 *
 * Every rule in here was already being enforced. The closed item taxonomy has
 * been checked on every write path since Part 14; the prohibited categories have
 * produced a recorded arrival disposal and a notification to the owner since the
 * same pass. What did not exist was the sentence telling a collector any of it
 * BEFORE they posted a box. The rule was discoverable exactly one way: by having
 * something refused, destroyed and written up.
 *
 * That is the gap this closes, and the design decision that matters is where the
 * text comes from. It is DERIVED, at request time, from the very modules the
 * intake path validates against — `ITEM_CLASSES` and `DISPOSAL_CATEGORIES`. A
 * hand-written policy page is a second copy of a rule, and a second copy drifts:
 * add a class to the taxonomy and the page silently starts lying. Here, adding a
 * class publishes it, and removing one unpublishes it, because the page and the
 * validator read the same array.
 *
 * The prose that cannot be derived — what a refusal actually means for the
 * collector — is held to the FAQ's rule: every sentence states something the
 * code does. Nothing here is aspirational, and nothing describes a handling
 * outcome the disposal record cannot express.
 */

export interface AcceptedClassPolicy {
  key: string;
  label: string;
  /** Stored under the oversized terms: shorter included period, steeper fee. */
  oversized: boolean;
  /** Whether this may be received as a single lot rather than as N items. */
  lotEligible: boolean;
  /**
   * The smallest count that is a lot for this class. Present only for classes
   * that carry a threshold — anything under it is received as individual items.
   */
  lotMinSize?: number;
  /** What one typically weighs packed, used for a rate when nobody weighed it. */
  typicalWeightGrams: number;
}

export interface RefusedCategoryPolicy {
  key: string;
  label: string;
  /** A safety or legal refusal, rather than a judgement about value. */
  prohibited: boolean;
  reason: string;
}

export interface IntakePolicy {
  acceptedClasses: AcceptedClassPolicy[];
  refusedCategories: RefusedCategoryPolicy[];
  outcomes: readonly DisposalOutcome[];
  lotThreshold: number;
  rules: { id: string; heading: string; body: string }[];
}

/**
 * Why each refusal category exists, in the collector's terms.
 *
 * Keyed off the same list the operator picks from, so a category with no reason
 * here is a bug that shows up as a missing sentence rather than as a page that
 * quietly omits a rule. `no_value` is deliberately phrased as the judgement it
 * is rather than as a refusal, because it is the one entry in that list that is
 * not about safety or legality.
 */
const REFUSAL_REASON: Record<string, string> = {
  gps_tracker:
    'A tracker is a powered radio transmitter. Carriers restrict them in air freight, and a vault cannot store one that is still transmitting somebody’s location.',
  lithium_battery:
    'Lithium cells are dangerous goods in air freight and cannot be held or forwarded.',
  liquid_or_glass:
    'A broken container in a parcel damages every other item travelling with it, including other collectors’ property.',
  flammable: 'Flammable goods are dangerous goods, and cannot be stored or forwarded.',
  medical: 'Medicines and supplements are regulated goods that Bault is not licensed to hold.',
  cosmetics: 'Cosmetics and perfume are commonly flammable and are restricted in air freight.',
  adult_material: 'Not accepted for storage or forwarding.',
  other_prohibited:
    'A warehouse meets things no list anticipated. Anything refused under this heading is written up with a mandatory note saying what it was.',
  no_value:
    'Not a refusal. Some arrivals cost more to process and store than they are worth, and shelving them would bill you more than the cards could ever return. You are told what was found and what became of it.',
};

/**
 * The rules that are not a list — the things a collector needs stated in
 * sentences. Every one names a behaviour that exists in code.
 */
const RULES: IntakePolicy['rules'] = [
  {
    id: 'closed-list',
    heading: 'The accepted list is closed',
    body:
      'Intake will not book in a class that is not on this list. This is checked on every path that can create an item — a single intake, a bulk intake, and a batch being split — so there is no route in for something the list does not name.',
  },
  {
    id: 'trackers',
    heading: 'Do not put a tracker in a parcel you send us',
    body:
      'A GPS tracker or AirTag found in an arriving parcel is removed and destroyed, and you are told that it was. This is the same rule the carriers apply to us, and it holds even though Bault will sell you a tracker on the way out: an outbound tracker travels in a parcel Bault packed, declared and insured, and is handed to you on delivery. An inbound one arrives undeclared in somebody else’s freight.',
  },
  {
    id: 'refusal-record',
    heading: 'Nothing addressed to you vanishes silently',
    body:
      'When something arrives that cannot go into your vault, a disposal record is written naming what it was, which of the four outcomes occurred, and why — and a notification is sent to you the moment it is filed. The record is permanent.',
  },
  {
    id: 'unattributable',
    heading: 'A parcel we cannot match to an account is held, not opened',
    body:
      'If the label names no account we can resolve, the parcel is recorded as unclaimed with whatever was written on it kept verbatim, and held unopened. It rejoins the normal flow the moment somebody works out whose it is.',
  },
  {
    id: 'condition',
    heading: 'The condition check happens before anything is booked in',
    body:
      'Every parcel is opened against a recorded finding — sound, packaging damaged, or contents damaged — with a written note, and that finding is timestamped before any item record exists. If the finding is not “sound” you are told immediately rather than after the contents are catalogued, because a claim against the seller or the carrier has a deadline.',
  },
  {
    id: 'lots',
    heading: 'A handful of cards is not a lot',
    body: `A lot is stored and billed as one item until it is broken. Below ${LOT_MIN_SIZE} cards that is worse for you than it is for us — you cannot sell, grade or ship a single card out of an unbroken lot — so a card lot under that size is received as that many individual items instead, each with its own serial, label and record.`,
  },
  {
    id: 'oversized',
    heading: 'Storage terms are fixed when we receive it',
    body:
      'Whether something is stored under the oversized terms is decided from its class at the moment it is booked in, and is never re-derived afterwards. A change to the taxonomy next year cannot retroactively change what you are paying for a box that has been on the same shelf the whole time.',
  },
];

/**
 * Build the published policy from the enforcing modules.
 *
 * Pure and dependency-free, which is why it is a function in a plain module
 * rather than a service: it reads two constant arrays and shapes them. That also
 * makes the drift guarantee testable without a database.
 */
export function intakePolicy(): IntakePolicy {
  return {
    acceptedClasses: ITEM_CLASSES.map((c) => ({
      key: c.key,
      label: c.label,
      oversized: c.oversized,
      lotEligible: c.lotEligible,
      lotMinSize: c.lotMinSize,
      typicalWeightGrams: c.typicalWeightGrams,
    })),
    refusedCategories: DISPOSAL_CATEGORIES.map((c) => ({
      key: c.key,
      label: c.label,
      prohibited: c.prohibited,
      // An unreasoned category is a missing sentence, and says so out loud
      // rather than rendering an empty paragraph.
      reason: REFUSAL_REASON[c.key] ?? 'No published reason for this category yet.',
    })),
    outcomes: DISPOSAL_OUTCOMES,
    lotThreshold: LOT_MIN_SIZE,
    rules: RULES,
  };
}
