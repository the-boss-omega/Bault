/**
 * Third-party grading service levels.
 *
 * Grading used to be one request with the grading body hard-coded to "PSA" in
 * the vault drawer. There was no tier, no declared value, no price shown before
 * ordering, and no way for a card worth $8,000 to be treated differently from a
 * common — which is the whole basis on which graders price the work.
 *
 * A grader's tiers are defined by exactly two numbers: the DECLARED VALUE they
 * will insure up to, and how long they take. Everything else follows from those,
 * including what it costs. So that is what a tier is here.
 */
import { formatMinor } from '../../shared/money';

export interface GradingTier {
  key: string;
  label: string;
  gradingBody: string;
  /**
   * The most a card may be declared at for this tier, in minor units. A card
   * above it must go up a tier — that is the grader's rule, not a Bault one,
   * and it exists because the tier price is really an insurance premium.
   */
  maxDeclaredMinor: number;
  turnaroundDaysMin: number;
  turnaroundDaysMax: number;
  /**
   * Whether a human has to agree before this is submitted at all.
   *
   * True only on the top tier. A card declared above the walkthrough threshold
   * is worth more than most of the shelf it sits on, and sending one away is not
   * a decision a form should be able to take on its own.
   */
  requiresApproval: boolean;
}

/**
 * The threshold above which grading needs prior approval, in minor units.
 * Mirrors the reference service's "cards above $4,999 require Walkthrough".
 */
export const WALKTHROUGH_THRESHOLD_MINOR = 499_900;

export const GRADING_TIERS: readonly GradingTier[] = [
  {
    key: 'psa_value',
    label: 'PSA Value',
    gradingBody: 'PSA',
    maxDeclaredMinor: 49_900, // $499
    turnaroundDaysMin: 45,
    turnaroundDaysMax: 65,
    requiresApproval: false,
  },
  {
    key: 'psa_regular',
    label: 'PSA Regular',
    gradingBody: 'PSA',
    maxDeclaredMinor: 149_900, // $1,499
    turnaroundDaysMin: 20,
    turnaroundDaysMax: 30,
    requiresApproval: false,
  },
  {
    key: 'psa_express',
    label: 'PSA Express',
    gradingBody: 'PSA',
    maxDeclaredMinor: 499_900, // $4,999
    turnaroundDaysMin: 10,
    turnaroundDaysMax: 15,
    requiresApproval: false,
  },
  {
    key: 'psa_walkthrough',
    label: 'PSA Walkthrough',
    gradingBody: 'PSA',
    // Effectively uncapped; the ceiling is what a person will agree to.
    maxDeclaredMinor: 100_000_000, // $1,000,000
    turnaroundDaysMin: 5,
    turnaroundDaysMax: 10,
    requiresApproval: true,
  },
  {
    key: 'bgs_standard',
    label: 'BGS Standard',
    gradingBody: 'BGS',
    maxDeclaredMinor: 149_900,
    turnaroundDaysMin: 25,
    turnaroundDaysMax: 40,
    requiresApproval: false,
  },
];

const BY_KEY = new Map(GRADING_TIERS.map((t) => [t.key, t]));

export function gradingTier(key: string): GradingTier | undefined {
  return BY_KEY.get(key);
}

export function isKnownTier(key: string): boolean {
  return BY_KEY.has(key);
}

/** The pricing-rule action type carrying this tier's fee. */
export function tierFeeAction(key: string): string {
  return `grading_fee:${key}`;
}

export interface TierProblem {
  field: string;
  message: string;
}

/**
 * Whether a card at this declared value may go on this tier.
 *
 * Checked before the billable request exists, so a seller is told "that is above
 * this tier's ceiling" instead of discovering it when an operator rejects the
 * submission a week later.
 */
export function checkTier(tier: GradingTier, declaredMinor: number): TierProblem[] {
  const problems: TierProblem[] = [];
  if (!Number.isInteger(declaredMinor) || declaredMinor <= 0) {
    problems.push({ field: 'declaredMinor', message: 'State what the card is worth.' });
    return problems;
  }
  if (declaredMinor > tier.maxDeclaredMinor) {
    problems.push({
      field: 'declaredMinor',
      message: `${tier.label} covers declared values up to ${formatMinor(tier.maxDeclaredMinor)}. Choose a higher tier.`,
    });
  }
  // The inverse guard: a low-value card on the walkthrough tier is somebody
  // paying far more than they need to, so it is refused rather than sold to them.
  if (tier.requiresApproval && declaredMinor < WALKTHROUGH_THRESHOLD_MINOR) {
    problems.push({
      field: 'tier',
      message: `${tier.label} is for cards declared above ${formatMinor(WALKTHROUGH_THRESHOLD_MINOR)}. A lower tier costs less and covers this.`,
    });
  }
  return problems;
}

/**
 * Areas a condition inspection can be asked to look at.
 *
 * Closed list, because the value of an inspection report is that two reports of
 * the same card are comparable. Free-text areas would produce findings nobody
 * could line up against each other.
 */
export const INSPECTION_AREAS = ['corners', 'edges', 'surface', 'centering', 'creases'] as const;
export type InspectionArea = (typeof INSPECTION_AREAS)[number];

export function isKnownArea(value: string): value is InspectionArea {
  return (INSPECTION_AREAS as readonly string[]).includes(value);
}
