/**
 * An account's picture, or its initials.
 *
 * WordPress falls back to a mystery-person silhouette; this draws the person's initials, which
 * tells two accounts apart at a glance rather than showing the same grey shape twice. A colour is
 * derived from the email so the same person keeps the same one.
 */
export function Avatar({
  name,
  email,
  url,
  size = 40,
}: {
  name: string;
  email: string;
  url?: string | null;
  size?: number;
}) {
  const initial = (name || email || '?').trim().charAt(0).toUpperCase();
  let hash = 0;
  for (const ch of email) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  const style = {
    width: size,
    height: size,
    borderRadius: '50%',
    flex: `0 0 ${size}px`,
  } as const;

  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" width={size} height={size} style={{ ...style, objectFit: 'cover' }} />;
  }
  return (
    <span
      aria-hidden="true"
      style={{
        ...style,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `hsl(${hash} 45% 88%)`,
        color: `hsl(${hash} 55% 26%)`,
        fontWeight: 600,
        fontSize: Math.round(size * 0.42),
      }}
    >
      {initial}
    </span>
  );
}
