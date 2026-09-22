export const API_BASE = process.env.NEXT_PUBLIC_CONTROL_PLANE_BASE_URL ?? 'http://localhost:3020';

export const OPS_WS_URL = `${API_BASE.replace(/^http/, 'ws')}/ws/ops`;
