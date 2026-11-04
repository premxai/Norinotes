import type { Metadata } from "next";
import { ComingNext } from "@/components/ComingNext";

export const metadata: Metadata = { title: "Privacy" };

export default function Privacy() {
  return <ComingNext title="Privacy" part="Legal" body="The privacy policy is being written. Until it's published, nothing is collected on this site." />;
}
