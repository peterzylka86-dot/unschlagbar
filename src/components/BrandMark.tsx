import { Link } from "@tanstack/react-router";

export function BrandMark({ size = "md", to = "/" as string | undefined }: { size?: "sm" | "md" | "lg" | "xl"; to?: string }) {
  const cls =
    size === "xl" ? "text-7xl sm:text-8xl"
    : size === "lg" ? "text-5xl"
    : size === "md" ? "text-3xl"
    : "text-xl";
  const inner = (
    <span className={`brand-mark ${cls} inline-flex items-baseline gap-1 leading-none`}>
      <span className="text-foreground">34</span>
      <span className="text-primary text-shadow-glow">:</span>
      <span className="text-foreground">0</span>
    </span>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

export function WordMark({ className = "" }: { className?: string }) {
  return (
    <span className={`brand-mark tracking-[0.18em] ${className}`}>UNSCHLAGBAR</span>
  );
}
