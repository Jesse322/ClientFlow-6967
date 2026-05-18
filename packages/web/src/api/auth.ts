import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./database/schema";

export const createAuth = (env: { BETTER_AUTH_SECRET?: string; DATABASE_URL?: string; DATABASE_AUTH_TOKEN?: string; [key: string]: any }, baseURL: string) => {
  const databaseUrl = env.DATABASE_URL || process.env.DATABASE_URL;
  const secret = env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to initialize auth");
  }

  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required to initialize auth");
  }

  const libsql = createClient({
    url: databaseUrl,
    authToken: env.DATABASE_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN,
  });
  const db = drizzle(libsql, { schema });

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    secret,
    baseURL,
    trustedOrigins: ["*"],
    user: {
      additionalFields: {
        role: {
          type: "string",
          defaultValue: "member",
          required: true,
          input: true,
        },
        airtableId: {
          type: "string",
          required: false,
          input: true,
        },
      },
    },
  });
};
