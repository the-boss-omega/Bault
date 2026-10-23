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

@ApiTags('SUP')
@Controller('support')
export class SupController {
  constructor(private readonly support: SupportService) {}

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

  @AllowSuspended()
  @Get('awaiting')
  awaiting(@CurrentUser() user: AuthUser) {
    return this.support.awaitingMe(user.id);
  }

  @AllowSuspended()
  @Get('tickets/:id')
  thread(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.support.thread(id, { id: user.id, role: user.role, status: user.status });
  }

  @AllowSuspended()
  @Post('tickets/:id/messages')
  reply(@Param('id') id: string, @Body() dto: ReplyDto, @CurrentUser() user: AuthUser) {
    return this.support.reply(id, { id: user.id, role: user.role, status: user.status }, dto.body);
  }

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
    return this.support.assign(id, { id: user.id, role: user.role, status: user.status });
  }

  @Roles('warehouse_operator', 'admin')
  @Post('tickets/:id/resolve')
  resolve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.support.resolve(id, { id: user.id, role: user.role, status: user.status });
  }
}
