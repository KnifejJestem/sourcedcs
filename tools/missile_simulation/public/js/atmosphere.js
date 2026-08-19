import { GRAVITY } from './constants.js';

export function isaAtmosphere(h) {
  const T0 = 288.15, P0 = 101325.0, R = 287.05, g = GRAVITY, gam = 1.4;
  h = Math.max(0, h);
  let T, P;
  if (h <= 11000) {
    const L = -0.0065;
    T = T0 + L * h;
    P = P0 * Math.pow(T / T0, -g / (L * R));
  } else if (h <= 20000) {
    const T11 = T0 - 0.0065 * 11000;
    const P11 = P0 * Math.pow(T11 / T0, -g / (-0.0065 * R));
    T = T11;
    P = P11 * Math.exp(-g * (h - 11000) / (R * T));
  } else {
    const T11 = T0 - 0.0065 * 11000;
    const P11 = P0 * Math.pow(T11 / T0, -g / (-0.0065 * R));
    const P20 = P11 * Math.exp(-g * (20000 - 11000) / (R * T11));
    const L = 0.001;
    T = T11 + L * (h - 20000);
    P = P20 * Math.pow(T / T11, -g / (L * R));
  }
  return { rho: P / (R * T), a: Math.sqrt(gam * R * T) };
}
