import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { BreakEvenService } from './break-even.service';
import { VaultService, type VaultScope } from './vault.service';

const SCOPES: readonly VaultScope[] = ['active', 'hold', 'history'];

function toScope(value: string | undefined): VaultScope {
  return SCOPES.includes(value as VaultScope) ? (value as VaultScope) : 'active';
}

/** VLT endpoints (T053). A customer's own vault. */
@ApiTags('VLT')
@Controller('vault')
export class VltController {
  constructor(
    private readonly vault: VaultService,
    private readonly breakEven: BreakEvenService,
  ) {}

  /**
   * Break-Even Watch — what each card has cost you, against what one like it
   * actually sold for here.
   *
   * A custodian telling a collector to stop paying it. Honest about its own
   * limits: where Bault has no way to price a card, the row says so and reports
   * the cost alone rather than inventing a comparison to justify advice.
   */
  @Get('break-even')
  breakEvenWatch(@CurrentUser() user: AuthUser) {
    return this.breakEven.summaryFor(user.id);
  }

  /**
   * `scope` selects the vault state the customer is looking at: `active` (the
   * default, live on-shelf stock), `hold` (frozen cards) or `history` (cards they
   * no longer hold). An unrecognised value falls back to `active` rather than
   * erroring, so a stale bookmark still renders a vault.
   */
  @Get('items')
  list(
    @CurrentUser() user: AuthUser,
    @Query('q') q?: string,
    @Query('scope') scope?: string,
    @Query('filter[type]') type?: string,
    @Query('filter[condition]') condition?: string,
  ) {
    return this.vault.listOwned(user.id, { q, type, condition, scope: toScope(scope) });
  }

  /** Per-scope row counts, for the vault's state-control badges. */
  @Get('counts')
  counts(@CurrentUser() user: AuthUser, @Query('q') q?: string) {
    return this.vault.counts(user.id, q);
  }

  @Get('items/:itemId')
  card(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string) {
    return this.vault.itemCard(user.id, itemId);
  }

  /**
   * What storage has cost this item, and when the next charge falls.
   *
   * Separate from the item record because it is derived from the charge history
   * rather than stored on the item, and because the vault grid does not need it —
   * only the drawer, when somebody asks.
   */
  @Get('items/:itemId/storage')
  storage(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string) {
    return this.vault.storageFor(user.id, itemId);
  }

  /** Complete history timeline of one of the caller's own items (Req 13.2). */
  @Get('items/:itemId/timeline')
  timeline(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string) {
    return this.vault.timeline(user.id, itemId);
  }
}
