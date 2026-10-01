// Side-effect import: registers the stale-chunk reload listener before any route chunk loads.
import "@/lib/stale-chunk-recovery";
import "@/lib/register-service-worker";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  console.error(normalizedError);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(normalizedError, { boundary: "tanstack_root_error_component" });
  }, [normalizedError]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Ozituma Learn" },
      { name: "description", content: "A thoughtful path into Igbo language and culture." },
      { name: "author", content: "Ozituma" },
      { property: "og:title", content: "Ozituma Learn" },
      { property: "og:description", content: "A thoughtful path into Igbo language and culture." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },

      /*
       * The official brand head, from the kit's head-snippet.html.
       *
       * `theme-color` is Ink (#1E1B16) from the brand palette — it tints the browser chrome on
       * mobile. The social image is an ABSOLUTE url because other servers fetch it, and a relative
       * path means nothing to them.
       */
      { property: "og:site_name", content: "Ozituma" },
      { property: "og:image", content: "https://learn.ozituma.com/og-image-1200x630.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:image", content: "https://learn.ozituma.com/og-image-1200x630.png" },
      { name: "theme-color", content: "#1E1B16" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },

      /*
       * The kit's favicons, exactly as shipped. Its instruction is to put the files from /favicon
       * at the site root, which is where they now are.
       *
       * The ICO is listed first for browsers that stop at the first icon they understand; the SVG
       * follows so modern browsers take the sharp one. `mask-icon` is Safari's pinned tab and takes
       * Ochre from the palette.
       */
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { rel: "icon", href: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "mask-icon", href: "/safari-pinned-tab.svg", color: "#C8792B" },
      { rel: "manifest", href: "/site.webmanifest" },

      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      /* The kit's typography: Gelasio for headings, Source Sans 3 for body and interface text. */
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Gelasio:wght@400;500;600;700&family=Source+Sans+3:wght@400;600;700;800;900&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}
