import { useCallback, useId, useRef, useState } from 'react';
import { api } from '../api';
import { useI18n } from '../i18n';
import { Button, IconButton } from './primitives';
import { IconAlert, IconClose, IconPlus } from './icons';

export interface PhotoRef {
  objectKey: string;
  previewUrl: string;
  name: string;
  isImage?: boolean;
}

export type UploadPurpose = 'item_intake' | 'parcel' | 'cash_in_receipt';

const IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/heic,image/heif';

export const RECEIPT_TYPES = `application/pdf,${IMAGE_TYPES}`;

export function PhotoInput({
  purpose,
  value,
  onChange,
  label,
  hint,
  max = 6,
  disabled,
  accept = IMAGE_TYPES,
  camera = true,
  addLabel,
}: {
  purpose: UploadPurpose;
  value: readonly PhotoRef[];
  onChange: (next: PhotoRef[]) => void;
  label?: string;
  hint?: string;
  max?: number;
  disabled?: boolean;
  accept?: string;
  camera?: boolean;
  addLabel?: string;
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
            isImage: file.type.startsWith('image/'),
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
    if (gone) URL.revokeObjectURL(gone.previewUrl);
    onChange(value.filter((p) => p.objectKey !== objectKey));
  }

  return (
    <div className="field photo-field">
      {label && (
        <span className="field-label" id={`${id}-label`}>
          {label}
        </span>
      )}

      <ul
        className="photo-strip"
        {...(label ? { 'aria-labelledby': `${id}-label` } : { 'aria-label': addLabel ?? t('photos.add') })}
      >
        {value.map((photo) => (
          <li key={photo.objectKey} className="upload-thumb">
            {photo.isImage === false ? (
              <span className="upload-file">
                <bdi dir="auto">{photo.name}</bdi>
              </span>
            ) : (
              <img src={photo.previewUrl} alt={photo.name} />
            )}
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
            <Button
              variant="secondary"
              size="sm"
              icon={<IconPlus />}
              disabled={disabled || busy > 0}
              onClick={() => inputRef.current?.click()}
              aria-describedby={`${id}-hint`}
            >
              {addLabel ?? (value.length === 0 ? t('photos.add') : t('photos.addMore'))}
            </Button>
          </li>
        )}
      </ul>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        {...(camera ? { capture: 'environment' as const } : {})}
        multiple={max > 1}
        tabIndex={-1}
        aria-label={addLabel ?? t('photos.add')}
        className="visually-hidden"
        onChange={(e) => {
          void add(e.target.files);
          e.target.value = '';
        }}
      />

      {error ? (
        <span className="field-error" role="alert">
          <IconAlert /> <bdi dir="auto">{error}</bdi>
        </span>
      ) : (
        <span className="field-hint" id={`${id}-hint`}>
          {hint ?? t('photos.hint', { max })}
        </span>
      )}
    </div>
  );
}

export const photoKeys = (photos: readonly PhotoRef[]): string[] => photos.map((p) => p.objectKey);
