export const STORAGE_KEY = "disabledOrigins";

export function originOf(url) {
  try {
    const { protocol, origin } = new URL(url);
    return protocol === "http:" || protocol === "https:" || protocol === "file:" ? origin : null;
  } catch {
    return null;
  }
}

export function isDisabled(disabledOrigins, origin) {
  return Boolean(origin && disabledOrigins?.[origin]);
}

export function setDisabled(disabledOrigins, origin, disabled) {
  const next = { ...disabledOrigins };
  if (disabled) next[origin] = true;
  else delete next[origin];
  return next;
}
