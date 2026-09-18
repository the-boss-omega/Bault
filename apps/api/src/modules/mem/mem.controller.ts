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

/** MEM endpoints: the public tier catalogue, and one member's own state. */
@ApiTags('MEM')
@Controller('membership')
export class MemController {
  constructor(private readonly memberships: MembershipService) {}

  /**
   * The tiers and what they cover.
   *
   * Public, for the same reason `GET /pricing/list` is: somebody deciding
   * whether to subscribe has to be able to read the terms before they have an
   * account. A membership page that requires an account to read is a page for
   * people who have already decided.
   */
  @Public()
  @Get('tiers')
  tiers() {
    return this.memberships.catalogue();
  }

  /** This account's tier and what is left of it this cycle. Null for non-members. */
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
