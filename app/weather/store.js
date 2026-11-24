import { isRedisConfigured, loadWeatherProfiles, saveWeatherProfile } from '../../services/agent-state.js';
import storage from '../../storage/index.js';

const STORAGE_KEY = 'weather';

// Profiles live in Upstash Redis when it is configured; otherwise in the app's
// storage (a Vercel env variable with VERCEL_ACCESS_TOKEN, else process memory,
// which a new Vercel instance does not keep).
export const isWeatherStorePersistent = () => isRedisConfigured() || storage.isPersistent;

/**
 * @returns {Promise<Object.<string, Object>>} profiles keyed by LINE userId
 */
export const getWeatherProfiles = async ({ reload = false } = {}) => {
  if (isRedisConfigured()) return loadWeatherProfiles();
  if (reload) await storage.initialize();
  return { ...(storage.getItem(STORAGE_KEY) || {}) };
};

export const getWeatherProfile = async (userId) => (await getWeatherProfiles())[userId] || null;

export const setWeatherProfile = async (userId, profile) => {
  if (isRedisConfigured()) {
    await saveWeatherProfile(userId, profile);
    return;
  }
  const profiles = { ...(storage.getItem(STORAGE_KEY) || {}), [userId]: profile };
  await storage.setItem(STORAGE_KEY, profiles);
};
