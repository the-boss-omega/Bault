import { useState } from 'react';
import { SignInPage } from './SignInPage';
import { SignUpPage } from './SignUpPage';

export interface SessionUser {
  id: string;
  role: string;
}

/**
 * The signed-out shell. Sign-in and sign-up are two SEPARATE pages — this only
 * decides which one is on screen. There is no router in the SPA, so the choice
 * lives in state, and each page owns its own form and fields.
 */
export function AuthPage({ onSignedIn }: { onSignedIn: (user: SessionUser) => void }) {
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');

  return mode === 'signIn' ? (
    <SignInPage onSignedIn={onSignedIn} onGoToSignUp={() => setMode('signUp')} />
  ) : (
    <SignUpPage onGoToSignIn={() => setMode('signIn')} />
  );
}
