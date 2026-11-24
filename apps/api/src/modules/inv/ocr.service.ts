import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { loadEnv } from '@bault/config';
import type { OcrBlock, OcrKind } from '@bault/adapters';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { OutboxService } from '../not/outbox/outbox.service';
import { item, itemChangeHistory } from '../cst/cst.schema';
import { OPEN_PARCEL_STATUSES, parcel, parcelEvent } from './parcel.schema';
import { ocrSuggestion, type OcrSubjectKind } from './ocr.schema';
import {
  GRADING_BODIES,
  ITEM_FIELDS,
  LABEL_FIELDS,
  certificateShape,
  certificateShapeOk,
  isGradingBody,
  parseReading,
} from './ocr-parse';

export const OCR_REQUESTED = 'ocr_requested';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KIND_OF: Record<OcrSubjectKind, OcrKind> = { parcel: 'label', item: 'item' };

export function ocrEnabled(): boolean {
  return loadEnv().OCR_ENABLED;
}

export async function requestOcr(
  outbox: OutboxService,
  tx: Database,
  subject: { kind: OcrSubjectKind; id: string },
  objectKey: string | undefined,
): Promise<void> {
  if (!objectKey || !ocrEnabled()) return;
  await outbox.emit(tx, {
    aggregateType: subject.kind,
    aggregateId: subject.id,
    eventType: OCR_REQUESTED,
    payload: { subjectKind: subject.kind, subjectId: subject.id, objectKey, kind: KIND_OF[subject.kind] },
  });
}

export type OcrConfirmation = Partial<Record<(typeof LABEL_FIELDS)[number] | (typeof ITEM_FIELDS)[number], string>>;

interface RawReading {
  lines?: unknown;
}

function readingOf(text: string, raw: RawReading): OcrBlock[] {
  const confidences = Array.isArray(raw.lines) ? raw.lines : [];
  return text
    .split('\n')
    .map((line, index) => ({ text: line, confidence: Number(confidences[index] ?? 0) || 0 }))
    .filter((b) => b.text.trim() !== '');
}

const clean = (value: string | undefined, max = 200): string => (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

@Injectable()
export class OcrService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  private assertOn(): void {
    if (!ocrEnabled()) throw AppError.notFound('Not found');
  }

  private async assertSubject(kind: OcrSubjectKind, id: string): Promise<void> {
    if (!UUID.test(id)) throw AppError.notFound(kind === 'parcel' ? 'Parcel not found' : 'Item not found');
    const table = kind === 'parcel' ? parcel : item;
    const [row] = await this.db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1);
    if (!row) throw AppError.notFound(kind === 'parcel' ? 'Parcel not found' : 'Item not found');
  }

  async suggestionFor(kind: OcrSubjectKind, id: string) {
    this.assertOn();
    await this.assertSubject(kind, id);
    const [row] = await this.db
      .select()
      .from(ocrSuggestion)
      .where(and(eq(ocrSuggestion.subjectKind, kind), eq(ocrSuggestion.subjectId, id)))
      .limit(1);
    if (!row) return { ready: false as const };

    let { fields, confidence } = row;
    const raw = confidence as RawReading;
    if (Array.isArray(raw.lines)) {
      const parsed = parseReading(KIND_OF[kind], readingOf(row.text, raw));
      fields = parsed.fields;
      confidence = parsed.confidence;
      await this.db
        .update(ocrSuggestion)
        .set({ fields, confidence })
        .where(and(eq(ocrSuggestion.id, row.id), sql`${ocrSuggestion.confidence} ? 'lines'`));
    }

    return {
      ready: true as const,
      id: row.id,
      subjectKind: row.subjectKind,
      subjectId: row.subjectId,
      fields,
      confidence,
      text: row.text,
      createdAt: row.createdAt,
      consumedAt: row.consumedAt,
    };
  }

  async confirm(actorId: string, kind: OcrSubjectKind, id: string, saved: OcrConfirmation) {
    this.assertOn();
    await this.assertSubject(kind, id);
    await this.suggestionFor(kind, id);

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(ocrSuggestion)
        .where(and(eq(ocrSuggestion.subjectKind, kind), eq(ocrSuggestion.subjectId, id)))
        .for('update')
        .limit(1);
      if (!row) throw new AppError(ErrorCode.CONFLICT, 'Nothing has been read from the photo yet', 409);
      if (row.consumedAt) throw new AppError(ErrorCode.CONFLICT, 'What was read from this photo has already been saved', 409);

      const changed =
        kind === 'parcel' ? await this.saveParcel(tx, actorId, id, saved) : await this.saveItem(tx, actorId, id, saved);

      await tx
        .update(ocrSuggestion)
        .set({ consumedAt: new Date(), consumedBy: actorId })
        .where(eq(ocrSuggestion.id, row.id));
      return { status: 'saved' as const, changed };
    });
  }

  private async saveParcel(tx: Database, actorId: string, parcelId: string, saved: OcrConfirmation): Promise<string[]> {
    const [row] = await tx.select().from(parcel).where(eq(parcel.id, parcelId)).for('update').limit(1);
    if (!row) throw AppError.notFound('Parcel not found');
    if (row.status === 'processed' || row.status === 'disposed') {
      throw new AppError(ErrorCode.CONFLICT, `The parcel is ${row.status}; its label can no longer be changed`, 409);
    }

    const carrier = clean(saved.carrier, 60);
    const trackingNumber = clean(saved.trackingNumber, 120);
    const senderName = clean(saved.senderName, 120);
    const senderAddress = (saved.senderAddress ?? '')
      .split('\n')
      .map((l) => clean(l, 120))
      .filter(Boolean)
      .slice(0, 4)
      .join(', ');

    const set: Partial<typeof parcel.$inferInsert> = {};
    const changed: string[] = [];
    if (carrier && carrier !== row.carrier) {
      set.carrier = carrier;
      changed.push('carrier');
    }
    if (trackingNumber && trackingNumber !== row.trackingNumber) {
      const [other] = await tx
        .select({ code: parcel.code })
        .from(parcel)
        .where(
          and(
            eq(parcel.trackingNumber, trackingNumber),
            ne(parcel.id, parcelId),
            inArray(parcel.status, [...OPEN_PARCEL_STATUSES]),
          ),
        )
        .limit(1);
      if (other) {
        throw new AppError(ErrorCode.CONFLICT, `Tracking number ${trackingNumber} is already on parcel ${other.code}`, 409);
      }
      set.trackingNumber = trackingNumber;
      changed.push('trackingNumber');
    }
    if (senderName || senderAddress) {
      const sender = `Sender: ${[senderName, senderAddress].filter(Boolean).join(', ')}`;
      if (!(row.notes ?? '').includes(sender)) {
        set.notes = [row.notes?.trim(), sender].filter(Boolean).join('\n').slice(0, 1000);
        changed.push('sender');
      }
    }

    if (changed.length > 0) {
      await tx
        .update(parcel)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(parcel.id, parcelId));
    }
    await tx.insert(parcelEvent).values({
      parcelId,
      eventType: 'label_details_confirmed',
      fromStatus: row.status,
      toStatus: row.status,
      actorId,
      facilityId: row.facilityId,
      metadata: { changed },
    });
    return changed;
  }

  private async saveItem(tx: Database, actorId: string, itemId: string, saved: OcrConfirmation): Promise<string[]> {
    const [current] = await tx.select().from(item).where(eq(item.id, itemId)).for('update').limit(1);
    if (!current) throw AppError.notFound('Item not found');

    const gradingBody = clean(saved.gradingBody, 10).toUpperCase();
    const grade = clean(saved.grade, 10);
    const certNumber = clean(saved.certNumber, 20).replace(/\s+/g, '');
    const year = clean(saved.year, 4);

    if (gradingBody && !isGradingBody(gradingBody)) {
      throw AppError.validation(`The grading body is one of ${GRADING_BODIES.join(', ')}`);
    }
    if (grade && !/^(?:10|[1-9](?:\.5)?)$/.test(grade)) {
      throw AppError.validation('A grade is a number from 1 to 10, in steps of a half');
    }
    if (year && !/^(?:19|20)\d{2}$/.test(year)) throw AppError.validation('The year is four digits');
    if (certNumber && !certificateShapeOk(gradingBody, certNumber)) {
      const shape = certificateShape(gradingBody) ?? '7 to 10 digits';
      throw AppError.validation(`A ${gradingBody || 'grading'} certificate number is ${shape}`, {
        field: 'certNumber',
      });
    }

    const cardNumber = clean(saved.cardNumber, 20);
    const parts = [
      clean(saved.cardName, 120),
      clean(saved.setName, 120),
      cardNumber ? (cardNumber.includes('/') ? cardNumber : `#${cardNumber}`) : '',
      year,
      certNumber ? `${gradingBody ? `${gradingBody} ` : ''}cert ${certNumber}` : '',
    ].filter(Boolean);
    const description = parts.join(' · ');
    const conditionGrade = grade ? [gradingBody, grade].filter(Boolean).join(' ') : '';

    const patches: { field: 'description' | 'conditionGrade'; value: string; old: string | null }[] = [];
    if (description && description !== current.description) {
      patches.push({ field: 'description', value: description, old: current.description });
    }
    if (conditionGrade && conditionGrade !== current.conditionGrade) {
      patches.push({ field: 'conditionGrade', value: conditionGrade, old: current.conditionGrade });
    }
    for (const patch of patches) {
      await tx
        .update(item)
        .set({ [patch.field]: patch.value, updatedAt: new Date() })
        .where(eq(item.id, itemId));
      await tx.insert(itemChangeHistory).values({
        itemId,
        actorId,
        field: patch.field,
        oldValue: patch.old,
        newValue: patch.value,
      });
    }
    return patches.map((p) => p.field);
  }
}
