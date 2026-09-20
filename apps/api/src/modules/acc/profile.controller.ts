import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../sec/current-user.decorator';
import { AllowSuspended } from './allow-suspended.decorator';
import type { AuthUser } from '../sec/auth-context';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './acc.dto';
import { IsShippableCountry } from '../shp/country.validator';

/**
 * `country` is an ISO 3166-1 alpha-2 code that a carrier rule can read, not
 * free text.
 *
 * It was `@IsString()`, and the address form pre-filled it with the word
 * "Israel". Every rule in `carriers.ts` compares this field against a code, so
 * the default value made each new address international-and-uncontracted: the
 * collector lost the cheapest service they qualified for and was told the
 * carrier does not go there. See `shp/countries.ts`.
 */
class CreateAddressDto {
  @IsString() label!: string;
  @IsString() recipient!: string;
  @IsString() line1!: string;
  @IsOptional() @IsString() @MaxLength(120) line2?: string | null;
  @IsString() city!: string;
  @IsOptional() @IsString() @MaxLength(60) region?: string | null;
  @IsShippableCountry() country!: string;
  @IsString() postalCode!: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string | null;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

/** Partial edit of a saved address (Requirement 4.2). */
class UpdateAddressDto {
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsString() recipient?: string;
  @IsOptional() @IsString() line1?: string;
  @IsOptional() @IsString() @MaxLength(120) line2?: string | null;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() @MaxLength(60) region?: string | null;
  @IsOptional() @IsShippableCountry() country?: string;
  @IsOptional() @IsString() postalCode?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string | null;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

/** Own-profile endpoints (T035): `/me/profile` + saved addresses `/me/addresses` (ACC-07). */
@ApiTags('ACC')
@Controller('me')
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  /**
   * Readable by a SUSPENDED account, unlike everything else on this controller.
   *
   * The SPA's boot probe is this request: without it the shell cannot tell a
   * suspended user apart from a signed-out one, and would show them a sign-in
   * form for an account they have just signed into. It carries the status the
   * restricted shell keys off, and nothing a suspended holder should not see.
   */
  @AllowSuspended()
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
