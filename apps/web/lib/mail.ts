/**
 * Sending mail — the one thing password recovery cannot do without.
 *
 * A recovery link has to reach the person, and the person is not at the site.
 * Everything else Ozituma sends is a courtesy; this is the only message whose
 * failure locks somebody out of their own account, so the way it is configured
 * and the way it fails both matter here more than they would elsewhere.
 *
 * TWO TRANSPORTS, ONE FUNCTION
 *
 * `sendMail` speaks SMTP, and it speaks Amazon SES. SMTP is what a mailbox
 * provider gives you (Zoho, cPanel, Fastmail, Google) and SES is what the
 * project's own AWS account gives you; between them they cover every way this
 * site is likely to send anything, and a change of provider is an environment
 * variable rather than a code change. Both are written against Node's own
 * `net`, `tls` and `crypto` — there is no dependency here to keep patched, which
 * is the same reason passwords use `scrypt`.
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

export type Transport = 'smtp' | 'ses' | null;

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

/**
 * The From address.
 *
 * `OZITUMA_MAIL_FROM` when set. Otherwise the site's own domain is used as a
 * last resort, and a message sent from an address that does not exist will be
 * refused or filed as spam — which is why the status reports whether the address
 * was explicitly set rather than silently inventing one.
 */
function fromAddress(): string | null {
  const explicit = env('OZITUMA_MAIL_FROM');
  if (explicit) return explicit;
  const site = env('OZITUMA_SITE_URL');
  if (!site) return null;
  try {
    const host = new URL(site).hostname.replace(/^www\./, '');
    return `Ozituma <hello@${host}>`;
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
 * Which transport, if any, would carry a message right now.
 *
 * SMTP wins when both are present: it is the one an operator has deliberately
 * configured for this site, whereas the AWS variables are on the box for the
 * media bucket and would otherwise be picked up by accident.
 */
export function mailStatus(): MailStatus {
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
        'No From address. Set OZITUMA_MAIL_FROM (and OZITUMA_SITE_URL, which is used to derive one).',
    };
  }
  return {
    configured: false,
    transport: null,
    from: fromAddress(),
    reason:
      'No mail transport. Set OZITUMA_SMTP_HOST, OZITUMA_SMTP_PORT, OZITUMA_SMTP_USER and ' +
      'OZITUMA_SMTP_PASSWORD for a mailbox, or AWS_REGION, AWS_ACCESS_KEY_ID and ' +
      'AWS_SECRET_ACCESS_KEY for Amazon SES.',
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
