/**
 * Cookie parsing and serialisation.
 *
 * TanStack Start exposes request headers and response headers but no cookie helper, so the two
 * lines that matter are here rather than duplicated at each call site. They are written out rather
 * than pulled from a library because the whole of what is needed is below, and a dependency for
 * `split(';')` is not worth the supply chain.
 */

/** Read one cookie from a `Cookie:` header. Returns undefined when absent or empty. */
export function readCookie(header: string | undefined | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      const value = part.slice(index + 1).trim();
      return value === "" ? undefined : decodeURIComponent(value);
    }
  }
  return undefined;
}

export interface CookieAttributes {
  httpOnly?: boolean;
  sameSite?: "lax" | "strict" | "none";
  secure?: boolean;
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
}

/**
 * Serialise a `Set-Cookie` value.
 *
 * `encodeURIComponent` is applied to the value because a session token is base64url and would
 * survive untouched, but a value that is ever extended to carry a character like `;` or `,` would
 * otherwise silently truncate the cookie — a failure that presents as a random sign-out.
 */
export function serialiseCookie(
  name: string,
  value: string,
  attributes: CookieAttributes = {}
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (attributes.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(attributes.maxAge)}`);
  if (attributes.expires) parts.push(`Expires=${attributes.expires.toUTCString()}`);
  parts.push(`Path=${attributes.path ?? "/"}`);
  if (attributes.domain) parts.push(`Domain=${attributes.domain}`);
  if (attributes.httpOnly) parts.push("HttpOnly");
  if (attributes.secure) parts.push("Secure");
  if (attributes.sameSite) {
    parts.push(`SameSite=${attributes.sameSite.charAt(0).toUpperCase()}${attributes.sameSite.slice(1)}`);
  }

  return parts.join("; ");
}

/** A cookie that clears the value, for sign-out. Attributes must match how it was set. */
export function clearedCookie(name: string, attributes: CookieAttributes = {}): string {
  return serialiseCookie(name, "", { ...attributes, maxAge: 0, expires: new Date(0) });
}
