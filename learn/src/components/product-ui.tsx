import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-xs font-extrabold uppercase text-primary", className)}>{children}</p>;
}

export function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "positive" | "warning" }) {
  return (
    <span className={cn(
      "inline-flex min-h-6 items-center rounded-sm px-2 text-[10px] font-black uppercase",
      tone === "positive" && "bg-primary text-primary-foreground",
      tone === "warning" && "bg-secondary text-secondary-foreground",
      tone === "neutral" && "bg-muted text-muted-foreground",
    )}>
      {children}
    </span>
  );
}

export function EmptyState({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="border border-dashed border-border bg-card px-5 py-10 text-center">
      <span className="mx-auto grid size-11 place-items-center rounded-full bg-muted text-primary"><Icon className="size-5" /></span>
      <h3 className="mt-4 font-display text-xl font-semibold">{title}</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted-foreground">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function LoadingRows({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="flex animate-pulse items-center gap-4 border border-border bg-card p-4">
          <div className="size-11 rounded-md bg-muted" />
          <div className="flex-1 space-y-2"><div className="h-3 w-2/5 rounded bg-muted" /><div className="h-3 w-3/5 rounded bg-muted" /></div>
        </div>
      ))}
    </div>
  );
}