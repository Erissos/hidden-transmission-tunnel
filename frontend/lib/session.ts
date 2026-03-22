import type { Identity } from "@/lib/types";

const storageKey = "htt.identity";
const adminKeyStorageKey = "htt.admin-key";

export function loadStoredIdentity(): Identity | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(storageKey);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as Identity;
  } catch {
    return null;
  }
}

export function storeIdentity(identity: Identity): void {
  window.localStorage.setItem(storageKey, JSON.stringify(identity));
}

export function clearSessionState(): void {
  window.localStorage.removeItem(storageKey);
}

export function loadAdminKey(): string {
  if (typeof window === "undefined") {
    return "";
  }

  return window.sessionStorage.getItem(adminKeyStorageKey) ?? "";
}

export function storeAdminKey(adminKey: string): void {
  window.sessionStorage.setItem(adminKeyStorageKey, adminKey);
}

export function clearAdminKey(): void {
  window.sessionStorage.removeItem(adminKeyStorageKey);
}
