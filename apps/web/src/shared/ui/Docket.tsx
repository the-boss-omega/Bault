import type { ReactNode } from 'react';
import { DrawerTag } from './DrawerTag';
import { StatusBadge, type StatusTone } from './primitives';

/** What a bench came to the last time its button was pressed: said on the docket, where the hands are. */
export interface BenchOutcome {
  tone: Extract<StatusTone, 'success' | 'error' | 'warning'>;
  /** The state, in a word or two: "Moved", "Not done". */
  label: string;
  /** What it was about (the serial and the shelf), or why it was refused. */
  detail?: string;
}

/**
 * The job in hand, written on a slip of paper beside the fields that write it: a bench (a warehouse's form that
 * is filled by scanning) shows what has been scanned as it is scanned, what will be done with it and, in the
 * foot, how the last press of the button came out. The foot is a live region, so what a screen reader is told
 * is what a sighted operator reads there; it is not left to a log on another tab.
 */
export function Docket({
  kicker,
  title,
  amount,
  lines,
  outcome,
  note,
  children,
}: {
  /** What the docket is, in a word or two: "Move", "Arrival", "Pick list". */
  kicker: string;
  /** What the job is about, where it is a name or a code. */
  title?: ReactNode;
  /** A figure the job has: how many scanned of how many, what it will cost. */
  amount?: string;
  lines?: { label: ReactNode; value: ReactNode }[];
  outcome?: BenchOutcome | null;
  /** What goes with the job, said under the rule. */
  note?: ReactNode;
  /** What the docket has to show that is neither a figure nor a line. */
  children?: ReactNode;
}) {
  return (
    <aside className="request-slip">
      <DrawerTag
        kicker={kicker}
        title={title}
        amount={amount}
        lines={lines}
        note={note}
        status={
          <span className="docket-outcome" role="status">
            {outcome ? (
              <>
                <StatusBadge tone={outcome.tone}>{outcome.label}</StatusBadge>
                {outcome.detail && (
                  <span className="docket-detail" dir="auto">
                    {outcome.detail}
                  </span>
                )}
              </>
            ) : null}
          </span>
        }
      >
        {children}
      </DrawerTag>
    </aside>
  );
}
