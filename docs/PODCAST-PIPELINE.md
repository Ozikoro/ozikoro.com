# The article-to-audio-to-Spotify pipeline

This records what was asked for, what is actually possible, and what is missing, so that the
work can be picked up later without rediscovering any of it.

## What was asked for

> "build the website for every article or folklore be converted to audio automatically"
> and published to Spotify.

The full intended workflow, as originally stated:

    article -> podcast script -> audio generation -> podcast metadata
            -> authorised publishing -> Spotify -> store the episode URL/ID back in Ozikoro

## The one misconception that has to be corrected first

**Spotify has no API that uploads a podcast episode.** This is not a permissions problem and
not a scope that was missed. There is no endpoint, so no amount of OAuth gets one.

That claim is worth proving rather than asserting, so it was checked against Spotify's own
machine-readable API definition, the OpenAPI schema the Web API reference is generated from, at
`https://developer.spotify.com/reference/web-api/open-api-schema.yaml`. Downloaded and counted:

| | |
|---|---|
| Paths | **70** |
| Operations | **96** |
| Paths that are read-only (`GET` only) | 46 |
| Paths with any write operation | 24 |

Every path that concerns shows and episodes is **`GET` only**:

```
/shows/{id}               GET
/shows                     GET
/shows/{id}/episodes       GET
/episodes/{id}             GET
/episodes                   GET
```

The only write operations anywhere near this are `PUT` and `DELETE` on `/me/shows` and
`/me/episodes`, and those *save to* and *remove from* the user's own library
(`operationId: save-shows-user`, `remove-shows-user`). They do not create anything.

The word **"upload" appears exactly once in the entire schema**:
`upload-custom-playlist-cover`, a JPEG for a playlist, requiring the `ugc-image-upload` scope.
That is the whole of Spotify's upload capability. In one line: **the Spotify Web API is a
consumption and library API, not a publishing API.**

The developer community is told the same thing, and the request is an open issue on Spotify's
tracker ([spotify/web-api#600](https://github.com/spotify/web-api/issues/600)).

So `authorised publishing -> Spotify` cannot be built as an API call, and any code that
pretends otherwise would be a lie in the repository.

**What Spotify actually does is ingest podcasts from an RSS feed.** That is the distribution
mechanism, it is fully automatable, and it needs no Spotify API at all:

- Spotify for Creators lets you supply an RSS feed, and Spotify polls it and publishes new
  episodes it finds. See [Finding and enabling your RSS feed](https://support.spotify.com/de-en/creators/article/finding-and-enabling-your-rss-feed/)
  and [Switch your podcast host to Spotify](https://creators.spotify.com/switch).
- Episode audio is delivered as an `<enclosure>` in the feed. The format is specified in
  Spotify's own [Podcast Delivery Specification](https://content-ops.atspotify.com/hc/en-us/article_attachments/4413124729499/Podcast_Delivery_Specification_v1.9.pdf).

**Consequence for the architecture.** The OAuth connection is not the publishing path. The
publishing path is: generate audio, serve it at a stable URL, write it into our own RSS feed,
and let Spotify ingest the feed.

**What the connection is genuinely good for** deserves stating precisely, because it is not
nothing. `GET /shows/{id}`, `GET /shows/{id}/episodes` and `GET /episodes/{id}` are public
catalogue reads needing no user authorisation at all, so once the feed is ingested Ozikoro can
read the episodes back and store their Spotify IDs and URLs — which is step 7 of the pipeline
below. The connection is what identifies the owning account, and it is cheap insurance for
whatever Spotify ships next. It should simply not be described as the thing that publishes.

## The corrected pipeline

| Stage | State | Notes |
|---|---|---|
| 1. Article or folklore text | **exists** | the archive being migrated from the old ozikoro.com WordPress site |
| 2. Podcast script | not built | needs a narration-oriented rewrite: the article is written to be read, a script to be heard. Oral genres (folktales) should probably not be rewritten at all, only prepared |
| 3. Audio generation (TTS) | **not built, and this is the hard part** | see below |
| 4. Episode metadata | not built | title, description, publication date, duration, episode/season numbering, GUID, transcript |
| 5. RSS feed | not built | stable, validated, with `<enclosure>` per episode and an `itunes:` namespace |
| 6. Spotify ingestion | Spotify's side | feed submitted once; Spotify polls thereafter |
| 7. Store episode URL/ID back | not built | match on GUID; needs a table linking an article to its episode |

## Stage 3 is the real obstacle, and it is not Spotify

The repository has serious prior work on Igbo **speech recognition** in `asr-lab/FINDINGS.md`,
measuring models on this machine against real recordings. That work is the *opposite* direction
(sound to text) and it does **not** transfer to text-to-speech. Its findings do say two things
that matter here:

- **Whisper has no Igbo language token at all**, so every Whisper variant is a dead end for
  Igbo in either direction.
- Text-to-speech was not investigated at all in that work. There is no Igbo TTS in this
  repository, and no measured evidence that any available engine is usable.

Why Igbo TTS is genuinely hard, and why it needs a decision rather than an assumption:

1. **Tone is lexical and the current orthography is lossy in practice.** `ákwá` (egg/cry) and
   `àkwà` (bed) are different words. A synthesiser that ignores tone marks, or that a pipeline
   strips before sending, produces confidently wrong audio. The repository already models this
   carefully (`packages/core/src/orthography.ts` distinguishes letter marks from tone marks),
   and any TTS step must consume the orthography intact.
2. **Dotted vowels are letters, not decoration.** `ị`, `ọ`, `ụ`, `ẹ` and `ṅ` change the word.
   The `asr-lab` measurements found that the dominant ASR errors were exactly `ọ/o`, `ụ/u`,
   `ị/i` and tone — which is a warning about how easily these are lost in an audio pipeline.
3. **Low-resource language.** Large commercial TTS engines generally do not offer Igbo, and
   the ones that approximate it produce an accent that a native speaker will hear as wrong.
   Audio published under Ozikoro's name carries the platform's credibility, and the design
   brief is explicit that nothing may be presented as authoritative that is not.

**Therefore stage 3 must begin with a measured evaluation, not an integration.** The shape of
that evaluation is already established by `asr-lab`: pick candidate engines, generate a fixed
set of test sentences that include minimal tone pairs, and have a native speaker judge them,
the way the ASR work had its output checked against the filed words. Until that exists, any
"automatic audio for every article" is a claim the platform cannot stand behind.

Options to evaluate, none of them verified:

- a hosted multilingual TTS that claims Igbo coverage, judged by a native speaker;
- a Nigerian or Igbo voice actor for the folklore, which is the honest answer for oral genres
  and cannot be automated;
- fine-tuning an open TTS model on the recording corpus, which is the largest undertaking and
  only becomes sensible once there is a corpus and a licence to use it.

## Operational constraints of the Spotify app as configured

Read from the Spotify Developer Dashboard for the app whose credentials are stored in
`.env.local`:

- **App Status: Development mode.** A development-mode app can only authorise accounts on its
  own allow-list, and is not usable by the public. For Ozikoro this is acceptable, because the
  connection belongs to one organisational account. It does mean that anyone who needs to
  press Connect must be added to the app's user list in the Dashboard first.
- **Refresh Token Lifetime: 180 days.** The connection therefore cannot live forever without
  attention: after that window the refresh token stops working and the administrator must
  reconnect. The implementation already handles this correctly rather than silently: a refused
  refresh is recorded, the setup screen says "Reconnect Spotify", and the connection is not
  destroyed while it is broken.
- Spotify shipped **February 2026 development-mode changes** (there is a
  [migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)),
  reported by TechCrunch as requiring a Premium account and reducing the number of test users.
  The full text could not be read while writing this (the page body and the community thread
  were not retrievable), so treat those specifics as unconfirmed and check the Dashboard.

## What already exists and can be reused

- **The secure connection**: `@ozikoro/platform` (`packages/ozikoro/`), with `getValidAccessToken(db)` and
  `spotifyApiCall(db, path, init)` as the seam. Access tokens renew automatically; the
  administrator is only asked to reconnect when the grant itself is refused.
- **A place to put episode records**: the migration pattern in `packages/db/migrations/`, and
  the archive tables this will grow alongside.
- **Audio storage**: `packages/db/src/storage.ts` already has an S3-or-local-filesystem driver
  with signature checking, used for pronunciation recordings. Episode audio is much larger and
  long-lived, so it belongs in the bucket (`S3_BUCKET`), not the local driver.
- **Orthography handling**: `packages/core/src/orthography.ts`, which must be in the path
  between the article text and whatever speaks it.
- **An AI gateway**: `packages/core/src/ai/` (Anthropic and OpenAI) is available for the
  script-writing stage, with the existing guardrails and spend limits.

## Decisions needed before this is built

1. **Which voice, and is it disclosed?** Every episode page should say how the audio was made.
   Undisclosed synthetic narration of cultural material is a credibility risk the design brief
   would not accept.
2. **Are folktales narrated or read by a person?** They are oral literature, and a synthetic
   voice may be the wrong answer regardless of quality.
3. **Where does the feed live?** Its URL is permanent and Spotify re-polls it forever, so it
   should be on a domain Ozikoro controls (`ozikoro.com`), not a third-party host.
4. **Does every article become an episode, or only some?** A feed that publishes everything
   indiscriminately is a different product from a curated series, and Spotify's own metadata
   (seasons, episode numbers) forces the question.
5. **What is the licence on the source text?** Audio is a new derivative work; material that
   arrived from partners for text publication may not permit a spoken version.
