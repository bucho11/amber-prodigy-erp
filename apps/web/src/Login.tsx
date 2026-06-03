import { useState } from "react";
import { useAuth } from "./auth";

export function Login() {
  const { needsSetup, tenantName, login, setupOwner } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (needsSetup) {
      if (!displayName.trim()) return setErr("Please enter your name.");
      if (password.length < 8) return setErr("Choose a password of at least 8 characters.");
      if (password !== confirm) return setErr("The two passwords don't match.");
    }
    setBusy(true);
    try {
      if (needsSetup) {
        await setupOwner(email.trim(), password, displayName.trim());
      } else {
        await login(email.trim(), password);
      }
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="centered">
      <div className="auth-card">
        <p className="eyebrow">{tenantName || "Prodigy"}</p>
        {needsSetup ? (
          <>
            <h1>Welcome — let's set up your account</h1>
            <p className="sub">
              You're the Owner. Create your sign-in below; you'll always have full access and can invite your team next.
            </p>
            <label className="field">
              <span>Your name</span>
              <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Amber" autoFocus />
            </label>
          </>
        ) : (
          <>
            <h1>Sign in</h1>
            <p className="sub">Welcome back. Sign in to {tenantName || "your workspace"}.</p>
          </>
        )}

        <label className="field">
          <span>Email</span>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoFocus={!needsSetup}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={needsSetup ? "At least 8 characters" : "Your password"}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !needsSetup) void submit();
            }}
          />
        </label>
        {needsSetup && (
          <label className="field">
            <span>Confirm password</span>
            <input
              className="input"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter your password"
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </label>
        )}

        {err && <p className="bad small">{err}</p>}
        <button className="btn primary block" disabled={busy} onClick={() => void submit()}>
          {busy ? "Please wait\u2026" : needsSetup ? "Create my account" : "Sign in"}
        </button>
      </div>
    </div>
  );
}
