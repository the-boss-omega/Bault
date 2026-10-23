import { api } from './api';

export interface SessionProfile {
  id: string;
  role: string;
  status: string;
  email: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  nameReviewRequired: boolean;
  mfaEnabled: boolean;
  mfaRequired: boolean;
}

let inFlight: Promise<SessionProfile> | null = null;

export function loadProfile(): Promise<SessionProfile> {
  if (inFlight) return inFlight;

  const pending = api.get<SessionProfile>('/me/profile');
  inFlight = pending;
  void pending
    .finally(() => {
      if (inFlight === pending) inFlight = null;
    })
    .catch(() => undefined);

  return pending;
}

export function resetProfileRequest(): void {
  inFlight = null;
}
