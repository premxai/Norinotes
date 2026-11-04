import type { ReactNode } from "react";

/** A section's opening: eyebrow label, H2 and lead, spaced as in spec section 3. */
export function SectionHead({ id, eyebrow, title, lead, center = false, className = "" }: { id: string; eyebrow: string; title: ReactNode; lead?: ReactNode; center?: boolean; className?: string }) {
  return (
    <div className={`flex flex-col gap-4 ${center ? "items-center text-center" : ""} ${className}`}>
      <p className="font-mono text-label text-ink-2">{eyebrow}</p>
      <h2 id={id} className="max-w-[45ch] font-serif text-h2 text-ink">
        {title}
      </h2>
      {lead && <p className="max-w-lead text-lead text-ink-2">{lead}</p>}
    </div>
  );
}

/** The "Sample" tag every demo carries (spec section 14). */
export function SampleTag({ className = "" }: { className?: string }) {
  return <span className={`inline-block rounded-full bg-tint px-2 py-0.5 font-mono text-tag text-ink-2 ${className}`}>Sample</span>;
}
