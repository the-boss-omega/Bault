import { useT } from '../../../shared/i18n';

/** The serial, enlarged: the label of a slab, drawn as a plate. The text is in CSS, so the page prints the serial once. */
export function PlateArt({ serial }: { serial: string }) {
  return (
    <div className="lp-art lp-art--plate" aria-hidden="true">
      <div className="lp-plate-art" data-serial={serial}>
        <span className="lp-plate-bars" />
      </div>
    </div>
  );
}

/**
 * Four lines of an append-only register. The last is a correction, and it is a
 * new line under the others: nothing above it moves. The labels are the
 * product's own custody-event names.
 */
export function LedgerArt() {
  const t = useT();
  const rows = [
    { n: '0001', kind: t('timeline.intake'), detail: '' },
    { n: '0002', kind: t('timeline.detail.shelvedIn', { bin: 'BIN-HT39VTZX' }), detail: '' },
    { n: '0003', kind: t('timeline.state_change'), detail: '' },
    { n: '0004', kind: t('timeline.correction'), detail: '' },
  ];
  return (
    <div className="lp-art lp-art--ledger" aria-hidden="true">
      <ol className="lp-ledger">
        {rows.map((row, i) => (
          <li key={row.n} style={{ '--i': i } as React.CSSProperties}>
            <span className="lp-ledger-n">{row.n}</span>
            <span className="lp-ledger-k">{row.kind}</span>
          </li>
        ))}
        <li className="lp-ledger-cursor" style={{ '--i': 4 } as React.CSSProperties}>
          <span className="lp-ledger-n">0005</span>
          <span className="lp-ledger-caret" />
        </li>
      </ol>
    </div>
  );
}

/** A receipt with a clause mark: every line on it points at the rule that priced it. */
export function RuleArt() {
  return (
    <div className="lp-art lp-art--rule" aria-hidden="true">
      <svg viewBox="0 0 200 180" role="presentation" focusable="false">
        <path
          className="draw"
          pathLength="1"
          d="M32 12h136v146l-11.3-8-11.4 8-11.3-8-11.4 8-11.3-8-11.4 8-11.3-8-11.4 8-11.3-8-11.4 8-11.3-8-11.4 8z"
        />
        <path className="draw" pathLength="1" d="M52 44h48M52 64h40M52 84h56M52 104h36" />
        <path className="draw" pathLength="1" d="M128 44h20M128 64h20M128 84h20M128 104h20" />
        <circle className="draw" pathLength="1" cx="100" cy="132" r="14" />
        <text x="100" y="139" textAnchor="middle" className="lp-rule-mark">
          §
        </text>
      </svg>
    </div>
  );
}

/** A pictogram for each way out: a parcel, a hand-off, a booth at a show. */
export function TicketArt({ kind }: { kind: 'carrier' | 'glove' | 'pickup' }) {
  return (
    <svg className="lp-ticket-art" viewBox="0 0 120 100" role="presentation" focusable="false" aria-hidden="true">
      {kind === 'carrier' && (
        <>
          <path className="draw" pathLength="1" d="M60 8 100 28v44L60 92 20 72V28z" />
          <path className="draw" pathLength="1" d="M20 28l40 20 40-20M60 48v44" />
          <path className="draw" pathLength="1" d="M40 18l40 20v14" />
        </>
      )}
      {kind === 'glove' && (
        <>
          <circle className="draw" pathLength="1" cx="44" cy="50" r="30" />
          <circle className="draw" pathLength="1" cx="76" cy="50" r="30" />
          <path className="draw" pathLength="1" d="m60 40 3.5 7 7.5 1-5.5 5.2 1.5 7.6L60 57l-7 3.8 1.5-7.6L49 48l7.5-1z" />
        </>
      )}
      {kind === 'pickup' && (
        <>
          <path className="draw" pathLength="1" d="M18 36h84l-8-16H26z" />
          <path className="draw" pathLength="1" d="M18 36q10.5 11 21 0t21 0 21 0 21 0" />
          <path className="draw" pathLength="1" d="M26 44v40M94 44v40M12 72h96" />
          <path className="draw" pathLength="1" d="M52 72V54h16v18" />
        </>
      )}
    </svg>
  );
}
