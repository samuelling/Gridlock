// GRIDLOCK engine — step-sequenced multi-effect. Runs inside an AudioWorklet or a ScriptProcessor.
const NR = 25, MAXS = 32;
const BUFROWS = [0, 1, 2, 3, 4, 5, 14, 15, 16];
const BSIZE = [1/2, 1, 2, 4];
const CHORDS = [[0, 3, 7, 10], [0, 4, 7, 11], [0, 7, 12, 19], [0, 5, 7, 12], [0, 6, 11, 17]];
const FORM = [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]];
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const SIZES = [1/8, 1/4, 1/2, 1, 2, 4];            // in 16th-steps
const RCHUNK = [1/2, 1, 2, 4, 0];                  // 0 = whole block
const SFACT = [1/2, 1/3, 1/4, 1/8, 0];             // 0 = freeze
const STUT = [1, 1/2, 1/3, 1/4, 1/6, 1/8];
const DTIME = [1/2, 1, 2, 3, 4, 6];
const pick = (arr, v) => arr[Math.min(arr.length - 1, Math.floor(v * arr.length))];
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

class Engine {
  constructor(sr) {
    this.sr = sr;
    this.L = new Float32Array(sr); this.R = new Float32Array(sr); this.len = sr;
    this.playing = false; this.t = 0; this.bpm = 100; this.nSteps = 16; this.swing = 0;
    this.grid = []; this.la = []; this.lb = []; this.par = [];
    for (let r = 0; r < NR; r++) {
      this.grid.push(new Int32Array(MAXS)); this.la.push(new Float32Array(MAXS)); this.lb.push(new Float32Array(MAXS));
      this.par.push({ a: 0.5, b: 0.5, mix: 1, ma: 0, mb: 0, mode: 0 });
    }
    this.mMix = 1; this.vol = 0.8;
    this.step = -1; this.nextStepT = 0; this.stepStartT = 0;
    this.on = new Uint8Array(NR); this.started = new Uint8Array(NR);
    this.t0 = new Float64Array(NR); this.blen = new Float64Array(NR);
    this.A = new Float32Array(NR); this.B = new Float32Array(NR); this.g = new Float32Array(NR);
    this.cur = this.mkNormal(); this.prev = null; this.xf = 0; this.XF = 192;
    this.oL = 0; this.oR = 0;
    this.onStep = null;
    this.initDSP();
    this.refreshParams();
  }
  stepLen() { return this.sr * 60 / this.bpm / 4; }

  // ---------- messages ----------
  msg(m) {
    switch (m.type) {
      case 'buffer': this.L = m.L; this.R = m.R; this.len = m.L.length; break;
      case 'play': this.playing = true; this.t = 0; this.step = -1; this.nextStepT = 0; this.on.fill(0);
        this.cur = this.mkNormal(); this.prev = null; break;
      case 'stop': this.playing = false; this.clearTails(); break;
      case 'pat': for (let r = 0; r < NR; r++) for (let s = 0; s < MAXS; s++) {
          this.grid[r][s] = m.grid[r][s]; this.la[r][s] = m.la[r][s]; this.lb[r][s] = m.lb[r][s]; }
        this.refreshParams(); break;
      case 'par': Object.assign(this.par[m.r], m.p); this.refreshParams(); break;
      case 'global': if (m.bpm) this.bpm = m.bpm; if (m.nSteps) this.nSteps = m.nSteps;
        if (m.swing !== undefined) this.swing = m.swing; if (m.mix !== undefined) this.mMix = m.mix;
        if (m.vol !== undefined) this.vol = m.vol; break;
    }
  }
  refreshParams() {
    const s = Math.max(0, this.step);
    for (let r = 0; r < NR; r++) {
      const p = this.par[r];
      this.A[r] = clamp01(p.a + p.ma * this.la[r][s]);
      this.B[r] = clamp01(p.b + p.mb * this.lb[r][s]);
    }
    const A = this.A, B = this.B, sr = this.sr, dv = this.dv || (this.dv = {});
    dv.ton = sr / mtof(36 + Math.round(A[6] * 48));
    dv.flt = 30 * Math.pow(2, A[9] * 9.2);
    dv.phr = 0.1 * Math.pow(2, A[10] * 6.3); dv.chr = 0.1 * Math.pow(2, A[11] * 5.7);
    dv.ring = 10 * Math.pow(2, A[17] * 8.6);
    dv.shR = Math.pow(2, Math.round((A[18] - 0.5) * 48) / 12); dv.shW = sr * (0.02 + 0.1 * B[18]);
    const root = 36 + Math.round(A[22] * 36), iv = CHORDS[this.par[22].mode] || CHORDS[0];
    dv.str = iv.map(i => sr / mtof(root + i));
  }

  // ---------- sequencer ----------
  advance() {
    const prevStep = this.step;
    this.step = (this.step + 1) % this.nSteps;
    const s = this.step, sl = this.stepLen();
    const thisLen = sl * ((s % 2 === 0) ? (1 + this.swing) : (1 - this.swing));
    this.stepStartT = this.nextStepT; this.nextStepT += thisLen;
    for (let r = 0; r < NR; r++) {
      const id = this.grid[r][s];
      this.started[r] = 0;
      if (id) {
        const prevId = prevStep >= 0 ? this.grid[r][prevStep] : 0;
        if (!this.on[r] || prevId !== id || s === 0) {
          let n = 0; for (let k = s; k < this.nSteps && this.grid[r][k] === id; k++) n++;
          this.t0[r] = this.stepStartT; this.blen[r] = n * sl; this.started[r] = 1;
        }
        this.on[r] = 1;
      } else this.on[r] = 0;
    }
    this.refreshParams();
    // choose buffer mode: lowest active row among 0..5 wins
    let want = -1;
    for (const r of BUFROWS) if (this.on[r]) want = r;
    if (want !== this.cur.r || (want >= 0 && this.started[want])) {
      this.prev = this.cur; this.xf = this.XF;
      this.cur = want < 0 ? this.mkNormal() : this.mkMode(want);
    }
    if (this.onStep) this.onStep(s);
  }

  // ---------- buffer reading ----------
  rd(p) {
    const len = this.len; p = p % len; if (p < 0) p += len; if (p >= len) p -= len;
    const i = p | 0, f = p - i, j = (i + 1 === len) ? 0 : i + 1;
    const L = this.L, R = this.R;
    this.oL = L[i] + (L[j] - L[i]) * f; this.oR = R[i] + (R[j] - R[i]) * f;
  }
  mkNormal() { const e = this; return { r: -1, next() { e.rd(e.t); } }; }
  mkMode(r) {
    const e = this, base0 = this.t0[r], mode = this.par[r].mode, blen = this.blen[r];
    const win = (ph, size) => { const w = Math.min(1, ph / 48, (size - ph) / 48); return w < 0 ? 0 : w; };
    switch (r) {
      case 0: { // X-Loop: size, pitch, steady/shrink/rise
        let ph = 0, shrink = 1, rise = 0;
        return { r, next() {
          const size = Math.max(64, pick(SIZES, e.A[0]) * e.stepLen() * shrink);
          const semi = Math.round((e.B[0] - 0.5) * 24) + rise;
          ph += Math.pow(2, semi / 12);
          if (ph >= size) { ph -= size; if (ph >= size) ph = 0;
            if (mode === 1) shrink = Math.max(0.0625, shrink * 0.75);
            if (mode === 2) rise = Math.min(24, rise + 1); }
          e.rd(base0 + ph); const w = win(ph, size); e.oL *= w; e.oR *= w; } };
      }
      case 1: { // Loop: size, gate, fwd/back/pingpong
        let ph = 0, rep = 0;
        return { r, next() {
          const size = pick(SIZES, e.A[1]) * e.stepLen();
          ph += 1; if (ph >= size) { ph -= size; if (ph >= size) ph = 0; rep++; }
          const back = mode === 1 || (mode === 2 && (rep & 1));
          const gate = size * (0.08 + 0.92 * e.B[1]);
          e.rd(base0 + (back ? size - ph : ph));
          const w = Math.min(win(ph, size), Math.max(0, Math.min(1, (gate - ph) / 48)));
          e.oL *= w; e.oR *= w; } };
      }
      case 2: { // Scratch loop: rate, depth, hold/drift
        const tau0 = e.t;
        return { r, next() {
          const P = pick(SIZES.slice(1), e.A[2]) * e.stepLen() * 2;
          const tau = e.t - tau0, D = (0.15 + 0.85 * e.B[2]) * P * 0.9;
          const pos = base0 + (mode === 1 ? tau * 0.5 : 0) + D * (1 - Math.cos(2 * Math.PI * tau / P)) / 2;
          e.rd(pos);
          const v = Math.abs(Math.sin(2 * Math.PI * tau / P)); const w = Math.min(1, 0.25 + v * 1.5);
          e.oL *= w; e.oR *= w; } };
      }
      case 3: { // Reverse: chunk, speed
        let ph = 0, cs = base0;
        return { r, next() {
          const cf = pick(RCHUNK, e.A[3]);
          const chunk = cf === 0 ? Math.max(64, blen) : cf * e.stepLen();
          ph += Math.pow(2, (e.B[3] - 0.5) * 2);
          if (ph >= chunk) { ph -= chunk; if (ph >= chunk) ph = 0; cs += chunk; }
          e.rd(cs + chunk - ph); const w = win(ph, chunk); e.oL *= w; e.oR *= w; } };
      }
      case 4: { // Stretch: granular, factor, grain size
        const tau0 = e.t; let G = 2048, p0 = 0, p1 = 1024, s0 = base0, s1 = base0;
        let gl = 0, gr = 0;
        return { r, next() {
          const head = base0 + (e.t - tau0) * pick(SFACT, e.A[4]);
          const w0 = Math.sin(Math.PI * p0 / G), w1 = Math.sin(Math.PI * p1 / G);
          e.rd(s0 + p0); gl = e.oL * w0 * w0; gr = e.oR * w0 * w0;
          e.rd(s1 + p1); gl += e.oL * w1 * w1; gr += e.oR * w1 * w1;
          if (++p0 >= G) { p0 = 0; G = Math.round(e.sr * (0.015 + 0.185 * e.B[4])); p1 = G / 2; s0 = head - Math.random() * G * 0.1; }
          if (++p1 >= G) { p1 = 0; s1 = head - Math.random() * G * 0.1; }
          e.oL = gl; e.oR = gr; } };
      }
      case 14: { // Bounce: dropped-ball retriggers
        let ph = 0, k = 0, I = pick(BSIZE, e.A[14]) * e.stepLen();
        const minI = e.sr * 0.012, maxI = e.sr * 4;
        return { r, next() {
          ph += 1;
          if (ph >= I) { ph = 0; k++; const el = 0.45 + 0.5 * e.B[14]; I = mode === 0 ? Math.max(minI, I * el) : Math.min(maxI, I / el); }
          e.rd(base0 + ph); const w = win(ph, I) * (mode === 0 ? Math.pow(0.93, k) : 1); e.oL *= w; e.oR *= w; } };
      }
      case 15: { // Shuffle: random slices from the loop
        let ph = 0, rev = false, sz = pick(BSIZE, e.A[15]) * e.stepLen(), ss = base0;
        const choose = () => { const len = e.len, n = Math.max(1, Math.floor(len / sz));
          rev = mode === 2 && Math.random() < 0.4;
          if (Math.random() >= e.B[15]) return e.t;
          if (mode === 1) { const c = Math.floor((e.t % len) / sz); return ((((c + Math.floor(Math.random() * 5) - 2) % n) + n) % n) * sz; }
          return Math.floor(Math.random() * n) * sz; };
        ss = choose();
        return { r, next() {
          ph += 1;
          if (ph >= sz) { ph = 0; sz = pick(BSIZE, e.A[15]) * e.stepLen(); ss = choose(); }
          e.rd(rev ? ss + sz - ph : ss + ph); const w = win(ph, sz); e.oL *= w; e.oR *= w; } };
      }
      case 16: { // Skip: CD skipping / datamosh
        let ph = 0, cs = base0, corrupt = 0, hl = 0, hr = 0;
        return { r, next() {
          const S = Math.max(64, e.sr * (0.005 + 0.145 * e.A[16] * e.A[16]));
          ph += 1;
          if (ph >= S) { ph = 0; const x = Math.random(), p = e.B[16];
            if (x < p * 0.55) { /* repeat chunk */ } else if (x < p) cs += (Math.floor(Math.random() * 9) - 4) * S; else cs += S;
            corrupt = mode === 1 && Math.random() < p * 0.45 ? 1 + Math.floor(Math.random() * 3) : 0; }
          e.rd(cs + ph); let l = e.oL, rr = e.oR;
          if (corrupt === 1) { l = Math.round(l * 3) / 3; rr = Math.round(rr * 3) / 3; }
          else if (corrupt === 2) { l = Math.max(-1, Math.min(1, -l * 3)); rr = Math.max(-1, Math.min(1, -rr * 3)); }
          else if (corrupt === 3) { if ((ph | 0) % 48 === 0) { hl = l; hr = rr; } l = hl; rr = hr; }
          const w = Math.max(0, Math.min(1, ph / 24, (S - ph) / 24)); e.oL = l * w; e.oR = rr * w; } };
      }
      case 5: { // Vinyl: stop / start / spinback
        const tau0 = e.t; let ph = 0;
        return { r, next() {
          const D = Math.max(256, Math.max(blen, e.stepLen()) * (0.1 + 0.9 * e.A[5]));
          const x = Math.min(1, (e.t - tau0) / D), k = 0.4 + e.B[5] * 2.6;
          let rate, gain;
          if (mode === 0) { rate = Math.pow(1 - x, k); gain = Math.min(1, rate * 3); }
          else if (mode === 1) { rate = Math.pow(x, k); gain = Math.min(1, rate * 3); }
          else { rate = x < 1 ? 1 - 4 * Math.pow(x, 1 / k) : 0; gain = x < 1 ? Math.min(1, Math.abs(rate) * 2 + 0.05) * (1 - x * x) : 0; }
          ph += rate; e.rd(base0 + ph); e.oL *= gain; e.oR *= gain; } };
      }
    }
  }

  // ---------- DSP state ----------
  initDSP() {
    const sr = this.sr;
    this.st = { cnt: 0, hl: 0, hr: 0, sg: 1 };
    this.flt = { l1: 0, l2: 0, r1: 0, r2: 0, fc: 2000 };
    const TN = 8192; this.ton = { L: new Float32Array(TN), R: new Float32Array(TN), w: 0, N: TN, d: 200, lpL: 0, lpR: 0 };
    this.ph = { lfo: 0, zl: new Float32Array(4), zr: new Float32Array(4), fbl: 0, fbr: 0 };
    const CN = 4096; this.ch = { L: new Float32Array(CN), R: new Float32Array(CN), w: 0, N: CN, lfo: 0 };
    const DN = 1 << Math.ceil(Math.log2(sr * 4)); this.dl = { L: new Float32Array(DN), R: new Float32Array(DN), w: 0, N: DN, d: sr * 0.25, lpL: 0, lpR: 0 };
    const sc = sr / 44100, combs = [1116, 1188, 1277, 1356, 1422, 1491], aps = [556, 441, 341];
    const mk = n => ({ b: new Float32Array(Math.round(n * sc)), i: 0, f: 0 });
    this.rv = { cl: combs.map(mk), cr: combs.map(n => mk(n + 23)), al: aps.map(mk), ar: aps.map(n => mk(n + 23)) };
    this.fold = { xl: 0, yl: 0, xr: 0, yr: 0 };
    this.vow = { cnt: 0, c: [0, 1, 2].map(() => ({ a1: 0, a2: 0, a3: 0, k: 1 })), s: [0, 1, 2].map(() => ({ l1: 0, l2: 0, r1: 0, r2: 0 })) };
    this.rad = { lpH: 0, l1: 0, l2: 0, nl: 0, ph1: 0, ph2: 0, wph: 0, crk: 0 };
    this.ring = { pl: 0, pr: 0 };
    const HN = 16384; this.shf = { L: new Float32Array(HN), R: new Float32Array(HN), w: 0, N: HN, p: 0 };
    this.str = { s: [0, 1, 2, 3].map(() => ({ b: new Float32Array(8192), w: 0, d: 400, prev: 0 })), en: 0 };
    const CL = 1 << 17; this.cld = { L: new Float32Array(CL), R: new Float32Array(CL), w: 0, M: CL - 1, acc: 0, nAct: 0,
      v: Array.from({ length: 12 }, () => ({ on: false, pos: 0, inc: 1, len: 1, age: 0, gl: 0, gr: 0 })) };
    this.shm = { lines: [1931, 2437, 3011, 3607].map(n => ({ b: new Float32Array(Math.round(n * sc)), i: 0, lp: 0 })),
      sb: new Float32Array(16384), sw: 0, sp: 0, en: 0 };
  }
  clearTails() {
    this.ton.L.fill(0); this.ton.R.fill(0); this.dl.L.fill(0); this.dl.R.fill(0);
    this.ch.L.fill(0); this.ch.R.fill(0);
    for (const k of ['cl', 'cr', 'al', 'ar']) for (const c of this.rv[k]) { c.b.fill(0); c.f = 0; }
    this.ph.zl.fill(0); this.ph.zr.fill(0); this.ph.fbl = this.ph.fbr = 0;
    this.flt.l1 = this.flt.l2 = this.flt.r1 = this.flt.r2 = 0;
    for (const s of this.str.s) s.b.fill(0); this.str.en = 0;
    for (const l of this.shm.lines) { l.b.fill(0); l.lp = 0; } this.shm.sb.fill(0); this.shm.en = 0;
    for (const v of this.cld.v) v.on = false; this.cld.nAct = 0;
  }

  // ---------- render ----------
  render(outL, outR, n) {
    if (!this.playing) { outL.fill(0); outR.fill(0); return; }
    const sr = this.sr, A = this.A, B = this.B, g = this.g, on = this.on, par = this.par;
    for (let i = 0; i < n; i++) {
      if (this.t >= this.nextStepT) this.advance();
      for (let r = 6; r < NR; r++) g[r] += (on[r] - g[r]) * 0.004;
      // dry (for master mix)
      this.rd(this.t); const dL = this.oL, dR = this.oR;
      // buffer modes with crossfade
      this.cur.next(); let L = this.oL, R = this.oR;
      if (this.xf > 0) { const a = this.xf / this.XF; this.prev.next(); L = L * (1 - a) + this.oL * a; R = R * (1 - a) + this.oR * a; if (--this.xf === 0) this.prev = null; }
      const bm = this.cur.r; if (bm >= 0 && par[bm].mix < 1) { const m = par[bm].mix; L = dL + (L - dL) * m; R = dR + (R - dR) * m; }
      const sl = this.stepLen();

      // Stutter (7)
      { const st = this.st; let tgt = 1;
        if (on[7]) { const per = pick(STUT, A[7]) * sl, tau = this.t - this.t0[7];
          const ph = (tau % per) / per, duty = 0.1 + 0.8 * B[7];
          tgt = par[7].mode === 0 ? (ph < duty ? 1 : 0) : Math.exp(-ph / (duty * 0.35));
          tgt = 1 - par[7].mix * (1 - tgt); }
        st.sg += (tgt - st.sg) * 0.05; L *= st.sg; R *= st.sg; }
      // Crush (8)
      if (g[8] > 1e-4) { const st = this.st, ds = 1 + Math.floor(B[8] * B[8] * 40);
        if (++st.cnt >= ds) { st.cnt = 0; const q = Math.pow(2, Math.round(16 - A[8] * 14) - 1); st.hl = Math.round(L * q) / q; st.hr = Math.round(R * q) / q; }
        const m = g[8] * par[8].mix; L += (st.hl - L) * m; R += (st.hr - R) * m; }
      // Fold (21)
      if (g[21] > 1e-4) { const F = this.fold, dr = 1 + A[21] * 14, bias = (B[21] - 0.5) * 0.8, md = par[21].mode;
        const fn = x => { x = x * dr + bias; if (md === 0) return Math.sin(x);
          if (md === 1) { const t = (x + 1) * 0.25; return 4 * Math.abs(t - Math.floor(t + 0.5)) - 1; }
          return Math.abs(Math.sin(x)) * 2 - 1; };
        const al = fn(L), ar = fn(R);
        F.yl = al - F.xl + 0.995 * F.yl; F.xl = al; F.yr = ar - F.xr + 0.995 * F.yr; F.xr = ar;
        const m = g[21] * par[21].mix; L += (F.yl * 0.55 - L) * m; R += (F.yr * 0.55 - R) * m; }
      // Filter (9)
      { const f = this.flt, tgt = this.dv.flt; f.fc += (tgt - f.fc) * 0.003;
        const m = g[9] * par[9].mix;
        const gg = Math.tan(Math.PI * Math.min(f.fc, sr * 0.45) / sr), k = 2 - 1.96 * B[9];
        const a1 = 1 / (1 + gg * (gg + k)), a2 = gg * a1, a3 = gg * a2, md = par[9].mode;
        let v3 = L - f.l2, v1 = a1 * f.l1 + a2 * v3, v2 = f.l2 + a2 * f.l1 + a3 * v3;
        f.l1 = 2 * v1 - f.l1; f.l2 = 2 * v2 - f.l2;
        const yl = md === 0 ? v2 : md === 1 ? v1 * k : L - k * v1 - v2;
        v3 = R - f.r2; v1 = a1 * f.r1 + a2 * v3; v2 = f.r2 + a2 * f.r1 + a3 * v3;
        f.r1 = 2 * v1 - f.r1; f.r2 = 2 * v2 - f.r2;
        const yr = md === 0 ? v2 : md === 1 ? v1 * k : R - k * v1 - v2;
        L += (yl - L) * m; R += (yr - R) * m; }
      // Vowel (20) — formant filter
      if (g[20] > 1e-4) { const V = this.vow;
        if ((V.cnt++ & 31) === 0) { let v = A[20];
          if (par[20].mode === 1) v = clamp01(v + 0.4 * Math.sin(2 * Math.PI * (this.t - this.t0[20]) / (sl * 2)));
          const x = v * 4, i0 = Math.min(3, Math.floor(x)), f = x - i0, k = 1 / (4 + B[20] * 20);
          for (let j = 0; j < 3; j++) { const fr = FORM[i0][j] + (FORM[i0 + 1][j] - FORM[i0][j]) * f, gg = Math.tan(Math.PI * fr / sr), c = V.c[j];
            c.k = k; c.a1 = 1 / (1 + gg * (gg + k)); c.a2 = gg * c.a1; c.a3 = gg * c.a2; } }
        let yl = 0, yr = 0; const GN = [1.6, 0.9, 0.5];
        for (let j = 0; j < 3; j++) { const c = V.c[j], s = V.s[j];
          let v3 = L - s.l2, v1 = c.a1 * s.l1 + c.a2 * v3, v2 = s.l2 + c.a2 * s.l1 + c.a3 * v3; s.l1 = 2 * v1 - s.l1; s.l2 = 2 * v2 - s.l2; yl += v1 * c.k * GN[j];
          v3 = R - s.r2; v1 = c.a1 * s.r1 + c.a2 * v3; v2 = s.r2 + c.a2 * s.r1 + c.a3 * v3; s.r1 = 2 * v1 - s.r1; s.r2 = 2 * v2 - s.r2; yr += v1 * c.k * GN[j]; }
        const m = g[20] * par[20].mix; L += (yl - L) * m; R += (yr - R) * m; }
      // Radio (23)
      if (g[23] > 1e-4) { const Q = this.rad, md = par[23].mode, clar = A[23], dr = B[23];
        const lo = md === 2 ? 0.06 : 0.045, hi = md === 2 ? 0.22 : 0.3;
        const x = (L + R) * 0.5; Q.lpH += (x - Q.lpH) * lo; let y = x - Q.lpH; Q.l1 += (y - Q.l1) * hi; Q.l2 += (Q.l1 - Q.l2) * hi; y = Q.l2 * 1.6;
        Q.ph1 += (0.07 + dr * 0.6) / sr; Q.ph2 += (0.23 + dr * 1.7) / sr;
        const lfo = 0.5 + 0.3 * Math.sin(2 * Math.PI * Q.ph1) + 0.2 * Math.sin(2 * Math.PI * Q.ph2);
        if (md === 2) y = Math.max(-0.5, Math.min(0.5, y * 3));
        else { const det = (1 - clar);
          if (md === 1) y *= 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(2 * Math.PI * Q.ph2 * 0.7));
          Q.wph += (250 + det * 2200 * lfo) / sr; if (Q.wph > 1) Q.wph -= 1;
          const n = Math.random() * 2 - 1; Q.nl += (n - Q.nl) * 0.35;
          if (Math.random() < 0.0004 * (1 + det * 4)) Q.crk = 1; Q.crk *= 0.92;
          y = Math.tanh(y * (1.5 + det)) * (0.4 + 0.6 * clar) + Q.nl * det * 0.45 * (0.5 + lfo * 0.5)
            + Math.sin(2 * Math.PI * Q.wph) * det * det * 0.12 * (0.4 + dr) + Q.crk * (Math.random() - 0.5) * 0.6; }
        const m = g[23] * par[23].mix; L += (y - L) * m; R += (y - R) * m; }
      // Ring mod (17)
      if (g[17] > 1e-4) { const G = this.ring; let f = this.dv.ring;
        if (par[17].mode === 2) f *= Math.pow(2, 3 * Math.min(1, (this.t - this.t0[17]) / Math.max(1, this.blen[17])));
        G.pl += f / sr; G.pr += f * (1 + B[17] * 0.03) / sr; G.pl -= Math.floor(G.pl); G.pr -= Math.floor(G.pr);
        let cl = Math.sin(2 * Math.PI * G.pl), cr = Math.sin(2 * Math.PI * G.pr);
        if (par[17].mode === 1) { cl = Math.tanh(cl * 6); cr = Math.tanh(cr * 6); }
        const m = g[17] * par[17].mix; L += (L * cl - L) * m; R += (R * cr - R) * m; }
      // Shifter (18) — granular pitch shift
      { const H = this.shf; H.L[H.w] = L; H.R[H.w] = R;
        if (g[18] > 1e-4) { const ratio = this.dv.shR, W = this.dv.shW;
          H.p += (1 - ratio) / W; H.p -= Math.floor(H.p); const p2 = (H.p + 0.5) % 1;
          const tap = (buf, d) => { let rp = H.w - d; while (rp < 0) rp += H.N; if (rp >= H.N) rp -= H.N; const ri = rp | 0, fr = rp - ri; return buf[ri] + (buf[(ri + 1) % H.N] - buf[ri]) * fr; };
          const w1 = Math.sin(Math.PI * H.p) ** 2, w2 = 1 - w1, d1 = H.p * W + 2, d2 = p2 * W + 2;
          const yl = tap(H.L, d1) * w1 + tap(H.L, d2) * w2, yr = tap(H.R, d1) * w1 + tap(H.R, d2) * w2;
          const m = g[18] * par[18].mix;
          if (par[18].mode === 0) { L += (yl - L) * m; R += (yr - R) * m; } else { L += yl * m * 0.8; R += yr * m * 0.8; } }
        H.w = (H.w + 1) % H.N; }
      // Tonal delay (6) — resonant comb, rings out
      { const T = this.ton, midi = 36 + Math.round(A[6] * 48), tgt = this.dv.ton;
        T.d += (tgt - T.d) * 0.0015; const fb = 0.6 + 0.39 * B[6], m = par[6].mix;
        let rp = T.w - T.d; while (rp < 0) rp += T.N; if (rp >= T.N) rp -= T.N; const ri = rp | 0, fr = rp - ri, rj = (ri + 1) % T.N;
        const yl = T.L[ri] + (T.L[rj] - T.L[ri]) * fr, yr = T.R[ri] + (T.R[rj] - T.R[ri]) * fr;
        T.lpL += (yl - T.lpL) * 0.6; T.lpR += (yr - T.lpR) * 0.6;
        T.L[T.w] = L * g[6] * 0.35 + T.lpL * fb; T.R[T.w] = R * g[6] * 0.35 + T.lpR * fb;
        T.w = (T.w + 1) % T.N;
        L = L * (1 - g[6] * m * 0.6) + yl * m; R = R * (1 - g[6] * m * 0.6) + yr * m; }
      // Strings (22) — sympathetic Karplus-Strong chord
      { const T = this.str;
        if (g[22] > 1e-4 || T.en > 1e-5) {           const fb = 0.95 + 0.0495 * Math.sqrt(B[22]), inp = (L + R) * 0.5 * g[22] * 0.22; let ol = 0, or = 0, en = 0;
          for (let k = 0; k < 4; k++) { const s = T.s[k], N = s.b.length; s.d += (this.dv.str[k] - s.d) * 0.003;
            let rp = s.w - s.d; while (rp < 0) rp += N; if (rp >= N) rp -= N; const ri = rp | 0, fr = rp - ri; const y = s.b[ri] + (s.b[(ri + 1) % N] - s.b[ri]) * fr;
            s.b[s.w] = inp + fb * 0.5 * (y + s.prev); s.prev = y; s.w = (s.w + 1) % N;
            if (k & 1) { ol += y * 0.35; or += y; } else { ol += y; or += y * 0.35; } en += Math.abs(y); }
          T.en = T.en * 0.999 + en * 0.001; const m = par[22].mix * 0.8; L += ol * m; R += or * m; } }
      // Cloud (19) — granular spray
      { const Cd = this.cld; Cd.L[Cd.w] = L; Cd.R[Cd.w] = R;
        if (g[19] > 0.5) { Cd.acc += (4 + A[19] * 56) / sr;
          if (Cd.acc >= 1) { Cd.acc -= 1; const v = Cd.v.find(x => !x.on);
            if (v) { const md = par[19].mode, len = sr * (0.03 + 0.17 * Math.random());
              let inc; if (md === 0) inc = Math.pow(2, [0, 12, -12, 7, 19, 12][Math.floor(Math.random() * 6)] / 12);
              else if (md === 1) inc = Math.pow(2, (Math.random() * 48 - 24) / 12); else inc = -[1, 0.5, 2][Math.floor(Math.random() * 3)];
              const back = Math.max(sr * 0.02 + B[19] * sr * 1.5 * Math.random(), len * Math.max(0, inc - 1) + 32);
              const pan = Math.random(); v.on = true; v.pos = Cd.w - back; v.inc = inc; v.len = len; v.age = 0;
              v.gl = Math.cos(pan * Math.PI / 2); v.gr = Math.sin(pan * Math.PI / 2); Cd.nAct++; } } }
        if (Cd.nAct > 0) { let ol = 0, or = 0;
          for (const v of Cd.v) { if (!v.on) continue; const x = v.age / v.len, w = Math.sin(Math.PI * x) ** 2;
            let p = v.pos; const pi = Math.floor(p), fr = p - pi, i0 = pi & Cd.M, i1 = (pi + 1) & Cd.M;
            const sl_ = Cd.L[i0] + (Cd.L[i1] - Cd.L[i0]) * fr, sr_ = Cd.R[i0] + (Cd.R[i1] - Cd.R[i0]) * fr;
            ol += sl_ * w * v.gl; or += sr_ * w * v.gr; v.pos += v.inc; if (++v.age >= v.len) { v.on = false; Cd.nAct--; } }
          const m = par[19].mix; L = L * (1 - g[19] * m * 0.5) + ol * m * 0.6; R = R * (1 - g[19] * m * 0.5) + or * m * 0.6; }
        Cd.w = (Cd.w + 1) & Cd.M; }
      // Phaser (10)
      if (g[10] > 1e-4) { const P = this.ph, rate = this.dv.phr;
        P.lfo += rate / sr; if (P.lfo >= 1) P.lfo -= 1; const fb = B[10] * 0.85;
        const lfoL = 0.5 - 0.5 * Math.cos(2 * Math.PI * P.lfo), lfoR = 0.5 - 0.5 * Math.cos(2 * Math.PI * (P.lfo + 0.25));
        let xl = L + P.fbl * fb, xr = R + P.fbr * fb;
        const tl = Math.tan(Math.PI * 200 * Math.pow(2, lfoL * 4) / sr), cl = (tl - 1) / (tl + 1);
        const tr = Math.tan(Math.PI * 200 * Math.pow(2, lfoR * 4) / sr), cr = (tr - 1) / (tr + 1);
        for (let k = 0; k < 4; k++) { let y = cl * xl + P.zl[k]; P.zl[k] = xl - cl * y; xl = y; y = cr * xr + P.zr[k]; P.zr[k] = xr - cr * y; xr = y; }
        P.fbl = xl; P.fbr = xr; const m = g[10] * par[10].mix * 0.5;
        L += (xl - L) * m; R += (xr - R) * m; }
      // Chorus (11)
      { const C = this.ch; C.L[C.w] = L; C.R[C.w] = R;
        if (g[11] > 1e-4) { const rate = this.dv.chr; C.lfo += rate / sr; if (C.lfo >= 1) C.lfo -= 1;
          const dep = (0.5 + B[11] * 7.5) * sr / 1000, base = 0.012 * sr;
          const rdC = (buf, d) => { let rp = C.w - d; while (rp < 0) rp += C.N; if (rp >= C.N) rp -= C.N; const ri = rp | 0, fr = rp - ri; return buf[ri] + (buf[(ri + 1) % C.N] - buf[ri]) * fr; };
          const yl = rdC(C.L, base + dep * (0.5 + 0.5 * Math.sin(2 * Math.PI * C.lfo)));
          const yr = rdC(C.R, base + dep * (0.5 + 0.5 * Math.cos(2 * Math.PI * C.lfo)));
          const m = g[11] * par[11].mix * 0.5; L += (yl - L) * m; R += (yr - R) * m; }
        C.w = (C.w + 1) % C.N; }
      // Delay (12) — send style
      { const D = this.dl, tgt = pick(DTIME, A[12]) * sl; D.d += (tgt - D.d) * 0.0005;
        let rp = D.w - D.d; while (rp < 0) rp += D.N; if (rp >= D.N) rp -= D.N; const ri = rp | 0, fr = rp - ri, rj = (ri + 1) & (D.N - 1);
        const yl = D.L[ri] + (D.L[rj] - D.L[ri]) * fr, yr = D.R[ri] + (D.R[rj] - D.R[ri]) * fr;
        D.lpL += (yl - D.lpL) * 0.45; D.lpR += (yr - D.lpR) * 0.45;
        const fb = B[12] * 0.88;
        if (par[12].mode === 0) { D.L[D.w] = (L + R) * 0.5 * g[12] + D.lpR * fb; D.R[D.w] = D.lpL * fb; }
        else { D.L[D.w] = L * g[12] + D.lpL * fb; D.R[D.w] = R * g[12] + D.lpR * fb; }
        D.w = (D.w + 1) & (D.N - 1);
        const m = par[12].mix * 0.8; L += yl * m; R += yr * m; }
      // Reverb (13) — send style
      { const V = this.rv, inp = (L + R) * 0.5 * g[13] * 0.07, fb = 0.72 + A[13] * 0.26, damp = 0.1 + B[13] * 0.7;
        let wl = 0, wr = 0;
        for (let k = 0; k < V.cl.length; k++) {
          let c = V.cl[k], y = c.b[c.i]; c.f = y + (c.f - y) * damp; c.b[c.i] = inp + c.f * fb; if (++c.i >= c.b.length) c.i = 0; wl += y;
          c = V.cr[k]; y = c.b[c.i]; c.f = y + (c.f - y) * damp; c.b[c.i] = inp + c.f * fb; if (++c.i >= c.b.length) c.i = 0; wr += y; }
        for (let k = 0; k < V.al.length; k++) {
          let c = V.al[k], bo = c.b[c.i]; c.b[c.i] = wl + bo * 0.5; if (++c.i >= c.b.length) c.i = 0; wl = bo - wl;
          c = V.ar[k]; bo = c.b[c.i]; c.b[c.i] = wr + bo * 0.5; if (++c.i >= c.b.length) c.i = 0; wr = bo - wr; }
        const m = par[13].mix; L += wl * m; R += wr * m; }

      // Shimmer (24) — FDN reverb with pitch shifter in the loop
      { const Sh = this.shm;
        if (g[24] > 1e-4 || Sh.en > 1e-5) { const md = par[24].mode, fb = md === 3 ? 0.997 : 0.6 + 0.37 * A[24], amt = B[24];
          const inp = (L + R) * 0.5 * g[24] * 0.6, ln = Sh.lines, y = [0, 0, 0, 0];
          for (let k = 0; k < 4; k++) { const l = ln[k]; l.lp += (l.b[l.i] - l.lp) * 0.6; y[k] = l.lp; }
          const h0 = (y[0] + y[1] + y[2] + y[3]) * 0.5, h1 = (y[0] - y[1] + y[2] - y[3]) * 0.5, h2 = (y[0] + y[1] - y[2] - y[3]) * 0.5, h3 = (y[0] - y[1] - y[2] + y[3]) * 0.5;
          // shifter on the loop sum
          const SN = Sh.sb.length; Sh.sb[Sh.sw] = h0; const ratio = [2, 1.5, 0.5, 2][md] || 2, W = sr * 0.08;
          Sh.sp += (1 - ratio) / W; Sh.sp -= Math.floor(Sh.sp); const p2 = (Sh.sp + 0.5) % 1;
          const tp = d => { let rp = Sh.sw - d; while (rp < 0) rp += SN; if (rp >= SN) rp -= SN; const ri = rp | 0, fr = rp - ri; return Sh.sb[ri] + (Sh.sb[(ri + 1) % SN] - Sh.sb[ri]) * fr; };
          const w1 = Math.sin(Math.PI * Sh.sp) ** 2, s = tp(Sh.sp * W + 2) * w1 + tp(p2 * W + 2) * (1 - w1); Sh.sw = (Sh.sw + 1) % SN;
          const hh = [h0, h1, h2, h3], sg = [1, -1, 1, -1];
          for (let k = 0; k < 4; k++) { const l = ln[k]; l.b[l.i] = inp + fb * ((1 - amt) * hh[k] + amt * s * 0.5 * sg[k]); if (++l.i >= l.b.length) l.i = 0; }
          Sh.en = Sh.en * 0.9995 + (Math.abs(y[0]) + Math.abs(y[1])) * 0.0005;
          const m = par[24].mix; L += (y[0] + y[2]) * 0.6 * m; R += (y[1] + y[3]) * 0.6 * m; } }
      // master
      L = dL + (L - dL) * this.mMix; R = dR + (R - dR) * this.mMix;
      L *= this.vol; R *= this.vol;
      outL[i] = L > 3 ? 1 : L < -3 ? -1 : L * (27 + L * L) / (27 + 9 * L * L);
      outR[i] = R > 3 ? 1 : R < -3 ? -1 : R * (27 + R * R) / (27 + 9 * R * R);
      this.t++;
    }
  }
}
