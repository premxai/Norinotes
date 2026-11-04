import { ButtonLink } from "@/components/Button";

/** A placeholder page in the Dawn theme, so every link works until its part is designed and built. */
export function ComingNext({ title, part, body = "This page is designed and built next. For now, there's nothing to fill in here." }: { title: string; part: string; body?: string }) {
  return (
    <main id="main" className="grid min-h-svh place-items-center bg-bg">
      <div className="wrap flex max-w-lead flex-col items-center gap-6 py-section text-center">
        <p className="font-mono text-label text-ink-2">{part}</p>
        <h1 className="font-serif text-h2 text-ink">{title}</h1>
        <p className="text-lead text-ink-2">{body}</p>
        <ButtonLink href="/" variant="outline">
          Back to the home page
        </ButtonLink>
      </div>
    </main>
  );
}
