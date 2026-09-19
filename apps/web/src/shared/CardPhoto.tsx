import { useEffect, useState } from 'react';
import { useT } from './i18n';

/**
 * Professional card photos are stored one-per-item under the repo-root
 * assets/images folder, named by the item's serial number (SN-DR97-0001.png).
 * Vite serves that folder as publicDir, so they resolve at /images/<SERIAL>.<ext>.
 *
 * This is deliberately separate from the API's item_image / signed-URL pipeline:
 * those are the per-item intake and photography scans stored in object storage,
 * whereas these are the catalogue photos shipped with the app.
 */

/**
 * Extensions tried in order. Reference scans arrive in whatever format the source
 * supplies — the current catalogue is PNG, earlier photos were JPEG — so the
 * filename convention fixes the *stem* (the serial number) and lets the extension
 * vary, rather than forcing a lossy re-encode of every new photo.
 */
const PHOTO_EXTENSIONS = ['png', 'jpg'] as const;

export function cardPhotoUrl(serialNumber: string, attempt = 0): string {
  const ext = PHOTO_EXTENSIONS[Math.min(attempt, PHOTO_EXTENSIONS.length - 1)];
  return `/images/${encodeURIComponent(serialNumber)}.${ext}`;
}

/**
 * Walks the candidate extensions on load failure and reports exhaustion, so a
 * genuinely missing photo still degrades to the placeholder rather than looping.
 */
function useCardPhotoSource(serialNumber: string) {
  const [attempt, setAttempt] = useState(0);
  const exhausted = attempt >= PHOTO_EXTENSIONS.length;
  return {
    src: cardPhotoUrl(serialNumber, attempt),
    exhausted,
    onError: () => setAttempt((a) => a + 1),
  };
}

/**
 * Camera button that opens the item's photo in a lightbox. Rendered on every card
 * surface (vault, marketplace, admin table).
 */
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
 * Real image thumbnail for an item tile (replaces the bare camera emoji). Shows the
 * item's catalogue photo; clicking it opens the same lightbox. If the item has no
 * photo on disk the thumbnail degrades to a camera-emoji placeholder rather than a
 * broken-image icon, but the click-to-enlarge affordance is preserved.
 */
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
      >
        {photo.exhausted ? (
          /* A stated absence, not a camera emoji. An emoji renders in whatever
             the platform's colour font decides, which is the one thing on this
             screen nobody chose. */
          <span className="photo-thumb-empty">{t('photo.none')}</span>
        ) : (
          <img
            className="photo-thumb-img"
            src={photo.src}
            alt={title}
            loading="lazy"
            onError={photo.onError}
          />
        )}
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
  // An item with no file on disk should degrade to a message rather than a broken
  // image icon — not every item in the vault has a catalogue photo.
  const photo = useCardPhotoSource(serialNumber);

  // Esc closes the lightbox; freeze background scrolling while it is open.
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
          <img className="modal-photo" src={photo.src} alt={title} onError={photo.onError} />
        )}
        <code className="modal-serial" dir="ltr">
          {serialNumber}
        </code>
      </div>
    </div>
  );
}
