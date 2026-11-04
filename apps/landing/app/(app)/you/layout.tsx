import { YouFrame } from "@/components/app/you/YouTabs";

/** You's four sub-pages share the title row and the sub-tab row (4c spec section 2). */
export default function YouLayout({ children }: { children: React.ReactNode }) {
  return <YouFrame>{children}</YouFrame>;
}
