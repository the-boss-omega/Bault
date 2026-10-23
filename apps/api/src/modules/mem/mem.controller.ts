import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { Public } from '../acc/public.decorator';
import { MembershipService } from './membership.service';
import { TIER_KEYS } from './tiers';

class SubscribeDto {
  @IsString()
  @IsIn([...TIER_KEYS])
  tier!: string;
}

@ApiTags('MEM')
@Controller('membership')
export class MemController {
  constructor(private readonly memberships: MembershipService) {}

  @Public()
  @Get('tiers')
  tiers() {
    return this.memberships.catalogue();
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return { membership: await this.memberships.allowances(user.id) };
  }

  @Post('subscribe')
  subscribe(@CurrentUser() user: AuthUser, @Body() dto: SubscribeDto) {
    return this.memberships.subscribe(user.id, dto.tier);
  }

  @Post('cancel')
  cancel(@CurrentUser() user: AuthUser) {
    return this.memberships.cancel(user.id);
  }
}
