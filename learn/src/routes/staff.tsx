import { createFileRoute } from "@tanstack/react-router";
import { LearnApp } from "@/components/app-shell";

/** The Staff tab, reachable directly at /staff. */
export const Route = createFileRoute("/staff")({
  component: () => <LearnApp tab="Staff" />,
});
