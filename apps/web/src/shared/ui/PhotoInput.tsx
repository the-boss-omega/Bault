import { useCallback, useId, useRef, useState } from 'react';
import { api } from '../api';
import { useI18n } from '../i18n';
import { Button, IconButton } from './primitives';
import { IconAlert, IconClose, IconPlus } from './icons';

/**
 * Take or attach photographs, and hand back the keys.
 *
 * Two steps, matching the API. Each file is uploaded to `/media/uploads` on
 * selection and the component holds the returned keys; the form it sits in
 * sends those keys with whatever it is creating. Uploading on selection lets an
 * operator photograph a box while still typing its tracking number, and keeps a
 * slow upload from sitting between them and the submit button.
 *
 * `capture="environment"` asks a phone for the rear camera directly, which is
 * what a receiving bench needs.
 */

export interface PhotoRef {
  objectKey: string;
  /** Local preview: a blob URL. The stored object is never fetched back. */
  previewUrl: string;
  name: string;
}

export function PhotoInput({
  purpose,
  value,
  onChange,
  label,
  hint,
  max = 6,
  disabled,
}: {
  purpose: 'item_intake' | 'parcel';
  value: readonly PhotoRef[];
  onChange: (next: PhotoRef[]) => void;
  label: string;
  hint?: string;
  max?: number;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const full = value.length >= max;

  const read = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('unreadable'));
      reader.readAsDataURL(file);
    });

  const add = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      // Files over the cap are dropped here instead of being uploaded and then
      // refused by the server.
      const room = Math.max(0, max - value.length);
      const chosen = Array.from(files).slice(0, room);
      if (chosen.length < files.length) setError(t('photos.tooMany', { max }));

      setBusy((n) => n + chosen.length);
      const added: PhotoRef[] = [];
      for (const file of chosen) {
        try {
          const dataBase64 = await read(file);
          const res = await api.post<{ objectKey: string }>('/media/uploads', {
            contentType: file.type,
            dataBase64,
            purpose,
          });
          added.push({
            objectKey: res.objectKey,
            previewUrl: URL.createObjectURL(file),
            name: file.name,
          });
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy((n) => n - 1);
        }
      }
      if (added.length > 0) onChange([...value, ...added]);
    },
    [max, onChange, purpose, t, value],
  );

  function remove(objectKey: string) {
    const gone = value.find((p) => p.objectKey === objectKey);
    // The blob is ours; releasing it is not optional on a bench that photographs
    // fifty boxes without reloading the page.
    if (gone) URL.revokeObjectURL(gone.previewUrl);
    onChange(value.filter((p) => p.objectKey !== objectKey));
  }

  return (
    <div className="field photo-field">
      <span className="field-label" id={`${id}-label`}>
        {label}
      </span>

      <ul className="photo-strip" aria-labelledby={`${id}-label`}>
        {value.map((photo) => (
          <li key={photo.objectKey} className="upload-thumb">
            <img src={photo.previewUrl} alt={photo.name} />
            <IconButton
              label={t('photos.remove', { name: photo.name })}
              className="photo-remove"
              onClick={() => remove(photo.objectKey)}
            >
              <IconClose />
            </IconButton>
          </li>
        ))}

        {busy > 0 &&
          Array.from({ length: busy }, (_, i) => (
            <li key={`pending-${i}`} className="upload-thumb upload-thumb--pending" aria-hidden="true">
              <span className="skel" />
            </li>
          ))}

        {!full && (
          <li>
            {/*
              The control is a Button rather than a styled <label>, so it is
              reachable by keyboard and announces as a button; the file input
              itself stays out of the tab order behind it.
            */}
            <Button
              variant="secondary"
              size="sm"
              icon={<IconPlus />}
              disabled={disabled || busy > 0}
              onClick={() => inputRef.current?.click()}
              aria-describedby={`${id}-hint`}
            >
              {value.length === 0 ? t('photos.add') : t('photos.addMore')}
            </Button>
          </li>
        )}
      </ul>

      {/*
        The real file input, driven by the visible button above. It is off the
        tab order but is still a form control, so it carries its own label.
      */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        capture="environment"
        multiple
        tabIndex={-1}
        aria-label={t('photos.add')}
        className="visually-hidden"
        onChange={(e) => {
          void add(e.target.files);
          // Reset, or picking the same file twice in a row does nothing.
          e.target.value = '';
        }}
      />

      {error ? (
        <span className="field-error" role="alert">
          <IconAlert /> {error}
        </span>
      ) : (
        <span className="field-hint" id={`${id}-hint`}>
          {hint ?? t('photos.hint', { max })}
        </span>
      )}
    </div>
  );
}

/** The keys a form sends, from what the control is holding. */
export const photoKeys = (photos: readonly PhotoRef[]): string[] => photos.map((p) => p.objectKey);
