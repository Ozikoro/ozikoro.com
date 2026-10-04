# Ozikoro Academy — agent notes

The Academy is the learning layer of the Ozikoro project, served at **academy.ozikoro.com**. It sits
beside the archive (`ozikoro.com`) and the dictionary (`ozituma.com`).

## Where this code came from

It was built in Lovable as `idenze/academy-hub` and imported here. **That Lovable project is no
longer the origin** — commits to this repository do not sync back to it, and the "do not rewrite
published history" warning that shipped with the import applied to that connection rather than this
one. If the Academy is ever reconnected to Lovable, that warning becomes true again and belongs here.

## Two rules that survive the import

- **Keep the front end data-driven through `src/data/academy.ts`**, so the catalogue, detail and
  learning views stay consistent with each other. A page that grows its own copy of course data is a
  page that will disagree with the catalogue the first time either changes.
- **The Academy must use Ozikoro's single shared authentication, profile, role and admin data
  source, so that registration applies everywhere.** This is the requirement the Academy has not yet
  met: it currently has no backend, and every account, enrolment, progress and certificate state is
  representative content. See `README.md` for the full account of what is and is not real.

## Things worth knowing before changing it

- **`vite.config.ts` names the Nitro preset `node-server`, and removing that line breaks the
  deploy.** The config wrapper defaults to Cloudflare, which produces an artefact `node` cannot run.
- **`src/components/ozikoro-mark.tsx` is the brand, drawn inline.** The path data is the owner's
  master artwork — treat it as an asset, not as code to tidy.
- **`apps/academy` is deliberately NOT an npm workspace member.** It has its own lockfile and its own
  Docker build, so its dependency graph cannot collide with the two Next.js apps'. See the header of
  `Dockerfile`.
- **The shell's top bar names `academy.ozikoro.com` as the current host.** That is accurate now;
  it was not before the hostname existed.
