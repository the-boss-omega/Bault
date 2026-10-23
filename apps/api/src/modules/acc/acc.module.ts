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
