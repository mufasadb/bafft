import type { RequestParamHandler } from "express";

/** router.param("id", ...) handler: 400s anything that isn't a positive integer before it reaches SQLite as NaN. */
export const requirePositiveIntId: RequestParamHandler = (_req, res, next, value) => {
  if (!/^[1-9]\d*$/.test(String(value))) {
    res.status(400).json({ error: "id must be a positive integer" });
    return;
  }
  next();
};
