import { AuthFrame } from "@/components/auth/AuthFrame";

/** Sign-in, sign-up and the password and email-link pages share one shell (auth-design-spec.md section 2). */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthFrame>{children}</AuthFrame>;
}
