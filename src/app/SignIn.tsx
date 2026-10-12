"use client";

import { useState } from "react";

type Props = {
  // Prefilled and locked when re-signing in mid-survey, so the session stays with the same owner.
  lockedEmail?: string;
  onSignedIn: () => void;
};

async function post(path: string, body: unknown): Promise<{ ok: boolean; error: string }> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true, error: "" };
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.error ?? "Something went wrong. Try again." };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

export default function SignIn({ lockedEmail, onSignedIn }: Props) {
  const [email, setEmail] = useState(lockedEmail ?? "");
  const [step, setStep] = useState<"email" | "code">("email");
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const r = await post("/api/auth/code", { email });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setCode("");
    setStep("code");
    setNotice(
      `We sent a code to ${email.trim()}. It can take a minute. Check junk mail if it doesn't arrive.`,
    );
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await post("/api/auth/verify", { email, code: code.trim(), remember });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onSignedIn();
  }

  if (step === "email") {
    return (
      <form onSubmit={sendCode} className="signin">
        <label>
          Work email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            readOnly={!!lockedEmail}
            maxLength={254}
            autoComplete="email"
            required
          />
        </label>
        <button disabled={busy}>Send code</button>
        {error && <p role="alert">{error}</p>}
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="signin">
      {notice && <p role="status">{notice}</p>}
      <label>
        6-digit code
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          required
          autoFocus
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Keep me signed in on this device for 14 days. Don&apos;t use this on a shared computer.
      </label>
      <button disabled={busy}>Sign in</button>
      {error && <p role="alert">{error}</p>}
      <div className="row">
        <button type="button" className="link" onClick={() => sendCode()} disabled={busy}>
          Send a new code
        </button>
        {!lockedEmail && (
          <button
            type="button"
            className="link"
            onClick={() => {
              setStep("email");
              setError("");
              setNotice("");
            }}
          >
            Use a different email
          </button>
        )}
      </div>
    </form>
  );
}
