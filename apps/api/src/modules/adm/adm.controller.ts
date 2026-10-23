import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { NAME_PART_MAX } from '../../shared/names';
import { Roles } from '../sec/roles.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { ShelfYieldService } from './shelf-yield.service';
import { AdmService } from './adm.service';
import { OutboxAdminService } from './outbox-admin.service';
import { MfaService } from '../acc/mfa/mfa.service';

class UpdateUserDto {
  @IsOptional() @IsIn(['user', 'warehouse_operator', 'admin']) role?: 'user' | 'warehouse_operator' | 'admin';
  @IsOptional() @IsIn(['pending', 'active', 'suspended', 'closed']) status?: 'pending' | 'active' | 'suspended' | 'closed';
  @IsOptional() @IsString() @MaxLength(NAME_PART_MAX) firstName?: string;
  @IsOptional() @IsString() @MaxLength(NAME_PART_MAX) lastName?: string;
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

@ApiTags('ADM')
@Roles('admin')
@Controller('admin')
export class AdmController {
  constructor(
    private readonly adm: AdmService,
    private readonly yield_: ShelfYieldService,
    private readonly mfa: MfaService,
    private readonly outbox: OutboxAdminService,
  ) {}

  @Get('shelf-yield')
  shelfYield() {
    return this.yield_.byShelf();
  }

  @Get('shelf-yield/zones')
  shelfYieldByZone() {
    return this.yield_.byZone();
  }

  @Get('shelf-yield/customers')
  shelfYieldByCustomer() {
    return this.yield_.byCustomer();
  }

  @Get('logins')
  logins() {
    return this.adm.recentLogins();
  }

  @Get('users')
  users() {
    return this.adm.listUsers();
  }

  @Patch('users/:id')
  updateUser(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.adm.updateUser(actor.id, id, dto);
  }

  @Post('users/:id/mfa/reset')
  @HttpCode(200)
  async resetMfa(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    const { sessionsEnded } = await this.mfa.resetFor(actor.id, id);
    return { status: 'mfa_reset', sessionsEnded };
  }

  @Get('outbox/parked')
  parkedOutbox() {
    return this.outbox.listParked();
  }

  @Post('outbox/:id/requeue')
  @HttpCode(200)
  requeueOutbox(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.outbox.requeue(actor.id, id);
  }

  @Get('items')
  items() {
    return this.adm.listItems();
  }

  @Patch('items/:id')
  updateItem(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateItemDto) {
    return this.adm.updateItem(user.id, id, dto);
  }

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

  @Get('transactions')
  transactions() {
    return this.adm.listTransactions();
  }

  @Get('storage-fee-runs')
  storageFeeRuns() {
    return this.adm.listStorageFeeRuns();
  }
}
