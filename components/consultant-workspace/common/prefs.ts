"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

const PREF_EVENT = "trafego-pref";

function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function subscribe(key: string, onChange: () => void) {
  const handler = (event: Event) => {
    if (event instanceof StorageEvent && event.key !== key) return;
    onChange();
  };
  window.addEventListener("storage", handler);
  window.addEventListener(PREF_EVENT, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(PREF_EVENT, handler);
  };
}

/** Preferência de tela neste navegador (colunas, densidade, carteira). Falha em silêncio. */
export function useLocalPref<T>(key: string, fallback: T): [T, (value: T) => void] {
  const raw = useSyncExternalStore(
    (onChange) => subscribe(key, onChange),
    () => readPref(key),
    () => null,
  );
  const value = useMemo(() => {
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
    // fallback é estável por chamada; só o valor bruto importa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);
  const set = useCallback(
    (next: T) => {
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // sem armazenamento (aba privada): a preferência vale só até recarregar
      }
      window.dispatchEvent(new Event(PREF_EVENT));
    },
    [key],
  );
  return [value, set];
}
