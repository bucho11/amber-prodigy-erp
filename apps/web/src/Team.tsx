import { useCallback, useEffect, useMemo, useState } from "react";
import type { PermissionDef, RoleWithPermissions, TeamMember } from "@prodigy/contracts";
import { api } from "./api";
import { useAuth } from "./auth";
import { ProvidersAdmin } from "./Staff";

export function Team() {
  const { hasPermission, user } = useAuth();
  const canStaff = hasPermission("staff.manage");
  const canRoles = hasPermission("roles.manage");
  const [section, setSection] = useState<"logins" | "providers">("logins");

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [roles, setRoles] = useState<RoleWithPermissions[]>([]);
  const [catalog, setCatalog] = useState<PermissionDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      if (canStaff) {
        const m = await api<{ users: TeamMember[] }>("/team/users");
        setMembers(m.users);
      }
      // /roles powers both the role editor and the invite/role dropdowns.
      const r = await api<{ roles: RoleWithPermissions[]; catalog: PermissionDef[] }>("/roles");
      setRoles(r.roles);
      setCatalog(r.catalog);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [canStaff]);

  useEffect(() => {
    void load();
  }, [load]);

  // Roles a person can be assigned to (staff roles: not Owner, not the client role).
  const assignableRoles = useMemo(() => roles.filter((r) => !r.isOwner && r.key !== "client"), [roles]);

  if (loading) return <p className="muted">Loading your team&hellip;</p>;

  return (
    <>
      <header>
        <p className="eyebrow">Setup</p>
        <h1>Team &amp; Roles</h1>
        <p className="sub">Invite your team, assign roles, and decide exactly what each role can do.</p>
      </header>

      {error && <p className="bad small">{error}</p>}

      {canStaff && (
        <div className="subtabs">
          <button className={section === "logins" ? "subtab active" : "subtab"} onClick={() => setSection("logins")}>
            Logins &amp; roles
          </button>
          <button className={section === "providers" ? "subtab active" : "subtab"} onClick={() => setSection("providers")}>
            Providers
          </button>
        </div>
      )}

      {canStaff && section === "providers" ? (
        <ProvidersAdmin />
      ) : (
        <>
      {canStaff && (
        <>
          <InviteForm roles={assignableRoles} />
          <section className="card">
            <h2>Your team</h2>
            {members.length === 0 && <p className="muted small">No one yet. Invite your first team member above.</p>}
            {members.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                roles={assignableRoles}
                isSelf={m.id === user?.id}
                canEdit={canStaff}
                onChanged={load}
              />
            ))}
          </section>
        </>
      )}

      {canRoles ? (
        <>
          <section className="card">
            <h2>Roles &amp; permissions</h2>
            <p className="muted small" style={{ marginTop: -6 }}>
              Tick exactly what each role may do. The Owner always keeps full access.
            </p>
            {roles.map((r) => (
              <RolePermissionsCard key={r.id} role={r} catalog={catalog} onSaved={load} />
            ))}
          </section>
          <CreateRoleForm onCreated={load} />
        </>
      ) : (
        canStaff && (
          <p className="muted small">Only the Owner (or a role with permission management) can edit role permissions.</p>
        )
      )}
        </>
      )}
    </>
  );
}

function InviteForm({ roles }: { roles: RoleWithPermissions[] }) {
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string; roleName: string; inviteUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    setErr(null);
    if (!email.trim()) return setErr("Enter an email address.");
    if (!roleId) return setErr("Choose a role for this person.");
    setBusy(true);
    try {
      const res = await api<{ email: string; roleName: string; inviteUrl: string }>("/team/invites", "POST", {
        email: email.trim(),
        roleId,
      });
      setSent(res);
      setEmail("");
      setRoleId("");
      setCopied(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!sent) return;
    try {
      await navigator.clipboard.writeText(sent.inviteUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="card">
      <h2>Invite someone</h2>
      <div className="form-row">
        <input
          className="input"
          type="email"
          placeholder="Their email"
          aria-label="Invite email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <select className="input" aria-label="Role for the invitee" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          <option value="">Choose a role&hellip;</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <button className="btn primary" disabled={busy} onClick={() => void submit()}>
          {busy ? "Sending\u2026" : "Create invite"}
        </button>
      </div>
      {err && <p className="bad small">{err}</p>}
      {sent && (
        <div className="invite-result">
          <p className="small">
            Invite ready for <b>{sent.email}</b> as <b>{sent.roleName}</b>. Share this private link with them — it works
            once:
          </p>
          <div className="invite-link">
            <input className="input sm" readOnly value={sent.inviteUrl} onFocus={(e) => e.target.select()} />
            <button className="btn sm" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function MemberRow({
  member,
  roles,
  isSelf,
  canEdit,
  onChanged,
}: {
  member: TeamMember;
  roles: RoleWithPermissions[];
  isSelf: boolean;
  canEdit: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isOwner = member.role?.isOwner === true;
  const disabled = member.status === "disabled";

  const changeRole = async (roleId: string) => {
    if (!roleId || roleId === member.role?.id) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/team/users/${member.id}/role`, "POST", { roleId });
      await onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status: "active" | "disabled") => {
    setBusy(true);
    setErr(null);
    try {
      await api(`/team/users/${member.id}/status`, "POST", { status });
      await onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="member">
      <div className="member-main">
        <div>
          <div className="member-name">
            {member.displayName} {isSelf && <span className="tag">you</span>}
            {disabled && <span className="tag muted-tag">deactivated</span>}
          </div>
          <div className="muted small">{member.email}</div>
        </div>
        <div className="member-actions">
          {isOwner || !canEdit ? (
            <span className="role-badge">{member.role?.name ?? "—"}</span>
          ) : (
            <select
              className="input sm role-select"
              aria-label={`Change role for ${member.displayName}`}
              value={member.role?.id ?? ""}
              disabled={busy}
              onChange={(e) => void changeRole(e.target.value)}
            >
              {/* Keep the current role selectable even if it's not in the assignable list */}
              {member.role && !roles.some((r) => r.id === member.role?.id) && (
                <option value={member.role.id}>{member.role.name}</option>
              )}
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
          {canEdit && !isSelf && !isOwner && (
            <button className="link-btn muted" disabled={busy} onClick={() => void setStatus(disabled ? "active" : "disabled")}>
              {disabled ? "Reactivate" : "Deactivate"}
            </button>
          )}
        </div>
      </div>
      {err && <p className="bad small">{err}</p>}
    </div>
  );
}

function RolePermissionsCard({
  role,
  catalog,
  onSaved,
}: {
  role: RoleWithPermissions;
  catalog: PermissionDef[];
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Set<string>>(() => new Set(role.permissions));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Resync if the parent reloads roles (e.g., after another save).
  const permsKey = role.permissions.slice().sort().join(",");
  useEffect(() => {
    setDraft(new Set(role.permissions));
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permsKey]);

  const groups = useMemo(() => {
    const map = new Map<string, PermissionDef[]>();
    for (const p of catalog) {
      const arr = map.get(p.group) ?? [];
      arr.push(p);
      map.set(p.group, arr);
    }
    return [...map.entries()];
  }, [catalog]);

  const dirty = useMemo(() => {
    if (draft.size !== role.permissions.length) return true;
    for (const p of role.permissions) if (!draft.has(p)) return true;
    return false;
  }, [draft, role.permissions]);

  if (role.isOwner) {
    return (
      <div className="role-row">
        <div className="role-row-head">
          <div className="role-title">{role.name}</div>
          <span className="role-badge full">Full access (always)</span>
        </div>
      </div>
    );
  }

  const toggle = (key: string) => {
    setSaved(false);
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api(`/roles/${role.id}/permissions`, "PUT", { permissions: [...draft] });
      setSaved(true);
      await onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="role-row">
      <div className="role-row-head">
        <div className="role-title">
          {role.name} <span className="muted small">· {draft.size} {draft.size === 1 ? "permission" : "permissions"}</span>
        </div>
        <button className="link-btn" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Edit permissions"}
        </button>
      </div>
      {open && (
        <div className="perm-editor">
          {groups.map(([group, perms]) => (
            <div className="perm-group" key={group}>
              <div className="perm-group-name">{group}</div>
              {perms.map((p) => (
                <label className="perm-item" key={p.key}>
                  <input type="checkbox" checked={draft.has(p.key)} onChange={() => toggle(p.key)} />
                  <span>{p.label}</span>
                </label>
              ))}
            </div>
          ))}
          {err && <p className="bad small">{err}</p>}
          <div className="perm-actions">
            <button className="btn primary sm" disabled={busy || !dirty} onClick={() => void save()}>
              {busy ? "Saving\u2026" : "Save changes"}
            </button>
            {saved && !dirty && <span className="ok small">Saved</span>}
            {dirty && (
              <button className="link-btn muted" disabled={busy} onClick={() => setDraft(new Set(role.permissions))}>
                Reset
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CreateRoleForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return setErr("Name the new role.");
    setBusy(true);
    setErr(null);
    try {
      await api("/roles", "POST", { name: name.trim() });
      setName("");
      await onCreated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>Add a custom role</h2>
      <p className="muted small" style={{ marginTop: -6 }}>
        Create a role (e.g. "Lead Therapist"), then set its permissions above. New roles start with no access.
      </p>
      <div className="form-row">
        <input
          className="input"
          placeholder="Role name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn" disabled={busy} onClick={() => void submit()}>
          {busy ? "Adding\u2026" : "Add role"}
        </button>
      </div>
      {err && <p className="bad small">{err}</p>}
    </section>
  );
}
