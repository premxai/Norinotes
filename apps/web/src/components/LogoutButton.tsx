"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { api } from "@/lib/api";
import { cx } from "./cx";
import { Icon } from "./Icon";

export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try { await api.logout(); } catch { /* the session is dropped client-side either way */ }
    router.replace("/login");
    router.refresh();
  }
  return (
    <button type="button" onClick={logout} disabled={busy} className={cx("inline-flex min-h-6 items-center gap-2 py-1 text-[12px] font-medium text-ink-2 transition-colors duration-150 hover:text-ink disabled:opacity-50", className)}>
      <Icon icon={LogOut} />
      {busy ? "Signing out..." : "Log out"}
    </button>
  );
}
