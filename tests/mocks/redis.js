import {
  ACQUIRE, COMPLETE, QUOTA, RELEASE,
} from '../../services/agent-state.js';

/**
 * In-memory stand-in for the Upstash Redis REST API. It implements the commands
 * the app sends, and the app's Lua scripts are emulated with the same semantics
 * (they run atomically in Redis, and synchronously here).
 */
const createFakeRedis = () => {
  const store = new Map();
  const hashes = new Map();

  const get = (k) => (store.has(k) ? store.get(k) : null);

  const evalScript = (script, keys, argv) => {
    if (script === ACQUIRE) {
      if (store.has(keys[0])) return 'done';
      if (store.has(keys[1]) || store.has(keys[2])) return 'busy';
      store.set(keys[1], argv[0]);
      store.set(keys[2], argv[0]);
      return 'acquired';
    }
    if (script === RELEASE) {
      if (get(keys[0]) === argv[0]) store.delete(keys[0]);
      if (get(keys[1]) === argv[0]) store.delete(keys[1]);
      return 1;
    }
    if (script === COMPLETE) {
      if (get(keys[1]) !== argv[0]) return 0;
      store.set(keys[0], '1');
      store.delete(keys[1]);
      if (get(keys[2]) === argv[0]) store.delete(keys[2]);
      return 1;
    }
    if (script === QUOTA) {
      const day = Number(get(keys[0]) || 0);
      const minute = Number(get(keys[1]) || 0);
      if (day >= Number(argv[0])) return -1;
      if (minute >= Number(argv[1])) return -2;
      store.set(keys[0], String(day + 1));
      store.set(keys[1], String(minute + 1));
      return day + 1;
    }
    throw new Error('Unknown script');
  };

  const execute = ([command, ...args]) => {
    switch (String(command).toUpperCase()) {
      case 'GET': return get(args[0]);
      case 'SET': store.set(args[0], String(args[1])); return 'OK';
      case 'DEL': return args.filter((k) => store.delete(k)).length;
      case 'HSET': {
        const [k, ...pairs] = args;
        const hash = hashes.get(k) || new Map();
        for (let i = 0; i < pairs.length; i += 2) hash.set(String(pairs[i]), String(pairs[i + 1]));
        hashes.set(k, hash);
        return pairs.length / 2;
      }
      case 'HGETALL': return Array.from((hashes.get(args[0]) || new Map()).entries()).flat();
      case 'EVAL': {
        const [script, count, ...rest] = args;
        const n = Number(count);
        return evalScript(script, rest.slice(0, n), rest.slice(n).map(String));
      }
      default: throw new Error(`Unsupported command ${command}`);
    }
  };

  return {
    store,
    hashes,
    down: false,
    commands: [],
    /** Handles one Upstash REST request body (a JSON command array). */
    handle(body) {
      const command = JSON.parse(body);
      this.commands.push(command);
      return { result: execute(command) };
    },
    keysMatching(prefix) {
      return Array.from(store.keys()).filter((k) => k.startsWith(prefix));
    },
  };
};

export default createFakeRedis;
