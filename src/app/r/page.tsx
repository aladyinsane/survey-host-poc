"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { survey } from "@/lib/survey";

const TOKEN_KEY = "survey-token";

type Loaded = {
  orgName: string;
  status: "in_progress" | "submitted";
  answers: Record<string, number | null>;
};

function parse(v: string): number | null | "bad" {
  const t = v.replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : "bad";
}

export default function Respond() {
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "invalid" | "ready">("loading");
  const [data, setData] = useState<Loaded | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function load() {
      let t = window.location.hash.slice(1);
      if (!t) {
        try {
          t = localStorage.getItem(TOKEN_KEY) ?? "";
        } catch {}
        if (t) history.replaceState(null, "", `#${t}`);
      }
      if (!t) return setState("invalid");
      setToken(t);
      try {
        const res = await fetch("/api/responses/me", { headers: { Authorization: `Bearer ${t}` } });
        if (!res.ok) return setState("invalid");
        const d: Loaded = await res.json();
        setData(d);
        setValues(
          Object.fromEntries(
            Object.entries(d.answers).map(([k, v]) => [k, v === null ? "" : String(v)]),
          ),
        );
        setState("ready");
      } catch {
        setState("invalid");
      }
    }
    void load();
  }, []);

  function collect(): Record<string, number | null> | null {
    const out: Record<string, number | null> = {};
    for (const s of survey.sections) {
      for (const f of s.fields) {
        const p = parse(values[f.key] ?? "");
        if (p === "bad") {
          setMessage(`"${f.label}" must be a number, zero or more.`);
          return null;
        }
        out[f.key] = p;
      }
    }
    return out;
  }

  async function send(path: string, method: string, body: unknown) {
    return fetch(path, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  }

  async function save() {
    setMessage("");
    const a = collect();
    if (!a) return;
    const res = await send("/api/responses/me", "PUT", a);
    setMessage(res.ok ? `Saved at ${new Date().toLocaleTimeString()}.` : "Could not save.");
  }

  async function submit() {
    setMessage("");
    setConfirming(false);
    const a = collect();
    if (!a) return;
    const res = await send("/api/responses/me/submit", "POST", a);
    if (res.ok) {
      setData((d) => (d ? { ...d, status: "submitted" } : d));
    } else {
      setMessage(
        res.status === 400
          ? "Every question needs an answer before you submit."
          : "Could not submit.",
      );
    }
  }

  if (state === "loading")
    return (
      <main>
        <p>Loading...</p>
      </main>
    );
  if (state === "invalid" || !data || !token)
    return (
      <main>
        <h1>Link not found</h1>
        <p>
          This link is not valid, or has expired. Check that you copied the whole link. If you lost
          it, contact the survey administrator. Or <Link href="/">start over</Link>.
        </p>
      </main>
    );

  const link = `${window.location.origin}/r#${token}`;
  const mailto = `mailto:?subject=${encodeURIComponent("My survey link")}&body=${encodeURIComponent(
    `Use this link to resume the survey. Anyone with the link can see and change your answers.\n\n${link}`,
  )}`;
  const done = data.status === "submitted";

  return (
    <main>
      <h1>{survey.title}</h1>
      <p>Organization: {data.orgName}</p>

      <section className="notice">
        <strong>Keep this link.</strong> It is the only way back to your answers, and anyone who has
        it can see and change them. Do not share it.
        <code>{link}</code>
        <div className="row">
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true))}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          <a
            className="button"
            download="survey-link.txt"
            href={`data:text/plain;charset=utf-8,${encodeURIComponent(link + "\n")}`}
          >
            Download as file
          </a>
          <a className="button" href={mailto}>
            Email to myself
          </a>
        </div>
      </section>

      {done ? (
        <p role="status">
          <strong>Submitted. Thank you.</strong> Your response is locked.
        </p>
      ) : (
        <form onSubmit={(e) => e.preventDefault()}>
          {survey.sections.map((s) => (
            <fieldset key={s.title}>
              <legend>{s.title}</legend>
              {s.fields.map((f) => (
                <label key={f.key}>
                  {f.label}
                  <input
                    inputMode="decimal"
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  />
                </label>
              ))}
            </fieldset>
          ))}
          <div className="row">
            <button type="button" onClick={save}>
              Save and continue later
            </button>
            {confirming ? (
              <>
                <button type="button" onClick={submit}>
                  Yes, submit final answers
                </button>
                <button type="button" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirming(true)}>
                Submit
              </button>
            )}
          </div>
          {confirming && <p>After submitting you cannot change your answers.</p>}
          {message && <p role="status">{message}</p>}
        </form>
      )}
    </main>
  );
}
