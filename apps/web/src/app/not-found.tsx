import type { Metadata } from "next";
import { NotFoundCard } from "@/components/NotFoundCard";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center px-5 py-16">
      <NotFoundCard />
    </main>
  );
}
