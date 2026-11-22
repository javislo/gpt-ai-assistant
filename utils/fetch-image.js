import { fetchContent } from '../services/line.js';

const DEFAULT_IMAGE_MIME_TYPE = 'image/jpeg';

/**
 * @param {string} messageId
 * @returns {Promise<string>} the image as a base64 data URL
 */
const fetchImage = async (messageId) => {
  const { data, headers } = await fetchContent({ messageId });
  const mimeType = String(headers?.['content-type'] || DEFAULT_IMAGE_MIME_TYPE).split(';')[0].trim();
  return `data:${mimeType};base64,${Buffer.from(data, 'binary').toString('base64')}`;
};

export default fetchImage;
