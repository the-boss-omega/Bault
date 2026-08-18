import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';
import { Roles } from '../sec/roles.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { EscrowService } from './escrow.service';

class RaiseDealDto {
  /** Which side the person raising it is on. */
  @IsIn(['buyer', 'seller']) raiserRole!: 'buyer' | 'seller';
  /** The other side, when they hold a Bault account. */
  @IsOptional() @IsString() counterpartyUsername?: string;
  /** The other side when they do not. Both are needed together. */
  @IsOptional() @IsString() @MaxLength(140) counterpartyName?: string;
  @IsOptional() @IsString() @MaxLength(200) counterpartyEmail?: string;
  @IsString() @IsNotEmpty() @MaxLength(500) description!: string;
  @IsInt() @IsPositive() valueMinor!: number;
  @IsIn(['buyer_vault', 'ship_to_buyer']) settlement!: 'buyer_vault' | 'ship_to_buyer';
}

class NotesDto {
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class FundDto {
  /** Required only when the money arrived off-platform. */
  @IsOptional() @IsString() @MaxLength(140) reference?: string;
}

class ReceiveItemDto {
  @IsString() itemId!: string;
}

class InspectDto {
  /** The whole question: is it what it was said to be. */
  @IsBoolean() matches!: boolean;
  @IsString() @IsNotEmpty() @MaxLength(2000) notes!: string;
}

class ReleaseDto {
  /** Only when an operator records an external party's confirmation. */
  @IsOptional() @IsIn(['buyer', 'seller']) side?: 'buyer' | 'seller';
}

class ReasonDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

/**
 * ESC endpoints (`/escrow/*`) — a private deal with Bault in the middle.
 *
 * The operator routes are the ones that matter for correctness: receiving the
 * card, recording the inspection, and attesting on behalf of a party who has no
 * account and therefore cannot click anything. Each is role-gated, and each
 * writes to the append-only trail with the operator's own id, so a second-hand
 * confirmation is always visibly second-hand.
 */
@ApiTags('ESC')
@Controller('escrow')
export class EscController {
  constructor(private readonly escrow: EscrowService) {}

  /** What it costs, and the floor under a deal. Read before committing. */
  @Get('terms')
  terms() {
    return this.escrow.terms();
  }

  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.escrow.listMine(user.id);
  }

  /** What this person has locked up in open deals, and which deals. */
  @Get('held')
  held(@CurrentUser() user: AuthUser) {
    return this.escrow.heldFor(user.id);
  }

  @Roles('warehouse_operator', 'admin')
  @Get('queue')
  queue() {
    return this.escrow.queue();
  }

  @Post()
  raise(@CurrentUser() user: AuthUser, @Body() dto: RaiseDealDto) {
    return this.escrow.raise(user.id, dto);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.escrow.detail(id, user);
  }

  @Post(':id/agree')
  agree(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: NotesDto) {
    return this.escrow.agree(id, user, dto.notes);
  }

  /** Hold the money. A wallet debit, or an operator attesting to receipt. */
  @Post(':id/fund')
  fund(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: FundDto) {
    return this.escrow.fund(id, user, dto.reference);
  }

  @Roles('warehouse_operator', 'admin')
  @Post(':id/receive-item')
  receiveItem(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReceiveItemDto) {
    return this.escrow.receiveItem(id, user.id, dto.itemId);
  }

  /** The gate. Written down before either side is asked to release. */
  @Roles('warehouse_operator', 'admin')
  @Post(':id/inspect')
  inspect(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: InspectDto) {
    return this.escrow.inspect(id, user.id, dto);
  }

  @Post(':id/release')
  release(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReleaseDto) {
    return this.escrow.release(id, user, dto.side);
  }

  @Post(':id/return')
  returnDeal(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.escrow.returnDeal(id, user, dto.reason);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.escrow.cancel(id, user, dto.reason);
  }
}
