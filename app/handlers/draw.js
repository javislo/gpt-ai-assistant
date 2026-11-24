import { t } from '../../locales/index.js';
import { COMMAND_BOT_DRAW } from '../commands/index.js';
import Context from '../context.js';

/**
 * @param {Context} context
 * @returns {boolean}
 */
const check = (context) => context.hasCommand(COMMAND_BOT_DRAW);

/**
 * Image generation is disabled: the Gemini API free tier does not include an
 * image generation model, and this app must never fall back to a paid service.
 * @param {Context} context
 * @returns {Promise<Context>}
 */
const exec = (context) => check(context) && (
  async () => {
    context.pushText(t('__ERROR_IMAGE_GENERATION_DISABLED'));
    return context;
  }
)();

export default exec;
