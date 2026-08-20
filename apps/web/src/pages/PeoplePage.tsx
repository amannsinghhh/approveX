/**
 * People & Access (A.1 #2) — the tenant admin surface for who exists, what
 * they can do, and who's on the way in. Three tabs over the users / roles /
 * invitations endpoints, all gated behind `member:manage`. Consequence
 * previews (A.1 #3) warn before a deactivation or role delete strands a live
 * approval.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { LedgerTable } from '../components/LedgerTable';
import { StampChip } from '../components/StampChip';
import { Button, Card, Input, Label, Tabs, Textarea } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime, timeAgo } from '../lib/format';
import type { Paginated } from '../lib/types';

// ------------------------------------------------------------------- shapes

interface RoleRef {
  id: string;
  name: string;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  status: 'active' | 'deactivated';
  createdAt: string;
  roles: RoleRef[];
}

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
  permissions: string[];
  memberCount: number;
}

interface PermissionRow {
  key: string;
  description: string;
}

interface InvitationRow {
  id: string;
  email: string;
  roleIds: string[];
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
  invitedById: string;
  createdAt: string;
}

interface UserConsequences {
  user: { id: string; name: string; status: string };
  soleApproverRoles: { id: string; name: string; workflows: { id: string; name: string }[]; pendingSteps: number }[];
  safeToDeactivate: boolean;
}

type Tab = 'people' | 'roles' | 'invitations';

// -------------------------------------------------------------- role picker

/** Shared checkbox list of roles, used by the user editor and the invite form. */
function RolePicker({
  roles,
  selected,
  onToggle,
}: {
  roles: RoleRow[];
  selected: string[];
  onToggle: (id: string) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      {roles.map((role) => (
        <label
          key={role.id}
          className="flex cursor-pointer items-center gap-2 text-base text-ink"
        >
          <input
            type="checkbox"
            checked={selected.includes(role.id)}
            onChange={() => onToggle(role.id)}
          />
          <span className="font-medium">{role.name}</span>
          {role.isSystem && <StampChip label="system" tone="brand" />}
          {role.description && (
            <span className="truncate text-sm text-ink-soft">— {role.description}</span>
          )}
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- people tab

function PeopleTab({ roles }: { roles: RoleRow[] }): React.JSX.Element {
  const { me } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<UserRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<Paginated<UserRow>>('/users?pageSize=100');
      setUsers(res.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      {editing && (
        <UserEditor
          user={editing}
          roles={roles}
          isSelf={editing.id === me?.id}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}

      <LedgerTable<UserRow>
        columns={[
          {
            key: 'name',
            header: 'Name',
            render: (u) => (
              <div className="min-w-0">
                <div className="font-medium text-ink">{u.name}</div>
                <div className="truncate text-sm text-ink-soft">{u.email}</div>
              </div>
            ),
          },
          {
            key: 'roles',
            header: 'Roles',
            render: (u) => (
              <span className="flex flex-wrap gap-1">
                {u.roles.length === 0 ? (
                  <span className="text-sm text-ink-soft">—</span>
                ) : (
                  u.roles.map((r) => (
                    <span
                      key={r.id}
                      className="rounded-[3px] border border-rule px-1 text-xs text-ink-soft"
                    >
                      {r.name}
                    </span>
                  ))
                )}
              </span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (u) => <StampChip label={u.status} />,
          },
          {
            key: 'joined',
            header: 'Joined',
            render: (u) => <span className="text-sm text-ink-soft">{timeAgo(u.createdAt)}</span>,
          },
          {
            key: 'actions',
            header: '',
            render: (u) => (
              <Button variant="ghost" className="h-7 text-sm" onClick={() => setEditing(u)}>
                Manage
              </Button>
            ),
          },
        ]}
        rows={users}
        rowKey={(u) => u.id}
        loading={loading}
        empty={
          <p className="text-center text-base text-ink-soft">
            No users yet. Invite teammates from the Invitations tab.
          </p>
        }
      />
    </div>
  );
}

function UserEditor({
  user,
  roles,
  isSelf,
  onClose,
  onSaved,
}: {
  user: UserRow;
  roles: RoleRow[];
  isSelf: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}): React.JSX.Element {
  const [roleIds, setRoleIds] = useState<string[]>(user.roles.map((r) => r.id));
  const [status, setStatus] = useState<'active' | 'deactivated'>(user.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consequences, setConsequences] = useState<UserConsequences | null>(null);

  // A.1 #3 — surface up front which approvals stall if this user goes away.
  useEffect(() => {
    let live = true;
    void api<UserConsequences>(`/users/${user.id}/consequences`)
      .then((res) => live && setConsequences(res))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [user.id]);

  const toggleRole = (id: string): void =>
    setRoleIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const dirty =
    status !== user.status ||
    roleIds.length !== user.roles.length ||
    roleIds.some((id) => !user.roles.some((r) => r.id === id));

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await api(`/users/${user.id}`, { method: 'PATCH', body: { status, roleIds } });
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Retry.');
    } finally {
      setSaving(false);
    }
  };

  const deactivating = status === 'deactivated' && user.status === 'active';
  const showStall = deactivating && consequences && !consequences.safeToDeactivate;

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-base font-medium text-ink">{user.name}</p>
          <p className="text-sm text-ink-soft">{user.email}</p>
        </div>
        <Button variant="ghost" className="h-7 text-sm" onClick={onClose}>
          Close
        </Button>
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <Label>Status</Label>
          <div className="flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-base text-ink">
              <input
                type="radio"
                name={`status-${user.id}`}
                checked={status === 'active'}
                onChange={() => setStatus('active')}
              />
              Active
            </label>
            <label
              className={
                isSelf
                  ? 'flex items-center gap-2 text-base text-ink-soft/50'
                  : 'flex cursor-pointer items-center gap-2 text-base text-ink'
              }
            >
              <input
                type="radio"
                name={`status-${user.id}`}
                disabled={isSelf}
                checked={status === 'deactivated'}
                onChange={() => setStatus('deactivated')}
              />
              Deactivated
            </label>
            {isSelf && (
              <span className="text-sm text-ink-soft">— you can't deactivate yourself</span>
            )}
          </div>
        </div>

        {showStall && (
          <div className="rounded-[6px] border border-pending bg-pending-bg/40 px-3 py-2">
            <p className="text-sm font-medium text-ink">
              Deactivating {consequences.user.name} would leave these roles with no active
              approver:
            </p>
            <ul className="mt-1 flex flex-col gap-1">
              {consequences.soleApproverRoles.map((role) => (
                <li key={role.id} className="text-sm text-ink-soft">
                  <span className="font-medium text-ink">{role.name}</span>
                  {role.workflows.length > 0 && ` — routes ${role.workflows.map((w) => w.name).join(', ')}`}
                  {role.pendingSteps > 0 && ` — ${role.pendingSteps} pending step(s)`}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <Label>Roles</Label>
          {roles.length === 0 ? (
            <p className="text-sm text-ink-soft">No roles defined yet.</p>
          ) : (
            <RolePicker roles={roles} selected={roleIds} onToggle={toggleRole} />
          )}
        </div>

        {error && <p className="text-sm text-reject">{error}</p>}

        <div className="flex gap-2">
          <Button variant="primary" disabled={saving || !dirty} onClick={() => void save()}>
            Save changes
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ----------------------------------------------------------------- roles tab

function RolesTab({
  roles,
  permissions,
  reload,
}: {
  roles: RoleRow[];
  permissions: PermissionRow[];
  reload: () => Promise<void>;
}): React.JSX.Element {
  const [editing, setEditing] = useState<RoleRow | 'new' | null>(null);
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null);

  const remove = async (role: RoleRow): Promise<void> => {
    setDeleteError(null);
    if (!window.confirm(`Delete role "${role.name}"? This can't be undone.`)) return;
    try {
      await api(`/roles/${role.id}`, { method: 'DELETE' });
      await reload();
    } catch (err) {
      setDeleteError({
        id: role.id,
        message:
          err instanceof ApiError
            ? err.message
            : 'Could not delete the role. Retry.',
      });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setEditing('new')}>
          New role
        </Button>
      </div>

      {editing && (
        <RoleEditor
          role={editing === 'new' ? null : editing}
          permissions={permissions}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}

      <LedgerTable<RoleRow>
        columns={[
          {
            key: 'name',
            header: 'Role',
            render: (r) => (
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink">{r.name}</span>
                  {r.isSystem && <StampChip label="system" tone="brand" />}
                </div>
                {r.description && (
                  <div className="truncate text-sm text-ink-soft">{r.description}</div>
                )}
              </div>
            ),
          },
          {
            key: 'permissions',
            header: 'Permissions',
            render: (r) =>
              r.permissions.length === 0 ? (
                <span className="text-sm text-ink-soft">none</span>
              ) : (
                <span className="flex flex-wrap gap-1">
                  {r.permissions.map((p) => (
                    <span
                      key={p}
                      className="rounded-[3px] border border-rule px-1 font-mono text-xs text-ink-soft"
                    >
                      {p}
                    </span>
                  ))}
                </span>
              ),
          },
          {
            key: 'members',
            header: 'Members',
            numeric: true,
            render: (r) => <span className="tabular-nums text-sm">{r.memberCount}</span>,
          },
          {
            key: 'actions',
            header: '',
            render: (r) => (
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  className="h-7 text-sm"
                  disabled={r.isSystem}
                  onClick={() => setEditing(r)}
                >
                  Edit
                </Button>
                <Button
                  variant="danger"
                  className="h-7 text-sm"
                  disabled={r.isSystem}
                  onClick={() => void remove(r)}
                >
                  Delete
                </Button>
              </div>
            ),
          },
        ]}
        rows={roles}
        rowKey={(r) => r.id}
        empty={<p className="text-center text-base text-ink-soft">No roles defined yet.</p>}
      />

      {deleteError && (
        <Card className="border-reject bg-reject-bg/30 p-3">
          <p className="text-sm text-ink">{deleteError.message}</p>
        </Card>
      )}
    </div>
  );
}

function RoleEditor({
  role,
  permissions,
  onClose,
  onSaved,
}: {
  role: RoleRow | null;
  permissions: PermissionRow[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}): React.JSX.Element {
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [permissionKeys, setPermissionKeys] = useState<string[]>(role?.permissions ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (key: string): void =>
    setPermissionKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (role) {
        await api(`/roles/${role.id}`, {
          method: 'PATCH',
          body: { name, description: description || null, permissionKeys },
        });
      } else {
        await api('/roles', {
          method: 'POST',
          body: { name, description: description || undefined, permissionKeys },
        });
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the role. Retry.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4">
      <p className="mb-3 text-base font-medium text-ink">{role ? `Edit "${role.name}"` : 'New role'}</p>
      <form onSubmit={(e) => void save(e)} className="flex flex-col gap-3">
        <div>
          <Label htmlFor="role-name">Name</Label>
          <Input
            id="role-name"
            required
            placeholder="Finance approver"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="role-desc">Description</Label>
          <Textarea
            id="role-desc"
            rows={2}
            placeholder="What this role is for (optional)."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <Label>Permissions</Label>
          <div className="flex flex-col gap-1.5">
            {permissions.map((perm) => (
              <label
                key={perm.key}
                className="flex cursor-pointer items-center gap-2 text-base text-ink"
              >
                <input
                  type="checkbox"
                  checked={permissionKeys.includes(perm.key)}
                  onChange={() => toggle(perm.key)}
                />
                <span className="font-mono text-sm">{perm.key}</span>
                <span className="text-sm text-ink-soft">— {perm.description}</span>
              </label>
            ))}
          </div>
        </div>
        {error && <p className="text-sm text-reject">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={saving || !name}>
            {role ? 'Save role' : 'Create role'}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ----------------------------------------------------------- invitations tab

function InvitationsTab({ roles }: { roles: RoleRow[] }): React.JSX.Element {
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ email: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const roleName = useMemo(() => {
    const map = new Map(roles.map((r) => [r.id, r.name]));
    return (id: string): string => map.get(id) ?? 'unknown role';
  }, [roles]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ items: InvitationRow[] }>('/invitations');
      setInvitations(res.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const invite = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await api<{ email: string; token: string }>('/invitations', {
        method: 'POST',
        body: { email, roleIds },
      });
      setFresh({ email: created.email, token: created.token });
      setEmail('');
      setRoleIds([]);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the invite. Retry.');
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (id: string): Promise<void> => {
    await api(`/invitations/${id}`, { method: 'DELETE' });
    await load();
  };

  const inviteLink = fresh
    ? `${window.location.origin}/accept-invite?token=${fresh.token}`
    : '';

  return (
    <div className="flex flex-col gap-4">
      {fresh && (
        <Card className="border-approve bg-approve-bg/40 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-base font-medium text-ink">
              Invite for “{fresh.email}” created — share this link now, it won't be shown again.
            </p>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="primary"
                className="h-8 text-sm"
                onClick={() => {
                  void navigator.clipboard.writeText(inviteLink);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? 'Copied' : 'Copy link'}
              </Button>
              <Button variant="ghost" className="h-8 text-sm" onClick={() => setFresh(null)}>
                Done
              </Button>
            </div>
          </div>
          <p className="mt-2 break-all rounded-[6px] border border-rule bg-surface px-3 py-2 font-mono text-sm text-ink">
            {inviteLink}
          </p>
        </Card>
      )}

      <Card className="p-4">
        <p className="mb-3 text-base font-medium text-ink">Invite a teammate</p>
        <form onSubmit={(e) => void invite(e)} className="flex flex-col gap-3">
          <div>
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              required
              placeholder="teammate@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <Label>Roles</Label>
            {roles.length === 0 ? (
              <p className="text-sm text-ink-soft">Create a role first.</p>
            ) : (
              <RolePicker
                roles={roles}
                selected={roleIds}
                onToggle={(id) =>
                  setRoleIds((prev) =>
                    prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                  )
                }
              />
            )}
          </div>
          {error && <p className="text-sm text-reject">{error}</p>}
          <div>
            <Button type="submit" variant="primary" disabled={saving || !email || roleIds.length === 0}>
              Send invite
            </Button>
          </div>
        </form>
      </Card>

      <LedgerTable<InvitationRow>
        columns={[
          {
            key: 'email',
            header: 'Email',
            render: (i) => <span className="font-medium text-ink">{i.email}</span>,
          },
          {
            key: 'roles',
            header: 'Roles',
            render: (i) => (
              <span className="flex flex-wrap gap-1">
                {i.roleIds.map((id) => (
                  <span key={id} className="rounded-[3px] border border-rule px-1 text-xs text-ink-soft">
                    {roleName(id)}
                  </span>
                ))}
              </span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (i) => <StampChip label={i.status} />,
          },
          {
            key: 'expires',
            header: 'Expires',
            render: (i) => (
              <span className="text-sm text-ink-soft" title={formatDateTime(i.expiresAt)}>
                {i.status === 'pending' ? timeAgo(i.expiresAt) : '—'}
              </span>
            ),
          },
          {
            key: 'actions',
            header: '',
            render: (i) =>
              i.status === 'pending' ? (
                <Button variant="danger" className="h-7 text-sm" onClick={() => void revoke(i.id)}>
                  Revoke
                </Button>
              ) : null,
          },
        ]}
        rows={invitations}
        rowKey={(i) => i.id}
        loading={loading}
        empty={<p className="text-center text-base text-ink-soft">No invitations yet.</p>}
      />
    </div>
  );
}

// --------------------------------------------------------------------- page

export function PeoplePage(): React.JSX.Element {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('people');
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [permissions, setPermissions] = useState<PermissionRow[]>([]);

  const loadRoles = useCallback(async () => {
    const res = await api<{ items: RoleRow[] }>('/roles');
    setRoles(res.items);
  }, []);

  useEffect(() => {
    if (!can('member:manage')) return;
    void loadRoles();
    void api<{ items: PermissionRow[] }>('/permissions').then((res) => setPermissions(res.items));
  }, [can, loadRoles]);

  if (!can('member:manage')) {
    return (
      <>
        <PageHeader title="People & access" />
        <Card className="p-6">
          <p className="text-base text-ink-soft">
            You need the <span className="font-mono text-sm">member:manage</span> permission to
            manage people and access. Ask a tenant admin.
          </p>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="People & access"
        subtitle="Who's in this tenant, what they can do, and who's on the way in."
        actions={
          <Button variant="primary" onClick={() => setTab('invitations')}>
            <UserPlus size={15} /> Invite
          </Button>
        }
      />

      <div className="mb-4">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'people', label: 'People' },
            { value: 'roles', label: 'Roles' },
            { value: 'invitations', label: 'Invitations' },
          ]}
        />
      </div>

      {tab === 'people' && <PeopleTab roles={roles} />}
      {tab === 'roles' && (
        <RolesTab roles={roles} permissions={permissions} reload={loadRoles} />
      )}
      {tab === 'invitations' && <InvitationsTab roles={roles} />}
    </>
  );
}
