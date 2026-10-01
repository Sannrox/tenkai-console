import type { ComponentProps, ReactNode } from "react";

/** Primitives matching the reference mock: cards, buttons, a centered panel. */

export const Card = ({ className = "", ...props }: ComponentProps<"div">) => (
  <div className={`rounded-card border border-line bg-card ${className}`} {...props} />
);

type ButtonProps = ComponentProps<"button"> & { variant?: "primary" | "plain" | "ghost" };

export const Button = ({ variant = "plain", className = "", ...props }: ButtonProps) => {
  const look = {
    primary: "border-primary bg-primary text-surface",
    plain: "border-field text-fg",
    ghost: "border-transparent text-muted",
  }[variant];
  return (
    <button
      type="button"
      className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50 ${look} ${className}`}
      {...props}
    />
  );
};

/** Full-height centered column used by sign-in and server status screens. */
export const Centered = ({ children }: { children: ReactNode }) => (
  <main className="grid min-h-screen place-items-center bg-page p-6">
    <Card className="w-full max-w-[380px] p-[22px]">{children}</Card>
  </main>
);

export const Title = ({ subtitle }: { subtitle: string }) => (
  <>
    <div className="text-[15px] font-semibold">Tenkai</div>
    <div className="mb-4 text-xs text-muted">{subtitle}</div>
  </>
);
