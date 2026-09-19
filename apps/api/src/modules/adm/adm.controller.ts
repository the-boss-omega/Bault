import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { NAME_PART_MAX } from '../../shared/names';
import { Roles } from '../sec/roles.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { ShelfYieldService } from './shelf-yield.service';
import { AdmService } from './adm.service';

class UpdateUserDto {
  @IsOptional() @IsIn(['user', 'warehouse_operator', 'admin']) role?: 'user' | 'warehouse_operator' | 'admin';
  @IsOptional() @IsIn(['pending', 'active', 'suspended', 'closed']) status?: 'pending' | 'active' | 'suspended' | 'closed';
  // Two name parts, never a free-text display name (see shared/names).
  @IsOptional() @IsString() @MaxLength(NAME_PART_MAX) firstName?: string;
  @IsOptional() @IsString() @MaxLength(NAME_PART_MAX) lastName?: string;
  // `username` is deliberately absent — immutable once set (Requirement 4.1).
}

class UpdateItemDto {
  @IsOptional() @IsString() typeClass?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() conditionGrade?: string;
  @IsOptional() @IsString() ownerId?: string;
  @IsOptional() @IsString() binId?: string;
  @IsOptional() @IsIn(['received', 'stored', 'listed', 'on-hold', 'sold', 'shipped', 'donated', 'consigned'])
  lifecycleState?: 'received' | 'stored' | 'listed' | 'on-hold' | 'sold' | 'shipped' | 'donated' | 'consigned';
  @IsOptional() @IsBoolean() holdFlag?: boolean;
}

class OpenDisputeDto {
  @IsString() transactionId!: string;
  @IsOptional() @IsString() note?: string;
}

class UpdateDisputeDto {
  @IsIn(['open', 'investigating', 'ruled', 'closed'])
  status!: 'open' | 'investigating' | 'ruled' | 'closed';
  @IsOptional() @IsString() ruling?: string;
}

/** ADM endpoints — admin only. Manage users, cards, disputes, storage fees. */
@ApiTags('ADM')
@Roles('admin')
@Controller('admin')
export class AdmController {
  constructor(
    private readonly adm: AdmService,
    private readonly yield_: ShelfYieldService,
  ) {}

  /**
   * Shelf Yield — what each shelf earns against the occupancy it consumes.
   *
   * Admin-only, and pointed at the operator rather than the collector: the same
   * charges and the same custody trail that produce Break-Even Watch, rolled up
   * by shelf instead of by card. REVENUE per shelf-month, never margin — Bault's
   * rent, labour and insurance are not in this database, and a profit figure
   * computed without them would be a confident number about something nobody
   * measured.
   */
  @Get('shelf-yield')
  shelfYield() {
    return this.yield_.byShelf();
  }

  /** The same, per zone — which part of the building earns, and where to build. */
  @Get('shelf-yield/zones')
  shelfYieldByZone() {
    return this.yield_.byZone();
  }

  /** Which accounts pay for the shelving they occupy, and which are carried. */
  @Get('shelf-yield/customers')
  shelfYieldByCustomer() {
    return this.yield_.byCustomer();
  }

  /** Sign-in attempts, successful and failed, with where they came from. */
  @Get('logins')
  logins() {
    return this.adm.recentLogins();
  }

  @Get('users')
  users() {
    return this.adm.listUsers();
  }

  /**
   * The caller's own id travels with the patch, because one of the edits an
   * administrator can make is to the administrator making it.
   */
  @Patch('users/:id')
  updateUser(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.adm.updateUser(actor.id, id, dto);
  }

  @Get('items')
  items() {
    return this.adm.listItems();
  }

  @Patch('items/:id')
  updateItem(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateItemDto) {
    return this.adm.updateItem(user.id, id, dto);
  }

  // --- Disputes (ADM-04) ---

  @Get('disputes')
  disputes() {
    return this.adm.listDisputes();
  }

  @Post('disputes')
  openDispute(@CurrentUser() user: AuthUser, @Body() dto: OpenDisputeDto) {
    return this.adm.openDispute(user.id, { transactionId: dto.transactionId, note: dto.note });
  }

  @Patch('disputes/:id')
  updateDispute(@Param('id') id: string, @Body() dto: UpdateDisputeDto) {
    return this.adm.updateDispute(id, { status: dto.status, ruling: dto.ruling });
  }

  /** Recorded transactions available to reference from a dispute (Requirement 13.3). */
  @Get('transactions')
  transactions() {
    return this.adm.listTransactions();
  }

  // --- Storage-fee runs (VLT-04) — read-only; billing is automatic (Req 12.2) ---

  @Get('storage-fee-runs')
  storageFeeRuns() {
    return this.adm.listStorageFeeRuns();
  }
}
