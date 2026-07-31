import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsObject, IsOptional, IsString } from 'class-validator';
import { sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { Roles } from '../sec/roles.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { pricingRule } from './prc.schema';
import { PricingService } from './pricing.service';

class CreateRuleDto {
  @IsString() actionType!: string;
  @IsOptional() @IsString() itemClass?: string;
  @IsString() description!: string;
  @IsIn(['fixed', 'percentage']) model!: 'fixed' | 'percentage';
  @IsInt() value!: number;
  @IsIn(['per_event', 'daily', 'weekly', 'monthly'])
  billingTrigger!: 'per_event' | 'daily' | 'weekly' | 'monthly';
  @IsOptional() @IsObject() parameters?: Record<string, unknown>;
}

/** PRC endpoints: read rules + admin CRUD (PRC-02 / ADM-02). */
@ApiTags('PRC')
@Controller('pricing')
export class PrcController {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly pricing: PricingService,
  ) {}

  @Get('rules')
  list() {
    return this.db.select().from(pricingRule).orderBy(sql`${pricingRule.effectiveFrom} desc`);
  }

  @Roles('admin')
  @Post('rules')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRuleDto) {
    return this.pricing.createRule(user.id, {
      actionType: dto.actionType,
      itemClass: dto.itemClass ?? null,
      description: dto.description,
      model: dto.model,
      value: dto.value,
      billingTrigger: dto.billingTrigger,
      parameters: dto.parameters ?? null,
    });
  }
}
