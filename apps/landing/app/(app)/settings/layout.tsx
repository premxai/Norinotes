import { SettingsFrame } from "@/components/app/settings/SettingsFrame";

/** Settings' sub-pages share the title row and the tab list (dashboard v2 plan, section 8). */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsFrame>{children}</SettingsFrame>;
}
