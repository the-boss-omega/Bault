import { Injectable } from '@nestjs/common';
import { CustodyService } from './custody.service';

/**
 * Relocate + hold operations (T047). Thin transactional orchestration over the
 * custody kernel — each call is one atomic commit (change + custody event).
 */
@Injectable()
export class RelocateService {
  constructor(private readonly custody: CustodyService) {}

  relocate(itemId: string, binId: string, actorId: string): Promise<void> {
    return this.custody.run((tx) => this.custody.relocate(tx, itemId, binId, actorId));
  }

  placeHold(itemId: string, actorId: string): Promise<void> {
    return this.custody.run((tx) => this.custody.setHold(tx, itemId, true, actorId));
  }

  releaseHold(itemId: string, actorId: string): Promise<void> {
    return this.custody.run((tx) => this.custody.setHold(tx, itemId, false, actorId));
  }
}
