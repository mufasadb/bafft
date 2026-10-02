import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

export function passwordAuth(password = process.env.BAFFT_PASSWORD): RequestHandler {
  if (!password) return (_req, _res, next) => next();
  const expected = createHash("sha256").update(password).digest();
  return (req, res, next) => {
    if (req.method === "GET" && req.path === "/api/health") return next();
    const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(req.get("authorization") ?? "");
    const decoded = match ? Buffer.from(match[1]!, "base64").toString("utf8") : "";
    const colon = decoded.indexOf(":");
    const supplied = createHash("sha256").update(colon >= 0 ? decoded.slice(colon + 1) : "").digest();
    if (timingSafeEqual(expected, supplied) && colon >= 0) return next();
    res.set("WWW-Authenticate", 'Basic realm="bafft", charset="UTF-8"');
    res.set("Cache-Control", "no-store");
    res.status(401).json({ error: "Authentication required" });
  };
}

export function warnIfOpen(password = process.env.BAFFT_PASSWORD): void {
  if (!password) console.warn("BAFFT_PASSWORD is unset: bafft is open to anyone who can reach the port.");
}
