export const INBOX_KINDS = ["verification_code", "confirmation", "recruiter_reply", "interview", "rejection", "offer", "other"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

/** Kinds that mean a person at the company answered, and so count as outcomes. */
export const INBOX_OUTCOME_KINDS = ["recruiter_reply", "interview", "rejection", "offer"] as const;
