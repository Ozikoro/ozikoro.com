import { createFileRoute } from "@tanstack/react-router";
import { LearnApp } from "@/components/app-shell";

/** The Teachers tab, reachable directly at /teachers. */
export const Route = createFileRoute("/teachers")({
  component: () => <LearnApp tab="Teachers" />,
});
