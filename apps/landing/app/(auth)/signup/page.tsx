import type { Metadata } from "next";
import { ComingNext } from "@/components/ComingNext";

export const metadata: Metadata = { title: "Create your account" };

export default function SignUp() {
  return <ComingNext title="Create your account" part="Part 2 · Sign-up" />;
}
