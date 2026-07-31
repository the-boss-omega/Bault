import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { Roles } from '../sec/roles.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { AdmService } from './adm.service';

class UpdateUserDto {
  @IsOptional() @IsIn(['user', 'warehouse_operator', 'admin']) role?: 'user' | 'warehouse_operator' | 'admin';
  @IsOptional() @IsIn(['pending', 'active', 'suspended', 'closed']) status?: 'pending' | 'active' | 'suspended' | 'closed';
  @IsOptional() @IsString() displayName?: string;
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
  constructor(private readonly adm: AdmService) {}

  @Get('users')
  users() {
    return this.adm.listUsers();
  }

  @Patch('users/:id')
  updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.adm.updateUser(id, dto);
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
