import { NorinoteMark } from "@/components/Logo";
import { Frame, LinkButton } from "@/components/ui";

/** Shown when a page, application or job does not exist (or is not yours). One way back. */
export function NotFoundCard({ what = "page" }: { what?: string }) {
  return (
    <Frame className="mx-auto flex w-full max-w-xl flex-col items-start gap-3 p-6 sm:p-8">
      <NorinoteMark size={44} />
      <p className="text-meta text-muted">Not found</p>
      <h1 className="text-display-md font-semibold text-ink">That {what} does not exist</h1>
      <p className="text-body-sm text-ink-2">The link may be old, or the item was removed. Nothing is wrong with your account.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <LinkButton href="/dashboard" variant="primary">Back to Today</LinkButton>
        <LinkButton href="/applications" variant="secondary">Your applications</LinkButton>
      </div>
    </Frame>
  );
}
