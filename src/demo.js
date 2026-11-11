// Built-in 2-bar breakbeat with bass and chord stabs, synthesized into stereo Float32Arrays.
function makeDemo(sr, bpm) {
  const st = sr * 60 / bpm / 4, N = Math.round(st * 32);
  const L = new Float32Array(N), R = new Float32Array(N);
  let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const add = (start, len, fn, panL = 1, panR = 1) => {
    const s0 = Math.round(start);
    for (let i = 0; i < len; i++) { const v = fn(i / sr, i); const k = (s0 + i) % N; L[k] += v * panL; R[k] += v * panR; }
  };
  const kick = (s, a = 1) => { let ph = 0; add(s * st, sr * 0.45, (t) => { ph += (45 + 110 * Math.exp(-t * 28)) / sr; return Math.sin(2 * Math.PI * ph) * Math.exp(-t * 5.5) * 0.9 * a + (t < 0.003 ? rnd() * 0.3 * a : 0); }); };
  const snare = (s, a = 1) => { let hp = 0, prev = 0; add(s * st, sr * 0.3, (t) => { const n = rnd(); hp = 0.85 * (hp + n - prev); prev = n;
      return (hp * Math.exp(-t * 16) * 0.45 + Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 30) * 0.5) * a; }, 0.95, 1); };
  const hat = (s, a = 1, open = false) => { let prev = 0; add(s * st, sr * (open ? 0.35 : 0.06), (t) => { const n = rnd(); const v = n - prev; prev = n;
      return v * Math.exp(-t * (open ? 11 : 70)) * 0.16 * a; }, 0.75, 1); };
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const bass = (s, m, len) => { let ph = 0, lp = 0; const f = mtof(m); add(s * st, st * len, (t, i) => { ph += f / sr; const saw = 2 * (ph % 1) - 1;
      const c = 0.02 + 0.25 * Math.exp(-t * 12); lp += (saw - lp) * c; const env = Math.min(1, (st * len - i) / 200); return lp * 0.5 * env; }); };
  const stab = (s, notes, len) => { const ph = notes.map(() => [0, 0]); let lpl = 0, lpr = 0;
    for (let i = 0; i < st * len; i++) { const t = i / sr; let vl = 0, vr = 0;
      notes.forEach((m, j) => { const f = mtof(m); ph[j][0] += f * 0.997 / sr; ph[j][1] += f * 1.003 / sr; vl += 2 * (ph[j][0] % 1) - 1; vr += 2 * (ph[j][1] % 1) - 1; });
      const c = 0.03 + 0.3 * Math.exp(-t * 9), env = Math.exp(-t * 3) * Math.min(1, (st * len - i) / 300);
      lpl += (vl - lpl) * c; lpr += (vr - lpr) * c; const k = (Math.round(s * st) + i) % N; L[k] += lpl * 0.09 * env; R[k] += lpr * 0.09 * env; } };

  [0, 7, 10, 16, 22, 26].forEach(s => kick(s));
  [4, 12, 20, 28].forEach(s => snare(s)); [15, 30].forEach(s => snare(s, 0.35)); snare(31, 0.5);
  for (let s = 0; s < 32; s++) if (s !== 14 && s !== 30) hat(s, s % 2 ? 0.55 : 1);
  hat(14, 0.8, true); hat(30, 0.8, true);
  const bl = [[0, 33, 3], [3, 33, 1], [6, 45, 2], [8, 40, 2], [10, 43, 2], [12, 45, 2], [16, 29, 3], [19, 29, 1], [22, 41, 2], [24, 36, 2], [26, 40, 2], [28, 43, 3]];
  bl.forEach(([s, m, l]) => bass(s, m, l));
  stab(0, [57, 60, 64, 67], 3); stab(6, [57, 60, 64, 67], 2); stab(16, [53, 57, 60, 64], 3); stab(22, [55, 59, 62, 65], 2); stab(26, [55, 59, 62, 67], 4);
  let pk = 0; for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const sc = 0.8 / pk; for (let i = 0; i < N; i++) { L[i] *= sc; R[i] *= sc; }
  return { L, R };
}
