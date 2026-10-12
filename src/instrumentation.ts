// Runs once when the server starts. Fails fast if config is wrong or the database is unreachable.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { migrate } = await import("./lib/migrate");
    await migrate();
    const { env } = await import("./lib/env");
    if (env().MAIL_TRANSPORT === "log") {
      console.warn(
        "WARNING: MAIL_TRANSPORT=log writes sign-in codes to the log. Anyone who can read the " +
          "logs can sign in as any respondent. Use it for demos only, never with real respondents.",
      );
    }
  }
}
