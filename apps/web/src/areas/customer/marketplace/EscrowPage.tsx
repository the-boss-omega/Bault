import { useEffect, useState } from 'react';
import { loadProfile } from '../../../shared/session';
import { EscrowTab } from './EscrowTab';

export function EscrowPage() {
  const [meId, setMeId] = useState<string | null>(null);

  useEffect(() => {
    void loadProfile()
      .then((p) => setMeId(p.id))
      .catch(() => undefined);
  }, []);

  return <EscrowTab meId={meId} />;
}
