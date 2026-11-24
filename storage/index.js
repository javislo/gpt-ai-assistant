import config from '../config/index.js';
import { isRedisConfigured, loadStorageData, saveStorageItem } from '../services/agent-state.js';
import { createEnvironment, ENV_TYPE_PLAIN, updateEnvironment } from '../services/vercel.js';
import { fetchEnvironment } from '../utils/index.js';

const ENV_KEY = 'APP_STORAGE';

export const BACKEND_MEMORY = 'memory';
export const BACKEND_VERCEL = 'vercel';
export const BACKEND_REDIS = 'redis';

// The async worker (LINE_ASYNC_ENABLED=true) keeps app state in Upstash Redis so it
// survives across Vercel instances. The synchronous webhook keeps the original
// behaviour: a Vercel environment variable when VERCEL_ACCESS_TOKEN is set, or
// process memory otherwise.
const selectBackend = () => {
  if (process.env.LINE_ASYNC_ENABLED === 'true') return BACKEND_REDIS;
  if (config.VERCEL_ACCESS_TOKEN) return BACKEND_VERCEL;
  return BACKEND_MEMORY;
};

class Storage {
  env;

  data = {};

  backend = BACKEND_MEMORY;

  /**
   * @returns {boolean} whether writes survive a new Vercel instance
   */
  // eslint-disable-next-line class-methods-use-this
  get isPersistent() {
    const backend = selectBackend();
    if (backend === BACKEND_REDIS) return isRedisConfigured();
    return backend === BACKEND_VERCEL;
  }

  async initialize() {
    this.backend = selectBackend();
    if (this.backend === BACKEND_REDIS) {
      this.env = undefined;
      this.data = await loadStorageData();
      return;
    }
    if (this.backend === BACKEND_MEMORY) return;
    this.env = await fetchEnvironment(ENV_KEY);
    if (!this.env) {
      const { data } = await createEnvironment({
        key: ENV_KEY,
        value: JSON.stringify(this.data),
        type: ENV_TYPE_PLAIN,
      });
      this.env = data.created;
    }
    this.data = JSON.parse(this.env.value);
  }

  /**
   * @param {string} key
   * @returns {string}
   */
  getItem(key) {
    return this.data[key];
  }

  /**
   * @param {string} key
   * @param {string} value
   */
  async setItem(key, value) {
    const backend = selectBackend();
    if (backend === BACKEND_REDIS) {
      this.data[key] = value;
      await saveStorageItem(key, value);
      return;
    }
    if (backend === BACKEND_MEMORY) {
      this.data[key] = value;
      return;
    }
    if (!this.env || this.backend !== BACKEND_VERCEL) {
      // Not initialized in this invocation: load the stored state first so this
      // write neither crashes on a missing env id nor drops other entries.
      await this.initialize();
    }
    this.data[key] = value;
    await updateEnvironment({
      id: this.env.id,
      value: JSON.stringify(this.data, null, config.VERCEL_ENV ? 0 : 2),
      type: ENV_TYPE_PLAIN,
    });
  }
}

const storage = new Storage();

export default storage;
