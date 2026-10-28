import { useState } from 'react';
import { api } from '../../shared/api';
import { useI18n } from '../../shared/i18n';
import type { MessageKey } from '../../shared/i18n';
import {
  NAME_PART_MAX,
  fullName,
  initialsFrom,
  isValidNamePart,
  normalizeNamePart,
} from '../../shared/names';
import { useNavigation, useRoute } from '../../shared/routing';
import {
  Button,
  EmptyState,
  Panel,
  SkeletonTable,
  StatusBadge,
  type StatusTone,
} from '../../shared/ui/primitives';
import { DetailDrawer } from '../../shared/ui/DetailDrawer';
import { DrawerTag } from '../../shared/ui/DrawerTag';
import { Code } from '../../shared/ui/Serial';
import { IconUsers } from '../../shared/ui/icons';

export interface AdminUser {
  id: string;
  email: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  nameReviewRequired: boolean;
  role: string;
  status: string;
  autoSuspended: boolean;
  intakeId: string | null;
  mfaEnabled: boolean;
}

const ROLES = ['user', 'warehouse_operator', 'admin'];
const STATUSES = ['pending', 'active', 'suspended', 'closed'];

const ACCOUNT_STATUS_TONE: Record<string, StatusTone> = {
  active: 'success',
  pending: 'warning',
  suspended: 'error',
  closed: 'neutral',
};

type Changes = Partial<Record<'firstName' | 'lastName' | 'role' | 'status', string>>;

/**
 * The accounts, as a roll: who each is (their initials, their name, their username and email), what they may
 * do, and where the account stands. An account is opened to be changed, on a card with the form beside it
 * in a drawer, not edited in the line it is read on.
 */
export function UsersSection({
  users,
  onChanged,
  onSaved,
  onError,
  onResetMfa,
  currentUserId,
}: {
  users: AdminUser[] | null;
  onChanged: (user: AdminUser) => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
  onResetMfa: (user: AdminUser) => void;
  currentUserId: string;
}) {
  const { t } = useI18n();
  const route = useRoute();
  const { openRecord, closeRecord } = useNavigation(route);
  const openId = route.params.user ?? null;
  const open = users?.find((u) => u.id === openId) ?? null;

  return (
    <>
      <Panel
        title={t('admin.users.heading', { count: users?.length ?? 0 })}
        subtitle={t('admin.users.subtitle')}
        flush
      >
        {users === null ? (
          <SkeletonTable rows={5} columns={4} />
        ) : users.length === 0 ? (
          <EmptyState title={t('admin.users.empty')} icon={<IconUsers />} />
        ) : (
          <div className="dt-wrap dt-wrap--stack">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('admin.signIns.col.account')}</th>
                  <th scope="col">{t('admin.users.col.role')}</th>
                  <th scope="col">{t('admin.col.status')}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.id}
                    className={'is-clickable' + (u.id === openId ? ' is-selected' : '')}
                    onClick={() => openRecord('user', u.id)}
                  >
                    <td data-label={t('admin.signIns.col.account')} className="dt-primary">
                      <div className="roll-account">
                        <span className="avatar" aria-hidden="true">
                          {initialsFrom(u.firstName, u.lastName, u.email)}
                        </span>
                        <div className="roll-account-text">
                          <button
                            type="button"
                            className="register-link"
                            onClick={(e) => {
                              e.stopPropagation();
                              openRecord('user', u.id);
                            }}
                          >
                            {fullName(u.firstName, u.lastName) || u.email}
                          </button>
                          <span className="dt-sub" dir="ltr">
                            @{u.username} · {u.email}
                          </span>
                          {u.nameReviewRequired && (
                            <span className="dt-sub">{t('admin.users.nameReviewRequired')}</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td data-label={t('admin.users.col.role')}>
                      {t(`role.${u.role}` as MessageKey)}
                    </td>
                    <td data-label={t('admin.col.status')}>
                      <div className="row roll-status">
                        <StatusBadge tone={ACCOUNT_STATUS_TONE[u.status] ?? 'neutral'}>
                          {t(`account.status.${u.status}` as MessageKey)}
                        </StatusBadge>
                        {u.mfaEnabled && (
                          <span title={t('admin.users.mfaOnTitle')}>
                            <StatusBadge tone="info">{t('admin.users.mfaOn')}</StatusBadge>
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {open && (
        <AccountDrawer
          key={open.id}
          user={open}
          onClose={() => closeRecord('user')}
          onChanged={onChanged}
          onSaved={onSaved}
          onError={onError}
          onResetMfa={
            open.mfaEnabled && open.id !== currentUserId ? () => onResetMfa(open) : undefined
          }
        />
      )}
    </>
  );
}

function AccountDrawer({
  user,
  onClose,
  onChanged,
  onSaved,
  onError,
  onResetMfa,
}: {
  user: AdminUser;
  onClose: () => void;
  onChanged: (user: AdminUser) => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
  onResetMfa?: () => void;
}) {
  const { t } = useI18n();
  const [firstName, setFirstName] = useState(user.firstName ?? '');
  const [lastName, setLastName] = useState(user.lastName ?? '');
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status);

  const namesOk =
    isValidNamePart(normalizeNamePart(firstName)) &&
    (lastName.trim() === '' || isValidNamePart(normalizeNamePart(lastName)));

  // Only what was changed is sent: a name the account is flagged for is confirmed by sending it as it is.
  const changes: Changes = {};
  const confirmName = user.nameReviewRequired && namesOk;
  if (confirmName || normalizeNamePart(firstName) !== (user.firstName ?? '')) {
    changes.firstName = normalizeNamePart(firstName);
  }
  if (lastName.trim() && (confirmName || normalizeNamePart(lastName) !== (user.lastName ?? ''))) {
    changes.lastName = normalizeNamePart(lastName);
  }
  if (role !== user.role) changes.role = role;
  if (status !== user.status) changes.status = status;
  const dirty = Object.keys(changes).length > 0;

  async function send(sent: Changes) {
    try {
      const updated = await api.patch<Partial<AdminUser> | null>(`/admin/users/${user.id}`, sent);
      onChanged({
        ...user,
        ...sent,
        autoSuspended:
          typeof updated?.autoSuspended === 'boolean'
            ? updated.autoSuspended
            : sent.status
              ? false
              : user.autoSuspended,
        nameReviewRequired:
          typeof updated?.nameReviewRequired === 'boolean'
            ? updated.nameReviewRequired
            : sent.firstName !== undefined || sent.lastName !== undefined
              ? false
              : user.nameReviewRequired,
      });
      onSaved(t('admin.users.saved', { email: user.email }));
    } catch (e) {
      onError((e as Error).message);
    }
  }

  async function keepSuspended() {
    setStatus('suspended');
    await send({ status: 'suspended' });
  }

  const name = fullName(firstName, lastName);
  const statusLabel = (key: string) => t(`account.status.${key}` as MessageKey);

  return (
    <DetailDrawer
      title={fullName(user.firstName, user.lastName) || user.email}
      subtitle={<Code value={`@${user.username}`} />}
      onClose={onClose}
      dirty={dirty}
      footer={
        <>
          <Button
            variant="gold"
            disabled={!namesOk || !dirty}
            onClick={() => void send({ ...changes })}
          >
            {t('admin.action.save')}
          </Button>
          {onResetMfa && (
            <Button
              variant="ghost"
              aria-label={t('admin.users.mfaResetLabel', { email: user.email })}
              onClick={onResetMfa}
            >
              {t('admin.users.mfaReset')}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            {t('ui.close')}
          </Button>
        </>
      }
    >
      {/* The account as it will stand once saved: the name as it is typed, and the role and status as chosen. */}
      <DrawerTag
        kicker={t('admin.signIns.col.account')}
        title={name || <span className="drawer-tag-quiet">{user.email}</span>}
        lines={[
          {
            label: t('admin.users.col.email'),
            value: (
              <>
                <span dir="ltr">{user.email}</span>
                {user.intakeId && (
                  <small
                    className="drawer-tag-sub"
                    dir="ltr"
                    title={t('admin.users.legacyIntakeIdTitle')}
                  >
                    {user.intakeId}
                  </small>
                )}
              </>
            ),
          },
          { label: t('admin.users.col.username'), value: <Code value={`@${user.username}`} /> },
        ]}
        status={
          <>
            <StatusBadge tone={ACCOUNT_STATUS_TONE[status] ?? 'neutral'}>
              {statusLabel(status)}
            </StatusBadge>
            {user.mfaEnabled && (
              <span title={t('admin.users.mfaOnTitle')}>
                <StatusBadge tone="info">{t('admin.users.mfaOn')}</StatusBadge>
              </span>
            )}
          </>
        }
        note={t(`role.${role}` as MessageKey)}
      />

      {user.status === 'suspended' && user.autoSuspended && (
        <div className="drawer-note drawer-note--hold">
          <span>{t('admin.users.autoSuspended')}</span>
          <Button
            size="sm"
            variant="secondary"
            aria-label={t('admin.users.keepSuspendedLabel', { email: user.email })}
            onClick={() => void keepSuspended()}
          >
            {t('admin.users.keepSuspended')}
          </Button>
        </div>
      )}

      <div className="stack stack--tight account-fields">
        {user.nameReviewRequired && (
          <p className="field-hint">{t('admin.users.nameReviewRequired')}</p>
        )}
        <div className="form-grid">
          <label className="field">
            <span className="field-label">{t('auth.firstName')}</span>
            <input
              value={firstName}
              maxLength={NAME_PART_MAX}
              aria-label={t('auth.firstName')}
              onChange={(e) => setFirstName(e.target.value)}
              dir="auto"
            />
          </label>
          <label className="field">
            <span className="field-label">{t('auth.lastName')}</span>
            <input
              value={lastName}
              maxLength={NAME_PART_MAX}
              aria-label={t('auth.lastName')}
              onChange={(e) => setLastName(e.target.value)}
              dir="auto"
            />
          </label>
          <label className="field">
            <span className="field-label">{t('admin.users.col.role')}</span>
            <select
              value={role}
              aria-label={t('admin.users.col.role')}
              onChange={(e) => setRole(e.target.value)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`role.${r}` as MessageKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">{t('admin.col.status')}</span>
            <select
              value={status}
              aria-label={t('admin.col.status')}
              onChange={(e) => setStatus(e.target.value)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </DetailDrawer>
  );
}
