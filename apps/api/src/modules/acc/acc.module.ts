import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { ProfileController } from './profile.controller';
import { AuthService } from './auth.service';
import { VerificationService } from './verification.service';
import { PasswordService } from './password.service';
import { ProfileService } from './profile.service';
import { SessionService } from './session.service';
import { SessionAuthGuard } from './session-auth.guard';
import { LoginAttemptService } from './login-attempts.service';
import { MfaController } from './mfa/mfa.controller';
import { MfaService } from './mfa/mfa.service';
import { MfaEnrollmentGuard } from './mfa/mfa-enrollment.guard';
import { MFA_POLICY, mfaPolicyProvider } from './mfa/mfa-policy';

/**
 * ACC module (identity & auth). Exports SessionService + SessionAuthGuard so the
 * global auth guard (registered in AppModule) can resolve sessions, and the
 * two-factor pieces the rest of the application needs: the enrolment guard and
 * its policy (also global, in AppModule), and `MfaService` for the
 * administrator's reset.
 */
@Module({
  controllers: [AuthController, ProfileController, MfaController],
  providers: [
    AuthService,
    VerificationService,
    PasswordService,
    ProfileService,
    SessionService,
    SessionAuthGuard,
    LoginAttemptService,
    MfaService,
    MfaEnrollmentGuard,
    mfaPolicyProvider,
  ],
  exports: [SessionService, SessionAuthGuard, MfaService, MfaEnrollmentGuard, MFA_POLICY],
})
export class AccModule {}
