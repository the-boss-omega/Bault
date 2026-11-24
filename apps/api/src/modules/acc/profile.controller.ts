import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { IdParam } from '../../shared/uuid-param';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '../sec/current-user.decorator';
import { AllowSuspended } from './allow-suspended.decorator';
import { AllowWithoutMfa } from './mfa/allow-without-mfa.decorator';
import type { AuthUser } from '../sec/auth-context';
import { ProfileService } from './profile.service';
import { ChangeEmailDto, UpdateProfileDto } from './acc.dto';
import { EmailChangeService } from './email-change.service';
import { MAIL_ROUTE } from './auth.controller';
import { AuthBucket } from '../../shared/throttle/auth-bucket';
import { IsShippableCountry } from '../shp/country.validator';

class CreateAddressDto {
  @IsString() label!: string;
  @IsString() recipient!: string;
  @IsString() line1!: string;
  @IsOptional() @IsString() line2?: string | null;
  @IsString() city!: string;
  @IsOptional() @IsString() region?: string | null;
  @IsShippableCountry() country!: string;
  @IsString() postalCode!: string;
  @IsOptional() @IsString() phone?: string | null;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

class UpdateAddressDto {
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsString() recipient?: string;
  @IsOptional() @IsString() line1?: string;
  @IsOptional() @IsString() line2?: string | null;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() region?: string | null;
  @IsOptional() @IsShippableCountry() country?: string;
  @IsOptional() @IsString() postalCode?: string;
  @IsOptional() @IsString() phone?: string | null;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

@ApiTags('ACC')
@Controller('me')
export class ProfileController {
  constructor(
    private readonly profiles: ProfileService,
    private readonly emailChange: EmailChangeService,
  ) {}

  @AllowSuspended()
  @AllowWithoutMfa()
  @Get('profile')
  get(@CurrentUser() user: AuthUser) {
    return this.profiles.get(user.id);
  }

  @Patch('profile')
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.profiles.update(user.id, { firstName: dto.firstName, lastName: dto.lastName });
  }

  @AuthBucket(MAIL_ROUTE)
  @Post('email')
  @HttpCode(202)
  async requestEmailChange(@CurrentUser() user: AuthUser, @Body() dto: ChangeEmailDto, @Req() req: Request) {
    const { pendingEmail } = await this.emailChange.request(user.id, dto.email, dto.currentPassword, dto.code, {
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    return { status: 'confirmation_sent', pendingEmail };
  }

  @AuthBucket(MAIL_ROUTE)
  @Post('email/resend')
  @HttpCode(202)
  async resendEmailChange(@CurrentUser() user: AuthUser) {
    const { pendingEmail } = await this.emailChange.resend(user.id);
    return { status: 'confirmation_sent', pendingEmail };
  }

  @Delete('email')
  async cancelEmailChange(@CurrentUser() user: AuthUser) {
    await this.emailChange.cancel(user.id);
    return { status: 'cancelled' };
  }

  @Get('addresses')
  addresses(@CurrentUser() user: AuthUser) {
    return this.profiles.listAddresses(user.id);
  }

  @Post('addresses')
  addAddress(@CurrentUser() user: AuthUser, @Body() dto: CreateAddressDto) {
    return this.profiles.addAddress(user.id, dto);
  }

  @Patch('addresses/:id')
  updateAddress(@CurrentUser() user: AuthUser, @IdParam() id: string, @Body() dto: UpdateAddressDto) {
    return this.profiles.updateAddress(user.id, id, dto);
  }

  @Delete('addresses/:id')
  deleteAddress(@CurrentUser() user: AuthUser, @IdParam() id: string) {
    return this.profiles.deleteAddress(user.id, id);
  }
}
