"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

const TOKEN_KEY = "survey-token";

export default function Home() {
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const router = useRouter();
  // Reads localStorage without a setState-in-effect; null on the server and when unavailable.
  const saved = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return localStorage.getItem(TOKEN_KEY);
      } catch {
        return null;
      }
    },
    () => null,
  );

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgName }),
    });
    if (!res.ok) {
      setBusy(false);
      setError(
        res.status === 429
          ? "Too many attempts. Try again later."
          : "Enter your organization name.",
      );
      return;
    }
    const { token } = await res.json();
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {}
    router.push(`/r#${token}`);
  }

  return (
    <main>
      <h1>Provider Survey</h1>
      <p>
        Start your survey below. You will get a unique link. <strong>Keep that link</strong>: it is
        the only way to come back, save your work, and finish later.
      </p>
      {saved && (
        <p className="notice">
          You have a survey in progress on this device. <a href={`/r#${saved}`}>Resume it</a>.
        </p>
      )}
      <form onSubmit={start}>
        <label>
          Organization name
          <input
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            maxLength={200}
            required
            autoComplete="organization"
          />
        </label>
        <button disabled={busy}>Start a new survey</button>
        {error && <p role="alert">{error}</p>}
      </form>
    </main>
  );
}
