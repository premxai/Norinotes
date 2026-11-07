/**
 * @norinote/inbox: owned inbound email. Every user gets a random address on our domain (`INBOUND_EMAIL_DOMAIN`); job
 * systems mail verification codes and confirmations there, employers reply there. The webhook hands each message to
 * `storeInbound` (fast, rules only); the `inbox.receive` job (`handleInboxReceive`) settles ambiguous ones with the small
 * model, relinks and forwards; `awaitVerification` gives auto-apply the emailed code or link. See docs/inbox.md.
 */
export {
  assignInboxAddress, DEFAULT_RETENTION_DAYS, getInboxAddress, getInboxSettings, readInboxSettings, updateInboxSettings,
} from "./address.js";
export type { InboxSettings } from "./address.js";
export { classifyMessage, extractCode, extractLinks, findCodes, magicLink } from "./classify.js";
export type { Classification, CodeCandidate, CodeResult } from "./classify.js";
export { createResendForwarder, createStubForwarder, forwardMessage } from "./forward.js";
export type { ForwardEnvelope, Forwarder, ForwardResult } from "./forward.js";
export { atsOfSender, fromAts, linkApplication, loadCandidates, pickApplication, senderBase, senderSpeaksFor } from "./link.js";
export type { AppCandidate, LinkResult } from "./link.js";
export { settleAmbiguous, smallModel } from "./model.js";
export type { InboxModel } from "./model.js";
export { notifyInbox, onInbox } from "./notify.js";
export {
  fromGeneric, fromPostmark, INBOUND_MAX_BYTES, INBOUND_PROVIDERS, InboundTooLargeError, normalizeInbound, parseMime, spamVerdict,
} from "./parse.js";
export type { AttachmentMeta, InboundEmail, InboundPayload, InboundProvider, SpamVerdict } from "./parse.js";
export { handleInboxReceive } from "./process.js";
export type { InboxJobResult } from "./process.js";
export { INBOX_BODY_MAX, INBOX_SUBJECT_MAX, receiveInbound, reprocessMessage, storeInbound, waitingApplications } from "./receive.js";
export type { InboxMeta, ReceiveResult, ReprocessOptions, StoredInbound, Wake } from "./receive.js";
export { purgeExpiredInbox, retentionDaysFromEnv, startInboxRetention } from "./retention.js";
export { verifyInboundSecret } from "./secret.js";
export {
  ENVELOPE_TO_HEADER, SIGNATURE_HEADER, SIGNATURE_TOLERANCE_SECONDS, signWebhook, TIMESTAMP_HEADER, verifyProviderRequest, verifyWebhookSignature,
} from "./signature.js";
export type { VerifyResult } from "./signature.js";
export { htmlToText, isTrackingPixel, sanitizeHtml, stripTrackingParams } from "./text.js";
export { awaitVerification, createCodeWaiter, findVerification } from "./waiter.js";
export type { AwaitVerificationArgs, CodeWaiterLike, CodeSource, CodeWaiterOptions, VerificationResult } from "./waiter.js";
export {
  awaitVerificationWithGmail, ComposioError, codeQuery, createComposioGmail, getGmailConnection, readGmailMessages, saveGmailConnection, watchGmailForCodes,
  type ComposioGmail, type GmailConnection, type GmailConnectionStatus, type GmailMessage, type WatchGmailArgs,
} from "./gmail.js";
