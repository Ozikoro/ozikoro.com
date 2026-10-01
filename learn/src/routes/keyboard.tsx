import { createFileRoute } from "@tanstack/react-router";
import { LearnApp } from "@/components/app-shell";

/** The Keyboard tab, reachable directly at /keyboard. */
export const Route = createFileRoute("/keyboard")({
  component: () => <LearnApp tab="Keyboard" />,
});
