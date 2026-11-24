import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { pageLimit } from '../../shared/query';
import { VAULT_PAGE_MAX, VaultService, type VaultScope } from './vault.service';

const SCOPES: readonly VaultScope[] = ['active', 'hold', 'history'];

function toScope(value: string | undefined): VaultScope {
  return SCOPES.includes(value as VaultScope) ? (value as VaultScope) : 'active';
}

@ApiTags('VLT')
@Controller('vault')
export class VltController {
  constructor(private readonly vault: VaultService) {}

  @Get('items')
  list(
    @CurrentUser() user: AuthUser,
    @Query('q') q?: string,
    @Query('scope') scope?: string,
    @Query('filter[type]') type?: string,
    @Query('filter[condition]') condition?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.vault.listOwned(user.id, {
      q,
      type,
      condition,
      scope: toScope(scope),
      limit: pageLimit(limit, { max: VAULT_PAGE_MAX, fallback: 50 }),
      cursor: cursor === undefined || cursor === '' ? undefined : cursor,
    });
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
