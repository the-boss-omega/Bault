import type { MessageKey, TranslateFn } from './i18n';

/**
 * The SPA's vocabulary for the services performed on a card that is already on
 * the shelf.
 *
 * The tier shapes are mirrored from `apps/api/src/modules/dis/grading-tiers.ts`
 * rather than imported, because the SPA cannot reach into the API tree. The
 * VALUES are not mirrored: tiers and inspection areas are fetched from
 * `/services/grading/tiers` and `/services/inspection/areas`, so adding a tier
 * on the server needs no redeploy of the client. Only the labels live here,
 * because a label has to be translatable and a server string is not.
 */

export interface GradingTier {
  key: string;
  label: string;
  gradingBody: string;
  maxDeclaredMinor: number;
  turnaroundDaysMin: number;
  turnaroundDaysMax: number;
  requiresApproval: boolean;
  /**
   * The fee, resolved from the pricing rules at request time. `null` means no
   * rule exists for this tier yet — the form says so rather than quoting the
   * flat service fee the charge would fall back to.
   */
  feeMinor: number | null;
}

const TIER_KEY: Record<string, MessageKey> = {
  psa_value: 'grade.tier.psa_value',
  psa_regular: 'grade.tier.psa_regular',
  psa_express: 'grade.tier.psa_express',
  psa_walkthrough: 'grade.tier.psa_walkthrough',
  bgs_standard: 'grade.tier.bgs_standard',
};

/**
 * A tier's name. Falls back to the server's own English label rather than to the
 * raw key, so a tier added on the server is readable here before it is
 * translated.
 */
export function tierLabel(t: TranslateFn, tier: GradingTier): string {
  const key = TIER_KEY[tier.key];
  return key ? t(key) : tier.label;
}

const AREA_KEY: Record<string, MessageKey> = {
  corners: 'inspect.area.corners',
  edges: 'inspect.area.edges',
  surface: 'inspect.area.surface',
  centering: 'inspect.area.centering',
  creases: 'inspect.area.creases',
};

export function areaLabel(t: TranslateFn, area: string): string {
  const key = AREA_KEY[area];
  return key ? t(key) : area;
}

/** The three grades an inspection finding may carry. Deliberately coarse. */
export const INSPECTION_SEVERITIES = ['clean', 'minor', 'notable'] as const;
export type InspectionSeverity = (typeof INSPECTION_SEVERITIES)[number];

const SEVERITY_KEY: Record<string, MessageKey> = {
  clean: 'inspect.severity.clean',
  minor: 'inspect.severity.minor',
  notable: 'inspect.severity.notable',
};

export function severityLabel(t: TranslateFn, severity: string): string {
  const key = SEVERITY_KEY[severity];
  return key ? t(key) : severity;
}

/** Grading-submission status → badge tone. */
export const SUBMISSION_TONE: Record<string, 'info' | 'violet' | 'success'> = {
  open: 'info',
  shipped: 'violet',
  returned: 'success',
};

const SUBMISSION_STATUS_KEY: Record<string, MessageKey> = {
  open: 'grade.sub.open',
  shipped: 'grade.sub.shipped',
  returned: 'grade.sub.returned',
};

export function submissionStatusLabel(t: TranslateFn, status: string): string {
  const key = SUBMISSION_STATUS_KEY[status];
  return key ? t(key) : status;
}
