import type { MessageKey, TranslateFn } from './i18n';

export interface GradingTier {
  key: string;
  label: string;
  gradingBody: string;
  maxDeclaredMinor: number;
  turnaroundDaysMin: number;
  turnaroundDaysMax: number;
  requiresApproval: boolean;
  feeMinor: number | null;
}

const TIER_KEY: Record<string, MessageKey> = {
  psa_value: 'grade.tier.psa_value',
  psa_regular: 'grade.tier.psa_regular',
  psa_express: 'grade.tier.psa_express',
  psa_walkthrough: 'grade.tier.psa_walkthrough',
  bgs_standard: 'grade.tier.bgs_standard',
};

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
