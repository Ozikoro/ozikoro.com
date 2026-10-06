'use client';

/**
 * A meta box that folds away from its own title bar, and remembers that it is folded.
 *
 * ── WHAT THIS REPRODUCES ─────────────────────────────────────────────────────────────────────────────
 *
 * The owner: *"on the entire things in the right side bar, one should be able to minimise any of them like it
 * works in wordpress."* In the editor this file is copied from, every box in the right column — Publish,
 * Categories, Tags, Featured image, Excerpt, Custom fields — carries a title bar that is a toggle: the bar
 * keeps its place and its padding, a small triangle sits at the right, and the body folds away underneath.
 * The state is remembered per box, so the column you arranged is the column you come back to.
 *
 * ── WHY THE STATE IS IN THE BROWSER AND NOT ON THE ACCOUNT ───────────────────────────────────────────
 *
 * It is a preference about a screen, not a fact about the archive, and the honest place for it is the place
 * that draws the screen. `localStorage` is keyed by box id (`ozikoro.postbox.<id>`), so collapsing "Tags"
 * on one piece collapses it on the next — which is what a person expects of a column they have arranged.
 *
 * ── WHY IT IS A SEPARATE COMPONENT, AND THE ONE THING IT MUST NOT TOUCH ──────────────────────────────
 *
 * The editing screen is a client component already, but the content box inside it is a `contenteditable`
 * that the BROWSER owns, and an earlier fault in this screen emptied it on every re-render — one keystroke,
 * one empty draft, a success message over nothing. The fix was to give React no children for that node at
 * all, so that React has nothing to reconcile there.
 *
 * **This component re-renders only its own subtree.** Its children are the meta box's contents, which are
 * ordinary controlled fields; the content box is a sibling in a different column and is not a child of any
 * meta box. A toggle therefore cannot write to the document being edited, and it does not: the collapsed
 * state is one boolean here and nothing else moves.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

/** The key each box's remembered state lives under. One prefix, so the namespace is greppable. */
const STORAGE_PREFIX = 'ozikoro.postbox.';

export interface MetaBoxProps {
  /** Stable across visits: the box's own id, as the markup that inspired this file gives it. */
  id: string;
  title: string;
  children: ReactNode;
  /** Extra classes for the box itself, e.g. a width or an inset body. */
  className?: string;
  /** Styles for the body, so a box that draws its own padded sections can say so. */
  insideStyle?: CSSProperties;
  /** Drawn in the title bar beside the toggle, as the editor this is copied from does. */
  note?: ReactNode;
}

export function MetaBox({ id, title, children, className, insideStyle, note }: MetaBoxProps) {
  /*
   * OPEN UNTIL THE BROWSER SAYS OTHERWISE.
   *
   * The stored value is applied in an effect rather than in the initial state, because the server renders
   * this component too and it has no `localStorage`: reading it during render would make the served markup
   * and the first client render disagree. The box is drawn open, then folds — the same order the screen
   * would have if it had been built with no memory at all, and never the other way round.
   */
  const [open, setOpen] = useState(true);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_PREFIX + id);
      if (stored === 'closed') setOpen(false);
      if (stored === 'open') setOpen(true);
    } catch {
      /* A browser that refuses storage still gets a box that folds; it just forgets. */
    }
  }, [id]);

  function toggle() {
    setOpen((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(STORAGE_PREFIX + id, next ? 'open' : 'closed');
      } catch {
        /* See the effect above: the fold works, the memory does not. */
      }
      return next;
    });
  }

  return (
    <div className={`postbox${open ? '' : ' postbox--closed'}${className ? ` ${className}` : ''}`} id={id}>
      {/*
        THE ENTIRE TITLE BAR IS THE CONTROL, which is what the design draws: its own markup puts
        `title="Click to minimise or expand"` on the bar and attaches the toggle to the bar itself, so a
        person can click the title, the empty space or the chevron. The two real buttons inside it are what
        makes the same act reachable from a keyboard, and they stop the click from bubbling so one press is
        one toggle. **There is deliberately no `onKeyDown` on the bar itself**: the handlers would bubble up
        from those buttons and turn one Enter press into two toggles, which is a fold that does nothing.
      */}
      <div
        className="postbox-header"
        title="Click to minimise or expand"
        onClick={toggle}
      >
        <h2 className="hndle">
          <button
            type="button"
            className="hndle__toggle"
            aria-expanded={open}
            onClick={(event) => {
              event.stopPropagation();
              toggle();
            }}
          >
            {title}
          </button>
        </h2>
        {note ? <span className="hndle-note">{note}</span> : null}
        <button
          type="button"
          className="handlediv"
          aria-expanded={open}
          onClick={(event) => {
            event.stopPropagation();
            toggle();
          }}
          title={`Toggle panel: ${title}`}
        >
          <span className="screen-reader-text">{`Toggle panel: ${title}`}</span>
          <span className="handlediv__arrow" aria-hidden="true">
            ⌃
          </span>
        </button>
      </div>
      <div className="inside" style={insideStyle} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
