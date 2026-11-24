import axios from 'axios';
import config from '../config/index.js';
import { handleFulfilled, handleRejected, handleRequest } from './utils/index.js';

// Central Weather Administration (中央氣象署) open data API.
export const CWA_BASE_URL = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore';
// 一般天氣預報－今明 36 小時天氣預報 (22 counties/cities, 3 periods of 12 hours).
export const DATASET_COUNTY_36H = 'F-C0032-001';

// Read at call time so the feature turns on as soon as the key is set in Vercel.
export const getCwaApiKey = () => process.env.CWA_API_KEY || null;

const client = axios.create({
  baseURL: CWA_BASE_URL,
  timeout: config.APP_API_TIMEOUT,
});

client.interceptors.request.use(handleRequest);
client.interceptors.response.use(handleFulfilled, handleRejected);

/**
 * @param {string} county official name, e.g. 臺北市
 */
const fetchCountyForecast = (county) => client.get(`/${DATASET_COUNTY_36H}`, {
  params: {
    Authorization: getCwaApiKey(),
    format: 'JSON',
    locationName: county,
  },
});

export {
  fetchCountyForecast,
};
