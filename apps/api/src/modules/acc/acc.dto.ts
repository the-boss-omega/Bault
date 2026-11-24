import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { NAME_PART_MAX, USERNAME_MAX, USERNAME_MIN } from '../../shared/names';

const trimmed = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

// eslint-disable-next-line no-control-regex -- control characters are exactly what this rejects
const NAME_PART_RULE = /^[^<>\u0000-\u001f]+$/;

const PASSWORD_MAX = 256;

export class RegisterDto {
  @IsEmail()
  email!: string;

  @trimmed()
  @IsString()
  @MinLength(USERNAME_MIN)
  @MaxLength(USERNAME_MAX)
  @Matches(/^[A-Za-z0-9_.-]+$/, {
    message: 'The username may only contain letters, digits, dots, dashes and underscores.',
  })
  username!: string;

  @trimmed()
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_PART_MAX)
  @Matches(NAME_PART_RULE, { message: 'The first name cannot contain < or > or control characters.' })
  firstName!: string;

  @trimmed()
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_PART_MAX)
  @Matches(NAME_PART_RULE, { message: 'The last name cannot contain < or > or control characters.' })
  lastName!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(PASSWORD_MAX, { message: `The password can be at most ${PASSWORD_MAX} characters.` })
  password!: string;

  @trimmed()
  @IsString({ message: 'Accept the terms to create an account.' })
  @MinLength(1, { message: 'Accept the terms to create an account.' })
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

export class ResendCodeDto {
  @IsString()
  @MaxLength(128)
  challengeToken!: string;
}

export class MfaCodeDto {
  @IsString()
  @MaxLength(32)
  code!: string;
}

const MFA_METHODS = ['totp', 'email'] as const;

export class SetupMfaDto {
  @IsOptional()
  @IsIn(MFA_METHODS)
  method?: (typeof MFA_METHODS)[number];
}

export class ConfirmMfaDto {
  @IsOptional()
  @IsIn(MFA_METHODS)
  method?: (typeof MFA_METHODS)[number];

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
  @MaxLength(PASSWORD_MAX, { message: `The new password can be at most ${PASSWORD_MAX} characters.` })
  newPassword!: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(PASSWORD_MAX, { message: `The new password can be at most ${PASSWORD_MAX} characters.` })
  newPassword!: string;
}

export class UpdateProfileDto {
  @trimmed()
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_PART_MAX)
  @Matches(NAME_PART_RULE, { message: 'The first name cannot contain < or > or control characters.' })
  firstName!: string;

  @trimmed()
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_PART_MAX)
  @Matches(NAME_PART_RULE, { message: 'The last name cannot contain < or > or control characters.' })
  lastName!: string;
}
