import { createFileRoute } from "@tanstack/react-router";
import { LearnApp } from "@/components/app-shell";

/**
 * The home tab.
 *
 * Every menu item is now its own route rather than a state change, so this file, `/learn`,
 * `/practise` and the rest differ only in which tab they hand to `LearnApp`. The alternative — one
 * route holding all of them in state — is what made every menu item a 404 on a direct hit and made
 * the URL useless for sharing or reloading.
 */
export const Route = createFileRoute("/")({
  component: () => <LearnApp tab="Home" />,
});
