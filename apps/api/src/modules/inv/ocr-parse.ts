import type { OcrBlock, OcrKind } from '@bault/adapters';

export const LABEL_FIELDS = ['trackingNumber', 'carrier', 'senderName', 'senderAddress'] as const;
export const ITEM_FIELDS = ['cardName', 'setName', 'cardNumber', 'year', 'gradingBody', 'grade', 'certNumber'] as const;

export type LabelField = (typeof LABEL_FIELDS)[number];
export type ItemField = (typeof ITEM_FIELDS)[number];

export interface ParsedReading {
  fields: Record<string, string>;
  confidence: Record<string, number>;
}

export const GRADING_BODIES = ['PSA', 'BGS', 'CGC', 'SGC'] as const;
export type GradingBody = (typeof GRADING_BODIES)[number];

const CERT_DIGITS: Record<GradingBody, readonly [min: number, max: number]> = {
  PSA: [8, 8],
  BGS: [10, 10],
  CGC: [7, 10],
  SGC: [7, 8],
};

export function isGradingBody(value: string): value is GradingBody {
  return (GRADING_BODIES as readonly string[]).includes(value);
}

export function certificateShapeOk(body: string, cert: string): boolean {
  const digits = cert.trim();
  if (!/^\d+$/.test(digits)) return false;
  const shape = isGradingBody(body.trim().toUpperCase()) ? CERT_DIGITS[body.trim().toUpperCase() as GradingBody] : [7, 10];
  return digits.length >= shape[0] && digits.length <= shape[1];
}

export function certificateShape(body: string): string | null {
  const key = body.trim().toUpperCase();
  if (!isGradingBody(key)) return null;
  const [min, max] = CERT_DIGITS[key];
  return min === max ? `${min} digits` : `${min} to ${max} digits`;
}

interface Line {
  text: string;
  upper: string;
  confidence: number;
}

function linesOf(blocks: readonly OcrBlock[]): Line[] {
  return blocks
    .flatMap((b) => b.text.split(/\r?\n/).map((text) => ({ text: text.replace(/\s+/g, ' ').trim(), confidence: b.confidence })))
    .filter((l) => l.text !== '')
    .map((l) => ({ ...l, upper: l.text.toUpperCase(), confidence: Math.round(Math.min(1, Math.max(0, l.confidence)) * 100) / 100 }));
}

function tokens(upper: string): string[] {
  return upper
    .replace(/(\d)[\s-]+(?=\d)/g, '$1')
    .split(/[^0-9A-Z]+/)
    .filter(Boolean);
}

interface TrackingShape {
  carrier: string;
  test: (token: string) => string | null;
  needsHint?: boolean;
}

const TRACKING_SHAPES: readonly TrackingShape[] = [
  { carrier: 'UPS', test: (t) => (/^1Z[0-9A-Z]{16}$/.test(t) ? t : null) },
  { carrier: 'USPS', test: (t) => /^420\d{5}(?:\d{4})?(9[1-5]\d{18,20})$/.exec(t)?.[1] ?? null },
  { carrier: 'USPS', test: (t) => (/^9[1-5]\d{18,20}$/.test(t) ? t : null) },
  { carrier: 'FedEx', test: (t) => (/^96\d{20}$/.test(t) ? t : null) },
  { carrier: 'USPS', test: (t) => (/^[A-Z]{2}\d{9}US$/.test(t) ? t : null) },
  { carrier: 'Postal service', test: (t) => (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(t) ? t : null) },
  { carrier: 'FedEx', test: (t) => (/^(?:\d{12}|\d{15})$/.test(t) ? t : null) },
  { carrier: 'DHL', test: (t) => (/^JJD\d{10,20}$/.test(t) ? t : null) },
  { carrier: 'DHL', test: (t) => (/^\d{10}$/.test(t) ? t : null), needsHint: true },
];

const TRACKING_HINT = /TRACK|AWB|WAYBILL|DHL/;

export function guessCarrier(trackingNumber: string): string | null {
  const token = trackingNumber.toUpperCase().replace(/[\s-]+/g, '');
  for (const shape of TRACKING_SHAPES) {
    if (shape.test(token)) return shape.carrier;
  }
  return null;
}

function findTracking(lines: readonly Line[]): { number: string; carrier: string; line: Line } | null {
  const ordered = [...lines.filter((l) => TRACKING_HINT.test(l.upper)), ...lines.filter((l) => !TRACKING_HINT.test(l.upper))];
  for (const shape of TRACKING_SHAPES) {
    for (const line of ordered) {
      if (shape.needsHint && !TRACKING_HINT.test(line.upper)) continue;
      for (const token of tokens(line.upper)) {
        const number = shape.test(token);
        if (number) return { number, carrier: shape.carrier, line };
      }
    }
  }
  return null;
}

const SENDER_MARK = /^(?:SHIP\s*FROM|RETURN\s*TO|SENDER|FROM)\b[\s:.-]*/i;
const ADDRESS_END = /^(?:SHIP\s*TO|DELIVER\s*TO|TO\b|TRACK|USPS|UPS\b|FEDEX|DHL|PRIORITY|FIRST[-\s]CLASS|GROUND)/i;

export function parseLabel(blocks: readonly OcrBlock[]): ParsedReading {
  const lines = linesOf(blocks);
  const fields: Record<string, string> = {};
  const confidence: Record<string, number> = {};

  const tracking = findTracking(lines);
  if (tracking) {
    fields.trackingNumber = tracking.number;
    confidence.trackingNumber = tracking.line.confidence;
    fields.carrier = tracking.carrier;
    confidence.carrier = tracking.line.confidence;
  }

  const at = lines.findIndex((l) => SENDER_MARK.test(l.text));
  if (at >= 0) {
    let cursor = at;
    let name = lines[at]!.text.replace(SENDER_MARK, '').trim();
    let nameConfidence = lines[at]!.confidence;
    if (!name && lines[at + 1] && !ADDRESS_END.test(lines[at + 1]!.text)) {
      cursor = at + 1;
      name = lines[cursor]!.text;
      nameConfidence = lines[cursor]!.confidence;
    }
    if (name) {
      fields.senderName = name;
      confidence.senderName = nameConfidence;
      const address: Line[] = [];
      for (const line of lines.slice(cursor + 1, cursor + 4)) {
        if (ADDRESS_END.test(line.text) || (tracking && line === tracking.line)) break;
        address.push(line);
      }
      if (address.length > 0) {
        fields.senderAddress = address.map((l) => l.text).join('\n');
        confidence.senderAddress = Math.min(...address.map((l) => l.confidence));
      }
    }
  }

  return { fields, confidence };
}

const BODY = /\b(PSA|BGS|BECKETT|CGC|SGC)\b/;
const GRADE_NUMBER = /^(?:10|[1-9](?:\.5)?)$/;
const GRADE_WORDS = /\b(?:GEM\s*MT|GEM\s*MINT|PRISTINE|MINT|NM-MT|NM|EX-MT|EX|VG-EX|VG|GOOD|FAIR|PR)\b[\s+]*(10|[1-9](?:\.5)?)\b/;
const YEAR = /\b(19[4-9]\d|20[0-4]\d)\b/;
const SLASH_NUMBER = /\b(\d{1,3}[A-Z]?\s*\/\s*\d{1,3})\b/;
const HASH_NUMBER = /#\s*([A-Z]{0,4}-?\d{1,4}[A-Z]?)\b(?!\d)/;

function certCandidates(line: Line): string[] {
  return tokens(line.upper).filter((t) => /^\d{7,10}$/.test(t));
}

export function parseItem(blocks: readonly OcrBlock[]): ParsedReading {
  const lines = linesOf(blocks);
  const fields: Record<string, string> = {};
  const confidence: Record<string, number> = {};
  const used = new Set<Line>();
  const put = (field: ItemField, value: string, line: Line) => {
    fields[field] = value;
    confidence[field] = line.confidence;
    used.add(line);
  };

  const bodyLine = lines.find((l) => BODY.test(l.upper));
  if (bodyLine) {
    const named = BODY.exec(bodyLine.upper)![1]!;
    put('gradingBody', named === 'BECKETT' ? 'BGS' : named, bodyLine);
    const after = bodyLine.upper.slice(bodyLine.upper.indexOf(named) + named.length);
    const grade = after.split(/[^0-9.]+/).find((t) => GRADE_NUMBER.test(t));
    if (grade) put('grade', grade, bodyLine);
  }
  if (!fields.grade) {
    for (const line of lines) {
      const m = GRADE_WORDS.exec(line.upper);
      if (m) {
        put('grade', m[1]!, line);
        break;
      }
    }
  }

  const body = fields.gradingBody ?? '';
  const certLines = [...lines.filter((l) => /CERT/.test(l.upper)), ...lines.filter((l) => !/CERT/.test(l.upper))];
  for (const line of certLines) {
    const cert = certCandidates(line).find((c) => certificateShapeOk(body, c));
    if (cert) {
      put('certNumber', cert, line);
      break;
    }
  }

  for (const line of lines) {
    const slash = SLASH_NUMBER.exec(line.upper);
    const hash = slash ? null : HASH_NUMBER.exec(line.upper);
    const number = slash?.[1]?.replace(/\s+/g, '') ?? hash?.[1];
    if (number && !(fields.certNumber && line.upper.includes(fields.certNumber) && !slash && /CERT/.test(line.upper))) {
      put('cardNumber', number, line);
      break;
    }
  }

  const yearLine = lines.find((l) => YEAR.test(l.upper) && !certCandidates(l).some((c) => c === fields.certNumber));
  if (yearLine) put('year', YEAR.exec(yearLine.upper)![1]!, yearLine);

  const setFrom = (line: Line): string =>
    line.text
      .replace(YEAR, ' ')
      .replace(SLASH_NUMBER, ' ')
      .replace(HASH_NUMBER, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const setCandidates = [
    yearLine,
    lines.find((l) => /\bSET\b/.test(l.upper)),
    lines.find((l) => fields.cardNumber !== undefined && l.upper.includes(fields.cardNumber)),
  ];
  for (const line of setCandidates) {
    if (!line) continue;
    const name = setFrom(line);
    if ((name.match(/[A-Za-z]/g) ?? []).length >= 3 && !BODY.test(name.toUpperCase())) {
      put('setName', name, line);
      break;
    }
  }

  const cardLine = lines.find(
    (l) =>
      !used.has(l) &&
      !BODY.test(l.upper) &&
      !GRADE_WORDS.test(l.upper) &&
      !/\b(?:CERT|SET|MINT|GEM)\b/.test(l.upper) &&
      !YEAR.test(l.upper) &&
      (l.text.match(/[A-Za-z]/g) ?? []).length >= 3 &&
      (l.text.match(/[A-Za-z]/g) ?? []).length >= (l.text.match(/\d/g) ?? []).length * 2,
  );
  if (cardLine) put('cardName', cardLine.text, cardLine);

  return { fields, confidence };
}

export function parseReading(kind: OcrKind, blocks: readonly OcrBlock[]): ParsedReading {
  return kind === 'label' ? parseLabel(blocks) : parseItem(blocks);
}
