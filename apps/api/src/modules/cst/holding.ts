export interface OwnershipEvent {
  prevOwnerId: string | null;
  newOwnerId: string | null;
  occurredAt: Date | string;
}

export interface HoldingWindow {
  from: number;
  to: number;
}

function millis(at: Date | string): number {
  return at instanceof Date ? at.getTime() : new Date(at).getTime();
}

export function holdingWindows(events: readonly OwnershipEvent[], userId: string): HoldingWindow[] {
  const ordered = [...events].sort((a, b) => millis(a.occurredAt) - millis(b.occurredAt));
  const windows: HoldingWindow[] = [];
  let openedAt: number | null = null;
  for (const e of ordered) {
    const at = millis(e.occurredAt);
    const gains = e.newOwnerId === userId && e.prevOwnerId !== userId;
    const loses = e.prevOwnerId === userId && e.newOwnerId !== userId;
    if (gains && openedAt === null) openedAt = at;
    if (loses && openedAt !== null) {
      windows.push({ from: openedAt, to: at });
      openedAt = null;
    }
  }
  if (openedAt !== null) windows.push({ from: openedAt, to: Number.POSITIVE_INFINITY });
  return windows;
}

export function heldAt(windows: readonly HoldingWindow[], at: Date | string): boolean {
  const t = millis(at);
  return windows.some((w) => t >= w.from && t <= w.to);
}
