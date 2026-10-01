import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
  variant?: "primary" | "secondary" | "ghost" | "icon";
  children: ReactNode;
};

export function Button({ asChild, variant = "primary", className, ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        variant === "primary" && "bg-primary text-primary-foreground shadow-sm hover:-translate-y-0.5 hover:bg-primary/90",
        variant === "secondary" && "border border-border bg-card text-card-foreground hover:bg-muted",
        variant === "ghost" && "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
        variant === "icon" && "size-11 min-h-11 bg-transparent p-0 text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
