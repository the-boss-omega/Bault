import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { Public } from '../acc/public.decorator';
import { UsageTierService } from './usage-tier.service';

@ApiTags('MEM')
@Controller('tiers')
export class MemController {
  constructor(private readonly tiers: UsageTierService) {}

  @Public()
  @Get()
  rules() {
    return this.tiers.rules();
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.tiers.standing(user.id);
  }
}
