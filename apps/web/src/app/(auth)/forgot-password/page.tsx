import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/AccountLinks";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
