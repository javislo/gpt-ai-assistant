import { fetchCountyForecast, getCwaApiKey } from '../../services/cwa.js';

// Taiwan's 22 counties/cities as named by the CWA, with an approximate seat
// location used when a shared LINE location has no recognisable address.
export const COUNTIES = [
  ['基隆市', 25.128, 121.741], ['臺北市', 25.038, 121.564], ['新北市', 25.012, 121.465],
  ['桃園市', 24.994, 121.301], ['新竹市', 24.804, 120.971], ['新竹縣', 24.839, 121.018],
  ['苗栗縣', 24.560, 120.821], ['臺中市', 24.148, 120.674], ['彰化縣', 24.075, 120.544],
  ['南投縣', 23.910, 120.684], ['雲林縣', 23.709, 120.431], ['嘉義市', 23.480, 120.449],
  ['嘉義縣', 23.459, 120.293], ['臺南市', 22.999, 120.227], ['高雄市', 22.627, 120.301],
  ['屏東縣', 22.669, 120.488], ['宜蘭縣', 24.757, 121.753], ['花蓮縣', 23.987, 121.601],
  ['臺東縣', 22.756, 121.144], ['澎湖縣', 23.571, 119.579], ['金門縣', 24.449, 118.377],
  ['連江縣', 26.160, 119.951],
].map(([name, lat, lon]) => ({ name, lat, lon }));

const normalize = (text) => String(text || '').replaceAll('台', '臺');

// Short names people use in questions ("高雄明天會下雨嗎"). Ambiguous short names
// (新竹, 嘉義) mean the city.
const ALIASES = [
  ...COUNTIES.map(({ name }) => [name, name]),
  ...COUNTIES
    .filter(({ name }) => !['新竹縣', '嘉義縣'].includes(name))
    .map(({ name }) => [name.slice(0, -1), name]),
  ['馬祖', '連江縣'],
].sort((a, b) => b[0].length - a[0].length);

/**
 * @param {string} text
 * @returns {string|null} county named in the text
 */
export const findCountyInText = (text) => {
  const value = normalize(text);
  const match = ALIASES.find(([alias]) => value.includes(alias));
  return match ? match[1] : null;
};

const distance = (a, b) => ((a.lat - b.lat) ** 2) + (((a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180)) ** 2);

/**
 * Resolves the county for a shared LINE location: the address first, otherwise
 * the nearest county seat (only for points in or near Taiwan).
 */
export const resolveCounty = ({ address, latitude, longitude }) => {
  const fromAddress = COUNTIES.find(({ name }) => normalize(address).includes(name));
  if (fromAddress) return fromAddress.name;
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < 21.5 || lat > 26.5 || lon < 118 || lon > 122.5) return null;
  const [nearest] = [...COUNTIES].sort((a, b) => distance(a, { lat, lon }) - distance(b, { lat, lon }));
  return nearest.name;
};

const WEATHER_KEYWORDS = [
  '天氣', '氣溫', '溫度', '下雨', '降雨', '雨傘', '帶傘', '颱風', '冷不冷', '熱不熱', '幾度',
  '穿什麼', '要穿', 'weather', 'rain', 'forecast',
];

export const isWeatherQuestion = (text) => {
  const value = String(text || '').toLowerCase();
  return WEATHER_KEYWORDS.some((keyword) => value.includes(keyword));
};

/**
 * Parses an F-C0032-001 response into periods.
 * @returns {{county: string, periods: Array<Object>}}
 */
export const parseCountyForecast = (data) => {
  const location = data?.records?.location?.[0];
  if (!location || !Array.isArray(location.weatherElement)) {
    throw new Error('中央氣象署預報資料格式不符');
  }
  const series = Object.fromEntries(location.weatherElement.map(({ elementName, time }) => [elementName, time || []]));
  const value = (name, index) => series[name]?.[index]?.parameter?.parameterName ?? null;
  const periods = (series.Wx || []).map((time, index) => ({
    start: time.startTime,
    end: time.endTime,
    wx: value('Wx', index),
    pop: value('PoP', index),
    minT: value('MinT', index),
    maxT: value('MaxT', index),
    ci: value('CI', index),
  }));
  if (periods.length === 0) throw new Error('中央氣象署預報資料格式不符');
  return { county: location.locationName, periods };
};

// "2026-11-24 06:00:00" -> { date: "11/24", time: "06:00" }
const splitTime = (value) => {
  const [, month, day, time] = /^\d{4}-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/.exec(String(value)) || [];
  return month ? { date: `${Number(month)}/${Number(day)}`, time } : { date: '', time: String(value) };
};

export const formatPeriodRange = ({ start, end }) => {
  const a = splitTime(start);
  const b = splitTime(end);
  return a.date === b.date ? `${a.date} ${a.time}–${b.time}` : `${a.date} ${a.time}–${b.date} ${b.time}`;
};

export const formatPeriod = (period) => {
  const parts = [period.wx];
  if (period.pop !== null) parts.push(`降雨機率 ${period.pop}%`);
  if (period.minT !== null && period.maxT !== null) parts.push(`${period.minT}–${period.maxT}°C`);
  if (period.ci) parts.push(period.ci);
  return `${formatPeriodRange(period)}：${parts.filter(Boolean).join('，')}`;
};

export const hasWeatherApi = () => Boolean(getCwaApiKey());

/**
 * @param {string} county
 * @returns {Promise<{county: string, periods: Array<Object>}>}
 */
export const getCountyForecast = async (county) => {
  const { data } = await fetchCountyForecast(county);
  return parseCountyForecast(data);
};

/** Text placed in the Gemini system instruction for a weather question. */
export const buildWeatherContext = (forecast) => [
  `以下是中央氣象署「${forecast.county}」今明 36 小時天氣預報：`,
  ...forecast.periods.map((period) => `- ${formatPeriod(period)}`),
  '回答天氣相關問題時，以上述資料為準，簡短回答；資料沒有涵蓋的時間或地點要明確說明，不要自行編造。',
].join('\n');

const needsUmbrella = (periods) => periods.some(({ pop }) => Number(pop) >= 50);

/** Message for the morning push and for the reply to a shared location. */
export const buildForecastMessage = (forecast, { greeting = '' } = {}) => {
  const periods = forecast.periods.slice(0, 2);
  return [
    `${greeting}${forecast.county}天氣（中央氣象署）`,
    ...periods.map(formatPeriod),
    needsUmbrella(periods) ? '☂️ 降雨機率偏高，記得帶傘。' : '',
  ].filter(Boolean).join('\n');
};
