import type { Metadata } from "next";
import { ForgotForm } from "@/components/auth/ForgotForm";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPassword() {
  return <ForgotForm />;
}
