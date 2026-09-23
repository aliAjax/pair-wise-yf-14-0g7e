import type { AppState } from "./types";
import { createInitialState } from "./seed";

const STORAGE_KEY = "tour-light-map:v1";

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (parsed?.venues?.length && parsed?.versions?.length) return parsed;
    }
  } catch {
    // 本地数据损坏时回落到预置
  }
  return createInitialState();
}

export function saveState(state: AppState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储满或不可用时静默：本会话仍可继续操作
  }
}

export function resetState(): AppState {
  const fresh = createInitialState();
  saveState(fresh);
  return fresh;
}
