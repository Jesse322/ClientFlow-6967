import { createMiddleware } from "hono/factory";
import { createAuth } from "../auth";

const getBaseURL = () => {
  return process.env.WEBSITE_URL?.replace(/\/$/, "") || "http://localhost:4200";
};

export const authMiddleware = createMiddleware(async (c, next) => {
  const env = (c.env || {}) as any;
  if (env && Object.keys(env).length) Object.assign(process.env, env);
  const auth = createAuth({ ...process.env, ...env } as any, getBaseURL());
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    c.set("user", null);
    c.set("session", null);
  } else {
    c.set("user", session.user);
    c.set("session", session.session);
  }
  return next();
});

export const requireAuth = createMiddleware(async (c, next) => {
  const session = c.get("session");
  if (!session) return c.json({ message: "Unauthorized" }, 401);
  return next();
});
