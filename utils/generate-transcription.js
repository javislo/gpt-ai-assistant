import config from '../config/index.js';
import { GEMINI_ROLE_USER, generateContent } from '../services/gemini.js';
import { assertApiKey, buildGenerationConfig, toCompletion } from './generate-completion.js';

// LINE delivers voice messages as M4A (AAC). audio/m4a is one of the input
// MIME types listed in the Gemini audio understanding docs.
export const LINE_AUDIO_MIME_TYPE = 'audio/m4a';

export const TRANSCRIPTION_INSTRUCTION = 'Generate a verbatim transcript of this audio in the language that is spoken. '
  + 'Output only the transcript text, with no timestamps, speaker labels, translation or commentary.';

class Transcription {
  text;

  constructor({
    text,
  }) {
    this.text = text;
  }
}

/**
 * Transcribes audio with Gemini's native audio understanding (generateContent
 * with inline audio data). No Whisper or /v1/audio/transcriptions endpoint is used.
 * @param {Object} param
 * @param {Buffer} param.buffer
 * @param {string} [param.mimeType]
 * @returns {Promise<Transcription>}
 */
const generateTranscription = async ({
  buffer,
  mimeType = LINE_AUDIO_MIME_TYPE,
}) => {
  assertApiKey();
  const { data } = await generateContent({
    model: config.GEMINI_AUDIO_MODEL,
    contents: [
      {
        role: GEMINI_ROLE_USER,
        parts: [
          { text: TRANSCRIPTION_INSTRUCTION },
          { inlineData: { mimeType, data: buffer.toString('base64') } },
        ],
      },
    ],
    generationConfig: buildGenerationConfig(),
  });
  const { text } = toCompletion(data);
  return new Transcription({ text });
};

export default generateTranscription;
