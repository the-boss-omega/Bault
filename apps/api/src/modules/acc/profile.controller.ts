import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '../sec/current-user.decorator';
import { AllowSuspended } from './allow-suspended.decorator';
import { AllowWithoutMfa } from './mfa/allow-without-mfa.decorator';
import type { AuthUser } from '../sec/auth-context';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './acc.dto';
import { IsShippableCountry } from '../shp/country.validator';

/**
 * `country` is an ISO 3166-1 alpha-2 code that a carrier rule can read, not
 * free text: every rule in `carriers.ts` compares this field against a code.
 * See `shp/countries.ts`.
 */
class CreateAddressDto {
  @IsString() label!: string;
  @IsString() recipient!: string;
  @IsString() line1!: string;
  @IsString() city!: string;
  @IsShippableCountry() country!: string;
  @IsString() postalCode!: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

/** Partial edit of a saved address. */
class UpdateAddressDto {
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsString() recipient?: string;
  @IsOptional() @IsString() line1?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsShippableCountry() country?: string;
  @IsOptional() @IsString() postalCode?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

/** Own-profile endpoints: `/me/profile` + saved addresses `/me/addresses`. */
@ApiTags('ACC')
@Controller('me')
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  /**
   * Readable by a SUSPENDED account, unlike everything else on this controller.
   *
   * The SPA's boot probe is this request: without it the shell cannot tell a
   * suspended user apart from a signed-out one. It carries the status the
   * restricted shell keys off, and nothing a suspended holder should not see.
   *
   * Readable before a required second factor is enrolled, for the same reason:
   * it is how the shell learns that the person in front of it must enrol.
   */
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

  @Get('addresses')
  addresses(@CurrentUser() user: AuthUser) {
    return this.profiles.listAddresses(user.id);
  }

  @Post('addresses')
  addAddress(@CurrentUser() user: AuthUser, @Body() dto: CreateAddressDto) {
    return this.profiles.addAddress(user.id, dto);
  }

  @Patch('addresses/:id')
  updateAddress(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateAddressDto) {
    return this.profiles.updateAddress(user.id, id, dto);
  }

  @Delete('addresses/:id')
  deleteAddress(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.profiles.deleteAddress(user.id, id);
  }
}
