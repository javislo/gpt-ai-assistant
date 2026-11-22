import { jest } from '@jest/globals';

/**
 * Factory for jest.mock('axios', ...). Every axios.create() call returns a fake
 * client registered under its baseURL so tests can stub and inspect requests.
 */
const createAxiosMock = () => {
  const clients = {};
  const create = jest.fn(({ baseURL } = {}) => {
    const client = {
      defaults: { baseURL },
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
      get: jest.fn(),
      post: jest.fn(),
    };
    clients[baseURL] = client;
    return client;
  });
  class AxiosError extends Error {}
  return {
    __esModule: true,
    default: { create, clients },
    AxiosError,
  };
};

export default createAxiosMock;
