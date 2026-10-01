import { createFileRoute } from "@tanstack/react-router";
import { LearnApp } from "@/components/app-shell";

/** The Ndebe tab, reachable directly at /ndebe. */
export const Route = createFileRoute("/ndebe")({
  component: () => <LearnApp tab="Ndebe" />,
});
