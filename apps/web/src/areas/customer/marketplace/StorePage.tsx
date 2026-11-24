import { useState } from 'react';
import { ErrorState, SuccessNote } from '../../../shared/ui/primitives';
import { HouseStorePanel } from './HouseStorePanel';

export function StorePage() {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      {status && <SuccessNote>{status}</SuccessNote>}
      {error && <ErrorState message={error} />}
      <HouseStorePanel onBought={setStatus} onError={setError} />
    </>
  );
}
