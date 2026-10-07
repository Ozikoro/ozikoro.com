/**
 * Sending mail — the one thing password recovery cannot do without.
 *
 * A recovery link has to reach the person, and the person is not at the site.
 * Everything else Ozituma sends is a courtesy; this is the only message whose
 * failure locks somebody out of their own account, so the way it is configured
 * and the way it fails both matter here more than they would elsewhere.
 *
 * THREE TRANSPORTS, ONE FUNCTION
 *
 * `sendMail` speaks Resend, it speaks SMTP, and it speaks Amazon SES. SMTP is what a mailbox
 * provider gives you (Zoho, cPanel, Fastmail, Google) and SES is what the project's own AWS
 * account gives you; Resend is a third, and this project does hold a working key for it on a
 * verified domain. Between them they cover every way this site is likely to send anything, and a
 * change of provider is an environment variable rather than a code change. Resend and SES are
 * HTTP, SMTP is written against Node's own `net`, `tls` and `crypto` — there is no dependency here
 * to keep patched, which is the same reason passwords use `scrypt`.
 *
 * THE ORDER IS RESEND, THEN SMTP, THEN SES, AND IT IS DELIBERATE
 *
 * Resend first because a live key on a verified domain is a transport known to deliver, and a site
 * that has configured one means it; `mailStatus()` reports the same order, so what the CLI prints
 * is what would actually be used. SMTP second because it is the one an operator has deliberately
 * configured for this site, whereas the AWS variables sit on the box for the media bucket and
 * would otherwise be picked up by accident. **A transport that is merely present is not the same as
 * one that is intended.**
 *
 * ── WHICH TRANSPORT EACH SITE ACTUALLY USES, MEASURED RATHER THAN ASSUMED ────────────────────────────
 *
 * **ozikoro.com sends by Zoho SMTP, and that is now the archive's stated provider.** Measured from inside
 * the production container on 2026-10-07: `smtp.zoho.com:465`, implicit TLS, sender `hello@ozikoro.com`,
 * `235 Authentication Successful`, `250 Sender … OK`, `250 Recipient … OK`, `250 Message received`, 776 ms
 * end to end. The four `OZITUMA_SMTP_*` names plus `OZIKORO_MAIL_FROM` are its whole configuration.
 *
 * **Resend is supported and NOT configured on that host.** The project holds a working 36-character key on
 * a domain with DKIM and SPF verified — but it lives in `apps/ozikoro/.env.local`, which `.dockerignore`
 * excludes from the image, and the host's `/opt/ozituma/.env` does not hold `RESEND_API_KEY` at all
 * (`docs/OZIKORO-CUTOVER.md` §5.8). So `resendConfig()` returns null there and the message goes by SMTP —
 * which is correct, and which used to happen **without saying so** because the compose file passed
 * `RESEND_API_KEY: ${RESEND_API_KEY:-}`, turning "unset" into the empty string.
 *
 * ── AND "A NAME IN `printenv` THAT LOOKS CONFIGURED AND IS NOT" IS NOW NAMED RATHER THAN SILENT ──────
 *
 * `env()` below treats a blank value as unset, and it is right to: a variable that exists and carries
 * nothing is not a configuration. **But the difference between "this name is absent" and "this name is
 * present and empty" is the difference between a decision and a mistake, and the code could not tell them
 * apart.** `${RESEND_API_KEY:-}` in a compose file produces the second while looking like the first, so the
 * transport fell through to SMTP in silence and `mailStatus()` reported SMTP as though that had always been
 * the plan. `blankMailNames()` and the warning `mailStatus()` now emits are that distinction written down:
 * **the names are the report, never the values.**
 *
 * WHY IT DOES NOT THROW WHEN UNCONFIGURED
 *
 * Mail is not configured on this machine yet. If `sendMail` threw, the recovery
 * form would fail and a locked-out person would have nowhere to go. Instead it
 * reports that it did not send, and the caller — see `forgot` in the auth route
 * — keeps the link and puts it in front of an administrator, who can pass it on
 * by hand. Recovery works today; it just takes a person in the middle until
 * credentials are in place.
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';

export interface MailMessage {
  to: string;
  subject: string;
  /** The plain-text body. Always send one: some clients show nothing else. */
  text: string;
  html?: string;
  replyTo?: string;
}

export type Transport = 'resend' | 'smtp' | 'ses' | null;

export interface MailStatus {
  /** True when a message would actually leave this machine. */
  configured: boolean;
  transport: Transport;
  from: string | null;
  /** Why not, in words an administrator can act on. */
  reason: string | null;
}

export interface SendResult {
  delivered: boolean;
  transport: Transport;
  /** Present when `delivered` is false or when the server reported a warning. */
  error?: string;
  /**
   * The provider's own identifier for an accepted message, when it gives one.
   *
   * Resend answers 200 with `{ id }`. Carrying it back is what lets `scripts/mail-test.ts` report the
   * API's actual response to the person verifying delivery — "delivered: true" alone is the client's
   * opinion of itself, and the id is the provider's.
   */
  id?: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function env(name: string): string | null {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : null;
}

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  password: string | null;
  from: string;
  fromName: string | null;
}

interface SesConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string | null;
  from: string;
  fromName: string | null;
}

interface ResendConfig {
  apiKey: string;
  from: string;
}

/**
 * The From address, and the order the names for it are tried.
 *
 * WHY OZIKORO_MAIL_FROM COMES FIRST
 *
 * Two sites share this package and they are different registrable domains: ozituma.com is the
 * dictionary, ozikoro.com is the archive, and a recovery message has to be recognisable as coming
 * from the site the reader was on. So the site's own name wins, and the shared one is the fallback
 * that keeps the dictionary working unchanged.
 *
 * THE SENDER MUST BE ON A DOMAIN RESEND WILL SEND FROM, AND THAT IS A MEASURED FACT, NOT AN ASSUMPTION
 *
 * `GET https://api.resend.com/domains` with the key in `apps/ozikoro/.env.local` answers 200 and lists TWO
 * domains, `ozikoro.com` and `ozituma.com`, both reported `verified`. ozikoro.com's own record reads
 * `partially_verified`, because its inbound MX (receiving) is still pending — **and the two records that
 * matter for SENDING, DKIM and SPF, are both verified**, which is why the domain sends. Measured, not
 * reasoned: a real message from `Ozikoro <hello@ozikoro.com>` returned HTTP 200 with an id. **An earlier
 * note in this project recorded ozikoro.com as not verified with Resend at all; that was true before
 * 2026-10-03 and is not true now, and the API is the thing to believe.** `scripts/check-mail.sh` re-reads
 * that list and fails when the configured sender is on a domain Resend will not send from, which is the
 * check that keeps this comment from going stale in the other direction.
 *
 * Changing the sender is one environment variable — `OZIKORO_MAIL_FROM` — and nothing in the code
 * needs to move with it.
 *
 * READ AS LITERALS RATHER THAN THROUGH env()
 *
 * `scripts/check-secrets.sh` keeps `.env.example` honest by grepping the source for
 * the `process.env.<NAME>` pattern as TEXT, and it reports a name that is documented but not seen that
 * way as
 * "DOCUMENTED BUT NEVER READ" — which fails the pre-commit hook. `env()` takes the name as an
 * argument, so a variable read only through it is invisible to that check. **The names that
 * `.env.example` lists are therefore spelled out here**, and `OZITUMA_SMTP_ALLOW_PLAINTEXT` and
 * `OZITUMA_EHLO_NAME` below are literal for the same reason.
 */
function fromAddress(): string | null {
  const explicit =
    process.env.OZIKORO_MAIL_FROM?.trim() ||
    process.env.OZITUMA_MAIL_FROM?.trim() ||
    process.env.RESEND_FROM?.trim() ||
    null;
  if (explicit) return explicit;
  const site = env('OZITUMA_SITE_URL');
  if (!site) return null;
  try {
    const host = new URL(site).hostname.replace(/^www\./, '');
    /*
     * The derived name follows the domain, because one package serves two sites with two names. Naming
     * an ozikoro.com sender "Ozituma" would be wrong in the one place a reader judges who wrote to
     * them, and the domain is the only fact here that decides which site this is.
     */
    const name = host === 'ozikoro.com' || host.endsWith('.ozikoro.com') ? 'Ozikoro' : 'Ozituma';
    return `${name} <hello@${host}>`;
  } catch {
    return null;
  }
}

function splitFrom(value: string): { address: string; name: string | null } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  if (match) return { address: match[2]!.trim(), name: match[1]!.replace(/^"|"$/g, '') || null };
  return { address: value.trim(), name: null };
}

function smtpConfig(): SmtpConfig | null {
  const host = env('OZITUMA_SMTP_HOST');
  const from = fromAddress();
  if (!host || !from) return null;
  const port = Number(env('OZITUMA_SMTP_PORT') ?? '587');
  // 465 is implicit TLS by convention; anything else offers STARTTLS, which the
  // client upgrades to when the server advertises it.
  const secure = env('OZITUMA_SMTP_SECURE') === '1' || port === 465;
  return {
    host,
    port: Number.isFinite(port) ? port : 587,
    secure,
    user: env('OZITUMA_SMTP_USER'),
    password: env('OZITUMA_SMTP_PASSWORD'),
    from,
    fromName: null,
  };
}

function sesConfig(): SesConfig | null {
  const from = fromAddress();
  if (!from) return null;
  const region = env('AWS_REGION') ?? env('AWS_DEFAULT_REGION');
  const accessKeyId = env('AWS_ACCESS_KEY_ID');
  const secretAccessKey = env('AWS_SECRET_ACCESS_KEY');
  if (!region || !accessKeyId || !secretAccessKey) return null;
  return {
    region,
    accessKeyId,
    secretAccessKey,
    sessionToken: env('AWS_SESSION_TOKEN'),
    from,
    fromName: null,
  };
}

/**
 * Resend, when a key is present and there is something to send from.
 *
 * READ AS A LITERAL, NOT THROUGH env(), so `scripts/check-secrets.sh` can see that the name in
 * `.env.example` is a name the code actually reads. See the note on `fromAddress`.
 */
function resendConfig(): ResendConfig | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = fromAddress();
  if (!apiKey || !from) return null;
  return { apiKey, from };
}

/**
 * EVERY MAIL NAME THIS MODULE KNOWS, SO AN EMPTY ONE CAN BE NAMED.
 *
 * These are the names the four configuration functions below read. The list is a report — `check-mail.sh`
 * and an operator print it — and it never carries a value.
 */
const MAIL_NAMES = [
  'RESEND_API_KEY',
  'RESEND_FROM',
  'OZIKORO_MAIL_FROM',
  'OZITUMA_MAIL_FROM',
  'OZITUMA_SMTP_HOST',
  'OZITUMA_SMTP_PORT',
  'OZITUMA_SMTP_USER',
  'OZITUMA_SMTP_PASSWORD',
  'OZITUMA_SMTP_SECURE',
  'OZITUMA_SMTP_ALLOW_PLAINTEXT',
  'OZITUMA_EHLO_NAME',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
] as const;

/**
 * The mail names that are PRESENT and carry nothing — which is a different fact from being absent.
 *
 * **This exists because of a fault rather than in case of one.** `docker-compose.ozikoro.yml` passed
 * `RESEND_API_KEY: ${RESEND_API_KEY:-}`, so the container's `printenv` showed a name that looked configured
 * and was not; `env()` correctly treats a blank value as unset, the transport fell through to SMTP, and
 * nothing anywhere said so. The compose line is deleted, and this is the guard against the next one: **a
 * name that exists and is empty is reported by name, never by value.**
 */
export function blankMailNames(): string[] {
  return MAIL_NAMES.filter((name) => {
    const value = process.env[name];
    return value !== undefined && value.trim().length === 0;
  });
}

/**
 * Say it once per process, at warn level, with a greppable prefix.
 *
 * **Once**, because a warning on every call would be noise an operator learns to skip — and this is called
 * from the recovery route and from the admin screens.
 */
let blankNamesReported = false;
function warnAboutBlankMailNames(): void {
  if (blankNamesReported) return;
  blankNamesReported = true;
  const blank = blankMailNames();
  if (blank.length === 0) return;
  console.warn(
    `[mail] these names are set in this environment and carry no value: ${blank.join(', ')}. ` +
      'An empty variable is not a configuration — `${NAME:-}` in a compose file turns "unset" into the ' +
      'empty string, and the transport then falls through in silence. Set a value or stop naming it.'
  );
}

/**
 * Which transport, if any, would carry a message right now.
 *
 * THE ORDER IS THE ORDER THE MESSAGE WOULD TAKE: Resend, then SMTP, then SES.
 *
 * Resend wins because a key on a verified domain is the transport this project can actually
 * deliver with. SMTP is next: it is the one an operator has deliberately configured for this site,
 * whereas the AWS variables are on the box for the media bucket and would otherwise be picked up
 * by accident. SES is last for that reason. **Reporting this order is the point of the function** —
 * a status that named a transport the send path would not choose would be worse than none.
 */
export function mailStatus(): MailStatus {
  warnAboutBlankMailNames();
  const resend = resendConfig();
  if (resend) {
    return { configured: true, transport: 'resend', from: resend.from, reason: null };
  }
  const smtp = smtpConfig();
  if (smtp) {
    return {
      configured: true,
      transport: 'smtp',
      from: smtp.from,
      reason: null,
    };
  }
  const ses = sesConfig();
  if (ses) {
    return { configured: true, transport: 'ses', from: ses.from, reason: null };
  }
  if (!fromAddress()) {
    return {
      configured: false,
      transport: null,
      from: null,
      reason:
        'No From address. Set OZIKORO_MAIL_FROM (or OZITUMA_MAIL_FROM, or OZITUMA_SITE_URL, which ' +
        'is used to derive one). The address must be on a domain the provider has verified; ' +
        'scripts/check-mail.sh lists what Resend has verified.',
    };
  }
  const blank = blankMailNames();
  return {
    configured: false,
    transport: null,
    from: fromAddress(),
    reason:
      (blank.length > 0
        ? `These names are set here and carry no value: ${blank.join(', ')}. `
        : '') +
      'No mail transport. Set RESEND_API_KEY for Resend, or OZITUMA_SMTP_HOST, ' +
      'OZITUMA_SMTP_PORT, OZITUMA_SMTP_USER and OZITUMA_SMTP_PASSWORD for a mailbox, or AWS_REGION, ' +
      'AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY for Amazon SES.',
  };
}

// ---------------------------------------------------------------------------
// The message
// ---------------------------------------------------------------------------

/**
 * Encode a header value.
 *
 * Anything outside printable ASCII has to go in an RFC 2047 encoded word, or a
 * subject line with an Igbo word or an accent in it arrives as mojibake.
 */
function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function formatAddress(value: string): string {
  const { address, name } = splitFrom(value);
  if (!name) return `<${address}>`;
  const needsQuoting = !/^[A-Za-z0-9 ._-]+$/.test(name);
  const quoted = needsQuoting ? `"${name.replace(/(["\\])/g, '\\$1')}"` : name;
  return `${encodeHeader(quoted)} <${address}>`;
}

function messageId(from: string): string {
  const { address } = splitFrom(from);
  const domain = address.split('@')[1] ?? 'localhost';
  return `<${randomBytes(16).toString('hex')}@${domain}>`;
}

/**
 * The raw message.
 *
 * Dot-stuffing is applied at send time rather than here so the same bytes can be
 * used by the SES transport, which does its own framing and must not receive
 * stuffed lines.
 */
function buildMessage(message: MailMessage, from: string): string {
  const headers: string[] = [
    `From: ${formatAddress(from)}`,
    `To: ${formatAddress(message.to)}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId(from)}`,
    'MIME-Version: 1.0',
  ];
  if (message.replyTo) headers.push(`Reply-To: ${formatAddress(message.replyTo)}`);

  if (message.html) {
    const boundary = `ozituma-${randomBytes(12).toString('hex')}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(message.text),
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(message.html),
      `--${boundary}--`,
      '',
    ].join('\r\n');
    return `${headers.join('\r\n')}\r\n\r\n${body}`;
  }

  headers.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64');
  return `${headers.join('\r\n')}\r\n\r\n${wrapBase64(message.text)}\r\n`;
}

/** Base64 in 76-character lines, which is what the transfer encoding requires. */
function wrapBase64(value: string): string {
  return (Buffer.from(value, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
}

/**
 * A minimal SMTP client.
 *
 * Written by hand because the alternative is a dependency on the send path of
 * the password-recovery flow. It implements the small part of RFC 5321 that
 * submission needs and refuses to guess at the rest: an advertised STARTTLS is
 * always taken, and a server that offers no encryption at all is only used when
 * the operator has explicitly asked for it with OZITUMA_SMTP_SECURE=0.
 */
class SmtpSession {
  private socket: Socket | TLSSocket | null = null;
  private buffer = '';
  private pending: string[] = [];
  private waiting: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  static async open(config: SmtpConfig): Promise<SmtpSession> {
    const session = new SmtpSession();
    await session.connect(config.secure, config.host, config.port);
    return session;
  }

  private connect(secure: boolean, host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = secure
        ? tlsConnect({ host, port, servername: host }, () => resolve())
        : netConnect({ host, port }, () => resolve());
      this.attach(socket);
      socket.setTimeout(20_000, () => {
        this.failure = new Error('The mail server did not answer in time.');
        socket.destroy();
        reject(this.failure);
      });
      socket.once('error', (error) => {
        this.failure = error instanceof Error ? error : new Error(String(error));
        reject(this.failure);
      });
    });
  }

  private attach(socket: Socket | TLSSocket): void {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      let index = this.buffer.indexOf('\r\n');
      while (index >= 0) {
        const line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 2);
        if (this.waiting) {
          const resume = this.waiting;
          this.waiting = null;
          resume(line);
        } else {
          this.pending.push(line);
        }
        index = this.buffer.indexOf('\r\n');
      }
    });
    socket.on('error', (error) => {
      this.failure = error instanceof Error ? error : new Error(String(error));
      if (this.waiting) {
        const resume = this.waiting;
        this.waiting = null;
        resume('');
      }
    });
    socket.on('close', () => {
      if (this.waiting) {
        const resume = this.waiting;
        this.waiting = null;
        resume('');
      }
    });
  }

  private readLine(): Promise<string> {
    if (this.pending.length > 0) return Promise.resolve(this.pending.shift()!);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.waiting = (line) => {
        if (line === '') {
          reject(this.failure ?? new Error('The mail server closed the connection.'));
          return;
        }
        resolve(line);
      };
      setTimeout(() => {
        if (this.waiting) {
          this.waiting = null;
          reject(new Error('The mail server stopped answering.'));
        }
      }, 20_000).unref?.();
    });
  }

  /** Read a reply, following multi-line replies until the code is followed by a space. */
  async reply(): Promise<{ code: number; text: string }> {
    const lines: string[] = [];
    for (;;) {
      const line = await this.readLine();
      if (line === '') throw new Error('The mail server closed the connection.');
      lines.push(line);
      const match = /^(\d{3})([ -])(.*)$/.exec(line);
      if (!match) throw new Error(`Unreadable reply from the mail server: ${line}`);
      if (match[2] === ' ') return { code: Number(match[1]), text: lines.join('\n') };
    }
  }

  async command(line: string, expect: number[] = [250]): Promise<{ code: number; text: string }> {
    this.write(`${line}\r\n`);
    const response = await this.reply();
    if (!expect.includes(response.code)) {
      throw new Error(`Mail server refused ${line.split(' ')[0]}: ${response.text}`);
    }
    return response;
  }

  private write(data: string): void {
    if (!this.socket) throw new Error('The mail connection is closed.');
    this.socket.write(data);
  }

  /** Write raw bytes — used for the message body, which must not be interpreted. */
  private writeRaw(data: string): void {
    this.write(data);
  }

  async startTls(host: string): Promise<void> {
    const plain = this.socket;
    if (!plain) throw new Error('The mail connection is closed.');
    await new Promise<void>((resolve, reject) => {
      plain.removeAllListeners('data');
      plain.removeAllListeners('close');
      const secure = tlsConnect({ socket: plain, servername: host }, () => resolve());
      secure.once('error', reject);
      this.attach(secure);
    });
  }

  async authenticate(user: string, password: string, mechanisms: string): Promise<void> {
    const upper = mechanisms.toUpperCase();
    if (upper.includes('PLAIN')) {
      const payload = Buffer.from(`\u0000${user}\u0000${password}`, 'utf8').toString('base64');
      await this.command(`AUTH PLAIN ${payload}`, [235]);
      return;
    }
    if (upper.includes('LOGIN')) {
      await this.command('AUTH LOGIN', [334]);
      await this.command(Buffer.from(user, 'utf8').toString('base64'), [334]);
      await this.command(Buffer.from(password, 'utf8').toString('base64'), [235]);
      return;
    }
    throw new Error('The mail server offers no authentication method this client can use.');
  }

  async sendMessage(from: string, to: string, raw: string): Promise<void> {
    await this.command(`MAIL FROM:<${from}>`, [250]);
    await this.command(`RCPT TO:<${to}>`, [250, 251]);
    await this.command('DATA', [354]);
    // Dot-stuffing: a body line that begins with a full stop would otherwise end
    // the message early, truncating it in a way that looks like a client bug.
    const stuffed = raw.replace(/\r\n\./g, '\r\n..');
    this.writeRaw(`${stuffed.replace(/\r\n$/, '')}\r\n.\r\n`);
    const response = await this.reply();
    if (response.code !== 250) throw new Error(`Mail server refused the message: ${response.text}`);
  }

  close(): void {
    const socket = this.socket;
    if (!socket) return;
    try {
      this.write('QUIT\r\n');
    } catch {
      // The connection may already be gone; nothing to do about it.
    }
    // End rather than destroy, so the QUIT actually leaves — a provider that
    // counts connections sees a polite disconnect. The destroy is the fallback
    // for a server that acknowledges nothing, and it is unref'd so a lingering
    // socket cannot hold a request open.
    socket.end();
    setTimeout(() => socket.destroy(), 500).unref?.();
  }
}

async function sendViaSmtp(config: SmtpConfig, message: MailMessage): Promise<void> {
  const session = await SmtpSession.open(config);
  try {
    const greeting = await session.reply();
    if (greeting.code !== 220) throw new Error(`Mail server would not talk: ${greeting.text}`);

    let ehlo = await session.command(`EHLO ${ehloName()}`, [250]);

    if (!config.secure) {
      const capabilities = ehlo.text.toUpperCase();
      if (capabilities.includes('STARTTLS')) {
        await session.command('STARTTLS', [220]);
        await session.startTls(config.host);
        ehlo = await session.command(`EHLO ${ehloName()}`, [250]);
      } else if (process.env.OZITUMA_SMTP_ALLOW_PLAINTEXT !== '1') {
        throw new Error(
          'The mail server does not offer STARTTLS, so the password would cross the network in the ' +
            'clear. Set OZITUMA_SMTP_SECURE=1 if it expects TLS on connect, or ' +
            'OZITUMA_SMTP_ALLOW_PLAINTEXT=1 to accept an unencrypted session.'
        );
      }
    }

    if (config.user && config.password) {
      await session.authenticate(config.user, config.password, ehlo.text);
    }

    const { address } = splitFrom(config.from);
    const { address: recipient } = splitFrom(message.to);
    await session.sendMessage(address, recipient, buildMessage(message, config.from));
  } finally {
    session.close();
  }
}

function ehloName(): string {
  return process.env.OZITUMA_EHLO_NAME ?? 'ozituma.com';
}

// ---------------------------------------------------------------------------
// Amazon SES
// ---------------------------------------------------------------------------

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

/**
 * Sign a request with SigV4.
 *
 * SES's HTTPS API rather than its SMTP endpoint, because the SMTP credentials
 * are a derived pair that has to be generated separately, while the API works
 * with the ordinary access key the box already has — one less credential to
 * create, distribute and rotate.
 */
function signedHeaders(
  config: SesConfig,
  host: string,
  path: string,
  payload: string,
  timestamp: Date
): Record<string, string> {
  const amzDate = timestamp.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash('sha256').update(payload, 'utf8').digest('hex');

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    host,
    'x-amz-date': amzDate,
  };
  if (config.sessionToken) headers['x-amz-security-token'] = config.sessionToken;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join('');
  const signedHeadersList = signedHeaderNames.join(';');

  const canonicalRequest = [
    'POST',
    path,
    '',
    canonicalHeaders,
    signedHeadersList,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${config.region}/ses/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    createHash('sha256').update(canonicalRequest, 'utf8').digest('hex'),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, dateStamp), config.region), 'ses'),
    'aws4_request'
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return {
    ...headers,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeadersList}, Signature=${signature}`,
  };
}

async function sendViaSes(config: SesConfig, message: MailMessage): Promise<void> {
  const host = `email.${config.region}.amazonaws.com`;
  const path = '/v2/email/outbound-emails';
  const { address } = splitFrom(config.from);

  const body = JSON.stringify({
    FromEmailAddress: address,
    Destination: { ToAddresses: [splitFrom(message.to).address] },
    ...(message.replyTo ? { ReplyToAddresses: [splitFrom(message.replyTo).address] } : {}),
    Content: {
      Simple: {
        Subject: { Data: message.subject, Charset: 'UTF-8' },
        Body: {
          Text: { Data: message.text, Charset: 'UTF-8' },
          ...(message.html ? { Html: { Data: message.html, Charset: 'UTF-8' } } : {}),
        },
      },
    },
  });

  const headers = signedHeaders(config, host, path, body, new Date());
  const response = await fetch(`https://${host}${path}`, {
    method: 'POST',
    headers,
    body,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    let reason = detail.slice(0, 400);
    try {
      const parsed = JSON.parse(detail) as { message?: string };
      if (parsed.message) reason = parsed.message;
    } catch {
      // Not JSON; the raw body is the best we have.
    }
    throw new Error(`SES refused the message (${response.status}): ${reason}`);
  }
}

// ---------------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------------

/**
 * One POST, and the provider's answer returned rather than assumed.
 *
 * Resend is the transport this project has a working key for, so it is the one whose failures matter
 * most, and the failure is the part worth being careful about: a non-2xx is turned into an Error
 * carrying the API's own message, because "the API said 403: domain is not verified" is a fact an
 * administrator can act on and "sending failed" is not. **Nothing is swallowed and nothing is
 * guessed at** — a message is delivered only when the API said 200.
 */
async function sendViaResend(config: ResendConfig, message: MailMessage): Promise<string | null> {
  const body = JSON.stringify({
    // The display name is passed through as Resend expects it: `Name <address@domain>`.
    from: config.from,
    to: [splitFrom(message.to).address],
    subject: message.subject,
    text: message.text,
    // Resend's own field name for a reply address is snake_case; `replyTo` here would be ignored
    // silently, which is the kind of mistake that only shows up when somebody replies.
    ...(message.replyTo ? { reply_to: splitFrom(message.replyTo).address } : {}),
    ...(message.html ? { html: message.html } : {}),
  });

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body,
  });

  const detail = await response.text().catch(() => '');
  if (!response.ok) {
    let reason = detail.slice(0, 400);
    try {
      const parsed = JSON.parse(detail) as { message?: string; error?: string };
      reason = parsed.message ?? parsed.error ?? reason;
    } catch {
      // Not JSON; the raw body is the best we have.
    }
    throw new Error(`Resend refused the message (${response.status}): ${reason}`);
  }

  /*
   * A 200 whose body we cannot read is still a sent message: the id is for reporting, not for
   * deciding. Treating an unreadable body as a failure would report a delivered recovery link as
   * lost, which is the one direction this must never fail in.
   */
  try {
    const parsed = JSON.parse(detail) as { id?: string };
    return parsed.id ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The public entry point
// ---------------------------------------------------------------------------

/**
 * Send a message, or say why not.
 *
 * Never throws. The caller decides what to do with a failure, because only the
 * caller knows whether there is a fallback — for password recovery there is one,
 * and for a courtesy notification there is not.
 */
export async function sendMail(message: MailMessage): Promise<SendResult> {
  const status = mailStatus();
  if (!status.configured || !status.transport) {
    return { delivered: false, transport: null, error: status.reason ?? 'Mail is not configured.' };
  }

  try {
    if (status.transport === 'resend') {
      const config = resendConfig();
      if (!config) throw new Error('Resend configuration disappeared.');
      const id = await sendViaResend(config, message);
      return { delivered: true, transport: 'resend', ...(id ? { id } : {}) };
    }
    if (status.transport === 'smtp') {
      const config = smtpConfig();
      if (!config) throw new Error('SMTP configuration disappeared.');
      await sendViaSmtp(config, message);
      return { delivered: true, transport: 'smtp' };
    }
    const config = sesConfig();
    if (!config) throw new Error('SES configuration disappeared.');
    await sendViaSes(config, message);
    return { delivered: true, transport: 'ses' };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error('[mail]', reason);
    return { delivered: false, transport: status.transport, error: reason };
  }
}

/** The site's own address, for `Contact` lines and for people to reply to. */
export function siteAddress(): string {
  const from = fromAddress();
  return from ? splitFrom(from).address : 'hello@ozituma.com';
}
