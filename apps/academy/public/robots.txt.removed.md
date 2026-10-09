`public/robots.txt` was deleted on purpose.

Nitro serves files from `public/` BEFORE the server entry's fetch handler, so a static
robots.txt made the launch gate's own robots response unreachable — the gate was closed and the
live file still said `Allow: /`. It is now answered by `src/backend/coming-soon.ts`, which
returns Disallow while the gate is closed and the ordinary Allow rules when it opens.

Do not add it back: a static file here silently overrides the gate.
