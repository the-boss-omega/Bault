import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { VaultService } from './vault.service';

/** VLT endpoints (T053). A customer's own vault. */
@ApiTags('VLT')
@Controller('vault')
export class VltController {
  constructor(private readonly vault: VaultService) {}

  @Get('items')
  list(
    @CurrentUser() user: AuthUser,
    @Query('q') q?: string,
    @Query('filter[type]') type?: string,
    @Query('filter[condition]') condition?: string,
  ) {
    return this.vault.listOwned(user.id, { q, type, condition });
  }

  @Get('items/:itemId')
  card(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string) {
    return this.vault.itemCard(user.id, itemId);
  }

  /** Complete history timeline of one of the caller's own items (Req 13.2). */
  @Get('items/:itemId/timeline')
  timeline(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string) {
    return this.vault.timeline(user.id, itemId);
  }
}
