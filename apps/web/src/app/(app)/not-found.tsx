import type { Metadata } from "next";
import { NotFoundCard } from "@/components/NotFoundCard";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return <NotFoundCard />;
}
