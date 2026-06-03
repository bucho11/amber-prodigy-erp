import { useEffect, useState } from "react";
import { api, ApiError } from "./api";

export function AcceptInvite() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [invite, setInvite] = useState<{ email: string; roleName: string } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoadErr("This invitation link is missing its code.");
      return;
    }
    api<{ email: string; roleName: string }>(`/auth/invite/${encodeURIComponent(token)}`)
      .then(setInvite)
      .catch((e) => setLoadErr(e instanceof ApiError ? e.message : "Could not load this invitation."));
  }, [token]);

  const submit = async () => {
    setErr(null);
    if (!displayName.trim()) return setErr("Please enter your name.");
    if (password.length < 8) return setErr("Choose a password of at least 8 characters.");
    if (password !== confirm) return setErr("The two passwords don't match.");
    setBusy(true);
    try {
      await api("/auth/accept-invite", "POST", { token, password, displayName: displayName.trim() });
      window.location.assign("/");
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="centered">
      <div className="auth-card">
        <p className="eyebrow">Prodigy ERP</p>
        {loadErr ? (
          <>
            <h1>Invitation unavailable</h1>
            <p className="bad">{loadErr}</p>
            <a className="btn block" href="/">
              Go to sign in
            </a>
          </>
        ) : !invite ? (
          <p className="muted">Loading your invitation&hellip;</p>
        ) : (
          <>
            <h1>Join the team</h1>
            <p className="sub">
              You've been invited as <b>{invite.roleName}</b> ({invite.email}). Set your name and a password to get started.
            </p>
            <label className="field">
              <span>Your name</span>
              <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoFocus />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            </label>
            <label className="field">
              <span>Confirm password</span>
              <input
                className="input"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                }}
              />
            </label>
            {err && <p className="bad small">{err}</p>}
            <button className="btn primary block" disabled={busy} onClick={() => void submit()}>
              {busy ? "Please wait\u2026" : "Create my account"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
