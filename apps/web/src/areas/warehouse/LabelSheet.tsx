import { useId, useState } from 'react';
import { useI18n } from '../../shared/i18n';
import { DetailDrawer } from '../../shared/ui/DetailDrawer';
import { Button, ButtonLink } from '../../shared/ui/primitives';
import { Code } from '../../shared/ui/Serial';
import { IconPrint } from '../../shared/ui/icons';

export type LabelTargets =
  | { kind: 'items'; items: readonly { id: string; code: string }[] }
  | { kind: 'parcel'; id: string; code: string };

export const LABEL_SIZE = { widthMm: 50, heightMm: 25, dpi: 203 } as const;
export const LABELS_PER_PDF = 100;

const VIEW_AT_100 = '#zoom=100';

export function labelPdfUrls(targets: LabelTargets): string[] {
  if (targets.kind === 'parcel') {
    return [`/api/v1/parcels/${encodeURIComponent(targets.id)}/label.pdf${VIEW_AT_100}`];
  }
  const ids = targets.items.map((i) => i.id);
  if (ids.length === 1) {
    return [`/api/v1/custody/items/${encodeURIComponent(ids[0]!)}/label.pdf${VIEW_AT_100}`];
  }
  const urls: string[] = [];
  for (let i = 0; i < ids.length; i += LABELS_PER_PDF) {
    const chunk = ids.slice(i, i + LABELS_PER_PDF);
    urls.push(`/api/v1/custody/labels.pdf?ids=${chunk.map(encodeURIComponent).join(',')}${VIEW_AT_100}`);
  }
  return urls;
}

const codesOf = (targets: LabelTargets) =>
  targets.kind === 'parcel' ? [targets.code] : targets.items.map((i) => i.code);

export function LabelSheet({
  targets,
  showCodes = true,
}: {
  targets: LabelTargets;
  showCodes?: boolean;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const urls = labelPdfUrls(targets);
  const codes = codesOf(targets);
  if (urls.length === 0) return null;

  return (
    <section className="label-sheet stack stack--tight" aria-labelledby={titleId}>
      <div className="row">
        <div>
          <h3 className="panel-title" id={titleId} style={{ fontSize: 15 }}>
            {t('labels.sheet.title', { count: codes.length })}
          </h3>
          <p className="hint">{t('labels.sheet.size')}</p>
        </div>
        <span className="spacer" />
        {urls.map((url, part) => (
          <ButtonLink
            key={url}
            variant="primary"
            icon={<IconPrint />}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {urls.length === 1
              ? t('labels.sheet.open', { count: codes.length })
              : t('labels.sheet.openPart', {
                  from: part * LABELS_PER_PDF + 1,
                  to: Math.min((part + 1) * LABELS_PER_PDF, codes.length),
                })}
          </ButtonLink>
        ))}
      </div>

      {showCodes && (
        <ul className="label-sheet-codes">
          {codes.map((c) => (
            <li key={c}>
              <Code value={c} />
            </li>
          ))}
        </ul>
      )}

      <details className="stack stack--tight">
        <summary className="field-label">{t('warehouse.labels.printerHelp')}</summary>
        <h4 className="field-label">{t('labels.sheet.settings')}</h4>
        <ol className="label-sheet-steps hint">
          <li>{t('labels.sheet.step.size')}</li>
          <li>{t('labels.sheet.step.scale')}</li>
          <li>{t('labels.sheet.step.margins')}</li>
          <li>{t('labels.sheet.step.pages')}</li>
        </ol>
        <h4 className="field-label">{t('labels.sheet.printers')}</h4>
        <dl className="label-sheet-printers hint">
          <dt>{t('labels.sheet.printer.zebra')}</dt>
          <dd>{t('labels.sheet.printer.zebraHow')}</dd>
          <dt>{t('labels.sheet.printer.rollo')}</dt>
          <dd>{t('labels.sheet.printer.rolloHow')}</dd>
          <dt>{t('labels.sheet.printer.brother')}</dt>
          <dd>{t('labels.sheet.printer.brotherHow')}</dd>
          <dt>{t('labels.sheet.printer.browser')}</dt>
          <dd>{t('labels.sheet.printer.browserHow')}</dd>
        </dl>
      </details>
    </section>
  );
}

export function LabelSheetButton({
  targets,
  size = 'sm',
  variant = 'ghost',
}: {
  targets: LabelTargets;
  size?: 'sm' | 'md';
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const codes = codesOf(targets);
  if (codes.length === 0) return null;
  const label =
    codes.length === 1
      ? t('labels.sheet.printOne', { code: codes[0]! })
      : t('labels.sheet.open', { count: codes.length });

  return (
    <>
      <Button
        size={size}
        variant={variant}
        icon={<IconPrint />}
        aria-label={label}
        title={label}
        onClick={() => setOpen(true)}
      >
        {t('labels.sheet.print')}
      </Button>
      {open && (
        <DetailDrawer title={t('labels.sheet.drawerTitle')} onClose={() => setOpen(false)}>
          <LabelSheet targets={targets} />
        </DetailDrawer>
      )}
    </>
  );
}
