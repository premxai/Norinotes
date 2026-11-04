import { AppShell } from "@/components/app/AppShell";

/** The dashboard's pages share one shell: the rail or tabs, the theme, Nori's seat and the live panel (4a spec). */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
