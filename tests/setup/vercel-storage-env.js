// Imported first: legacy synchronous mode with Vercel env storage. Dummy values only.
export const ORIGINAL_ENV = { ...process.env };
delete process.env.LINE_ASYNC_ENABLED;
process.env.VERCEL_ACCESS_TOKEN = 'dummy-vercel-token';
process.env.VERCEL_PROJECT_NAME = 'test-project';

export const restoreEnv = () => {
  Object.keys(process.env).forEach((key) => {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  });
  Object.assign(process.env, ORIGINAL_ENV);
};
