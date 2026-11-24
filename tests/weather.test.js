// Must be the first import: production-like Gemini env before config loads.
// eslint-disable-next-line import/order
import { GEMINI_BASE_URL, restoreEnv } from './setup/gemini-env.js';
import {
  afterAll, afterEach, beforeAll, beforeEach, expect, jest, test,
} from '@jest/globals';
import axios from 'axios';
import webhook from '../api/index.js';
import { handleEvents, removePrompt } from '../app/index.js';
import { COMMAND_WEATHER_SUBSCRIBE, COMMAND_WEATHER_UNSUBSCRIBE } from '../app/handlers/weather.js';
import {
  findCountyInText, isWeatherQuestion, parseCountyForecast, resolveCounty,
} from '../app/weather/forecast.js';
import { NO_LOCATION_CONTEXT, NO_WEATHER_DATA_CONTEXT } from '../app/weather/index.js';
import { CWA_BASE_URL } from '../services/cwa.js';
import storage from '../storage/index.js';
import { retryKeyForEvent } from '../utils/reply-message.js';

jest.mock('axios', () => jest.requireActual('./mocks/axios.js').default());

const USER = 'U-weather-user';
const { clients } = axios;
const cwa = () => clients[CWA_BASE_URL];
const gemini = () => clients[GEMINI_BASE_URL];
const line = () => clients['https://api.line.me'];

// Shape of an F-C0032-001 (今明 36 小時天氣預報) response.
const cwaForecast = (county, pops = ['20', '60', '10']) => ({
  data: {
    success: 'true',
    records: {
      datasetDescription: '三十六小時天氣預報',
      location: [{
        locationName: county,
        weatherElement: [
          ['Wx', ['多雲', '短暫陣雨', '晴']],
          ['PoP', pops],
          ['MinT', ['18', '17', '16']],
          ['MaxT', ['24', '21', '23']],
          ['CI', ['舒適', '稍有寒意', '舒適']],
        ].map(([elementName, values]) => ({
          elementName,
          time: values.map((parameterName, i) => ({
            startTime: ['2026-11-24 06:00:00', '2026-11-24 18:00:00', '2026-11-25 06:00:00'][i],
            endTime: ['2026-11-24 18:00:00', '2026-11-25 06:00:00', '2026-11-25 18:00:00'][i],
            parameter: { parameterName },
          })),
        })),
      }],
    },
  },
});

const event = (message) => ({
  type: 'message',
  replyToken: 'reply-token',
  webhookEventId: `E${Math.random()}`,
  source: { type: 'user', userId: USER },
  message: { id: 'm1', ...message },
});
const location = (address, latitude = 25.04, longitude = 121.51) => event({
  type: 'location', title: '我的位置', address, latitude, longitude,
});
const text = (value) => event({ type: 'text', text: value });

const replies = () => line().post.mock.calls
  .filter(([url]) => url === '/v2/bot/message/reply')
  .map(([, body]) => body.messages.map((m) => m.text).join('\n'));
const pushes = () => line().post.mock.calls.filter(([url]) => url === '/v2/bot/message/push');
const geminiSystem = (i = 0) => gemini().post.mock.calls[i][1].systemInstruction.parts[0].text;

let server;
beforeAll(async () => {
  server = webhook.listen(0);
  await new Promise((resolve) => { server.once('listening', resolve); });
});

afterAll(async () => {
  await new Promise((resolve) => { server.close(resolve); });
  restoreEnv();
});

beforeEach(() => {
  process.env.CWA_API_KEY = 'dummy-cwa-key';
  storage.data = {};
  line().get.mockResolvedValue({ data: { displayName: 'user' } });
  line().post.mockResolvedValue({ status: 200, data: {} });
  cwa().get.mockImplementation(async (url, { params }) => cwaForecast(params.locationName));
  gemini().post.mockResolvedValue({
    data: { candidates: [{ content: { parts: [{ text: '明天會下雨，記得帶傘。' }] }, finishReason: 'STOP' }] },
  });
});

afterEach(() => {
  removePrompt(USER);
  delete process.env.CWA_API_KEY;
  delete process.env.CRON_SECRET;
  jest.clearAllMocks();
});

test('county helpers: address, nearest seat, names in questions', () => {
  expect(resolveCounty({ address: '100台灣台北市中正區重慶南路一段122號' })).toEqual('臺北市');
  expect(resolveCounty({ address: '新竹縣竹北市' })).toEqual('新竹縣');
  expect(resolveCounty({ address: 'Kaohsiung', latitude: 22.62, longitude: 120.3 })).toEqual('高雄市');
  expect(resolveCounty({ address: 'Tokyo', latitude: 35.68, longitude: 139.76 })).toBeNull();
  expect(findCountyInText('高雄明天會下雨嗎')).toEqual('高雄市');
  expect(findCountyInText('新北市冷不冷')).toEqual('新北市');
  expect(findCountyInText('台北天氣')).toEqual('臺北市');
  expect(findCountyInText('今天天氣如何')).toBeNull();
  expect(isWeatherQuestion('明天要帶傘嗎')).toBe(true);
  expect(isWeatherQuestion('幫我寫一封信')).toBe(false);
});

test('parses the F-C0032-001 forecast and rejects an unexpected format', () => {
  const { county, periods } = parseCountyForecast(cwaForecast('臺北市').data);
  expect(county).toEqual('臺北市');
  expect(periods[1]).toEqual({
    start: '2026-11-24 18:00:00', end: '2026-11-25 06:00:00', wx: '短暫陣雨', pop: '60', minT: '17', maxT: '21', ci: '稍有寒意',
  });
  expect(() => parseCountyForecast({ records: {} })).toThrow('格式不符');
});

test('shared LINE location: saved, replied with the forecast, no Gemini call', async () => {
  await handleEvents([location('100台灣台北市中正區重慶南路一段122號')]);

  expect(cwa().get).toHaveBeenCalledWith('/F-C0032-001', {
    params: { Authorization: 'dummy-cwa-key', format: 'JSON', locationName: '臺北市' },
  });
  expect(gemini().post).not.toHaveBeenCalled();
  const [reply] = replies();
  expect(reply).toContain('📍 已記住你的位置：臺北市');
  expect(reply).toContain('11/24 06:00–18:00：多雲，降雨機率 20%，18–24°C，舒適');
  expect(reply).toContain('☂️');
  expect(storage.getItem('weather')[USER]).toEqual(expect.objectContaining({ county: '臺北市', subscribed: true }));
});

test('weather question uses the saved location; forecast goes to the system instruction only', async () => {
  await handleEvents([location('台北市中正區')]);
  await handleEvents([text('明天要帶傘嗎')]);

  expect(cwa().get).toHaveBeenCalledTimes(2);
  expect(gemini().post).toHaveBeenCalledTimes(1);
  const system = geminiSystem();
  expect(system).toContain('中央氣象署「臺北市」今明 36 小時天氣預報');
  expect(system).toContain('降雨機率 60%');
  const { contents } = gemini().post.mock.calls[0][1];
  expect(contents[contents.length - 1].parts[0].text).toEqual('明天要帶傘嗎。');
  expect(replies()[1]).toEqual('明天會下雨，記得帶傘。');
});

test('a county named in the question overrides the saved location', async () => {
  await handleEvents([location('台北市中正區')]);
  await handleEvents([text('高雄明天會下雨嗎')]);
  expect(cwa().get.mock.calls[1][1].params.locationName).toEqual('高雄市');
  expect(geminiSystem()).toContain('「高雄市」');
});

test('weather question without any location asks the user to share it', async () => {
  await handleEvents([text('今天天氣如何')]);
  expect(cwa().get).not.toHaveBeenCalled();
  expect(geminiSystem()).toContain(NO_LOCATION_CONTEXT);
});

test('non-weather questions unchanged; no forecast data means Gemini must not invent one', async () => {
  await handleEvents([location('台北市中正區')]);
  jest.clearAllMocks();

  await handleEvents([text('幫我寫一首詩')]);
  expect(cwa().get).not.toHaveBeenCalled();
  expect(geminiSystem(0)).not.toContain('中央氣象署');

  delete process.env.CWA_API_KEY;
  await handleEvents([text('明天要帶傘嗎')]);
  expect(cwa().get).not.toHaveBeenCalled();
  expect(geminiSystem(1)).toContain(NO_WEATHER_DATA_CONTEXT);

  process.env.CWA_API_KEY = 'dummy-cwa-key';
  cwa().get.mockRejectedValueOnce(new Error('timeout'));
  await handleEvents([text('明天要帶傘嗎')]);
  expect(gemini().post).toHaveBeenCalledTimes(3);
  expect(geminiSystem(2)).toContain(NO_WEATHER_DATA_CONTEXT);
  expect(replies()).toHaveLength(3);
});

const callCron = (headers = {}) => fetch(`http://127.0.0.1:${server.address().port}/api/cron/weather`, { headers });

test('morning push: off without CRON_SECRET, rejects a wrong secret', async () => {
  expect((await callCron()).status).toEqual(404);
  process.env.CRON_SECRET = 'test-cron-secret';
  expect((await callCron()).status).toEqual(401);
  expect((await callCron({ authorization: 'Bearer wrong' })).status).toEqual(401);
  expect(pushes()).toHaveLength(0);
});

test('morning push: one push per subscriber with a daily retry key; unsubscribe stops it', async () => {
  await handleEvents([location('台北市中正區')]);
  process.env.CRON_SECRET = 'test-cron-secret';

  const res = await callCron({ authorization: 'Bearer test-cron-secret' });
  expect(res.status).toEqual(200);
  expect(await res.json()).toEqual({ sent: 1, failed: 0, skipped: 0 });
  expect(pushes()).toHaveLength(1);
  const [, body, options] = pushes()[0];
  expect(body.to).toEqual(USER);
  expect(body.messages[0].text).toMatch(/^☀️ 早安！臺北市天氣（中央氣象署）/);
  const date = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  expect(options.headers['X-Line-Retry-Key']).toEqual(retryKeyForEvent(`weather:${USER}:${date}`));
  expect(gemini().post).not.toHaveBeenCalled();

  await handleEvents([text(COMMAND_WEATHER_UNSUBSCRIBE)]);
  expect(replies()[1]).toContain('已關閉天氣推播');
  const after = await callCron({ authorization: 'Bearer test-cron-secret' });
  expect(await after.json()).toEqual({ sent: 0, failed: 0, skipped: 1 });
  expect(pushes()).toHaveLength(1);

  await handleEvents([text(COMMAND_WEATHER_SUBSCRIBE)]);
  expect(replies()[2]).toContain('已開啟每天早上的天氣推播（臺北市）');
});

test('location outside Taiwan is not saved', async () => {
  await handleEvents([location('Tokyo, Japan', 35.68, 139.76)]);
  expect(replies()[0]).toContain('不在臺灣');
  expect(storage.getItem('weather')).toBeUndefined();
});
