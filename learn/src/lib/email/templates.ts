/**
 * The Ozituma email design system.
 *
 * EMAIL IS NOT THE WEB, AND THE DIFFERENCE IS NOT COSMETIC
 *
 * A page you build for the browser uses flexbox, external stylesheets and web fonts. None of that
 * survives an inbox reliably:
 *
 *   - Gmail strips `<style>` blocks in several contexts, so every rule has to be INLINE.
 *   - Outlook renders through Word, which understands tables and almost nothing else — no flexbox,
 *     no grid, no `max-width` on a div.
 *   - Web fonts are unsupported in much of Outlook and blocked by default in Apple Mail, so a
 *     display face must DEGRADE rather than disappear.
 *   - Dark mode inverts colours in some clients and not others. A design that assumes one
 *     background ends up with dark text on a dark background for half the list.
 *
 * So this file is tables, inline styles, and a 600px column — which is still what email is, twenty
 * years on. The design still looks like Ozituma; it is built the way the medium requires.
 *
 * THE PALETTE MATCHES THE APP
 *
 * Deep forest green, coral highlight, warm paper — the same tokens the site uses, converted to hex
 * because email clients do not support OKLCH. They are written out rather than imported, because an
 * email must render in a client that has never seen the stylesheet.
 */

/** The brand's colours, as hex. Email clients do not support oklch(). */
const C = {
  paper: '#fbf8f2', // warm page background
  card: '#ffffff', // the content column
  ink: '#12211c', // body text — near-black with a green cast
  soft: '#5b6b64', // secondary text
  brand: '#1f4d3a', // deep forest green
  coral: '#c9552f', // the highlight
  sand: '#f4ecdd', // a warm panel
  line: '#e6ded0', // hairlines
} as const;

const FONT_DISPLAY = "Georgia, 'Times New Roman', serif";
const FONT_BODY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Escape interpolated content. A name with an ampersand should not break the markup. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface EmailShellOptions {
  /** The `<title>`, used by clients that show one and by the preheader fallback. */
  title: string;
  /**
   * The grey line the inbox shows next to the subject.
   *
   * Written deliberately rather than derived from the first line of body text, because the first
   * line is usually "Hello Chidi" — which wastes the only preview text the reader gets.
   */
  preheader: string;
  /** The inner HTML, already built. */
  body: string;
  /** Shown above the footer. Omitted for transactional mail, where it is noise. */
  unsubscribeUrl?: string;
}

/**
 * The shared shell: paper background, white column, branded header, legal footer.
 *
 * The 600px width is not arbitrary — it is the width every client agrees on, and the widest that
 * Outlook's reading pane renders without a horizontal scrollbar.
 */

/**
 * Which site the email is coming from.
 *
 * THE PROBLEM THIS SOLVES
 *
 * Every email said "Ozituma" and "Learn" regardless of where the registration happened. A person who
 * signed up at ozikoro.com — the history and archive — received a message branded as a dictionary,
 * from a name they never interacted with. That is confusing at best and looks like a mis-send at
 * worst, which is exactly the wrong first impression for a confirmation link.
 *
 * THE THREE IDENTITIES
 *
 *   ozikoro.com        Ozikoro          the parent project, history and archive
 *   ozituma.com        Ozituma          the dictionary
 *   learn.ozituma.com  Ozituma Learn    the learning platform
 *
 * Ozikoro is the COMPANY and appears in every footer, because it is the accountable entity — but the
 * HEADER names whichever site the person actually used. That is the distinction that matters: the
 * header is where they came from, the footer is who is responsible.
 */
export type EmailBrand = "ozikoro" | "ozituma" | "learn";

interface BrandIdentity {
  /** The name in the header. */
  name: string;
  /** The right-aligned descriptor beside it; empty when the name already says it. */
  descriptor: string;
  /** One line in the footer, describing what this site is. */
  description: string;
  /** What the reader has an account WITH, for the footer sentence. */
  account: string;
  /** The site's own address. */
  url: string;
  /** The domain as displayed. */
  domain: string;
}

const BRANDS: Record<EmailBrand, BrandIdentity> = {
  ozikoro: {
    name: "Ozikoro",
    descriptor: "",
    description: "the history and archive of the Igbo people.",
    account: "Ozikoro",
    url: "https://ozikoro.com",
    domain: "ozikoro.com",
  },
  ozituma: {
    name: "Ozituma",
    descriptor: "",
    description: "the Igbo dictionary.",
    account: "Ozituma",
    url: "https://ozituma.com",
    domain: "ozituma.com",
  },
  learn: {
    name: "Ozituma",
    descriptor: "Learn",
    description: "the Igbo dictionary and learning platform.",
    account: "Ozituma Learn",
    url: "https://learn.ozituma.com",
    domain: "learn.ozituma.com",
  },
};

/**
 * Work out which brand an email belongs to, from the site it was triggered on.
 *
 * Fails to `learn` rather than throwing: a missing host should still produce a sendable email, and
 * this application IS the learning platform — the other two brands only ever arrive as a parameter
 * from a bridge call.
 */
export function brandFromHost(host: string | null | undefined): EmailBrand {
  if (!host) return "learn";
  const h = host.toLowerCase();
  if (h.includes("ozikoro")) return "ozikoro";
  // `learn.` before the bare apex, or the subdomain would match `ozituma` first.
  if (h.includes("learn.")) return "learn";
  if (h.includes("ozituma")) return "ozituma";
  return "learn";
}

export function emailShell({ title, preheader, body, unsubscribeUrl, brand = "learn" }: EmailShellOptions & { brand?: EmailBrand | undefined }): string {
  const B = BRANDS[brand];
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:${C.paper};">

<!--
  The preheader. Hidden in the body, shown by the inbox beside the subject. The run of &nbsp; and
  the zero-width joiner stop the client continuing into visible content after it.
-->
<div style="display:none;font-size:1px;color:${C.paper};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
  ${esc(preheader)}
  ${'&#847;&zwnj;&nbsp;'.repeat(60)}
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.paper};">
  <tr>
    <td align="center" style="padding:24px 12px;">

      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:${C.card};border-radius:12px;overflow:hidden;">

        <!-- Header. The wordmark is text, not an image: an image is blocked by default in Outlook
             and many corporate clients, and a blocked logo leaves an empty box. -->
        <tr>
          <td style="background:${C.brand};padding:24px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-family:${FONT_DISPLAY};font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.02em;">
                  ${B.name}
                </td>
                <td align="right" style="font-family:${FONT_BODY};font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.72);">
                  ${B.descriptor}
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- A coral rule under the header, which is the one piece of the site's visual identity
             that survives translation into email untouched. -->
        <tr><td style="height:4px;background:${C.coral};line-height:4px;font-size:0;">&nbsp;</td></tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 32px 8px 32px;font-family:${FONT_BODY};font-size:16px;line-height:1.6;color:${C.ink};">
            ${body}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:28px 32px 32px 32px;border-top:1px solid ${C.line};font-family:${FONT_BODY};font-size:12px;line-height:1.6;color:${C.soft};">
            <p style="margin:0 0 8px 0;">
              <strong style="color:${C.ink};">${B.name}${B.descriptor ? ` ${B.descriptor}` : ""}</strong> — ${B.description}
            </p>
            <p style="margin:0 0 8px 0;">
              You are receiving this because you have an ${B.account} account.
            </p>
            ${
              unsubscribeUrl
                ? `<p style="margin:0;"><a href="${esc(unsubscribeUrl)}" style="color:${C.soft};text-decoration:underline;">Unsubscribe</a></p>`
                : ''
            }
            <p style="margin:12px 0 0 0;color:#8a968f;">
              Ozikoro · <a href="${B.url}" style="color:#8a968f;text-decoration:none;">${B.domain}</a>
            </p>
          </td>
        </tr>

      </table>

    </td>
  </tr>
</table>
</body>
</html>`;
}

/** A heading in the display face. Used at the top of the body, once. */
function h1(text: string): string {
  return `<h1 style="margin:0 0 16px 0;font-family:${FONT_DISPLAY};font-size:28px;line-height:1.25;font-weight:700;color:${C.ink};">${esc(text)}</h1>`;
}

/** Body copy. */
function p(html: string): string {
  return `<p style="margin:0 0 16px 0;font-family:${FONT_BODY};font-size:16px;line-height:1.6;color:${C.ink};">${html}</p>`;
}

/** Secondary copy, smaller and greyer. */
function small(html: string): string {
  return `<p style="margin:0 0 16px 0;font-family:${FONT_BODY};font-size:13px;line-height:1.6;color:${C.soft};">${html}</p>`;
}

/**
 * The button.
 *
 * BUILT FROM A TABLE, NOT AN ANCHOR WITH PADDING
 *
 * Outlook ignores padding on an `<a>` and renders the text with no button around it. A one-cell
 * table with a background and radius is the only construction that holds its shape everywhere.
 */
function button(text: string, href: string, tone: 'brand' | 'coral' = 'brand'): string {
  const bg = tone === 'coral' ? C.coral : C.brand;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
  <tr>
    <td align="center" style="background:${bg};border-radius:8px;">
      <a href="${esc(href)}" style="display:inline-block;padding:14px 28px;font-family:${FONT_BODY};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${esc(text)}</a>
    </td>
  </tr>
</table>`;
}

/** A warm panel, for the one thing the reader should notice. */
function panel(inner: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;background:${C.sand};border-radius:10px;">
  <tr><td style="padding:20px 22px;font-family:${FONT_BODY};font-size:15px;line-height:1.6;color:${C.ink};">${inner}</td></tr>
</table>`;
}

/** A hairline. */
function divider(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;"><tr><td style="height:1px;background:${C.line};line-height:1px;font-size:0;">&nbsp;</td></tr></table>`;
}

// ---------------------------------------------------------------------------
// The emails
// ---------------------------------------------------------------------------

export interface RenderedEmail {
  subject: string;
  html: string;
  /** Inbox preview text. Kept beside the subject so the two are written together. */
  preheader: string;
}

/**
 * Welcome — sent when an account is created.
 *
 * The one job is to get the learner to their first lesson. So there is exactly ONE button, and it
 * points at the daily journey rather than at a tour or a marketing page.
 */
export function welcomeEmail(input: { name?: string | null; siteUrl: string; brand?: EmailBrand }): RenderedEmail {
  const greeting = input.name ? `Nnọọ, ${esc(input.name)}.` : 'Nnọọ.';
  const subject = 'Nnọọ — your Igbo journey starts here';
  const preheader = 'One short lesson a day. Every word comes from the Ozituma dictionary, with its recording.';

  const body = `
    ${h1(greeting)}
    ${p('Welcome to Ozituma Learn. Igbo is a language of tone and context — <em>ákwá</em> is a cry, <em>àkwà</em> is a bed — and the fastest way in is a little every day rather than a lot once.')}
    ${p('Your journey is waiting. It adapts to how much time you have, and it remembers what you are about to forget.')}
    ${button('Start today’s journey', `${input.siteUrl}/`, 'coral')}
    ${panel(`
      <strong style="display:block;margin-bottom:6px;">What makes this different</strong>
      Every word you meet has an entry in the dictionary you can read, hear and check. Nothing is
      invented, and nothing is machine-translated — a linguist and native speakers approve the
      content before a learner ever sees it.
    `)}
    ${small('If a word is missing, tell us. We would rather show you nothing than an approximation.')}
  `;

  return { subject, preheader, html: emailShell({ title: subject, preheader, body, brand: input.brand }) };
}

/**
 * Password reset.
 *
 * Transactional, so no unsubscribe link — the reader has an account and asked for this. It also
 * says plainly when the link expires and what to do if they did not ask, because a reset email that
 * omits both is a reset email that generates support.
 */
export function passwordResetEmail(input: { resetUrl: string; expiresInMinutes?: number; brand?: EmailBrand }): RenderedEmail {
  const minutes = input.expiresInMinutes ?? 60;
  const subject = 'Reset your Ozituma password';
  const preheader = `The link works for ${minutes} minutes. If you did not ask for this, ignore this email.`;

  const body = `
    ${h1('Reset your password')}
    ${p('Someone asked to reset the password for this Ozituma account. If that was you, the button below will take you to a page where you can choose a new one.')}
    ${button('Choose a new password', input.resetUrl, 'coral')}
    ${small(`This link works for <strong>${minutes} minutes</strong> and can only be used once.`)}
    ${divider()}
    ${small('<strong>If you did not ask for this</strong>, you can ignore this email. Your password has not changed and nobody can use this link without it.')}
  `;

  return { subject, preheader, html: emailShell({ title: subject, preheader, body, brand: input.brand }) };
}

/**
 * Lesson receipt, after a paid teacher lesson.
 *
 * A receipt is a record, so it leads with the facts and keeps the design quiet. The amount is shown
 * in naira because that is what Paystack charged — converting it for display would mean the receipt
 * and the bank statement disagree.
 */
export function lessonReceiptEmail(input: {
  brand?: EmailBrand;
  teacherName: string;
  startsAt: string;
  minutes: number;
  amountKobo: number;
  reference: string;
  siteUrl: string;
}): RenderedEmail {
  const amount = `₦${(input.amountKobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
  const when = new Date(input.startsAt).toLocaleString('en-NG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });

  const subject = `Your lesson with ${input.teacherName} is booked`;
  const preheader = `${when} · ${input.minutes} minutes · ${amount} paid`;

  const body = `
    ${h1('Your lesson is booked')}
    ${p(`You are learning with <strong>${esc(input.teacherName)}</strong>. We will remind you before it starts, and the classroom opens ten minutes early.`)}
    ${panel(`
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="padding:4px 0;color:${C.soft};font-size:13px;">When</td><td align="right" style="padding:4px 0;font-weight:600;">${esc(when)}</td></tr>
        <tr><td style="padding:4px 0;color:${C.soft};font-size:13px;">Length</td><td align="right" style="padding:4px 0;font-weight:600;">${input.minutes} minutes</td></tr>
        <tr><td style="padding:4px 0;color:${C.soft};font-size:13px;">Paid</td><td align="right" style="padding:4px 0;font-weight:600;">${amount}</td></tr>
        <tr><td style="padding:4px 0;color:${C.soft};font-size:13px;">Reference</td><td align="right" style="padding:4px 0;font-family:monospace;font-size:12px;">${esc(input.reference)}</td></tr>
      </table>
    `)}
    ${button('Open the classroom', `${input.siteUrl}/platform`)}
    ${small('This is your receipt. Keep it for your records — the same reference appears on your Paystack statement.')}
  `;

  return { subject, preheader, html: emailShell({ title: subject, preheader, body, brand: input.brand }) };
}

/**
 * Newsletter.
 *
 * The one marketing email here, and the only one that needs an unsubscribe link. Written as
 * sections so a composed issue reads as a designed page rather than a wall of paragraphs — the
 * same shape the rest of the product uses.
 */
export function newsletterEmail(input: {
  title: string;
  intro: string;
  sections: readonly { heading: string; body: string; link?: string; linkText?: string }[];
  unsubscribeUrl: string;
  siteUrl: string;
  /** Which site the issue is going out as. */
  brand?: EmailBrand | undefined;
}): RenderedEmail {
  const subject = input.title;
  const preheader = input.intro.slice(0, 140);

  const sections = input.sections
    .map(
      (section) => `
    ${divider()}
    <h2 style="margin:0 0 10px 0;font-family:${FONT_DISPLAY};font-size:20px;line-height:1.3;font-weight:700;color:${C.ink};">${esc(section.heading)}</h2>
    ${p(section.body)}
    ${section.link ? button(section.linkText ?? 'Read more', section.link, 'coral') : ''}
  `
    )
    .join('');

  const body = `
    ${h1(input.title)}
    ${p(input.intro)}
    ${sections}
    ${divider()}
    ${button('Practise what you have learned', `${input.siteUrl}/practice`)}
  `;

  return {
    subject,
    preheader,
    html: emailShell({ title: subject, preheader, body, unsubscribeUrl: input.unsubscribeUrl, brand: input.brand }),
  };
}
