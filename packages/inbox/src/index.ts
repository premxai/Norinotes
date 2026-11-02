/**
 * @norinote/inbox: owned inbound email. Every user gets a random address on our domain; job systems mail verification
 * codes and confirmations there, employers reply there. `receiveInbound` stores and classifies what the webhook hands
 * over, `createCodeWaiter` gives apply the emailed code.
 */
export { assignInboxAddress } from "./address.js";
export { classifyMessage, extractCode, extractLinks, magicLink } from "./classify.js";
export type { Classification } from "./classify.js";
export { fromAts, pickApplication, senderBase, senderSpeaksFor } from "./link.js";
export type { AppCandidate } from "./link.js";
export { normalizeInbound, parseMime } from "./parse.js";
export type { InboundEmail, InboundPayload } from "./parse.js";
export { INBOX_BODY_MAX, receiveInbound, reprocessMessage, waitingApplications } from "./receive.js";
export type { ReceiveResult, StoredInbound, Wake } from "./receive.js";
export { verifyInboundSecret } from "./secret.js";
export { createCodeWaiter } from "./waiter.js";
export type { CodeWaiterLike, CodeWaiterOptions } from "./waiter.js";
