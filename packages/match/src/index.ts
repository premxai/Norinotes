export { HEURISTIC_SPEC_VERSION, SPEC_VERSION, UNDERSTAND_SYSTEM, JobSpecModelOutput, finalizeSpec, jobEmbeddingText, loadCurrentSpec, understandJob } from "./understand.js";
export type { StoredJobSpec, UnderstandResult } from "./understand.js";
export { UNSPECCED_BACKLOG_LIMIT, jobsFittingLanes, unspeccedJobsForUser } from "./demand.js";
export { heuristicSpec, roleFamilyFromTitle, seniorityFromTitle, yearsFromText } from "./heuristic-spec.js";
export type { HeuristicJob } from "./heuristic-spec.js";
export { HARD_YEARS_GAP, SENIOR_MIN_YEARS, checkGates, jobPlace, requiredYears } from "./gates.js";
export type { GateOptions, GateResult } from "./gates.js";
export { buildShortlist, byRank, clearRequirementVectorCache, matchNewJobs, openAndFreshSql, rankScore, saveShortlistRows } from "./shortlist.js";
export type {
  BuildShortlistOptions, EmbedFn, ExplainOptions, MatchNewJobsOptions, MatchNewJobsResult, MatchOptions, MatchStats, ShortlistCandidate, ShortlistRow,
} from "./shortlist.js";
export { DEFAULT_MIN_FIT, RESUME_POINT_ID, buildRequirements, coverageOf, qualityOf, relevantYears, scoreFit, scoreRequirement, similarityToRelevance } from "./fit.js";
export type { FitComponents, FitEvidence, FitMapItem, FitResult, QualityLevel, Requirement, ScoreFitArgs, SpecQuality } from "./fit.js";
export {
  familyRelation, familyYears, jobLevelBand, levelFromYears, matchTargetOf, recentRoleTitles, seniorityFit, statedYearsMin, titleAlignment, titlePairScore, widenedTooFar,
} from "./alignment.js";
export type { MatchTarget, SeniorityFit } from "./alignment.js";
export { countryOf, parseLocation, placeAllowed, placeFactor, placeLabel } from "./location.js";
export type { ParsedLocation, RemoteMode } from "./location.js";
export { laneFitsJob, laneFitsSql, locationFits, matchingLanes, significantTitleWords, titleMatches } from "./lanes.js";
export type { JobLike, LaneLike } from "./lanes.js";
export {
  allowedCountries, experienceYearsOf, homeCountryOf, loadMatchProfile, meanProfileEmbedding, meanVector, normalizeCountry, parseWorkAuth, pointInterval, unionYears,
} from "./profile.js";
export type { CountryAuth, EvidencePoint, MatchProfile, WorkAuth } from "./profile.js";
export { detectRestrictions, needsUsCitizenshipOrClearance } from "./clearance.js";
export type { ClearanceJob, Restrictions } from "./clearance.js";
export { NO_SPONSOR, detectSponsorship } from "./sponsorship.js";
export {
  DEFAULT_SKILL_MAP, buildSkillMap, canonicalSkill, canonicalSkills, findSkillsInText, parseSkillTable, skillDisplayName, skillRelation,
} from "./skills.js";
export type { SkillEntry, SkillMap } from "./skills.js";
export { LEXICAL_SIM_FLOOR, LEXICAL_SIM_SPAN, lexicalOverlap, lexicalProfile, lexicalSimilarity, userSkillSet } from "./lexical.js";
export type { LexicalProfile } from "./lexical.js";
export {
  POOL_DEFAULT_LIMIT, POOL_TTL_MS, ROLE_FAMILIES, SOFTWARE_SUBFAMILIES, adjacentTitles, clearRolePoolCache, mainFamilyOf, roleFamilyOf, rolePool,
} from "./roles.js";
export type { DataSpecialty, DesignSpecialty, PoolJob, RoleClass, RoleFamily, RoleSeniority, RolePoolOptions, SoftwareSubfamily } from "./roles.js";
export {
  WIDENED_BY, WIDENED_REASON_PREFIX, WIDEN_MIN_FIT, WIDEN_TARGET, deriveTemporaryLane, loadRemoteExcluded, loadTemporaryLane, widenedByOf, widenedReason,
  wideningPlan, withoutWidenedReasons,
} from "./widen.js";
export type { SimpleLane, TemporaryLane, WidenedBy, WideningStep } from "./widen.js";
export { inlineLanesFitSql } from "./lanes.js";
export { engineJobSql, hostedFormSql, isHostedForm, readEngineAts } from "./engine.js";
export {
  FIT_BANDS, NO_RESPONSE_DAYS, OUTCOME_KINDS, OUTCOME_REASON_PREFIX, SMALL_SAMPLE, addManualOutcome, boardSizeOf, fitBandOf, listOutcomes, loadOutcomeHistory,
  outcomeNudgeOf, removeOutcome, removeOutcomesOfKind, resolveApplication, stampTailoringVersions, statsOf, summarizeOutcomes, syncInboxOutcomes,
} from "./outcomes.js";
export type { BoardSize, FitBand, OutcomeHistoryRow, OutcomeKind, OutcomeRow, OutcomeState, OutcomeStats, OutcomeSummary, Resolution, SyncResult } from "./outcomes.js";
export {
  OUTCOME_DIMENSIONS, OUTCOME_LEARNING, applyOutcomeLearning, jobFeatures, learnFromOutcomes, loadOutcomeLearning, outcomeNudge, refreshOutcomeLearning,
} from "./outcome-learning.js";
export type { JobFeatures, OutcomeDimension, OutcomeLearning, OutcomeNudge } from "./outcome-learning.js";
