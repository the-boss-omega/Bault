import { useState } from 'react';
import { api } from '../../shared/api';
import { Barcode, BarcodePrintButton } from '../../shared/Barcode';
import { CardPhotoButton, CardPhotoThumb } from '../../shared/CardPhoto';
import { useI18n } from '../../shared/i18n';
import { STATE_META, stateLabel } from '../../shared/itemTimeline';
import { useNavigation, useRoute } from '../../shared/routing';
import {
  Button,
  EmptyState,
  ErrorState,
  Panel,
  SkeletonTable,
  StatusBadge,
  SuccessNote,
} from '../../shared/ui/primitives';
import { DetailDrawer } from '../../shared/ui/DetailDrawer';
import { DrawerTag } from '../../shared/ui/DrawerTag';
import { Code } from '../../shared/ui/Serial';
import { IconBox } from '../../shared/ui/icons';
import type { AdminUser } from './UsersSection';

export interface AdminItem {
  id: string;
  serialNumber: string;
  barcode: string;
  typeClass: string;
  description: string;
  conditionGrade: string | null;
  lifecycleState: string;
  holdFlag: boolean;
  binId: string | null;
  ownerId: string;
  ownerEmail: string | null;
}

const STATES = [
  'received',
  'stored',
  'listed',
  'on-hold',
  'sold',
  'shipped',
  'donated',
  'consigned',
];

/** The name of a card: what the catalogue line says up to its first " · " (year, set, card). */
const nameOf = (description: string, typeClass: string) =>
  (description.split(' · ')[0] ?? description).trim() || typeClass;

/**
 * The inventory, as a roll: each item by its name and its number, whose it is, and where it stands. An item is
 * opened to be corrected, on a card with the fields beside it in a drawer, not edited in the line it is read on.
 */
export function ItemsSection({
  items,
  users,
  onChanged,
  onSaved,
  onError,
}: {
  items: AdminItem[] | null;
  users: AdminUser[];
  onChanged: (item: AdminItem) => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const route = useRoute();
  const { openRecord, closeRecord } = useNavigation(route);
  const openId = route.params.item ?? null;
  const open = items?.find((i) => i.id === openId) ?? null;

  return (
    <>
      <Panel
        title={t('admin.items.heading', { count: items?.length ?? 0 })}
        subtitle={t('admin.items.subtitle')}
        flush
      >
        {items === null ? (
          <SkeletonTable rows={5} columns={4} />
        ) : items.length === 0 ? (
          <EmptyState title={t('admin.items.empty')} icon={<IconBox />} />
        ) : (
          <div className="dt-wrap dt-wrap--stack">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('admin.items.col.description')}</th>
                  <th scope="col">{t('admin.items.col.owner')}</th>
                  <th scope="col">{t('admin.items.col.lifecycle')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const meta = STATE_META[item.lifecycleState];
                  return (
                    <tr
                      key={item.id}
                      className={'is-clickable' + (item.id === openId ? ' is-selected' : '')}
                      onClick={() => openRecord('item', item.id)}
                    >
                      <td data-label={t('admin.items.col.description')} className="dt-primary">
                        <div className="roll-account-text">
                          <button
                            type="button"
                            className="register-link"
                            onClick={(e) => {
                              e.stopPropagation();
                              openRecord('item', item.id);
                            }}
                          >
                            {nameOf(item.description, item.typeClass)}
                          </button>
                          <span className="dt-sub">
                            <Code value={item.barcode} />
                            {item.conditionGrade && (
                              <>
                                {' · '}
                                <span dir="auto">{item.conditionGrade}</span>
                              </>
                            )}
                          </span>
                        </div>
                      </td>
                      <td data-label={t('admin.items.col.owner')}>
                        <span dir="ltr">{item.ownerEmail ?? '—'}</span>
                      </td>
                      <td data-label={t('admin.items.col.lifecycle')}>
                        <div className="row roll-status">
                          <StatusBadge tone={meta?.tone ?? 'neutral'}>
                            {stateLabel(t, item.lifecycleState)}
                          </StatusBadge>
                          {item.holdFlag && (
                            <StatusBadge tone="error">{t('admin.items.col.hold')}</StatusBadge>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {open && (
        <ItemDrawer
          key={open.id}
          item={open}
          users={users}
          onClose={() => closeRecord('item')}
          onChanged={onChanged}
          onSaved={onSaved}
          onError={onError}
        />
      )}
    </>
  );
}

function ItemDrawer({
  item,
  users,
  onClose,
  onChanged,
  onSaved,
  onError,
}: {
  item: AdminItem;
  users: AdminUser[];
  onClose: () => void;
  onChanged: (item: AdminItem) => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const [description, setDescription] = useState(item.description);
  const [typeClass, setTypeClass] = useState(item.typeClass);
  const [conditionGrade, setConditionGrade] = useState(item.conditionGrade ?? '');
  const [ownerId, setOwnerId] = useState(item.ownerId);
  const [lifecycleState, setLifecycleState] = useState(item.lifecycleState);
  const [holdFlag, setHoldFlag] = useState(item.holdFlag);
  // What the last save came to is told here, in the drawer: the page's own line is behind its backdrop.
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  // Only what was changed is sent: the state the item was showing is not a change to it.
  const current = { description, typeClass, conditionGrade, ownerId, lifecycleState, holdFlag };
  const saved = {
    description: item.description,
    typeClass: item.typeClass,
    conditionGrade: item.conditionGrade ?? '',
    ownerId: item.ownerId,
    lifecycleState: item.lifecycleState,
    holdFlag: item.holdFlag,
  };
  const changes: Partial<typeof current> = {};
  for (const field of Object.keys(current) as (keyof typeof current)[]) {
    if (current[field] !== saved[field]) Object.assign(changes, { [field]: current[field] });
  }
  const dirty = Object.keys(changes).length > 0;

  async function save() {
    if (!dirty) return;
    const sent = { ...changes };
    setNotice(null);
    try {
      const updated = await api.patch<{ lifecycleState?: string } | null>(
        `/admin/items/${item.id}`,
        sent,
      );
      const state = updated?.lifecycleState ?? sent.lifecycleState ?? item.lifecycleState;
      setLifecycleState(state);
      const owner = users.find((u) => u.id === (sent.ownerId ?? item.ownerId));
      onChanged({
        ...item,
        ...sent,
        conditionGrade:
          sent.conditionGrade !== undefined ? sent.conditionGrade || null : item.conditionGrade,
        lifecycleState: state,
        ownerEmail: owner?.email ?? item.ownerEmail,
      });
      const text = t('admin.items.saved', { barcode: item.barcode });
      onSaved(text);
      setNotice({ ok: true, text });
    } catch (e) {
      onError((e as Error).message);
      setNotice({ ok: false, text: (e as Error).message });
    }
  }

  const name = nameOf(description, typeClass);
  const meta = STATE_META[lifecycleState];
  const owner = users.find((u) => u.id === ownerId);
  // A state the list does not offer (one the system set) is still the one the item is in, and is shown as such.
  const states = STATES.includes(item.lifecycleState) ? STATES : [item.lifecycleState, ...STATES];

  return (
    <DetailDrawer
      title={nameOf(item.description, item.typeClass)}
      subtitle={item.barcode === item.serialNumber ? undefined : <Code value={item.barcode} />}
      onClose={onClose}
      dirty={dirty}
      notice={
        notice &&
        (notice.ok ? (
          <SuccessNote>{notice.text}</SuccessNote>
        ) : (
          <ErrorState message={notice.text} />
        ))
      }
      footer={
        <>
          <Button variant="primary" disabled={!dirty} onClick={() => void save()}>
            {t('admin.action.save')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.close')}
          </Button>
        </>
      }
    >
      {/* The item as it will stand once saved: its number, its name as it is typed, and whose and where as chosen. */}
      <DrawerTag
        art={<CardPhotoThumb serialNumber={item.serialNumber} title={name} decorative />}
        kicker={item.serialNumber}
        title={name || <span className="drawer-tag-quiet">{t('admin.items.col.description')}</span>}
        lines={[
          { label: t('admin.items.col.type'), value: <Code value={typeClass || '—'} /> },
          { label: t('admin.items.col.condition'), value: conditionGrade || '—' },
          {
            label: t('admin.items.col.owner'),
            value: <span dir="ltr">{owner?.email ?? item.ownerEmail ?? '—'}</span>,
          },
        ]}
        status={
          <>
            <StatusBadge tone={meta?.tone ?? 'neutral'}>
              {stateLabel(t, lifecycleState)}
            </StatusBadge>
            {holdFlag && <StatusBadge tone="error">{t('admin.items.col.hold')}</StatusBadge>}
          </>
        }
      >
        <div className="parcel-stub">
          <Barcode value={item.barcode} options={{ moduleWidth: 1, height: 40 }} />
        </div>
      </DrawerTag>

      <div className="row item-tools">
        <BarcodePrintButton value={item.barcode} caption={item.description || item.typeClass} />
        <span className="item-photo">
          <span className="field-label">{t('admin.items.col.photo')}</span>
          <CardPhotoButton
            serialNumber={item.serialNumber}
            title={item.description || item.typeClass}
          />
        </span>
      </div>

      <div className="stack stack--tight account-fields">
        <label className="field">
          <span className="field-label">{t('admin.items.col.description')}</span>
          <textarea
            rows={3}
            value={description}
            aria-label={t('admin.items.col.description')}
            onChange={(e) => setDescription(e.target.value)}
            dir="auto"
          />
        </label>
        <div className="form-grid">
          <label className="field">
            <span className="field-label">{t('admin.items.col.type')}</span>
            <input
              value={typeClass}
              aria-label={t('admin.items.col.type')}
              onChange={(e) => setTypeClass(e.target.value)}
              dir="ltr"
            />
          </label>
          <label className="field">
            <span className="field-label">{t('admin.items.col.condition')}</span>
            <input
              value={conditionGrade}
              aria-label={t('admin.items.col.condition')}
              onChange={(e) => setConditionGrade(e.target.value)}
              dir="auto"
            />
          </label>
          <label className="field">
            <span className="field-label">{t('admin.items.col.owner')}</span>
            <select
              value={ownerId}
              aria-label={t('admin.items.col.owner')}
              onChange={(e) => setOwnerId(e.target.value)}
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.email}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">{t('admin.items.col.lifecycle')}</span>
            <select
              value={lifecycleState}
              aria-label={t('admin.items.col.lifecycle')}
              onChange={(e) => setLifecycleState(e.target.value)}
            >
              {states.map((s) => (
                <option key={s} value={s}>
                  {stateLabel(t, s)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={holdFlag}
            aria-label={t('admin.items.col.hold')}
            onChange={(e) => setHoldFlag(e.target.checked)}
          />
          {t('admin.items.col.hold')}
        </label>
      </div>
    </DetailDrawer>
  );
}
