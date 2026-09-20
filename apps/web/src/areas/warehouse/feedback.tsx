import { useCallback, useState } from 'react';
import { ErrorState, SuccessNote } from '../../shared/ui/primitives';

/**
 * What the last action on a panel did, said next to the button that did it.
 *
 * The console's panels reported only to the activity log, which the Inventory,
 * Shipments and Locations tabs do not render and which sits at the foot of the
 * Receiving tab — a relocate succeeded and its fields silently cleared, and a
 * refusal was nowhere the operator was looking. Each panel keeps its own note
 * now; the log still gets the line, as the shift's running record.
 */
export interface Note {
  ok: boolean;
  text: string;
}

export function useNote() {
  const [note, setNote] = useState<Note | null>(null);
  const ok = useCallback((text: string) => setNote({ ok: true, text }), []);
  const fail = useCallback((text: string) => setNote({ ok: false, text }), []);
  const clear = useCallback(() => setNote(null), []);
  return { note, ok, fail, clear };
}

export function NoteLine({ note }: { note: Note | null }) {
  if (!note) return null;
  return note.ok ? <SuccessNote>{note.text}</SuccessNote> : <ErrorState message={note.text} />;
}
