import { createFileRoute } from "@tanstack/react-router";
import { LearnApp } from "@/components/app-shell";

/** The Tutor tab, reachable directly at /tutor. */
export const Route = createFileRoute("/tutor")({
  component: () => <LearnApp tab="Tutor" />,
});
