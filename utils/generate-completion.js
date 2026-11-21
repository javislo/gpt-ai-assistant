import config from '../config/index.js';
import { MOCK_TEXT_OK } from '../constants/mock.js';
import { createChatCompletion, FINISH_REASON_STOP } from '../services/openai.js';

class Completion {
  text;

  finishReason;

  constructor({
    text,
    finishReason,
  }) {
    this.text = text;
    this.finishReason = finishReason;
  }

  get isFinishReasonStop() {
    return this.finishReason === FINISH_REASON_STOP;
  }
}

/**
 * @param {Object} param
 * @param {Array<{ role: string, content: string }>} param.messages
 * @returns {Promise<Completion>}
 */
const generateCompletion = async ({
  messages,
}) => {
  if (config.APP_ENV !== 'production') return new Completion({ text: MOCK_TEXT_OK });
  const { data } = await createChatCompletion({ messages });
  const [choice] = data.choices;
  return new Completion({
    text: (choice.message.content || '').trim(),
    finishReason: choice.finish_reason,
  });
};

export default generateCompletion;
