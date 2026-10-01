import { createFileRoute } from "@tanstack/react-router";
import { LearnApp } from "@/components/app-shell";

/** The Profile tab, reachable directly at /profile. */
export const Route = createFileRoute("/profile")({
  component: () => <LearnApp tab="Profile" />,
});
