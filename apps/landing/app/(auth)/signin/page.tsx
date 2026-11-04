import type { Metadata } from "next";
import { ComingNext } from "@/components/ComingNext";

export const metadata: Metadata = { title: "Sign in" };

export default function SignIn() {
  return <ComingNext title="Welcome back" part="Part 2 · Sign-in" />;
}
