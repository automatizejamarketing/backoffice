"use client";

import {
  parseUserContactMarks,
  serializeUserContactMarks,
  setUserContactMark,
  USER_CONTACT_MARKS_COOKIE_MAX_AGE,
  USER_CONTACT_MARKS_COOKIE_NAME,
  USER_CONTACT_MARKS_STORAGE_KEY,
} from "./user-contact-marks";

function readCookie(): string | null {
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${USER_CONTACT_MARKS_COOKIE_NAME}=([^;]*)`),
  );
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function writeCookie(serialized: string) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${USER_CONTACT_MARKS_COOKIE_NAME}=${encodeURIComponent(serialized)}; Path=/; Max-Age=${USER_CONTACT_MARKS_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

export function readUserContactMarks(): string[] {
  try {
    const stored = window.localStorage.getItem(USER_CONTACT_MARKS_STORAGE_KEY);
    const fromStorage = parseUserContactMarks(stored);
    if (fromStorage.length > 0) return fromStorage;
  } catch {
    // Private mode or a blocked storage API should still fall back to the cookie.
  }

  return parseUserContactMarks(readCookie());
}

export function writeUserContactMarks(ids: string[]): string[] {
  const serialized = serializeUserContactMarks(ids);
  const next = parseUserContactMarks(serialized);

  try {
    window.localStorage.setItem(
      USER_CONTACT_MARKS_STORAGE_KEY,
      JSON.stringify(next),
    );
  } catch {
    // Cookie is enough for the server-side filter.
  }

  writeCookie(serialized);
  return next;
}

export function persistUserContactMark(userId: string, contacted: boolean) {
  return writeUserContactMarks(
    setUserContactMark(readUserContactMarks(), userId, contacted),
  );
}

export function resolveContactedUserIds(serverIds: string[] = []): string[] {
  return [...new Set([...serverIds, ...readUserContactMarks()])];
}
