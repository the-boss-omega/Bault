import { useRef, useState } from 'react';
import { useT } from './i18n';
import { IconClose } from './ui/icons';
import { inBody } from './ui/inBody';
import { slabLeave, slabMove } from './ui/slabTilt';
import { useExit } from './ui/useExit';
import { useOverlay } from './ui/useOverlay';

/**
 * Where a photograph is looked for, in order. The first is a 640 px WebP made by
 * scripts/make-photo-derivatives.mjs (a tenth of the size of the original); the
 * others are the original, so a photograph with no derivative still shows.
 */
const PHOTO_SOURCES = [
  (serial: string) => `/images/w640/${serial}.webp`,
  (serial: string) => `/images/${serial}.png`,
  (serial: string) => `/images/${serial}.jpg`,
] as const;

const FULL_SOURCES = PHOTO_SOURCES.slice(1);

export function cardPhotoUrl(serialNumber: string, attempt = 0, full = false): string {
  const sources = full ? FULL_SOURCES : PHOTO_SOURCES;
  const make = sources[Math.min(attempt, sources.length - 1)] ?? PHOTO_SOURCES[1];
  return make(encodeURIComponent(serialNumber));
}

/**
 * Which source each photograph settled on, kept for the life of the page. A
 * serial with no photograph walks the whole list once and is then remembered as
 * missing, instead of walking it again (three failed requests) every time a card
 * for it is drawn.
 */
const settled = new Map<string, number>();

function useCardPhotoSource(serialNumber: string, full = false) {
  const key = `${full ? 'full' : 'thumb'}:${serialNumber}`;
  const [attempt, setAttempt] = useState(() => settled.get(key) ?? 0);
  const [forKey, setForKey] = useState(key);
  if (forKey !== key) {
    // The same card component was handed another serial: start that one afresh.
    setForKey(key);
    setAttempt(settled.get(key) ?? 0);
  }
  // No name, no photograph: nothing is asked for (a card with none was asked for at ".webp", ".png" and ".jpg").
  const exhausted = !serialNumber || attempt >= (full ? FULL_SOURCES : PHOTO_SOURCES).length;
  return {
    src: cardPhotoUrl(serialNumber, attempt, full),
    exhausted,
    onLoad: () => settled.set(key, attempt),
    onError: () => {
      settled.set(key, attempt + 1);
      setAttempt((a) => a + 1);
    },
  };
}

export function CardPhotoButton({ serialNumber, title }: { serialNumber: string; title: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="photo-btn"
        title={t('photo.show')}
        aria-label={t('photo.showOf', { title })}
        onClick={() => setOpen(true)}
      >
        📷
      </button>
      {open && (
        <CardPhotoModal serialNumber={serialNumber} title={title} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

/**
 * The card in its case: a graded-slab frame with a label band, set on the
 * photography mat. The band's text is drawn from data attributes in CSS, so the
 * serial appears once in the document (where the caller prints it), not twice.
 */
/** The label carries the name up to the first " · " (year, set, card), not the whole catalogue line. */
function labelTitle(title: string): string {
  return title.split(' · ')[0] ?? title;
}

function SlabFace({
  serialNumber,
  title,
  photo,
  noneLabel,
  labelSerial,
  priority,
}: {
  serialNumber: string;
  title: string;
  photo: ReturnType<typeof useCardPhotoSource>;
  noneLabel: string;
  labelSerial?: string;
  priority?: boolean;
}) {
  return (
    <span className="slab-case">
      <span
        className="slab-band"
        aria-hidden="true"
        data-serial={labelSerial ?? serialNumber}
        data-title={labelTitle(title)}
      />
      <span className="slab-window">
        {photo.exhausted ? (
          <span className="photo-thumb-empty">{noneLabel}</span>
        ) : (
          <img
            className="photo-thumb-img"
            src={photo.src}
            alt={title}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            {...(priority ? { fetchPriority: 'high' as const } : {})}
            onLoad={photo.onLoad}
            onError={photo.onError}
          />
        )}
      </span>
      <span className="slab-glare" aria-hidden="true" />
    </span>
  );
}

/**
 * A slab with no button around it, for pages that present a card rather than
 * offer it: the landing page and the sign-in stage. It is hidden from
 * assistive technology, because whatever text the page prints beside it says
 * what it is.
 */
export function CardSlab({
  serialNumber,
  title,
  className = '',
  labelSerial,
  priority,
  noneLabel = '',
  as: Tag = 'div',
}: {
  serialNumber: string;
  title: string;
  className?: string;
  labelSerial?: string;
  /** The first thing on the page: load it now, not when it scrolls near. */
  priority?: boolean;
  /** What the window says when there is no photograph. */
  noneLabel?: string;
  /** A span where it sits inside phrasing content, such as a label. */
  as?: 'div' | 'span';
}) {
  const photo = useCardPhotoSource(serialNumber);
  return (
    <Tag
      className={`photo-thumb slab-static ${className}`.trim()}
      aria-hidden="true"
      onPointerMove={slabMove}
      onPointerLeave={slabLeave}
    >
      <SlabFace
        serialNumber={serialNumber}
        title={title}
        photo={photo}
        noneLabel={noneLabel}
        labelSerial={labelSerial}
        priority={priority}
      />
    </Tag>
  );
}

export function CardPhotoThumb({
  serialNumber,
  title,
  decorative,
}: {
  serialNumber: string;
  title: string;
  /** The card around it is already the button (it opens the item), so the photograph is not a second one. */
  decorative?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const photo = useCardPhotoSource(serialNumber);

  if (decorative) {
    return <CardSlab serialNumber={serialNumber} title={title} noneLabel={t('photo.none')} />;
  }

  return (
    <>
      <button
        type="button"
        className="photo-thumb"
        title={t('photo.show')}
        aria-label={t('photo.showOf', { title })}
        onClick={() => setOpen(true)}
        onPointerMove={slabMove}
        onPointerLeave={slabLeave}
      >
        <SlabFace serialNumber={serialNumber} title={title} photo={photo} noneLabel={t('photo.none')} />
      </button>
      {open && (
        <CardPhotoModal serialNumber={serialNumber} title={title} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function CardPhotoModal({
  serialNumber,
  title,
  onClose,
}: {
  serialNumber: string;
  title: string;
  onClose: () => void;
}) {
  const t = useT();
  const photo = useCardPhotoSource(serialNumber, true);
  const { closing, requestClose } = useExit(onClose);
  const dialogRef = useRef<HTMLDivElement>(null);
  useOverlay(dialogRef, requestClose);

  return inBody(
    <div
      className={`${closing ? 'modal-backdrop is-closing' : 'modal-backdrop'} lightbox`}
      role="presentation"
      onClick={requestClose}
    >
      <div
        ref={dialogRef}
        className={closing ? 'modal is-closing' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="lightbox-close" aria-label={t('photo.close')} onClick={requestClose}>
          <IconClose />
        </button>
        {photo.exhausted ? (
          <p className="hint modal-empty">{t('photo.missing')}</p>
        ) : (
          <div className="modal-slab photo-thumb" onPointerMove={slabMove} onPointerLeave={slabLeave}>
            <SlabFace serialNumber={serialNumber} title={title} photo={photo} noneLabel={t('photo.none')} />
          </div>
        )}
        <div className="lightbox-plate">
          <h4 className="lightbox-name">
            <bdi dir="auto">{title}</bdi>
          </h4>
          <code className="modal-serial" dir="ltr">
            {serialNumber}
          </code>
        </div>
      </div>
    </div>,
  );
}
