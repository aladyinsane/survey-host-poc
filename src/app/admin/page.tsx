"use client";

import { useCallback, useEffect, useState } from "react";

type Row = {
  id: string;
  orgName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  expiresAt: string;
};

const fmt = (s: string | null) => (s ? new Date(s).toLocaleString() : "");

export default function Admin() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [newLink, setNewLink] = useState<{ org: string; link: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/responses");
    setRows(res.ok ? (await res.json()).responses : null);
  }, []);

  useEffect(() => {
    async function first() {
      const res = await fetch("/api/admin/responses");
      setRows(res.ok ? (await res.json()).responses : null);
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
    setNewLink(null);
  }

  async function act(r: Row, action: "revoke" | "reissue") {
    setMessage("");
    setNewLink(null);
    const res = await fetch(`/api/admin/responses/${r.id}/${action}`, { method: "POST" });
    if (!res.ok) return setMessage((await res.json()).error ?? "Failed.");
    if (action === "reissue") {
      const { token } = await res.json();
      setNewLink({ org: r.orgName, link: `${window.location.origin}/r#${token}` });
    }
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
      {newLink && (
        <p className="notice">
          New link for <strong>{newLink.org}</strong>. The old link no longer works. Shown once:
          <code>{newLink.link}</code>
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>Organization</th>
            <th>Status</th>
            <th>Started</th>
            <th>Last saved</th>
            <th>Submitted</th>
            <th>Link expires</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.orgName}</td>
              <td>{r.status}</td>
              <td>{fmt(r.createdAt)}</td>
              <td>{fmt(r.updatedAt)}</td>
              <td>{fmt(r.submittedAt)}</td>
              <td>{fmt(r.expiresAt)}</td>
              <td>
                {r.status === "in_progress" && (
                  <div className="row">
                    <button onClick={() => act(r, "reissue")}>New link</button>
                    <button onClick={() => act(r, "revoke")}>Revoke</button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p>No responses yet.</p>}
    </main>
  );
}
