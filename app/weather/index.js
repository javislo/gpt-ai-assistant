import { push } from '../../services/line.js';
import { retryKeyForEvent } from '../../utils/reply-message.js';
import config from '../../config/index.js';
import {
  buildForecastMessage, buildWeatherContext, findCountyInText, getCountyForecast, hasWeatherApi,
  isWeatherQuestion,
} from './forecast.js';
import { getWeatherProfile, getWeatherProfiles } from './store.js';

export const NO_LOCATION_CONTEXT = '使用者問了天氣，但還沒有提供位置，也沒有提到縣市。請簡短請使用者在 LINE 聊天室按「＋」→「位置資訊」傳送位置，或在問題中說明縣市。';

export const NO_WEATHER_DATA_CONTEXT = '目前沒有可用的即時天氣資料。不要編造天氣、溫度或降雨機率；請簡短說明現在查不到天氣，並建議使用者查看中央氣象署網站或 App。';

/**
 * Builds the extra system text for a weather question, or '' when the message
 * is not about weather. Never throws: without forecast data (no CWA key, or the
 * request failed) it tells Gemini not to invent one.
 */
export const getWeatherContextFor = async (userId, text) => {
  if (!isWeatherQuestion(text)) return '';
  // Without forecast data, keep Gemini from inventing a forecast.
  if (!hasWeatherApi()) return NO_WEATHER_DATA_CONTEXT;
  try {
    const county = findCountyInText(text) || (await getWeatherProfile(userId))?.county;
    if (!county) return NO_LOCATION_CONTEXT;
    return buildWeatherContext(await getCountyForecast(county));
  } catch (err) {
    console.error('Weather context failed:', err.message);
    return NO_WEATHER_DATA_CONTEXT;
  }
};

const taipeiDate = () => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

// Protects the LINE monthly push quota if many users subscribe.
export const MAX_DAILY_PUSHES = 20;

/**
 * Sends the morning forecast to every subscribed user (one push each). The LINE
 * retry key is fixed per user per Taipei date, so a second run on the same day
 * does not deliver a duplicate.
 */
export const sendDailyWeather = async () => {
  if (!hasWeatherApi()) {
    return {
      sent: 0, failed: 0, skipped: 0, reason: 'CWA_API_KEY is not set',
    };
  }
  const profiles = await getWeatherProfiles({ reload: true });
  const subscribers = Object.entries(profiles)
    .filter(([, profile]) => profile?.subscribed && profile.county)
    .slice(0, MAX_DAILY_PUSHES);
  const date = taipeiDate();
  const forecasts = new Map();
  const result = { sent: 0, failed: 0, skipped: Object.keys(profiles).length - subscribers.length };
  // One user at a time keeps CWA and LINE request rates low.
  await subscribers.reduce((previous, [userId, { county }]) => previous.then(async () => {
    try {
      if (!forecasts.has(county)) forecasts.set(county, await getCountyForecast(county));
      const text = buildForecastMessage(forecasts.get(county), { greeting: '☀️ 早安！' });
      if (config.APP_ENV === 'production') {
        await push({
          to: userId,
          messages: [{ type: 'text', text }],
          retryKey: retryKeyForEvent(`weather:${userId}:${date}`),
        });
      }
      result.sent += 1;
    } catch (err) {
      console.error('Daily weather push failed:', err.message);
      result.failed += 1;
    }
  }), Promise.resolve());
  return result;
};
