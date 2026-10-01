// Runs once when the server starts. Fails fast if config is wrong or the database is unreachable.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { migrate } = await import("./lib/migrate");
    await migrate();
  }
}
