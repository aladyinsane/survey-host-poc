"use client";

import { useCallback, useEffect, useState } from "react";

type Row = {
  id: string;
  orgName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  ownerEmail: string;
  npi: string | null;
  duplicateNpi: boolean;
};

type AuditEvent = { at: string; event: string; responseId: string | null };

const fmt = (s: string | null) => (s ? new Date(s).toLocaleString() : "");

export default function Admin() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [editing, setEditing] = useState<{ id: string; email: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/responses");
    setRows(res.ok ? (await res.json()).responses : null);
    const a = await fetch("/api/admin/audit");
    if (a.ok) setAudit((await a.json()).events);
  }, []);

  useEffect(() => {
    async function first() {
      const res = await fetch("/api/admin/responses");
      setRows(res.ok ? (await res.json()).responses : null);
      const a = await fetch("/api/admin/audit");
      if (a.ok) setAudit((await a.json()).events);
    }
    void first();
  }, []);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setPassword("");
    if (!res.ok) return setMessage(res.status === 429 ? "Too many attempts." : "Invalid login.");
    await load();
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    setRows(null);
    setEditing(null);
  }

  async function revoke(r: Row) {
    setMessage("");
    if (!window.confirm(`Revoke the response for ${r.orgName}? This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/responses/${r.id}/revoke`, { method: "POST" });
    if (!res.ok) return setMessage((await res.json()).error ?? "Failed.");
    await load();
  }

  // Only after confirming by phone that the new person speaks for the organization.
  async function changeOwner(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setMessage("");
    const res = await fetch(`/api/admin/responses/${editing.id}/owner`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: editing.email }),
    });
    if (!res.ok) return setMessage((await res.json()).error ?? "Failed.");
    setEditing(null);
    setMessage("Owner changed. The previous owner has been signed out.");
    await load();
  }

  if (!rows) {
    return (
      <main>
        <h1>Admin</h1>
        <form onSubmit={login}>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button>Sign in</button>
          {message && <p role="alert">{message}</p>}
        </form>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: "70rem" }}>
      <h1>Responses</h1>
      <div className="row">
        <a className="button" href="/api/admin/export">
          Export CSV
        </a>
        <button onClick={logout}>Sign out</button>
      </div>
      {message && <p role="alert">{message}</p>}
      <table>
        <thead>
          <tr>
            <th>Organization</th>
            <th>NPI</th>
            <th>Owner email</th>
            <th>Status</th>
            <th>Started</th>
            <th>Last saved</th>
            <th>Submitted</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.orgName}</td>
              <td>
                {r.npi}
                {r.duplicateNpi && <div className="flag">Duplicate NPI</div>}
              </td>
              <td>
                {editing?.id === r.id ? (
                  <form onSubmit={changeOwner}>
                    <input
                      type="email"
                      value={editing.email}
                      onChange={(e) => setEditing({ id: r.id, email: e.target.value })}
                      required
                      autoFocus
                    />
                    <div className="row">
                      <button>Save</button>
                      <button type="button" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  r.ownerEmail
                )}
              </td>
              <td>{r.status}</td>
              <td>{fmt(r.createdAt)}</td>
              <td>{fmt(r.updatedAt)}</td>
              <td>{fmt(r.submittedAt)}</td>
              <td>
                {r.status === "in_progress" && editing?.id !== r.id && (
                  <div className="row">
                    <button onClick={() => setEditing({ id: r.id, email: "" })}>
                      Change owner
                    </button>
                    <button onClick={() => revoke(r)}>Revoke</button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p>No responses yet.</p>}

      <h2>Recent activity</h2>
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Event</th>
            <th>Response</th>
          </tr>
        </thead>
        <tbody>
          {audit.map((e, i) => (
            <tr key={i}>
              <td>{fmt(e.at)}</td>
              <td>{e.event}</td>
              <td>{e.responseId ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
