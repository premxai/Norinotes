import { notFound } from "next/navigation";

/** An address under a dashboard section that isn't a page: the in-shell 404 (error pages spec section 2). proxy.ts sets its status. */
export default function Missing(): never {
  notFound();
}
