import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsString } from 'class-validator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { NotificationService } from './notification.service';

class SetPreferenceDto {
  @IsString() eventType!: string;
  @IsBoolean() enabled!: boolean;
}

/** NOT endpoints — a user's own notification feed + per-event-type opt-outs. */
@ApiTags('NOT')
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.notifications.listMine(user.id);
  }

  @Get('preferences')
  preferences(@CurrentUser() user: AuthUser) {
    return this.notifications.getPreferences(user.id);
  }

  @Put('preferences')
  setPreference(@CurrentUser() user: AuthUser, @Body() dto: SetPreferenceDto) {
    return this.notifications.setPreference(user.id, dto.eventType, dto.enabled);
  }
}
