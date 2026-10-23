import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsString } from 'class-validator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { NotificationService } from './notification.service';
import { NOTIFICATION_CHANNELS } from './event-types';

class SetPreferenceDto {
  @IsString() eventType!: string;
  @IsIn([...NOTIFICATION_CHANNELS]) channel: string = 'in_app';
  @IsBoolean() enabled!: boolean;
}

class SetChannelDto {
  @IsIn([...NOTIFICATION_CHANNELS]) channel!: string;
  @IsBoolean() enabled!: boolean;
}

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
    return this.notifications.setPreference(user.id, dto.eventType, dto.channel, dto.enabled);
  }

  @Put('preferences/channel')
  setChannel(@CurrentUser() user: AuthUser, @Body() dto: SetChannelDto) {
    return this.notifications.setChannel(user.id, dto.channel, dto.enabled);
  }
}
