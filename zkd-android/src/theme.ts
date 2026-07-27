/** Same palette as the web app: deep navy, one blue, muted status colours. */
export const C = {
  bg: '#080c14',
  glass: 'rgba(255,255,255,0.045)',
  glass2: 'rgba(255,255,255,0.075)',
  edge: 'rgba(255,255,255,0.10)',
  edge2: 'rgba(255,255,255,0.18)',
  text: '#eef1f6',
  mist: 'rgba(228,234,244,0.66)',
  mist2: 'rgba(228,234,244,0.42)',
  iris: '#2f7ff0',
  irisSoft: 'rgba(47,127,240,0.14)',
  safe: '#4bab7c',
  safeSoft: 'rgba(75,171,124,0.13)',
  warn: '#d3a03f',
  warnSoft: 'rgba(211,160,63,0.13)',
  risk: '#d9615a',
  riskSoft: 'rgba(217,97,90,0.13)',
};

export const tone = (b: 'low' | 'mid' | 'high') =>
  b === 'high' ? C.risk : b === 'mid' ? C.warn : C.safe;
export const toneSoft = (b: 'low' | 'mid' | 'high') =>
  b === 'high' ? C.riskSoft : b === 'mid' ? C.warnSoft : C.safeSoft;

export const mono = 'monospace';
