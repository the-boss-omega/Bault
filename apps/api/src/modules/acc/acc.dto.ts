import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Request DTOs for ACC. Validated globally by ValidationPipe (main.ts). */
export class RegisterDto {
  @IsEmail()
  email!: string;

  /**
   * Chosen once, here, and never changeable afterwards (Requirement 4.1). There is
   * deliberately no `username` field on UpdateProfileDto or any admin patch DTO.
   */
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9_.-]+$/, {
    message: 'username may only contain letters, digits, dot, dash and underscore',
  })
  username!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

export class LoginDto {
  /**
   * Email OR username — either one identifies the account on its own. Usernames
   * cannot contain '@' (see RegisterDto), so the two namespaces never collide.
   */
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  identifier!: string;

  @IsString()
  password!: string;
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

/**
 * Only the display name is editable. `username` is intentionally absent — it is
 * immutable once set at registration (Requirement 4.1).
 */
export class UpdateProfileDto {
  @IsString()
  displayName!: string;
}
