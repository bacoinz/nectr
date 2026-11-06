import type { Context } from "hono";
import { badRequest } from "./errors";

// Tiny request validators: enough for this API without a schema library.

export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw badRequest("Pedido inválido.");
  return body as Record<string, unknown>;
}

export function text(v: unknown, field: string, max: number, min = 0): string {
  if (typeof v !== "string") throw badRequest(`${field}: valor em falta.`);
  const s = v.trim();
  if (s.length < min) throw badRequest(min === 1 ? `${field}: não pode ficar vazio.` : `${field}: demasiado curto.`);
  if (s.length > max) throw badRequest(`${field}: máximo de ${max} caracteres.`);
  return s;
}

export const optText = (v: unknown, field: string, max: number, min = 0) => (v === undefined ? undefined : text(v, field, max, min));

export function oneOf<T extends string>(v: unknown, list: readonly T[], field: string): T {
  if (typeof v !== "string" || !(list as readonly string[]).includes(v)) throw badRequest(`${field}: valor inválido.`);
  return v as T;
}

export function int(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw badRequest(`${field}: valor inválido.`);
  return v;
}

const ID = /^[A-Za-z0-9_-]{6,32}$/;

export function id(v: unknown, field: string): string {
  if (typeof v !== "string" || !ID.test(v)) throw badRequest(`${field}: identificador inválido.`);
  return v;
}

/** `undefined` = not sent, `null` = explicitly cleared (e.g. move to the project root). */
export const optNullableId = (v: unknown, field: string) => (v === undefined ? undefined : v === null ? null : id(v, field));

export function idList(v: unknown, field: string, max = 1000): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > max) throw badRequest(`${field}: lista inválida.`);
  return [...new Set(v.map((x) => id(x, field)))];
}
