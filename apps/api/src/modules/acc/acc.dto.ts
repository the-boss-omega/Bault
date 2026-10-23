import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { NAME_PART_MAX, USERNAME_MAX, USERNAME_MIN } from '../../shared/names';

const trimmed = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

// eslint-disable-next-line no-control-regex -- control characters are exactly what this rejects
const NAME_PART_RULE = /^[^<>\u0000-\u001f]+$/;

export class RegisterDto {
  @IsEmail()
  email!: string;

  @trimmed()
  @IsString()
  @MinLength(USERNAME_MIN)
  @MaxLength(USERNAME_MAX)
  @Matches(/^[A-Za-z0-9_.-]+$/, {
    message: 'username may only contain letters, digits, dot, dash and underscore',
  })
  username!: string;

  @trimmed()
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_PART_MAX)
  @Matches(NAME_PART_RULE, { message: 'firstName contains invalid characters' })
  firstName!: string;

  @trimmed()
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_PART_MAX)
  @Matches(NAME_PART_RULE, { message: 'lastName contains invalid characters' })
  lastName!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @trimmed()
  @IsString({ message: 'acceptedTermsVersion is required: accept the terms to create an account' })
  @MinLength(1, { message: 'acceptedTermsVersion is required: accept the terms to create an account' })
  @MaxLength(64)
  acceptedTermsVersion!: string;
}

export class LoginDto {
  @trimmed()
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  identifier!: string;

  @IsString()
  password!: string;
}

export class LoginMfaDto {
  @IsString()
  @MaxLength(128)
  challengeToken!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  recoveryCode?: string;
}

export class MfaCodeDto {
  @IsString()
  @MaxLength(32)
  code!: string;
}

export class ConfirmMfaDto {
  @IsString()
  password!: string;

  @IsString()
  @MaxLength(32)
  code!: string;
}

export class DisableMfaDto {
  @IsString()
  password!: string;

  @IsString()
  @MaxLength(32)
  code!: string;
}

export class TokenDto {
  @IsString()
  token!: string;
}

export class EmailDto {
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}

export class UpdateProfileDto {
  @trimmed()
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_PART_MAX)
  @Matches(NAME_PART_RULE, { message: 'firstName contains invalid characters' })
  firstName!: string;

  @trimmed()
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_PART_MAX)
  @Matches(NAME_PART_RULE, { message: 'lastName contains invalid characters' })
  lastName!: string;
}
