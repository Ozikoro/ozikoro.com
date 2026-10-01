import { createFileRoute } from "@tanstack/react-router";
import { LearnApp } from "@/components/app-shell";

/** The Practise tab, reachable directly at /practise. */
export const Route = createFileRoute("/practise")({
  component: () => <LearnApp tab="Practise" />,
});
