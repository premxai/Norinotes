import type { Metadata } from "next";
import { ComingNext } from "@/components/ComingNext";

export const metadata: Metadata = { title: "Terms" };

export default function Terms() {
  return <ComingNext title="Terms" part="Legal" body="The terms of use are being written. They'll be published here." />;
}
