import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { ProfileController } from './profile.controller';
import { AuthService } from './auth.service';
import { VerificationService } from './verification.service';
import { PasswordService } from './password.service';
import { ProfileService } from './profile.service';
import { SessionService } from './session.service';
import { SessionAuthGuard } from './session-auth.guard';

/**
 * ACC module (identity & auth). Exports SessionService + SessionAuthGuard so the
 * global auth guard (registered in AppModule) can resolve sessions.
 */
@Module({
  controllers: [AuthController, ProfileController],
  providers: [
    AuthService,
    VerificationService,
    PasswordService,
    ProfileService,
    SessionService,
    SessionAuthGuard,
  ],
  exports: [SessionService, SessionAuthGuard],
})
export class AccModule {}
