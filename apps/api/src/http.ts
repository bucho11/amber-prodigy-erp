import type { Request, Response, RequestHandler } from "express";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function reqString(v: unknown, field: string): string {
  if (typeof v !== "string" || v.trim() === "") throw new ValidationError(`'${field}' is required`);
  return v.trim();
}
export function optString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new ValidationError("expected a string");
  const t = v.trim();
  return t === "" ? undefined : t;
}
export function reqInt(v: unknown, field: string, min = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < min) throw new ValidationError(`'${field}' must be a whole number >= ${min}`);
  return n;
}
export function optInt(v: unknown, field: string, min = 0): number | undefined {
  if (v === undefined || v === null) return undefined;
  return reqInt(v, field, min);
}
export function optBool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}
export function reqEmail(v: unknown, field = "email"): string {
  const s = reqString(v, field).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new ValidationError(`'${field}' must be a valid email address`);
  return s;
}
export function reqPassword(v: unknown): string {
  if (typeof v !== "string" || v.length < 8) throw new ValidationError("Password must be at least 8 characters.");
  if (v.length > 200) throw new ValidationError("Password is too long.");
  return v;
}

export type AsyncHandler = (req: Request, res: Response) => Promise<void>;
export const wrap = (fn: AsyncHandler): RequestHandler => (req, res, next) => {
  fn(req, res).catch(next);
};
