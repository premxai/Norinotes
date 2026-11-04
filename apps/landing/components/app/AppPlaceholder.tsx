import Link from "next/link";
import { buttonClass } from "@/components/Button";

/** A dashboard section that's planned but not built yet (parts 4b and 4c), inside the shell. */
export function AppPlaceholder({ title, part, body }: { title: string; part: string; body: string }) {
  return (
    <main id="main" className="mx-auto flex max-w-[960px] flex-col items-start gap-4 px-4 pt-[18px] pb-24 tablet:px-8 tablet:pt-7 laptop:px-10">
      <p className="font-mono text-label text-ink-2">{part}</p>
      <h1 className="font-serif text-[2rem] leading-[1.05] text-ink laptop:text-[2.5rem]">{title}</h1>
      <p className="max-w-lead text-ink-2">{body}</p>
      <Link href="/today" className={buttonClass("outline", "min-h-11")}>
        Back to Today
      </Link>
    </main>
  );
}
