import type { Metadata } from "next";
import { Account } from "@/components/app/you/Account";

export const metadata: Metadata = { title: "Account · You", robots: { index: false, follow: false } };

export default function Page() {
  return <Account />;
}
