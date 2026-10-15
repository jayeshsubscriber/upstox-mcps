/** Keeps the app state in data/state.json so a restart doesn't lose the demo. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AppState } from "../shared/types";
import { initialState, upgradeState } from "./seed";

const FILE = path.resolve(process.cwd(), "data", "state.json");

export function loadState(now: Date): AppState {
  try {
    if (existsSync(FILE)) {
      const s = JSON.parse(readFileSync(FILE, "utf8")) as AppState;
      if (s && Array.isArray(s.agents) && Array.isArray(s.requests)) return upgradeState(s, now);
    }
  } catch (e) {
    console.warn(`[store] couldn't read ${FILE}: ${(e as Error).message}; starting fresh`);
  }
  return initialState(now);
}

let timer: NodeJS.Timeout | null = null;
/** Writes at most every 300 ms, atomically (write then rename). */
export function saveState(s: AppState) {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(s));
    renameSync(tmp, FILE);
  }, 300);
}
