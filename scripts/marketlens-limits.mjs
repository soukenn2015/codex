export const LIMITS = {
  X_QUEUE_DEFAULT: 500,
  X_QUEUE_HARD_MAX: 500,
  X_READER_DEFAULT: 3,
  X_READER_HARD_MAX: 20,
  MARKETPLACE_SUBJECT_DEFAULT: 200,
  MARKETPLACE_SUBJECT_HARD_MAX: 500,
  MARKETPLACE_TARGETS_HARD_MAX: 1000,
  MARKETPLACE_DISPLAY_DEFAULT: 15,
  MARKETPLACE_DISPLAY_HARD_MAX: 30,
  SOCIAL_DISPLAY_DEFAULT: 8,
  SOCIAL_DISPLAY_HARD_MAX: 10,
  REALTIME_DISPLAY_DEFAULT: 10,
  REALTIME_DISPLAY_HARD_MAX: 15,
  BROWSER_OBSERVATION_BATCH_DEFAULT: 5,
  BROWSER_OBSERVATION_BATCH_HARD_MAX: 10,
  MARKETPLACE_BROWSER_OBSERVATION_DEFAULT: 3,
  MARKETPLACE_BROWSER_OBSERVATION_HARD_MAX: 5,
};

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

export function resolveXQueueLimit(env = process.env) {
  return clampNumber(Number(env.MARKETLENS_X_QUEUE_LIMIT ?? LIMITS.X_QUEUE_DEFAULT), 50, LIMITS.X_QUEUE_HARD_MAX);
}

export function resolveXReaderLimit(env = process.env) {
  return clampNumber(Number(env.MARKETLENS_X_READER_LIMIT ?? LIMITS.X_READER_DEFAULT), 0, LIMITS.X_READER_HARD_MAX);
}

export function resolveMarketplaceSubjectLimit(env = process.env) {
  return clampNumber(
    Number(env.MARKETLENS_MARKETPLACE_SUBJECT_LIMIT ?? LIMITS.MARKETPLACE_SUBJECT_DEFAULT),
    1,
    LIMITS.MARKETPLACE_SUBJECT_HARD_MAX,
  );
}

export function resolveMarketplaceDisplayLimit(env = process.env) {
  return clampNumber(
    Number(env.MARKETLENS_MARKETPLACE_DISPLAY_LIMIT ?? LIMITS.MARKETPLACE_DISPLAY_DEFAULT),
    10,
    LIMITS.MARKETPLACE_DISPLAY_HARD_MAX,
  );
}

export function resolveSocialDisplayLimit() {
  return LIMITS.SOCIAL_DISPLAY_DEFAULT;
}

export function resolveRealtimeDisplayLimit(env = process.env) {
  return clampNumber(
    Number(env.MARKETLENS_REALTIME_DISPLAY_LIMIT ?? LIMITS.REALTIME_DISPLAY_DEFAULT),
    5,
    LIMITS.REALTIME_DISPLAY_HARD_MAX,
  );
}

export function resolveBrowserObservationBatchLimit(env = process.env) {
  return clampNumber(
    Number(env.MARKETLENS_BROWSER_OBSERVATION_LIMIT ?? LIMITS.BROWSER_OBSERVATION_BATCH_DEFAULT),
    0,
    LIMITS.BROWSER_OBSERVATION_BATCH_HARD_MAX,
  );
}

export function resolveMarketplaceBrowserObservationLimit(env = process.env) {
  const batchLimit = resolveBrowserObservationBatchLimit(env);
  const configured = clampNumber(
    Number(env.MARKETLENS_MARKETPLACE_BROWSER_OBSERVATION_LIMIT ?? LIMITS.MARKETPLACE_BROWSER_OBSERVATION_DEFAULT),
    0,
    LIMITS.MARKETPLACE_BROWSER_OBSERVATION_HARD_MAX,
  );
  return Math.min(configured, batchLimit);
}

export function resolveRealtimeBrowserObservationLimit(env = process.env) {
  const batchLimit = resolveBrowserObservationBatchLimit(env);
  const marketplaceLimit = resolveMarketplaceBrowserObservationLimit(env);
  return Math.max(0, batchLimit - marketplaceLimit);
}

export function resolveObservationLimits(env = process.env) {
  return {
    xQueueLimit: resolveXQueueLimit(env),
    xQueueHardMax: LIMITS.X_QUEUE_HARD_MAX,
    xReaderLimit: resolveXReaderLimit(env),
    xReaderHardMax: LIMITS.X_READER_HARD_MAX,
    marketplaceSubjectLimit: resolveMarketplaceSubjectLimit(env),
    marketplaceSubjectHardMax: LIMITS.MARKETPLACE_SUBJECT_HARD_MAX,
    marketplaceTargetsHardMax: LIMITS.MARKETPLACE_TARGETS_HARD_MAX,
    marketplaceDisplayLimit: resolveMarketplaceDisplayLimit(env),
    marketplaceDisplayHardMax: LIMITS.MARKETPLACE_DISPLAY_HARD_MAX,
    socialDisplayLimit: resolveSocialDisplayLimit(),
    socialDisplayHardMax: LIMITS.SOCIAL_DISPLAY_HARD_MAX,
    realtimeDisplayLimit: resolveRealtimeDisplayLimit(env),
    realtimeDisplayHardMax: LIMITS.REALTIME_DISPLAY_HARD_MAX,
    browserObservationBatchLimit: resolveBrowserObservationBatchLimit(env),
    browserObservationBatchHardMax: LIMITS.BROWSER_OBSERVATION_BATCH_HARD_MAX,
    marketplaceBrowserObservationLimit: resolveMarketplaceBrowserObservationLimit(env),
    marketplaceBrowserObservationHardMax: LIMITS.MARKETPLACE_BROWSER_OBSERVATION_HARD_MAX,
    realtimeBrowserObservationLimit: resolveRealtimeBrowserObservationLimit(env),
  };
}