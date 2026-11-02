import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/AccountLinks";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return <ResetPasswordForm token={Array.isArray(token) ? token[0] : token} />;
}
