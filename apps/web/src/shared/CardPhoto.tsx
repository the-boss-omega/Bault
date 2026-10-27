import { useEffect, useState } from 'react';
import { useT } from './i18n';
import { slabLeave, slabMove } from './ui/slabTilt';

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

function useCardPhotoSource(serialNumber: string, full = false) {
  const [attempt, setAttempt] = useState(0);
  const exhausted = attempt >= (full ? FULL_SOURCES : PHOTO_SOURCES).length;
  return {
    src: cardPhotoUrl(serialNumber, attempt, full),
    exhausted,
    onError: () => setAttempt((a) => a + 1),
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
}: {
  serialNumber: string;
  title: string;
  className?: string;
  labelSerial?: string;
  /** The first thing on the page: load it now, not when it scrolls near. */
  priority?: boolean;
}) {
  const photo = useCardPhotoSource(serialNumber);
  return (
    <div
      className={`photo-thumb slab-static ${className}`.trim()}
      aria-hidden="true"
      onPointerMove={slabMove}
      onPointerLeave={slabLeave}
    >
      <SlabFace
        serialNumber={serialNumber}
        title={title}
        photo={photo}
        noneLabel=""
        labelSerial={labelSerial}
        priority={priority}
      />
    </div>
  );
}

export function CardPhotoThumb({ serialNumber, title }: { serialNumber: string; title: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const photo = useCardPhotoSource(serialNumber);

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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h4>{title}</h4>
          <button type="button" className="btn btn--ghost modal-close" aria-label={t('photo.close')} onClick={onClose}>
            ✕
          </button>
        </header>
        {photo.exhausted ? (
          <p className="hint modal-empty">{t('photo.missing')}</p>
        ) : (
          <div className="modal-slab photo-thumb" onPointerMove={slabMove} onPointerLeave={slabLeave}>
            <SlabFace serialNumber={serialNumber} title={title} photo={photo} noneLabel={t('photo.none')} />
          </div>
        )}
        <code className="modal-serial" dir="ltr">
          {serialNumber}
        </code>
      </div>
    </div>
  );
}
