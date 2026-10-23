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

@ApiTags('VLT')
@Controller('vault')
export class VltController {
  constructor(
    private readonly vault: VaultService,
    private readonly breakEven: BreakEvenService,
  ) {}

  @Get('break-even')
  breakEvenWatch(@CurrentUser() user: AuthUser) {
    return this.breakEven.summaryFor(user.id);
  }

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

  @Get('counts')
  counts(@CurrentUser() user: AuthUser, @Query('q') q?: string) {
    return this.vault.counts(user.id, q);
  }

  @Get('items/:itemId')
  card(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string) {
    return this.vault.itemCard(user.id, itemId);
  }

  @Get('items/:itemId/storage')
  storage(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string) {
    return this.vault.storageFor(user.id, itemId);
  }

  @Get('items/:itemId/timeline')
  timeline(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string) {
    return this.vault.timeline(user.id, itemId);
  }
}
