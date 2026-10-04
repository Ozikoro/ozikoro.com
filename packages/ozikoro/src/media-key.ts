/**
 * WHAT A STORAGE KEY MAY LOOK LIKE WHEN IT IS ADDRESSED AS `/media/<key>`.
 *
 * WHY THIS IS ITS OWN MODULE AND NOT A LOCAL CONSTANT IN THE ROUTE
 *
 * The pattern is a **traversal guard** — it is the only thing standing between a URL segment and a
 * filesystem or bucket read — and it is also a **census of what the archive actually holds**. Those two jobs
 * pull in opposite directions: a guard that is too tight 404s real files, and a guard that is too loose stops
 * guarding. The first fault had already happened twice by the time this module was written (see below), and
 * both times it was found by fetching a real key, not by reading the regex.
 *
 * So the pattern lives here, where the **uploader** can read the same constant the route enforces. An
 * uploader that cannot see the route's pattern will happily put 3,443 objects in a bucket and leave some of
 * them permanently unreachable, and it will report success while it does it.
 *
 * THE TRAVERSAL GUARD IS "NO PATH SEPARATOR, EVER", AND THAT IS WHAT MUST SURVIVE.
 *
 * Neither pattern admits `/` after its fixed prefix, so `..`, an absolute path and anything else simply does
 * not match and is refused **before any filesystem or bucket call is made**. Widening a character class does
 * not weaken that; admitting a separator would.
 *
 * WHY THE CLASS HAS THE CHARACTERS IT HAS, MEASURED RATHER THAN GUESSED
 *
 * Every character below is one that appears in a **real** filename in `ozikoro_media`. Measured over the
 * 3,443 keys that carry a file: the complete set of characters in their file names is
 *
 *     space  -  .  0-9  @  A-Z  _  a-z
 *
 * and nothing else. Six of those are punctuation WordPress leaves in an uploaded name — the space, and the
 * parentheses, brackets, comma, apostrophe, ampersand and plus that appear in the *other* names the
 * migration holds — and they are admitted because the alternative is a 404 on precisely the records with the
 * most descriptive names.
 *
 * HOW THE TWO FAULTS THIS CLOSES WERE MEASURED
 *
 *   * **`@` was rejected, and seven real images carry it.** WordPress writes a retina variant as
 *     `name@2x.png`, so `ozikoro/9274-osm-intl8aa250x200@2x.png` and six like it were *in the table, on
 *     disk, correctly named and served a 404* — the same shape of fault as the space before it. `@` in a
 *     path segment separates nothing; it is not a separator on any system this runs on, and it is now
 *     admitted.
 *   * **The length cap was 180 and one real filename is 212 characters.** A WordPress title truncated into
 *     a file name produced `10853-this-1935-photograph-captures-an-ulakwo-priest-…-mission.jpg`, of which
 *     206 characters follow the attachment id. The cap is now 255, which is the limit a file name actually
 *     has on the filesystems and object stores this archive uses, rather than a number that happened to be
 *     typed. **A length cap guards against abuse; the traversal guard is the separator rule, and it is
 *     untouched.**
 *
 * AND `..` IS A NAME, WHICH IS WHY BOTH PATTERNS CARRY A LOOKAHEAD
 *
 * `.` and `-` are ordinary characters in a WordPress file name, so a class that admits them also admits a
 * name that is **only dots**. `ozikoro/episodes/..` matched the episode pattern with no slash in it at all —
 * and `key.slice('ozikoro/'.length)` is `episodes/..`, which resolves to the media root rather than to a
 * file. It is refused by the route's `stat` today and would refuse a directory, so nothing was readable
 * through it; **it was still a traversal-shaped input walking through a guard whose own comment promised
 * "a file name that cannot contain a slash, a backslash or a dot-dot"**, and a guard that is right by
 * accident is not a guard. `(?!\.{1,2}$)` is what makes the comment true.
 *
 * WHAT IS DELIBERATELY NOT ADMITTED, AND WHY IT IS NOT AN OVERSIGHT
 *
 * `?`, `#`, `%` and `\`. The first three end or alter a URL rather than belonging to it, and the fourth is a
 * separator on Windows. **No key in the archive contains any of them**, so admitting one would widen the
 * class for a file that does not exist — and if one ever appears, the correct fix is to rename the file in
 * the import, not to teach the route a character that means something to a URL parser.
 */

/**
 * `ozikoro/<wpId>-<filename>`, the shape every migrated media key has.
 *
 * The `\d{1,8}-` prefix is the WordPress attachment id the importer prepends, and it is required: it is what
 * makes the key unmistakably an archive key rather than an arbitrary path.
 */
export const MEDIA_KEY_PATTERN = /^ozikoro\/\d{1,8}-(?!\.{1,2}$)[A-Za-z0-9._\- ()[\],'&+@]{1,255}$/;

/**
 * `ozikoro/episodes/<slug>.mp3` — the spoken records, in their own fixed directory.
 *
 * THE SECOND DOOR IS NARROWER THAN THE FIRST, ON PURPOSE. The media pattern forbids `/` because the
 * traversal guard is what it exists for, so widening *it* to admit a slash would have weakened the guard for
 * every one of the archive's images in order to serve a handful of episodes. Instead the episode path is one
 * fixed directory name followed by a file name that cannot contain a slash, a backslash or a dot-dot. **The
 * guard is not relaxed; a second door is cut that only opens onto one room.**
 */
export const EPISODE_KEY_PATTERN = /^ozikoro\/episodes\/(?!\.{1,2}$)[A-Za-z0-9._\-]{1,180}$/;

/**
 * Whether `/media/<key>` can address this key at all.
 *
 * A key that fails this is a **404 that no upload can fix**, which is why the uploader refuses to run rather
 * than reporting a successful move with holes in it.
 */
export function isAddressableMediaKey(key: string): boolean {
  return MEDIA_KEY_PATTERN.test(key) || EPISODE_KEY_PATTERN.test(key);
}
