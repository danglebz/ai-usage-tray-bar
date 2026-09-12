// Shared helpers for providers. No provider-specific knowledge lives here.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pkg from "../../package.json" with { type: "json" };
import type { Extra, Severity, Snapshot, UsageWindow } from "../types.ts";

// "name/version (+url)" is the convention for a tool identifying itself to the services it calls.
const REPO_URL = pkg.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");
export const USER_AGENT = `${pkg.name}/${pkg.version} (+${REPO_URL})`;

/** Absolute path under the user's home directory. */
export function home(...parts: string[]): string {
  return path.join(os.homedir(), ...parts);
}

/** Read and parse a JSON file; returns null when missing or unparsable. */
export function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Read a JSON file whose top level is an object; null for anything else. */
export function readJsonObject(file: string): Record<string, unknown> | null {
  const j = readJson(file);
  return isObject(j) ? j : null;
}

/** Narrow an unknown value to a plain object so its keys can be read. */
export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** `v[key]` when `v` is an object, else undefined. Saves a chain of `&&` on untyped JSON. */
export function prop(v: unknown, key: string): unknown {
  return isObject(v) ? v[key] : undefined;
}

/** `v` as a string, else null. */
export function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** `v` as a finite number, else null. */
export function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Decode the payload of a JWT without verifying it. Returns null on any failure. */
export function decodeJwt(token: unknown): Record<string, unknown> | null {
  try {
    const part = String(token).split(".")[1] ?? "";
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const payload: unknown = JSON.parse(json);
    return isObject(payload) ? payload : null;
  } catch {
    return null;
  }
}

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface FetchResult {
  status: number;
  ok: boolean;
  /** Parsed body, or null when it was not JSON. */
  json: unknown;
  text: string;
}

/**
 * fetch() with a hard timeout. Resolves to { status, ok, json, text }.
 * Never throws on HTTP errors; throws only on network failure / timeout.
 */
export async function fetchJson(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  const { method = "GET", headers = {}, body, timeoutMs = 10_000 } = options;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...headers },
      body,
      signal: ac.signal,
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON body; keep text */
    }
    return { status: res.status, ok: res.ok, json, text };
  } finally {
    clearTimeout(timer);
  }
}

/** Clamp a number into [0, 100] and round to one decimal; null passes through. */
export function pct(n: unknown): number | null {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Math.max(0, Math.min(100, Math.round(Number(n) * 10) / 10));
}

/** Convert unix seconds, ms, or ISO string to an ISO string; null when unknown. */
export function toIso(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Human label for a rolling window given its length in seconds. */
export function windowLabel(seconds: number | null | undefined): string {
  if (!seconds) return "Window";
  const h = seconds / 3600;
  if (Math.abs(h - 5) < 0.5) return "5-hour";
  if (Math.abs(h - 168) < 1) return "Weekly";
  if (Math.abs(h - 24) < 0.5) return "Daily";
  if (h >= 24) return `${Math.round(h / 24)}-day`;
  return `${Math.round(h)}-hour`;
}

/** Severity bucket used by the UI and the tray icon. */
export function severity(percent: number | null): Severity {
  if (percent == null) return "unknown";
  if (percent >= 90) return "critical";
  if (percent >= 70) return "warning";
  return "normal";
}

/** Build a window entry. `percent` is USED percent. */
export function win(
  label: string,
  percent: unknown,
  resetsAt: unknown,
  extra: Partial<Pick<UsageWindow, "detail" | "active" | "note">> = {},
): UsageWindow {
  const p = pct(percent);
  return { label, percent: p, resetsAt: toIso(resetsAt), severity: severity(p), ...extra };
}

type SnapFields = Partial<Omit<Snapshot, "status" | "fetchedAt">>;

function base(status: Snapshot["status"], fields: SnapFields): Snapshot {
  return { status, windows: [], extras: [], ...fields, fetchedAt: new Date().toISOString() };
}

/** Snapshot constructors so every provider returns the same shape. */
export const snap = {
  ok: (fields: SnapFields): Snapshot => base("ok", { source: "api", ...fields }),
  notConfigured: (message: string, fields: SnapFields = {}): Snapshot => base("not_configured", { message, ...fields }),
  notLoggedIn: (message: string, fields: SnapFields = {}): Snapshot => base("not_logged_in", { message, ...fields }),
  expired: (message: string, fields: SnapFields = {}): Snapshot => base("expired", { message, ...fields }),
  error: (message: string, fields: SnapFields = {}): Snapshot => base("error", { message, ...fields }),
};

/** Format a USD amount from a number of dollars; "?" when unknown so it can sit in any label. */
export function usd(n: unknown): string {
  if (n == null || Number.isNaN(Number(n))) return "?";
  return `$${Number(n).toFixed(2)}`;
}

/** Build an extras line. */
export function extra(label: string, value: string): Extra {
  return { label, value };
}

/** First day of the current month (UTC) as ISO and unix seconds. */
export function monthStart(): { iso: string; unix: number } {
  const d = new Date();
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  return { iso: start.toISOString(), unix: Math.floor(start.getTime() / 1000) };
}

export interface FoundFile {
  path: string;
  mtimeMs: number;
}

/** Walk a directory tree and return files matching `pred`, newest first. Silently skips unreadable dirs. */
export function walkFiles(root: string, pred: (file: string) => boolean, { maxDepth = 6 } = {}): FoundFile[] {
  const out: FoundFile[] = [];
  const visit = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) visit(p, depth + 1);
      else if (e.isFile() && pred(p)) {
        try {
          out.push({ path: p, mtimeMs: fs.statSync(p).mtimeMs });
        } catch {
          /* vanished */
        }
      }
    }
  };
  visit(root, 0);
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}
