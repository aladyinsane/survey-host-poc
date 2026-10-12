import { randomBytes } from "node:crypto";

// Test defaults so env() validates. Database tests point DATABASE_URL at TEST_DATABASE_URL.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://unused";
process.env.DATA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.ADMIN_PASSWORD_HASH = "scrypt:16384:8:1:c2FsdA:aGFzaA";
process.env.ADMIN_SESSION_SECRET = "t".repeat(32);
process.env.MAIL_TRANSPORT = "log";
