import { useEffect, useState } from "react";
import { api, ApiError } from "./api";

// Web-local mirrors of the API response shapes (we never import server packages into the browser).
interface AiStatus {
  configured: boolean;
  kind: string;
  model: string;
  simulated: boolean;
}
interface AgentStep {
  tool: string;
  status: "ok" | "denied" | "requires_approval" | "error";
  reason?: string;
}
interface AgentApproval {
  id: string;
  tool: string;
  input: unknown;
  status: string;
  actorName: string;
  createdAt: string;
  preview?: string;
}
type AgentRun =
  | { status: "completed"; answer: string; steps: AgentStep[] }
  | { status: "needs_approval"; answer: string; steps: AgentStep[]; pending: { tool: string; input: unknown }[]; approvals: AgentApproval[] }
  | { status: "max_steps"; answer: string; steps: AgentStep[] };

interface Turn {
  role: "user" | "assistant";
  text: string;
  steps?: AgentStep[];
  needsApproval?: boolean;
}

const prettyTool = (name: string): string => name.replace(/_/g, " ");
const statusClass = (s: AgentStep["status"]): string =>
  s === "ok" ? "ok" : s === "requires_approval" ? "warn" : "bad";
const statusLabel = (s: AgentStep["status"]): string =>
  s === "ok" ? "ran" : s === "requires_approval" ? "needs approval" : s === "denied" ? "denied" : "error";

export function Assistant() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<AgentApproval[] | null>(null);
  const [history, setHistory] = useState<AgentApproval[] | null>(null);
  const [busyApproval, setBusyApproval] = useState<string | null>(null);

  useEffect(() => {
    api<AiStatus>("/ai/status").then(setStatus).catch(() => setStatus(null));
    void refreshApprovals();
  }, []);

  const refreshApprovals = async () => {
    try {
      const [pend, hist] = await Promise.all([
        api<{ approvals: AgentApproval[] }>("/ai/approvals"),
        api<{ approvals: AgentApproval[] }>("/ai/approvals/history"),
      ]);
      setApprovals(pend.approvals);
      setHistory(hist.approvals);
    } catch {
      setApprovals([]);
      setHistory([]);
    }
  };

  const historyLabel = (s: string): { text: string; cls: string } =>
    s === "executed" ? { text: "Approved & ran", cls: "ok" } : s === "rejected" ? { text: "Rejected", cls: "warn" } : { text: "Failed", cls: "bad" };

  const send = async () => {
    const message = input.trim();
    if (!message || sending) return;
    setError(null);
    setSending(true);
    setTurns((t) => [...t, { role: "user", text: message }]);
    setInput("");
    try {
      const run = await api<AgentRun>("/ai/agent", "POST", { message });
      const needsApproval = run.status === "needs_approval";
      const answer =
        run.answer && run.answer.trim()
          ? run.answer
          : needsApproval
          ? "I've proposed an action that needs your approval below."
          : "Done.";
      setTurns((t) => [...t, { role: "assistant", text: answer, steps: run.steps, needsApproval }]);
      if (needsApproval) await refreshApprovals();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      setError(msg);
      setTurns((t) => [...t, { role: "assistant", text: `Sorry — ${msg}` }]);
    } finally {
      setSending(false);
    }
  };

  const decide = async (id: string, decision: "approve" | "reject") => {
    setBusyApproval(id);
    setError(null);
    try {
      await api(`/ai/approvals/${id}/${decision}`, "POST");
      await refreshApprovals();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusyApproval(null);
    }
  };

  return (
    <>
      <section className="card">
        <div className="ticket-head">
          <h2>Ask Prodigy</h2>
          {status && (
            <span className={status.simulated ? "tag muted-tag" : "tag"}>
              {status.simulated ? "Simulated (no AI key)" : `Live · ${status.model}`}
            </span>
          )}
        </div>
        <p className="muted small">
          Your AI operations assistant. It can look things up and propose actions across the business — anything
          that writes data or moves money pauses for your approval first. You&rsquo;re always in charge.
        </p>
        {status?.simulated && (
          <p className="muted small">
            Running in simulated mode — set <code>ANTHROPIC_API_KEY</code> to switch to live Claude. Tool calls,
            permissions, and approvals all work the same either way.
          </p>
        )}

        <div className="assistant-thread" aria-live="polite">
          {turns.length === 0 && (
            <p className="muted small">
              Try: &ldquo;What&rsquo;s the trial balance?&rdquo; · &ldquo;List recent sales&rdquo; · &ldquo;Issue a $50 gift card&rdquo;
            </p>
          )}
          {turns.map((turn, i) => (
            <div key={i} className={`assistant-turn ${turn.role}`}>
              <div className="assistant-role">{turn.role === "user" ? "You" : "Prodigy"}</div>
              <div className="assistant-text">{turn.text}</div>
              {turn.steps && turn.steps.length > 0 && (
                <ul className="assistant-steps">
                  {turn.steps.map((s, j) => (
                    <li key={j}>
                      <span className={`step-dot ${statusClass(s.status)}`} aria-hidden="true" />
                      <span className="step-tool">{prettyTool(s.tool)}</span>
                      <span className="muted small"> — {statusLabel(s.status)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        {error && <p className="bad small">{error}</p>}

        <form
          className="form-row"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="sr-only" htmlFor="assistant-input">
            Ask the assistant
          </label>
          <input
            id="assistant-input"
            className="input"
            placeholder="Ask Prodigy anything about the business…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={sending}
          />
          <button className="btn primary" type="submit" disabled={sending || !input.trim()}>
            {sending ? "Thinking…" : "Send"}
          </button>
        </form>
      </section>

      <section className="card">
        <div className="ticket-head">
          <h2>Pending approvals</h2>
          <button className="btn sm" onClick={() => void refreshApprovals()}>
            Refresh
          </button>
        </div>
        <p className="muted small">Actions the assistant proposed that need a human to approve before they run.</p>
        {!approvals && <p className="muted">Loading&hellip;</p>}
        {approvals && approvals.length === 0 && <p className="muted small">Nothing waiting for approval.</p>}
        {approvals && approvals.length > 0 && (
          <ul className="approval-list">
            {approvals.map((a) => (
              <li key={a.id} className="approval-item">
                <div>
                  <div className="approval-tool">{a.preview ?? prettyTool(a.tool)}</div>
                  <div className="muted small">
                    proposed by {a.actorName} · {new Date(a.createdAt).toLocaleString()}
                  </div>
                </div>
                <div className="approval-actions">
                  <button
                    className="btn primary sm"
                    disabled={busyApproval === a.id}
                    onClick={() => void decide(a.id, "approve")}
                  >
                    Approve
                  </button>
                  <button className="btn sm" disabled={busyApproval === a.id} onClick={() => void decide(a.id, "reject")}>
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Recent agent actions</h2>
        <p className="muted small">A log of what the assistant proposed and how each action was decided.</p>
        {!history && <p className="muted">Loading&hellip;</p>}
        {history && history.length === 0 && <p className="muted small">No agent actions yet.</p>}
        {history && history.length > 0 && (
          <ul className="approval-list">
            {history.map((a) => {
              const lbl = historyLabel(a.status);
              return (
                <li key={a.id} className="approval-item">
                  <div>
                    <div className="approval-tool">{a.preview ?? prettyTool(a.tool)}</div>
                    <div className="muted small">{new Date(a.createdAt).toLocaleString()}</div>
                  </div>
                  <span className={`tag ${lbl.cls === "ok" ? "" : "muted-tag"}`}>{lbl.text}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
