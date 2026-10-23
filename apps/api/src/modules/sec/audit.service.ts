import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { auditRecord } from './audit.schema';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  targetEntity?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async record(entry: AuditEntry, tx?: Database): Promise<void> {
    const exec = tx ?? this.db;
    await exec.insert(auditRecord).values({
      actorId: entry.actorId ?? null,
      action: entry.action,
      targetEntity: entry.targetEntity ?? null,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata ?? {},
    });
  }
}
