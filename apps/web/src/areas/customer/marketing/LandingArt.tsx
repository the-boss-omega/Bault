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
    { n: '0002', kind: t('timeline.detail.shelvedIn', { bin: '\u2066BIN-HT39VTZX\u2069' }), detail: '' },
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

/**
 * A printed charge: a line, the rule that priced it, the date the rule took
 * effect, and a clause mark pressed into the corner. No amount is drawn, because
 * the page prices itself from the live rules and a drawn figure could go stale.
 */
export function RuleArt() {
  return (
    <div className="lp-art lp-art--rule" aria-hidden="true">
      <div className="lp-charge">
        <div className="lp-charge-line">
          <i />
          <i />
        </div>
        <div className="lp-charge-line">
          <i />
          <i />
        </div>
        <div className="lp-charge-rule">
          <span>§</span>
          <code>R-2026-10</code>
          <code>2026-01-01</code>
        </div>
        <span className="lp-charge-stamp">§</span>
      </div>
    </div>
  );
}
