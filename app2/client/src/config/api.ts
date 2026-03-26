const isDev = import.meta.env.DEV;
export const API_BASE = '/api';
export const WS_URL = isDev
  ? `ws://localhost:4001/api/events/stream`
  : `ws://${window.location.host}/api/events/stream`;
