import {
  hasWeatherApi, buildForecastMessage, getCountyForecast, resolveCounty,
} from '../weather/forecast.js';
import { getWeatherProfile, isWeatherStorePersistent, setWeatherProfile } from '../weather/store.js';
import Context from '../context.js';

export const COMMAND_WEATHER_SUBSCRIBE = '開啟天氣推播';
export const COMMAND_WEATHER_UNSUBSCRIBE = '取消天氣推播';

const plain = (text) => String(text || '').replace(/[。.!！?？\s]/g, '');

const toggle = (context) => {
  if (!context.event.isText) return null;
  const text = plain(context.event.text);
  if (text === COMMAND_WEATHER_SUBSCRIBE) return true;
  if (text === COMMAND_WEATHER_UNSUBSCRIBE) return false;
  return null;
};

/**
 * @param {Context} context
 * @returns {boolean}
 */
const check = (context) => context.event.isLocation || toggle(context) !== null;

const persistenceNote = () => (isWeatherStorePersistent()
  ? ''
  : '\n（目前沒有設定 Upstash Redis 或 VERCEL_ACCESS_TOKEN，位置只暫存在這次的伺服器記憶體，重新部署後可能需要再傳一次。）');

const saveLocation = async (context) => {
  const {
    title, address, latitude, longitude,
  } = context.event.message;
  const county = resolveCounty({ address, latitude, longitude });
  if (!county) {
    context.pushText('這個位置不在臺灣，中央氣象署的預報沒有涵蓋，所以沒有幫你記住。');
    return;
  }
  await setWeatherProfile(context.userId, {
    county,
    address: address || title || '',
    latitude,
    longitude,
    subscribed: true,
    updatedAt: new Date().toISOString(),
  });
  const lines = [`📍 已記住你的位置：${county}${address ? `（${address}）` : ''}`];
  if (!hasWeatherApi()) {
    lines.push('天氣資料尚未啟用（需要在 Vercel 設定 CWA_API_KEY）。');
  } else {
    try {
      lines.push('', buildForecastMessage(await getCountyForecast(county)));
    } catch (err) {
      console.error('Weather forecast failed:', err.message);
      lines.push('暫時查不到天氣資料，稍後再問我一次。');
    }
  }
  lines.push('', `每天早上會推播當天天氣；傳「${COMMAND_WEATHER_UNSUBSCRIBE}」可以關閉。`);
  context.pushText(lines.join('\n') + persistenceNote());
};

const setSubscription = async (context, subscribed) => {
  const profile = await getWeatherProfile(context.userId);
  if (!profile) {
    context.pushText('還沒有你的位置。請在聊天室按「＋」→「位置資訊」傳送位置，就會開始每天早上推播天氣。');
    return;
  }
  await setWeatherProfile(context.userId, { ...profile, subscribed, updatedAt: new Date().toISOString() });
  context.pushText(subscribed
    ? `已開啟每天早上的天氣推播（${profile.county}）。`
    : `已關閉天氣推播。想恢復時傳「${COMMAND_WEATHER_SUBSCRIBE}」。`);
};

/**
 * @param {Context} context
 * @returns {Promise<Context>}
 */
const exec = (context) => check(context) && (
  async () => {
    try {
      if (context.event.isLocation) await saveLocation(context);
      else await setSubscription(context, toggle(context));
    } catch (err) {
      context.pushError(err);
    }
    return context;
  }
)();

export default exec;
