import type { Metadata } from "next";
import { ResetForm } from "@/components/auth/ResetForm";

// Reached only from an email link, so it stays out of search results.
export const metadata: Metadata = { title: "Choose a new password", robots: { index: false, follow: false } };

export default function ResetPassword() {
  return <ResetForm />;
}
