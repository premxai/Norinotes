import { timeAgo } from "@/lib/format";

export function TimeAgo({ iso, className }: { iso: string | null | undefined; className?: string }) {
  return (
    <time dateTime={iso ?? undefined} title={iso ? new Date(iso).toLocaleString() : undefined} className={className} suppressHydrationWarning>
      {timeAgo(iso)}
    </time>
  );
}
