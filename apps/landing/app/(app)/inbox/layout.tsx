import { Inbox } from "@/components/app/Inbox";

/** The Inbox is the layout of /inbox and /inbox/:id, so the list stays put while messages open (4b spec section 5). */
export default function InboxLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Inbox />
      {children}
    </>
  );
}
