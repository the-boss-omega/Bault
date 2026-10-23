import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { CustodyService } from '../cst/custody.service';
import { item, itemImage } from '../cst/cst.schema';
import { ServiceRequestService } from './service.service';
import { INSPECTION_AREAS, isKnownArea, type InspectionArea } from './grading-tiers';

export interface VideoFulfillment {
  objectKey: string;
  durationSeconds: number;
  itemVerified: boolean;
  notes: string;
}

const VIDEO_REQUIRED: readonly (keyof VideoFulfillment)[] = [
  'objectKey',
  'durationSeconds',
  'itemVerified',
  'notes',
];

export interface AreaFinding {
  area: string;
  severity: string;
  note: string;
}

export interface InspectionFulfillment {
  findings: AreaFinding[];
  itemVerified: boolean;
  notes: string;
}

const SEVERITIES = ['clean', 'minor', 'notable'] as const;

@Injectable()
export class MediaService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly custody: CustodyService,
    private readonly requests: ServiceRequestService,
  ) {}

  private async assertOwnedAndPresent(tx: Database, ownerId: string, itemId: string) {
    const [it] = await tx.select().from(item).where(eq(item.id, itemId)).limit(1);
    if (!it || it.ownerId !== ownerId) throw AppError.forbidden('Not your item');
    if (it.lifecycleState !== 'stored' && it.lifecycleState !== 'listed') {
      throw new AppError(ErrorCode.CONFLICT, `Item must be on the shelf (it is ${it.lifecycleState})`, 409);
    }
    return it;
  }

  async requestVideo(ownerId: string, itemId: string) {
    return this.custody.run(async (tx) => {
      await this.assertOwnedAndPresent(tx, ownerId, itemId);
      return this.requests.create(tx, {
        type: 'video_review',
        requesterId: ownerId,
        itemId,
        feeActionType: 'service_fee:video_review',
      });
    });
  }

  async completeVideo(operatorId: string, requestId: string, form: VideoFulfillment) {
    return this.db.transaction(async (tx) => {
      const req = await this.requests.get(requestId, tx);
      this.requests.assertAccepted(req);
      if (req.type !== 'video_review') throw AppError.validation('Not a video review request');
      if (!req.itemId) throw AppError.validation('Request has no item');

      const [latest] = await tx
        .select({ version: itemImage.version })
        .from(itemImage)
        .where(eq(itemImage.itemId, req.itemId))
        .orderBy(desc(itemImage.version))
        .limit(1);
      const nextVersion = (latest?.version ?? 0) + 1;

      await tx.insert(itemImage).values({
        itemId: req.itemId,
        type: 'video',
        version: nextVersion,
        objectKey: form.objectKey,
      });

      return this.requests.completeWithFulfillment(tx, requestId, operatorId, { ...form }, VIDEO_REQUIRED, {
        objectKey: form.objectKey,
        durationSeconds: form.durationSeconds,
        version: nextVersion,
      });
    });
  }

  async requestInspection(ownerId: string, itemId: string, areas: string[]) {
    const wanted = (areas ?? []).filter((a): a is InspectionArea => isKnownArea(a));
    if (wanted.length === 0) {
      throw AppError.validation(`Choose at least one area: ${INSPECTION_AREAS.join(', ')}`);
    }
    return this.custody.run(async (tx) => {
      await this.assertOwnedAndPresent(tx, ownerId, itemId);
      return this.requests.create(tx, {
        type: 'condition_inspection',
        requesterId: ownerId,
        itemId,
        feeActionType: 'service_fee:condition_inspection',
        typeFields: { areas: wanted },
      });
    });
  }

  async completeInspection(operatorId: string, requestId: string, form: InspectionFulfillment) {
    return this.db.transaction(async (tx) => {
      const req = await this.requests.get(requestId, tx);
      this.requests.assertAccepted(req);
      if (req.type !== 'condition_inspection') throw AppError.validation('Not an inspection request');

      const asked = (((req.typeFields as Record<string, unknown>)?.areas as string[]) ?? []).slice();
      const findings = form.findings ?? [];

      for (const f of findings) {
        if (!isKnownArea(f.area)) throw AppError.validation(`Unknown area "${f.area}"`);
        if (!(SEVERITIES as readonly string[]).includes(f.severity)) {
          throw AppError.validation(`Severity must be one of: ${SEVERITIES.join(', ')}`);
        }
        if (!f.note?.trim()) throw AppError.validation(`Say what you saw on the ${f.area}`);
      }
      const answered = new Set(findings.map((f) => f.area));
      const missing = asked.filter((a) => !answered.has(a));
      if (missing.length > 0) {
        throw AppError.validation(`No finding recorded for: ${missing.join(', ')}`, { missing });
      }
      if (!form.itemVerified) throw AppError.validation('Verify the item');
      if (!form.notes?.trim()) throw AppError.validation('Notes are required');

      return this.requests.completeWithFulfillment(
        tx,
        requestId,
        operatorId,
        { ...form, findings: JSON.stringify(findings) },
        ['itemVerified', 'notes'],
        { findings },
      );
    });
  }
}
