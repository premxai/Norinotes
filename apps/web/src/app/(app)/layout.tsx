import { redirect } from "next/navigation";
import { api, ApiError, USE_MOCK } from "@/lib/api";
import { NEEDS_YOU } from "@/lib/format";
import { Shell, type ShellData } from "@/components/Shell";

async function shellData(): Promise<ShellData> {
  const data: ShellData = { needsYouCount: 0, unreadCount: 0, userName: "you", mock: USE_MOCK, liveSubmit: true };
  const [apps, inbox, me, status] = await Promise.allSettled([api.listApplications(), api.listInbox(), api.me(), api.agentStatus()]);
  if (apps.status === "fulfilled") data.needsYouCount = apps.value.filter((a) => NEEDS_YOU.includes(a.application.status)).length;
  if (inbox.status === "fulfilled") data.unreadCount = inbox.value.filter((m) => m.read === false).length;
  if (me.status === "fulfilled") data.userName = me.value.profile?.fullName ?? me.value.user.name ?? me.value.user.email;
  // Demo mode never sends; an older API without the field is treated as live (no band) rather than guessed.
  if (status.status === "fulfilled") data.liveSubmit = status.value.liveSubmit !== false && !USE_MOCK;
  else if (USE_MOCK) data.liveSubmit = false;
  return data;
}

/** Signed-in app chrome. Sends a stale session to /login and an unfinished onboarding to /onboarding. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ob = await api.onboarding().catch((e: unknown) => e);
  if (ob instanceof ApiError && ob.status === 401) redirect("/session-expired");
  // Any other failure (API down, older API without the route) falls through to the pages, which show their own errors.
  if (!(ob instanceof Error) && ob && typeof ob === "object" && "step" in ob && ob.step !== "done") redirect("/onboarding");
  const data = await shellData();
  return <Shell data={data}>{children}</Shell>;
}
