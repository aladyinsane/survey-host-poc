"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import SignIn from "./SignIn";

export default function Home() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [savedNote, setSavedNote] = useState(false);

  // Already signed in (for example "keep me signed in"): go straight to the survey.
  useEffect(() => {
    async function check() {
      setSavedNote(new URLSearchParams(window.location.search).has("saved"));
      try {
        const res = await fetch("/api/responses/me");
        if (res.ok) return router.replace("/r");
      } catch {}
      setChecking(false);
    }
    void check();
  }, [router]);

  if (checking)
    return (
      <main>
        <p>Loading...</p>
      </main>
    );

  return (
    <main>
      <h1>Provider Survey</h1>
      {savedNote && (
        <p className="notice" role="status">
          Your answers are saved. To come back, open this page and sign in with the same email.
        </p>
      )}
      <p>
        Sign in with your work email. We&apos;ll email you a code each time you sign in. Your
        answers are saved as you go, so you can stop and come back, on this or another device, until
        the survey closes.
      </p>
      <SignIn onSignedIn={() => router.push("/r")} />
    </main>
  );
}
