import type { Metadata } from "next";
import { VerifyEmailStatus } from "@/components/auth/AccountLinks";

export const metadata: Metadata = { title: "Confirm your email" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return <VerifyEmailStatus token={Array.isArray(token) ? token[0] : token} />;
}
