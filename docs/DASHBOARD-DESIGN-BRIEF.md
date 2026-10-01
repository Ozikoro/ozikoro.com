# Design brief: the Ozituma dashboards

You are designing the authenticated side of **Ozituma** (`ozituma.com`), an Igbo dictionary and
language archive. Read this whole brief before proposing anything. It describes a real, working
application with real constraints; the goal is to redesign how it *looks and reads*, not to
reimagine what it *does*.

Your design will be **published to GitHub**, read, and implemented into the running application by
another agent. So publish markup and CSS rather than pictures — section 6 explains why that matters.

**This is a blank page.** Nothing about the current visual arrangement is sacred — not the
navigation, not the page structure, not the density. The screens listed below are the *work that
must be possible*, not a layout to preserve. Design the whole of it yourself. The only things you
may not change are in section 3, and those are about the server contract rather than the design.

---

## 1. The one idea that governs everything

There are **three roles**, and **two dashboards** — not three.

| role | what they are |
|---|---|
| **contributor** | Sends words, names, proverbs, clans, dialects and recordings for review |
| **editor** | A contributor who can *also* review and publish what others send |
| **administrator** | Runs the site: the record, users, appearance, analytics, codes |

**Contributors and editors share ONE dashboard.** It is the same screens, the same layout, the same
navigation. The *only* difference is authority: an editor sees a **Review queue** entry that a
contributor does not, and can publish directly instead of proposing. Design it as a single
dashboard with role-conditional affordances — **never as two products**.

**Administrators get a different dashboard**, because their work is different work. It is organised
around running a system, not around contributing to one.

So: **design A (contributor/editor) and design B (admin).** Two things, not three.

---

## 2. Scope — every screen that exists

### Dashboard A — contributor / editor (`/contribute`)

| route | what it is |
|---|---|
| `/contribute` | Overview: greeting, what you have sent, what became of it |
| `/contribute/word` | Form: add a dictionary entry |
| `/contribute/name` | Form: add a personal name |
| `/contribute/proverb` | Form: add a proverb |
| `/contribute/clan` | Form: add a clan or town |
| `/contribute/dialect` | Form: add a dialect/variety entry |
| `/contribute/recording` | Form: upload or point at an audio recording |
| `/contribute/submissions` | List: everything you have sent, and its state |
| `/contribute/account` | Your account: profile, password, API key, your picture |
| `/contribute/profile` | Public-facing profile summary |
| `/review` | **Editor and admin only.** The queue: read a submission, accept, refuse, or edit |

The six **forms are the heart of this dashboard** and they are currently the weakest part. They are
long, they are plain, and a person filling one in for the first time has no sense of how far along
they are or what happens next.

### Dashboard B — administrator (`/admin`)

| route | what it is |
|---|---|
| `/admin` | The dashboard: what the record holds, and every section with its count |
| `/admin/words` | Dictionary entries — list, search, hide, delete |
| `/admin/names` | Names — list, hide, delete |
| `/admin/clans` | Clans and towns — list, hide, delete |
| `/admin/proverbs` | Proverbs — list, hide, delete |
| `/admin/recordings` | Recordings — read-only list; acted on at the entry |
| `/admin/submissions` | Submissions — read-only list; decided in review |
| `/admin/users` | Users: table of accounts with pictures, roles, contributions |
| `/admin/users/new` | Add account |
| `/admin/users/[id]` | Edit user: picture, role, status, delete |
| `/admin/appearance` | Colours (6), logo, content width, menu (drag to order), footer |
| `/admin/layout` | Front-page blocks, drag to order, each switchable |
| `/admin/ads` | Advertisement slots: header, article, sidebar, footer |
| `/admin/analytics` | Traffic for `ozituma.com` and `learn.ozituma.com`, side by side |
| `/admin/settings` | Google Analytics id, Search Console and Bing tokens, custom head markup |
| `/admin/learn` | The learn subdomain: how it is served, what is not controllable here |
| `/admin/record` | Settings: search, donations, languages |

---

## 3. Non-negotiable technical constraints

These are not preferences. Breaking them breaks the application.

1. **Next.js 15 App Router, React Server Components.** Pages are server-rendered. Do not propose
   client-side data fetching, global stores, or SPA routing.
2. **Plain CSS. No Tailwind, no CSS-in-JS, no component library, no UI kit.** The project has none
   and is not adopting one. Propose CSS custom properties and class names.
3. **Forms are plain HTML `<form method="post">` posting to API routes.** They must work **with
   JavaScript disabled**. The only client-side JS in the entire authenticated side is two
   drag-and-drop helpers (menu order, front-page block order). Do not design anything that requires
   JS to be usable.
4. **The server owns the field names and the action URLs.** A form must keep posting the same
   `name="..."` values and the same `action="/api/..."`. You may restyle and restructure the layout
   of a form; you may not rename or drop a field, or the submission silently loses data.
5. **`<details>`/`<summary>` is the established disclosure pattern** for drop-down menu groups —
   keyboard-accessible with no JavaScript. Prefer it.
6. **Never invent data or empty states.** Every number is counted live from the database. A screen
   must be able to say "nothing here yet" honestly rather than showing a decorative placeholder
   figure.

### Existing design tokens (`apps/web/app/globals.css`)

Colours are declared in `oklch()`. Headings use **Libre Baskerville** (serif), body uses **IBM Plex
Sans**, both self-hosted via `next/font` — no runtime request to Google.

```
--ink --ink-soft --ink-faint      text, three weights of emphasis
--paper --paper-raised --line     surfaces and borders
--indigo --ochre --clay --green --red
--radius-sm --radius --radius-lg
--shadow-sm --shadow
--font-body --font-serif --font-mono
--wrap                            content width, 68rem by default
```

**An administrator can override these at runtime** from `/admin/appearance`: `--ink`, `--paper`,
`--accent`, `--header-bg`, `--footer-bg`, `--link`, and `--wrap`. Your design must survive a
different palette and a different content width — **do not hard-code colours or measure against a
fixed page width.**

### Chrome

- The **public site** has a header (logo, horizontal nav, account link) and a footer.
- The **dashboards** must NOT show the public header or footer. They have their own chrome. The
  admin currently has a top bar plus a dark left menu; the contributor dashboard has a dark left
  sidebar. This separation is deliberate and must be preserved.
- **Both dashboards' navigation and chrome are yours to design.** There is no house pattern to
  preserve: the current layouts are a starting point the owner is happy to lose. Propose whatever
  arrangement you think serves the work, with one constraint — the dashboards must never show the
  public site's header or footer.

---

## 4. What is wrong with it today — the honest critique

This is the part most worth your attention. The current interfaces work but do not feel designed.

1. **The contributor dashboard has no sense of progress or reward.** A person adds a word and gets a
   line of text. There is nothing that shows their work accumulating, nothing that acknowledges it.
   This is the single biggest gap: it should feel worth contributing to.
2. **The six contribution forms are walls.** Long vertical stacks of labelled inputs with no
   grouping, no progressive disclosure, no indication of what is required versus optional, and no
   clear end. They should feel like a short guided task, not paperwork.
3. **`/contribute` overview and `/contribute/submissions` overlap** without a clear division of
   labour between them.
4. **The admin's list screens are tables and little else.** No bulk actions, no column sorting, no
   sense of which rows need attention, and no indication of what an administrator should do next.
5. **Empty and error states are afterthoughts.** A failed submission, a refused contribution, an
   empty queue — all deserve real design, and these are the moments a contributor most needs
   clarity.
6. **Typography inside the dashboards is generic.** The public site has a real typographic identity
   (serif headings, warm paper). The dashboards use browser-default-feeling type and grey-on-white.
7. **The two dashboards do not read as siblings.** They should share a visual language while being
   clearly different tools.

---

## 5. What good looks like

- **Dashboard A should feel like a workspace you want to return to.** Show a contributor their own
  progress: what they have sent, what was accepted, what is waiting. Make the six forms feel like
  six short, confident tasks with clear beginnings, middles and ends.
- **Editor additions must be additive, not disruptive.** The review queue should appear as extra
  capability inside the same shell — never as a differently-shaped product.
- **Dashboard B should feel like an instrument panel.** Dense, calm, scannable, unmistakably for
  someone running a system. Numbers legible at a glance; lists that show what needs action.
- **Consistency between A and B**: same type scale, same spacing rhythm, same colour semantics, same
  control styles. Different density and different navigation.
- **Accessibility is a requirement, not a polish step.** Keyboard-operable throughout, visible focus
  states, sufficient contrast (remember the palette is admin-overridable), and correct semantics
  (`<table>` for tabular data, `<label>` bound to every input, `<nav aria-label>` per navigation).

---

## 6. What to publish, and how it will be used

**Publish your design to your own GitHub repository when it is done.** You are not editing this
application and you do not need access to it. Your work will be read and implemented into the
running site by another agent, so the form you publish it in decides how faithfully it survives
that step.

### The most useful thing you can publish

**Static HTML and CSS — one file per screen — that opens in a browser with no build step.**

Markup and CSS translate directly into the application. A picture does not: it has to be measured
by eye, and every judgement you made is lost. If you publish a working prototype, your design lands
as you intended it. If you publish only images, it lands as somebody's impression of your images.

So, ideally, your repository contains:

```
index.html            a page linking every screen, so it can be walked through
screens/*.html        one per screen — dashboard, forms, lists, review, settings
styles/*.css          plain CSS, with your tokens at the top
tokens.css            the custom properties, on their own, so they can be lifted directly
NOTES.md              the rationale, the component inventory, and every departure
```

**No build step, no preprocessor, no framework** in what you publish — no Tailwind, no Sass, no
CSS-in-JS. Not because those are bad, but because the application they are going into has none of
them, and a deliverable that needs compiling cannot be copied. Plain CSS with class names is what
will be lifted.

**Static mock data in the prototype is fine and expected** — use realistic Igbo words, names and
proverbs so the screens read true. Just do not design a state that cannot exist, and do not omit
the empty state: the application counts everything live and a screen with nothing in it is a real
screen that people will see.

Screenshots and a Figma file are welcome **as an overview** on top of that, and useful for
discussing direction. They are not a substitute for the markup, because the markup is what gets
copied.

### Reference: what is already there

You do not have to match any of this, but it is what exists today, in case it is useful to see
where the current design lives:

```
apps/web/app/globals.css               shared tokens — also styles the public site
apps/web/app/admin/admin.css           the administrator's dashboard
apps/web/app/contribute/contribute.css the contributor's and editor's dashboard
```

The public site's typography is **Libre Baskerville** for headings and **IBM Plex Sans** for
everything else, and its colours are declared in `oklch()`. You may keep that identity, extend it,
or propose a different one for the dashboards — but say which, and why.

### How it will be implemented

An agent will read your repository and rewrite the dashboards to match, keeping the server contract
in section 3 intact. Two things make that go well:

1. **Name your classes meaningfully and use them consistently.** `panel`, `panel__head`,
   `field--error` and the like survive translation; `.css-1x9f2k` does not.
2. **Say what is a component and what is a one-off.** If the same card appears on six screens,
   say so once, and the implementation will be one component rather than six copies.

---

## 7. What to deliver

1. **A design rationale**, short. Two or three paragraphs on the direction, and why it suits a
   language archive that values honesty over flourish.
2. **A token proposal** — the CSS custom properties you would add or change, in `oklch()`, with the
   admin-overridable ones respected.
3. **High-fidelity designs for these screens**, at desktop width and at 375px:
   - Dashboard A: overview, one contribution form in full, submissions list, review queue
   - Dashboard B: dashboard, one list screen (`/admin/users`), appearance, analytics
4. **A component inventory** — the reusable pieces (page header, panel, table, form field, notice,
   badge, empty state, pagination) with their states: default, hover, focus, disabled, error, empty.
5. **The prototype itself** — HTML and CSS, one file per screen, plain and buildless, as described
   in section 6. This is the deliverable that gets copied; the rest supports it.
6. **A short note on every departure you make from the current behaviour**, so nothing is lost
   silently.

## 8. What NOT to do

- Do not add a UI framework or a dependency.
- Do not require JavaScript for any interaction that must work.
- Do not rename or remove form fields or change form actions.
- Do not invent statistics, sample data, or lorem ipsum in place of real empty states.
- Do not redesign the public dictionary, the clan pages or the word entries. **Only the
  authenticated dashboards.**
- Do not merge the two dashboards into one, and do not split contributor from editor into two.
