import { createFileRoute } from "@tanstack/react-router";
import { LearnApp } from "@/components/app-shell";

/** The Learn tab, reachable directly at /learn. */
export const Route = createFileRoute("/learn")({
  component: () => <LearnApp tab="Learn" />,
});
