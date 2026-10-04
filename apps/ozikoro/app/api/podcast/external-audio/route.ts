/**
 * POST /api/podcast/external-audio — record that an episode's audio lives somewhere else.
 *
 * THE OWNER'S INSTRUCTION, VERBATIM
 *
 *   "there should be an option to add spotify audio link, instead of my own generated link. all these are
 *    options"
 *
 * THIS ROUTE SPENDS NOTHING, AND THAT IS WHY ITS GATE IS NOT THE SPEND GATE
 *
 * `approve-proposal` needs `manage_ai_corpus` because it sends a script to ElevenLabs and is billed per
 * character. Nothing here reaches the API: it records an address a person has already published somewhere
 * else. So the capability is `review_audio` — the one 0046 added for "special access to the audio files" —
 * and it is the same capability that publishes a rendered take, because this IS a publication: the episode
 * becomes live on the article and in the feed.
 *
 * WHY THE DECISION IS RECORDED AS AN APPROVAL
 *
 * The owner's rule is that an unapproved episode shows no audio. Attaching an external link is a deliberate,
 * named, audited act by a person who holds the audio capability, and there is no charge for the approval to
 * gate. `setEpisodeExternalAudio` therefore writes `approved_by`/`approved_at`/`published_at` itself, which
 * is what makes the episode admissible on all three public surfaces rather than merely assuming it.
 *
 * THE CHECK, AND WHAT IT DOES AND DOES NOT ESTABLISH
 *
 * The URL is fetched once, server-side, with a timeout, and the response decides two things:
 *
 *   * a 404 or 410 REFUSES the save, with the status in the sentence — the same rule and the same shape as
 *     `imageAddressProblem` in `/api/admin/design/`, because **an address that does not resolve is a hole in
 *     the page** whether it holds a photograph or a podcast;
 *   * the content type decides `external_direct_audio`, which is what the FEED needs: an `<enclosure>` must
 *     be a directly playable audio resource, and `https://open.spotify.com/episode/…` is an HTML page.
 *
 * **What it does NOT establish is what a reader will see.** Spotify answers a bot and a browser differently:
 * a 200 here says the address resolved from this machine at this moment, not that a reader's session is
 * permitted to play it. The note stored on the row says which of those two things was checked, so nobody has
 * to infer it later.
 *
 * A FETCH THAT THROWS IS NOT EVIDENCE THE ADDRESS IS WRONG — a timeout, a DNS blip or a service restarting
 * is recorded as "could not be checked" and the link is still saved. Refusing on an inability to check would
 * block a correct edit whenever the check itself was unlucky. The rule is `imageAddressProblem`'s.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';
import {
  EXTERNAL_AUDIO_LABELS,
  clearEpisodeExternalAudio,
  externalAudioShapeProblem,
  isDirectAudioContentType,
  isExternalAudioService,
  setEpisodeExternalAudio,
} from '@ozikoro/platform';
import { sameOrigin } from '@/lib/access';
import { answerAction, guardNarration, memberErrorOutcome, readAction } from '@/lib/narration-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The narrator kinds the episode vocabulary already holds. Stated by a person, never defaulted. */
const NARRATOR_KINDS = ['human', 'synthetic_own_voice', 'synthetic_generic'] as const;
type NarratorKind = (typeof NARRATOR_KINDS)[number];

function isNarratorKind(value: string): value is NarratorKind {
  return (NARRATOR_KINDS as readonly string[]).includes(value);
}

/**
 * What a fetch of the address establishes.
 *
 * `refuse` is returned only for a status that means the resource is genuinely gone (404, 410). Every other
 * non-2xx is reported and allowed: a 401/403 is what a service does to a checkout runner it does not know,
 * and a 429 is a rate limit — neither is a reason to tell an editor their correct link is wrong.
 */
type UrlCheck = { refuse: string | null; directAudio: boolean; contentType: string | null; note: string };

async function checkAddress(url: string): Promise<UrlCheck> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(8_000),
      headers: {
        // Named honestly. A default `undici` user agent is what some services refuse, and a refusal we caused
        // is not evidence about the address.
        'user-agent': 'OzikoroArchive/1.0 (+https://ozikoro.com; link check)',
        accept: 'audio/*,text/html;q=0.9,*/*;q=0.5',
      },
      cache: 'no-store',
    });
    const contentType = res.headers.get('content-type');
    if (res.status === 404 || res.status === 410) {
      return {
        refuse:
          `That address answers ${res.status} — the page or file is not there, so an article pointing at it ` +
          'would send a reader to a dead end. Correct the address, or leave it out.',
        directAudio: false,
        contentType: null,
        note: `Answered ${res.status}.`,
      };
    }
    const direct = res.ok && isDirectAudioContentType(contentType);
    return {
      refuse: null,
      directAudio: direct,
      contentType: direct ? contentType : null,
      note: res.ok
        ? `Answered ${res.status} with content-type ${contentType ?? '(none)'}` +
          (direct ? ' — a directly playable audio resource.' : ' — a page, not a file the feed can enclose.')
        : `Answered ${res.status}` +
          (res.status === 401 || res.status === 403
            ? ' — the service refused this server, which says nothing about a reader’s browser.'
            : ' — recorded as it answered.'),
    };
  } catch (error) {
    // Not evidence of absence. The distinction is the one `imageAddressProblem` records.
    return {
      refuse: null,
      directAudio: false,
      contentType: null,
      note:
        'The address could not be checked from this server (' +
        `${String(error instanceof Error ? error.name : error).slice(0, 60)}). It has been saved unchecked; ` +
        'a failed check is not evidence that the address is wrong.',
    };
  }
}

export async function POST(request: Request): Promise<Response> {
  const input = await readAction(request);
  if (!sameOrigin(request)) {
    return answerAction(input, {
      ok: false, status: 403, payload: { error: 'cross_origin' }, notice: 'That request did not come from this site.',
    });
  }

  const guard = await guardNarration(input, 'review_audio');
  if (!guard.ok) return guard.response;

  const slug = (input.data.slug ?? '').trim();
  const url = (input.data.url ?? '').trim();
  const service = (input.data.service ?? '').trim();
  const narratorKind = (input.data.narrator ?? '').trim();

  if (!slug) {
    return answerAction(input, {
      ok: false, status: 400, payload: { error: 'An episode slug is required.' }, notice: 'Name the episode.',
    });
  }

  const db = await getDb();

  try {
    // An empty address is a deliberate removal, not a validation failure.
    if (url.length === 0) {
      const cleared = await clearEpisodeExternalAudio(db, {
        slug,
        actorId: guard.actorId,
        note: (input.data.note ?? '').trim() || null,
      });
      return answerAction(input, {
        ok: true,
        notice:
          cleared.status === 'withdrawn'
            ? `The external link was removed from “${cleared.slug}”, and because this archive holds no copy of ` +
              'its audio the episode is now WITHDRAWN rather than left published and silent.'
            : `The external link was removed from “${cleared.slug}”. The copy this archive holds is what the ` +
              'page now offers.',
        payload: { ok: true, ...cleared },
      });
    }

    const shape = externalAudioShapeProblem(url, service);
    if (shape) {
      return answerAction(input, {
        ok: false, status: 400, payload: { error: 'bad_external_url', message: shape }, notice: shape,
      });
    }
    if (!isNarratorKind(narratorKind)) {
      // Not defaulted: the record says who is speaking because a person said so.
      return answerAction(input, {
        ok: false,
        status: 400,
        payload: { error: 'narrator_required', kinds: NARRATOR_KINDS },
        notice:
          'Say who is speaking on that recording — read by a person, or generated in the author’s cloned ' +
          'voice, or generated in a stock voice. This archive does not guess it.',
      });
    }

    const check = await checkAddress(url);
    if (check.refuse) {
      return answerAction(input, {
        ok: false, status: 400, payload: { error: 'external_url_not_found', message: check.refuse }, notice: check.refuse,
      });
    }

    const saved = await setEpisodeExternalAudio(db, {
      slug,
      url,
      service: isExternalAudioService(service) ? service : 'other',
      narratorKind,
      narratorName: (input.data.narrator_name ?? '').trim() || null,
      directAudio: check.directAudio,
      mimeType: check.contentType,
      checkNote: check.note,
      actorId: guard.actorId,
      note: (input.data.note ?? '').trim() || null,
    });

    const label = saved.after.external_service && isExternalAudioService(saved.after.external_service)
      ? EXTERNAL_AUDIO_LABELS[saved.after.external_service]
      : EXTERNAL_AUDIO_LABELS.other;
    const feedLine = check.directAudio
      ? 'It is a directly playable file, so the feed’s enclosure points at it.'
      : saved.after.storage_key
        ? 'It is a page rather than a file, so the feed’s enclosure stays on the copy this archive holds.'
        : 'It is a page rather than a file and this archive holds no copy, so the episode is NOT listed in the feed — a podcast item without a playable enclosure is rejected.';

    return answerAction(input, {
      ok: true,
      notice:
        `“${saved.slug}” is PUBLISHED with its audio recorded as held on ${label}. ${feedLine} ` +
        'Nothing was rendered and no credit was spent.',
      payload: {
        ok: true,
        episodeId: saved.episodeId,
        slug: saved.slug,
        status: saved.status,
        externalUrl: saved.after.external_url,
        externalService: saved.after.external_service,
        directAudio: check.directAudio,
        checked: check.note,
        article: `/${saved.slug}/`,
        feed: check.directAudio || saved.after.storage_key ? '/podcast/feed.xml' : null,
        rendered: false,
      },
    });
  } catch (error) {
    return answerAction(input, memberErrorOutcome(error));
  }
}

/** Without a body there is nothing to record, and the two fields a caller must supply are named. */
export async function GET(): Promise<Response> {
  return NextResponse.json(
    {
      error: 'Use POST.',
      body: {
        slug: '<episode-slug>',
        url: 'https://open.spotify.com/episode/…',
        service: 'spotify',
        narrator: 'human | synthetic_own_voice | synthetic_generic',
      },
      note:
        'Requires the “review_audio” capability. Spends nothing: no render is made and ElevenLabs is not ' +
        'called. An empty url removes the external link.',
    },
    { status: 405, headers: { 'cache-control': 'no-store' } }
  );
}
