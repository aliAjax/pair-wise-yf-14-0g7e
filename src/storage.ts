import type { PersistState } from "./types";

const KEY = "tour-light-mapper:v1";

export function emptyState(): PersistState {
  return {
    versions: [],
    selectedVersionId: null,
    overrides: {},
    mappings: {},
    history: {},
  };
}

export function loadState(): PersistState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as PersistState;
    return { ...emptyState(), ...parsed };
  } catch {
    return emptyState();
  }
}

export function saveState(state: PersistState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // 存储满或被禁用时静默：本次会话仍可用
  }
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}
