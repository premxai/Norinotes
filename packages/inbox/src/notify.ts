/**
 * In-process wake-up for verification waiters. Storing a message calls `notifyInbox(userId)`; a waiter in the same process
 * (the worker runs both `inbox.receive` and `apply.run`) re-checks the database at once instead of at its next poll.
 * Across processes (the API stores, the worker waits) the poll is what finds it, so this is only a latency shortcut.
 */
type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

export function notifyInbox(userId: string): void {
  for (const l of listeners.get(userId) ?? []) l();
}

/** Calls `fn` whenever a message for this user is stored or reprocessed. Returns the unsubscribe function. */
export function onInbox(userId: string, fn: Listener): () => void {
  let set = listeners.get(userId);
  if (!set) listeners.set(userId, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(userId);
  };
}
