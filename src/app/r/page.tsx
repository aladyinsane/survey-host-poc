"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { isValidNpi } from "@/lib/npi";
import { survey } from "@/lib/survey";
import SignIn from "../SignIn";

type ResponseData = {
  orgName: string;
  npi: string | null;
  status: "in_progress" | "submitted";
  answers: Record<string, number | null>;
  version: number;
  submittedAt: string | null;
};

type Me = {
  email: string;
  closesAt: string | null;
  closed: boolean;
  response: ResponseData | null;
};

type Action = "save" | "submit" | "exit";

function parse(v: string): number | null | "bad" {
  const t = v.replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : "bad";
}

async function fetchMe(): Promise<Me | "signed_out" | "error"> {
  const res = await fetch("/api/responses/me").catch(() => null);
  if (res?.status === 401) return "signed_out";
  if (!res?.ok) return "error";
  return res.json();
}

const fmtDate = (s: string) => new Date(s).toLocaleDateString(undefined, { dateStyle: "long" });

export default function Respond() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  // Set when the session ended mid-sitting: typed answers stay on screen while they sign in again.
  const [reauthFor, setReauthFor] = useState<Action | null>(null);
  const [conflict, setConflict] = useState(false);

  const apply = useCallback(
    (result: Me | "signed_out" | "error") => {
      if (result === "signed_out") return router.replace("/");
      if (result === "error")
        return setMessage("Could not load your survey. Reload the page to try again.");
      setMe(result);
      setValues(
        Object.fromEntries(
          Object.entries(result.response?.answers ?? {}).map(([k, v]) => [
            k,
            v === null ? "" : String(v),
          ]),
        ),
      );
    },
    [router],
  );

  const load = useCallback(() => fetchMe().then(apply), [apply]);

  useEffect(() => {
    fetchMe().then(apply);
  }, [apply]);

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

  async function signOut() {
    await fetch("/api/auth/signout", { method: "POST" }).catch(() => {});
  }

  // Runs a save, submit, or save-and-exit. A 401 opens sign-in in place and retries afterwards.
  async function run(action: Action) {
    if (!me?.response) return;
    setMessage("");
    setConfirming(false);
    const answers = collect();
    if (!answers) return;
    const res = await fetch(
      action === "submit" ? "/api/responses/me/submit" : "/api/responses/me",
      {
        method: action === "submit" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, version: me.response.version }),
      },
    ).catch(() => null);
    if (!res) return setMessage("Couldn't reach the server. Your answers are still on screen.");
    if (res.status === 401) return setReauthFor(action);
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      if (action === "exit") {
        await signOut();
        return router.push("/?saved=1");
      }
      if (action === "submit") return load();
      setMe({ ...me, response: { ...me.response, version: data.version } });
      return setMessage(`Saved at ${new Date().toLocaleTimeString()}.`);
    }
    if (data.reason === "changed") return setConflict(true);
    if (data.reason === "submitted" || data.reason === "closed") {
      setMessage(data.error);
      return load();
    }
    setMessage(
      res.status === 400 && action === "submit"
        ? "Every question needs an answer before you submit."
        : (data.error ?? "Could not save."),
    );
  }

  if (!me)
    return (
      <main>
        <p>{message || "Loading..."}</p>
      </main>
    );

  const header = (
    <div className="row header">
      <span>Signed in as {me.email}</span>
      {me.response?.status === "in_progress" && !me.closed ? (
        <button type="button" onClick={() => run("exit")}>
          Save and exit
        </button>
      ) : (
        <button
          type="button"
          onClick={async () => {
            await signOut();
            router.push("/");
          }}
        >
          Sign out
        </button>
      )}
    </div>
  );

  if (reauthFor) {
    return (
      <main>
        <h1>Sign in again to keep going</h1>
        <p className="notice">
          You were signed out, but your answers are still here and haven&apos;t been lost. Sign in
          and we&apos;ll {reauthFor === "submit" ? "submit" : "save"} them.
        </p>
        <SignIn
          lockedEmail={me.email}
          onSignedIn={() => {
            const action = reauthFor;
            setReauthFor(null);
            void run(action);
          }}
        />
      </main>
    );
  }

  if (!me.response) {
    return (
      <main>
        {header}
        <h1>{survey.title}</h1>
        {me.closed ? (
          <p>The survey closed{me.closesAt ? ` on ${fmtDate(me.closesAt)}` : ""}.</p>
        ) : (
          <StartForm onStarted={load} closesAt={me.closesAt} />
        )}
      </main>
    );
  }

  const r = me.response;
  const readOnly = r.status === "submitted" || me.closed;

  return (
    <main>
      {header}
      <h1>{survey.title}</h1>
      <p>
        Organization: {r.orgName}
        {r.npi && <> (NPI {r.npi})</>}
      </p>
      {r.status === "submitted" ? (
        <p role="status" className="notice">
          <strong>
            Submitted{r.submittedAt ? ` on ${fmtDate(r.submittedAt)}` : ""}. Thank you.
          </strong>{" "}
          Your answers are shown below and can no longer be changed.
        </p>
      ) : me.closed ? (
        <p role="status" className="notice">
          The survey closed{me.closesAt ? ` on ${fmtDate(me.closesAt)}` : ""}. This response was not
          submitted.
        </p>
      ) : (
        me.closesAt && <p>The survey closes on {fmtDate(me.closesAt)}.</p>
      )}

      {conflict && (
        <div className="notice" role="alert">
          These answers were changed in another window or on another device. Reload to see the
          latest version. Anything you changed here since your last save will be lost.
          <div className="row">
            <button
              type="button"
              onClick={() => {
                setConflict(false);
                void load();
              }}
            >
              Reload
            </button>
          </div>
        </div>
      )}

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
                  readOnly={readOnly}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                />
              </label>
            ))}
          </fieldset>
        ))}
        {readOnly ? (
          <div className="row no-print">
            <button type="button" onClick={() => window.print()}>
              Print or save as PDF
            </button>
          </div>
        ) : (
          <div className="row no-print">
            <button type="button" onClick={() => run("save")}>
              Save
            </button>
            {confirming ? (
              <>
                <button type="button" onClick={() => run("submit")}>
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
        )}
        {confirming && <p>After submitting you cannot change your answers.</p>}
        {message && <p role="status">{message}</p>}
      </form>
    </main>
  );
}

function StartForm({ onStarted, closesAt }: { onStarted: () => void; closesAt: string | null }) {
  const router = useRouter();
  const [orgName, setOrgName] = useState("");
  const [npi, setNpi] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!isValidNpi(npi.trim()))
      return setError("That NPI isn't valid. Check the 10 digits and try again.");
    setBusy(true);
    const res = await fetch("/api/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgName, npi: npi.trim() }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok || res?.status === 409) return onStarted();
    if (res?.status === 401) return router.replace("/");
    const data = await res?.json().catch(() => ({}));
    setError(data?.error ?? "Could not start the survey. Try again.");
  }

  return (
    <form onSubmit={start}>
      <p>
        Start your organization&apos;s survey. Only one person per organization should fill it in.
        {closesAt && ` The survey closes on ${fmtDate(closesAt)}.`}
      </p>
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
      <label>
        Organization NPI (10 digits)
        <input
          value={npi}
          onChange={(e) => setNpi(e.target.value.replace(/\D/g, "").slice(0, 10))}
          inputMode="numeric"
          pattern="[0-9]{10}"
          required
        />
      </label>
      <button disabled={busy}>Start the survey</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
