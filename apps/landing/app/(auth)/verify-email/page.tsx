import type { Metadata } from "next";
import { VerifyEmail } from "@/components/auth/VerifyEmail";

// Reached only from an email link, so it stays out of search results.
export const metadata: Metadata = { title: "Confirm your email", robots: { index: false, follow: false } };

export default function VerifyEmailPage() {
  return <VerifyEmail />;
}
