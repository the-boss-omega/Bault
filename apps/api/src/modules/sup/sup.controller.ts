import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Roles } from '../sec/roles.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import { AllowSuspended } from '../acc/allow-suspended.decorator';
import type { AuthUser } from '../sec/auth-context';
import { SupportService, type TicketCategory } from './support.service';

const CATEGORIES = ['parcel', 'shipment', 'item', 'billing', 'account', 'private_sale', 'other'] as const;

class OpenTicketDto {
  @IsIn(CATEGORIES) category!: TicketCategory;
  @IsString() @MinLength(1) @MaxLength(200) subject!: string;
  @IsString() @MinLength(1) @MaxLength(5000) body!: string;
  @IsOptional() @IsString() @MaxLength(40) relatedType?: string;
  @IsOptional() @IsString() @MaxLength(64) relatedId?: string;
}

class ReplyDto {
  @IsString() @MinLength(1) @MaxLength(5000) body!: string;
}

/**
 * SUP endpoints — the helpdesk.
 *
 * Every collector-facing route carries `@AllowSuspended()`. That is the entire
 * point of the module: an account suspended for debt cannot sign in to any other
 * part of the platform, cannot cash in, and therefore cannot clear the debt that
 * suspended it. Without a channel to ask for help the lock has no key on the
 * inside. These routes are the key, and they are the only ones a suspended
 * holder can reach.
 *
 * Roles are per method rather than on the class, because the queue and the
 * resolve/assign actions are staff work while the rest is ordinary account
 * functionality.
 */
@ApiTags('SUP')
@Controller('support')
export class SupController {
  constructor(private readonly support: SupportService) {}

  /* ---------------- collector ---------------- */

  @AllowSuspended()
  @Get('tickets')
  mine(@CurrentUser() user: AuthUser) {
    return this.support.listMine(user.id);
  }

  @AllowSuspended()
  @Post('tickets')
  open(@Body() dto: OpenTicketDto, @CurrentUser() user: AuthUser) {
    return this.support.open(user.id, dto);
  }

  /** Tickets currently waiting on this collector — the rail badge. */
  @AllowSuspended()
  @Get('awaiting')
  awaiting(@CurrentUser() user: AuthUser) {
    return this.support.awaitingMe(user.id);
  }

  /**
   * One ticket and its whole thread. Staff may open any; a collector only their
   * own, and a miss answers `notFound` rather than `forbidden`.
   */
  @AllowSuspended()
  @Get('tickets/:id')
  thread(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.support.thread(id, { id: user.id, role: user.role });
  }

  /** Reply. The status flips automatically depending on who spoke. */
  @AllowSuspended()
  @Post('tickets/:id/messages')
  reply(@Param('id') id: string, @Body() dto: ReplyDto, @CurrentUser() user: AuthUser) {
    return this.support.reply(id, { id: user.id, role: user.role }, dto.body);
  }

  /* ---------------- staff ---------------- */

  @Roles('warehouse_operator', 'admin')
  @Get('queue')
  queue() {
    return this.support.listQueue();
  }

  @Roles('warehouse_operator', 'admin')
  @Get('queue/count')
  queueCount() {
    return this.support.openCount();
  }

  @Roles('warehouse_operator', 'admin')
  @Post('tickets/:id/assign')
  assign(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.support.assign(id, { id: user.id, role: user.role });
  }

  /** The owner may close their own ticket; the service enforces which is which. */
  @Post('tickets/:id/resolve')
  resolve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.support.resolve(id, { id: user.id, role: user.role });
  }
}
