const ROWS = [
  { n: 'X-Loop', h: 8, a: 'Size', b: 'Pitch', modes: ['Steady', 'Shrink', 'Rise'] },
  { n: 'Loop', h: 26, a: 'Size', b: 'Gate', modes: ['Fwd', 'Back', 'Ping-pong'] },
  { n: 'Scratch', h: 42, a: 'Rate', b: 'Depth', modes: ['Hold', 'Drift'] },
  { n: 'Reverse', h: 56, a: 'Chunk', b: 'Speed' },
  { n: 'Stretch', h: 74, a: 'Factor', b: 'Grain' },
  { n: 'Vinyl', h: 96, a: 'Time', b: 'Curve', modes: ['Stop', 'Start', 'Spinback'] },
  { n: 'Tonal Dly', h: 150, a: 'Note', b: 'Feedback' },
  { n: 'Stutter', h: 172, a: 'Rate', b: 'Duty', modes: ['Gate', 'Decay'] },
  { n: 'Crush', h: 192, a: 'Bits', b: 'Downsample' },
  { n: 'Filter', h: 212, a: 'Cutoff', b: 'Reso', modes: ['LP', 'BP', 'HP'] },
  { n: 'Phaser', h: 248, a: 'Rate', b: 'Feedback' },
  { n: 'Chorus', h: 272, a: 'Rate', b: 'Depth' },
  { n: 'Delay', h: 300, a: 'Time', b: 'Feedback', modes: ['Ping-pong', 'Stereo'] },
  { n: 'Reverb', h: 328, a: 'Size', b: 'Damp' },
];
const NRW = 14, MS = 32;
const NOTE = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const pk = (arr, v) => arr[Math.min(arr.length - 1, Math.floor(v * arr.length))];
const SZL = ['1/128', '1/64', '1/32', '1/16', '1/8', '1/4'];
function fmt(r, w, v) {
  const pct = Math.round(v * 100) + '%';
  if (w === 'mix') return pct;
  switch (r) {
    case 0: if (w === 'a') return pk(SZL, v); { const s = Math.round((v - .5) * 24); return (s > 0 ? '+' : '') + s + ' st'; }
    case 1: return w === 'a' ? pk(SZL, v) : Math.round((0.08 + 0.92 * v) * 100) + '%';
    case 2: return w === 'a' ? pk(['1/32', '1/16', '1/8', '1/4', '1/2'], v) : Math.round((0.15 + .85 * v) * 100) + '%';
    case 3: return w === 'a' ? pk(['1/32', '1/16', '1/8', '1/4', 'Block'], v) : Math.pow(2, (v - .5) * 2).toFixed(2) + '×';
    case 4: return w === 'a' ? pk(['½×', '⅓×', '¼×', '⅛×', 'Freeze'], v) : Math.round(15 + 185 * v) + ' ms';
    case 5: return w === 'a' ? Math.round((0.1 + .9 * v) * 100) + '% blk' : (0.4 + v * 2.6).toFixed(1);
    case 6: if (w === 'a') { const m = 36 + Math.round(v * 48); return NOTE[m % 12] + (Math.floor(m / 12) - 1); } return Math.round((0.6 + .39 * v) * 100) + '%';
    case 7: return w === 'a' ? pk(['1/16', '1/32', '1/48', '1/64', '1/96', '1/128'], v) : Math.round((0.1 + .8 * v) * 100) + '%';
    case 8: return w === 'a' ? Math.round(16 - v * 14) + ' bit' : (1 + Math.floor(v * v * 40)) + '×';
    case 9: if (w === 'a') { const f = 30 * Math.pow(2, v * 9.2); return f >= 1000 ? (f / 1000).toFixed(1) + ' kHz' : Math.round(f) + ' Hz'; } return pct;
    case 10: case 11: if (w === 'a') return (0.1 * Math.pow(2, v * (r === 10 ? 6.3 : 5.7))).toFixed(2) + ' Hz';
      return r === 10 ? Math.round(v * 85) + '%' : (0.5 + v * 7.5).toFixed(1) + ' ms';
    case 12: return w === 'a' ? pk(['1/32', '1/16', '1/8', '3/16', '1/4', '3/8'], v) : Math.round(v * 88) + '%';
    case 13: return pct;
  }
}

// ---------------- state ----------------
const z2 = f => Array.from({ length: NRW }, () => new Array(MS).fill(f));
const blankPat = () => ({ grid: z2(0), la: z2(0), lb: z2(0) });
let S;
function defaults() {
  const pats = Array.from({ length: 8 }, blankPat);
  let id = 1;
  const blk = (p, r, s0, s1) => { const i = id++; for (let s = s0; s <= s1; s++) pats[p].grid[r][s] = i; };
  blk(0, 12, 4, 4); blk(0, 7, 7, 7); blk(0, 1, 10, 11); blk(0, 13, 12, 12); blk(0, 3, 14, 15);
  blk(1, 2, 4, 5); blk(1, 8, 8, 11); blk(1, 5, 12, 15);
  blk(2, 4, 0, 3); blk(2, 9, 0, 15); blk(2, 6, 8, 15);
  for (let s = 0; s < 16; s++) pats[2].la[9][s] = s / 15;
  [0, 0, 3, 3, 7, 7, 10, 12].forEach((m, k) => pats[2].la[6][8 + k] = m / 48);
  blk(3, 10, 0, 15); blk(3, 0, 6, 7); blk(3, 1, 12, 12); blk(3, 11, 8, 11); blk(3, 12, 15, 15);
  for (const p of pats) for (let r = 0; r < NRW; r++) for (let s = 0; s < 16; s++) {
    p.grid[r][s + 16] = p.grid[r][s] ? p.grid[r][s] + 500 : 0; p.la[r][s + 16] = p.la[r][s]; p.lb[r][s + 16] = p.lb[r][s]; }
  const par = [{ a: .5, mode: 2 }, { a: .4, b: 1 }, { a: .3, b: .6 }, {}, { a: .3, b: .4 }, { a: .8, b: .4 },
    { a: 21 / 48, b: .7, mix: .8, ma: 1 }, {}, { a: .7, b: .4 }, { a: .35, ma: .6 }, { a: .4, b: .6 }, { a: .3 },
    { b: .45, mix: .8 }, { a: .7, b: .4, mix: .9 }].map(p => Object.assign({ a: .5, b: .5, mix: 1, ma: 0, mb: 0, mode: 0 }, p));
  return { pats, cur: 0, par, nSteps: 16, swing: 0, mix: 1, vol: .8, sel: 9, lane: 'a', page: 0, bars: 2, bpm: 100, nextId: 2000 };
}
try { S = JSON.parse(localStorage.getItem('gridlock-v1')); } catch (e) { S = null; }
if (!S || !S.pats || S.pats.length !== 8) S = defaults();
let saveT = 0;
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem('gridlock-v1', JSON.stringify(S)); } catch (e) {} }, 400); };
const P = () => S.pats[S.cur];

// ---------------- audio ----------------
let ctx = null, node = null, eng = null, sp = null, playing = false, playStep = -1;
let source = { kind: 'demo', L: null, R: null, name: 'Built-in break', dur: 0 };
function send(m) { if (node) node.port.postMessage(m); else if (eng) eng.msg(m); }
const WORKLET_TAIL = `
class GridlockProc extends AudioWorkletProcessor {
  constructor(){ super(); this.e = new Engine(sampleRate); this.e.onStep = s => this.port.postMessage(s);
    this.port.onmessage = ev => this.e.msg(ev.data); }
  process(i, o){ const out = o[0]; this.e.render(out[0], out[1] || out[0], out[0].length); return true; }
}
registerProcessor('gridlock', GridlockProc);`;
async function initAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC({ latencyHint: 'interactive' });
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  try {
    const url = URL.createObjectURL(new Blob([document.getElementById('eng').textContent + WORKLET_TAIL], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    node = new AudioWorkletNode(ctx, 'gridlock', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    node.port.onmessage = e => onStep(e.data);
    node.connect(ctx.destination);
  } catch (err) {
    window._wkErr = String(err && err.message || err);
    node = null; eng = new Engine(ctx.sampleRate); eng.onStep = s => onStep(s);
    sp = ctx.createScriptProcessor(2048, 0, 2);
    sp.onaudioprocess = e => { const o = e.outputBuffer; eng.render(o.getChannelData(0), o.getChannelData(1), o.length); };
    sp.connect(ctx.destination);
  }
  if (source.kind === 'demo') buildDemo(); else sendBuffer();
  sendAll();
}
function buildDemo() { if (!ctx) return; const d = makeDemo(ctx.sampleRate, S.bpm); source.L = d.L; source.R = d.R; sendBuffer(); }
function sendBuffer() { send({ type: 'buffer', L: source.L, R: source.R }); }
function effBpm() { return source.kind === 'demo' ? S.bpm : S.bars * 4 * 60 / source.dur; }
function sendGlobal() { send({ type: 'global', bpm: effBpm(), nSteps: S.nSteps, swing: S.swing * 0.33, mix: S.mix, vol: S.vol }); }
function sendPat() { send({ type: 'pat', grid: P().grid, la: P().la, lb: P().lb }); }
function sendPar(r) { send({ type: 'par', r, p: S.par[r] }); }
function sendAll() { sendGlobal(); for (let r = 0; r < NRW; r++) sendPar(r); sendPat(); }

async function togglePlay() {
  try {
    if (!ctx) await initAudio();
    if (ctx.state !== 'running') await ctx.resume();
  } catch (e) { showErr('Audio could not start: ' + e.message); return; }
  playing = !playing; send({ type: playing ? 'play' : 'stop' });
  if (!playing) { playStep = -1; paintPlayhead(); }
  const b = $('play'); b.textContent = playing ? '■ Stop' : '▶ Play'; b.classList.toggle('stop', playing);
}
function showErr(t) { const e = $('err'); e.textContent = t; e.style.display = 'block'; }

// ---------------- UI ----------------
const $ = id => document.getElementById(id);
const grid = $('grid'); const cellEls = []; const lightEls = []; const rowEls = [];
function buildGrid() {
  ROWS.forEach((row, r) => {
    const rw = document.createElement('div'); rw.className = 'row' + (r === 5 ? ' div' : ''); rw.style.setProperty('--h', row.h);
    const lab = document.createElement('div'); lab.className = 'lab'; lab.innerHTML = `<span class="lt"></span>${row.n}`;
    lab.addEventListener('pointerdown', e => { e.stopPropagation(); S.sel = r; renderSel(); renderPanel(); save(); });
    const cells = document.createElement('div'); cells.className = 'cells'; cellEls[r] = [];
    for (let c = 0; c < 16; c++) { const ce = document.createElement('div'); ce.className = 'cell'; ce.dataset.r = r; ce.dataset.c = c; cells.appendChild(ce); cellEls[r].push(ce); }
    rw.append(lab, cells); grid.appendChild(rw); rowEls.push(rw); lightEls.push(lab.firstChild);
  });
}
function renderGrid() {
  const g = P().grid, off = S.page * 16;
  for (let r = 0; r < NRW; r++) for (let c = 0; c < 16; c++) {
    const s = off + c, id = g[r][s], el = cellEls[r][c];
    let cls = 'cell';
    if (c % 4 === 0) cls += ' q';
    if (s >= S.nSteps) cls += ' off';
    if (id) { cls += ' on'; if (s > 0 && g[r][s - 1] === id && c > 0) cls += ' join'; if (s < MS - 1 && g[r][s + 1] === id && c < 15) cls += ' cont'; }
    if (s === playStep) cls += ' ph';
    el.className = cls;
  }
  renderPats();
}
function renderSel() { rowEls.forEach((el, r) => el.classList.toggle('sel', r === S.sel)); }
function paintPlayhead() {
  const off = S.page * 16, g = P().grid;
  for (let r = 0; r < NRW; r++) {
    for (let c = 0; c < 16; c++) cellEls[r][c].classList.toggle('ph', off + c === playStep);
    lightEls[r].classList.toggle('lit', playStep >= 0 && !!g[r][playStep]);
  }
  laneBars.forEach((b, c) => b.classList.toggle('ph', off + c === playStep));
  if (S.nSteps === 32) { $('pg0').classList.toggle('live', playStep >= 0 && playStep < 16); $('pg1').classList.toggle('live', playStep >= 16); }
}
function onStep(s) { playStep = s; requestAnimationFrame(paintPlayhead); }

// painting
let drag = null;
function cellAt(x, y) { const el = document.elementFromPoint(x, y); return el && el.classList && el.classList.contains('cell') ? el : null; }
grid.addEventListener('pointerdown', e => {
  const el = cellAt(e.clientX, e.clientY); if (!el) return;
  const r = +el.dataset.r, s = S.page * 16 + +el.dataset.c; if (s >= S.nSteps) return;
  const g = P().grid[r];
  if (S.sel !== r) { S.sel = r; renderSel(); renderPanel(); }
  if (g[s]) { const id = g[s]; for (let k = 0; k < MS; k++) if (g[k] === id) g[k] = 0; drag = null; }
  else { drag = { r, s0: s, id: S.nextId++ }; g[s] = drag.id; }
  grid.setPointerCapture(e.pointerId); renderGrid(); sendPat(); save();
});
grid.addEventListener('pointermove', e => {
  if (!drag) return; const el = cellAt(e.clientX, e.clientY); if (!el) return;
  let s = S.page * 16 + +el.dataset.c; s = Math.min(s, S.nSteps - 1);
  const g = P().grid[drag.r];
  for (let k = 0; k < MS; k++) if (g[k] === drag.id) g[k] = 0;
  const a = Math.min(drag.s0, s), b = Math.max(drag.s0, s);
  for (let k = a; k <= b; k++) g[k] = drag.id;
  renderGrid(); sendPat();
});
const endDrag = () => { if (drag) { drag = null; save(); } };
grid.addEventListener('pointerup', endDrag); grid.addEventListener('pointercancel', endDrag);

// patterns
let clip = null;
function renderPats() {
  const el = $('pats'); if (!el.children.length) {
    'ABCDEFGH'.split('').forEach((L, i) => { const b = document.createElement('button'); b.className = 'p'; b.textContent = L;
      b.onclick = () => selPat(i); el.appendChild(b); });
    const sp = document.createElement('span'); sp.className = 'spacer'; el.appendChild(sp);
    [['Chaos', chaos], ['Copy', () => { clip = JSON.parse(JSON.stringify(P())); }], ['Paste', () => { if (clip) { S.pats[S.cur] = JSON.parse(JSON.stringify(clip)); changed(); } }],
     ['Clear', () => { S.pats[S.cur] = blankPat(); changed(); }]].forEach(([t, f]) => { const b = document.createElement('button'); b.textContent = t; b.onclick = f; el.appendChild(b); });
  }
  [...el.querySelectorAll('.p')].forEach((b, i) => { b.classList.toggle('on', i === S.cur); b.classList.toggle('has', S.pats[i].grid.some(row => row.some(v => v))); });
}
function selPat(i) { S.cur = i; changed(); }
function changed() { renderGrid(); renderPanel(); sendPat(); save(); paintPlayhead(); }
function chaos() {
  const p = blankPat(), n = S.nSteps;
  for (let r = 0; r < NRW; r++) {
    const longish = r >= 9 && r !== 12, prob = r <= 5 ? 0.45 : 0.4;
    const blocks = n === 32 ? 2 : 1;
    for (let k = 0; k < blocks; k++) {
      if (Math.random() > prob) continue;
      const len = longish ? 2 + Math.floor(Math.random() * 6) : 1 + Math.floor(Math.random() * (Math.random() < .6 ? 2 : 4));
      const st = Math.floor(Math.random() * (n - len + 1)); if (p.grid[r].slice(st, st + len).some(v => v)) continue;
      const id = S.nextId++; for (let s = st; s < st + len; s++) p.grid[r][s] = id;
    }
    if (Math.random() < 0.3) for (let s = 0; s < MS; s++) p.la[r][s] = Math.random();
  }
  S.pats[S.cur] = p; changed();
}

// panel
let laneBars = [];
function slider(label, val, fmtFn, onv, color) {
  const d = document.createElement('div'); d.className = 'ctl';
  d.innerHTML = `<span>${label}</span><input type="range" min="0" max="1000"><span class="v"></span>`;
  const inp = d.querySelector('input'), v = d.querySelector('.v');
  if (color) inp.style.setProperty('--hc', color);
  inp.value = Math.round(val * 1000); v.textContent = fmtFn(val);
  inp.oninput = () => { const x = inp.value / 1000; v.textContent = fmtFn(x); onv(x); };
  return d;
}
function renderPanel() {
  const r = S.sel, row = ROWS[r], p = S.par[r], el = $('panel'); el.innerHTML = '';
  el.style.setProperty('--h', row.h); const col = `hsl(${row.h} 85% 60%)`;
  const h = document.createElement('h3'); h.innerHTML = `<span class="dot"></span>${row.n}`;
  const sp = document.createElement('span'); sp.className = 'spacer'; h.appendChild(sp);
  const clr = document.createElement('button'); clr.textContent = 'Clear row'; clr.onclick = () => { P().grid[r].fill(0); changed(); }; h.appendChild(clr);
  el.appendChild(h);
  if (row.modes) { const m = document.createElement('div'); m.className = 'line'; m.style.marginTop = '8px'; const seg = document.createElement('span'); seg.className = 'seg';
    row.modes.forEach((t, i) => { const b = document.createElement('button'); b.textContent = t; if (p.mode === i) b.classList.add('on');
      b.onclick = () => { p.mode = i; sendPar(r); renderPanel(); save(); }; seg.appendChild(b); });
    m.appendChild(seg); el.appendChild(m); }
  const set = k => x => { p[k] = x; sendPar(r); save(); };
  el.appendChild(slider(row.a, p.a, x => fmt(r, 'a', x), set('a'), col));
  el.appendChild(slider(row.b, p.b, x => fmt(r, 'b', x), set('b'), col));
  el.appendChild(slider('Mix', p.mix, x => fmt(r, 'mix', x), set('mix'), col));
  // mod lanes
  const tabs = document.createElement('div'); tabs.className = 'modtabs';
  ['a', 'b'].forEach(k => { const b = document.createElement('button'); b.textContent = 'Mod ' + row[k]; if (S.lane === k) b.classList.add('on');
    b.onclick = () => { S.lane = k; renderPanel(); save(); }; tabs.appendChild(b); });
  el.appendChild(tabs);
  const mk = 'm' + S.lane, lane = S.lane === 'a' ? P().la[r] : P().lb[r];
  el.appendChild(slider('Depth', (p[mk] + 1) / 2, x => { const d = Math.round((x * 2 - 1) * 100); return (d > 0 ? '+' : '') + d + '%'; }, x => { p[mk] = x * 2 - 1; sendPar(r); save(); }, col));
  const ln = document.createElement('div'); ln.className = 'lane'; laneBars = [];
  for (let c = 0; c < 16; c++) { const b = document.createElement('div'); b.className = 'bar'; const f = document.createElement('div'); f.className = 'f';
    b.appendChild(f); ln.appendChild(b); laneBars.push(b); }
  const drawLane = () => laneBars.forEach((b, c) => { const s = S.page * 16 + c; b.firstChild.style.height = (lane[s] * 100) + '%'; b.style.opacity = s < S.nSteps ? 1 : .25; });
  drawLane();
  let down = false;
  const setAt = e => { const rc = ln.getBoundingClientRect(); const c = Math.max(0, Math.min(15, Math.floor((e.clientX - rc.left) / rc.width * 16)));
    const v = Math.max(0, Math.min(1, 1 - (e.clientY - rc.top) / rc.height)); lane[S.page * 16 + c] = v; drawLane(); sendPat(); };
  ln.addEventListener('pointerdown', e => { down = true; ln.setPointerCapture(e.pointerId); setAt(e); });
  ln.addEventListener('pointermove', e => { if (down) setAt(e); });
  ln.addEventListener('pointerup', () => { down = false; save(); });
  el.appendChild(ln);
  const foot = document.createElement('div'); foot.className = 'line'; foot.style.marginTop = '6px';
  foot.innerHTML = `<span class="hint">Lane adds to ${row[S.lane]} per step, scaled by Depth.</span><span class="spacer"></span>`;
  const lc = document.createElement('button'); lc.textContent = 'Flatten lane'; lc.onclick = () => { lane.fill(0); drawLane(); sendPat(); save(); }; foot.appendChild(lc);
  el.appendChild(foot);
  paintPlayhead();
}

// transport + master
function renderTransport() {
  $('bpmV').textContent = S.bpm;
  $('s16').classList.toggle('on', S.nSteps === 16); $('s32').classList.toggle('on', S.nSteps === 32);
  $('pager').style.display = S.nSteps === 32 ? 'flex' : 'none';
  $('pg0').classList.toggle('on', S.page === 0); $('pg1').classList.toggle('on', S.page === 1);
  const demo = source.kind === 'demo';
  $('bDemo').classList.toggle('on', demo); $('bLoad').classList.toggle('on', !demo);
  $('tempoCtl').style.display = demo ? 'flex' : 'none'; $('barsCtl').style.display = demo ? 'none' : 'flex';
  $('srcname').textContent = source.name;
  const seg = $('barsSeg'); if (!seg.children.length) [1, 2, 4, 8].forEach(n => { const b = document.createElement('button'); b.textContent = n; b.dataset.n = n;
    b.onclick = () => { S.bars = n; sendGlobal(); renderTransport(); save(); }; seg.appendChild(b); });
  [...seg.children].forEach(b => b.classList.toggle('on', +b.dataset.n === S.bars));
  if (!demo) $('bpmCalc').textContent = '→ ' + effBpm().toFixed(1) + ' BPM';
}
let demoT = 0;
const bump = d => { S.bpm = Math.max(60, Math.min(180, S.bpm + d)); renderTransport(); sendGlobal(); clearTimeout(demoT); demoT = setTimeout(buildDemo, 250); save(); };
$('bpmDn').onclick = () => bump(-2); $('bpmUp').onclick = () => bump(2);
$('s16').onclick = () => { S.nSteps = 16; S.page = 0; sendGlobal(); renderTransport(); renderGrid(); renderPanel(); save(); };
$('s32').onclick = () => { S.nSteps = 32; sendGlobal(); renderTransport(); renderGrid(); renderPanel(); save(); };
$('pg0').onclick = () => { S.page = 0; renderTransport(); renderGrid(); renderPanel(); };
$('pg1').onclick = () => { S.page = 1; renderTransport(); renderGrid(); renderPanel(); };
$('bDemo').onclick = () => { source = { kind: 'demo', name: 'Built-in break', L: null, R: null, dur: 0 }; buildDemo(); sendGlobal(); renderTransport(); };
$('bLoad').onclick = () => $('file').click();
$('file').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    if (!ctx) await initAudio();
    const ab = await f.arrayBuffer();
    const buf = await new Promise((res, rej) => { const p = ctx.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
    const L = buf.getChannelData(0).slice(), R = (buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)).slice();
    source = { kind: 'file', name: f.name, L, R, dur: buf.duration };
    let bars = S.bars; const bpmFor = n => n * 240 / buf.duration;
    if (bpmFor(bars) < 70 || bpmFor(bars) > 190) { bars = [1, 2, 4, 8].reduce((best, n) => Math.abs(bpmFor(n) - 120) < Math.abs(bpmFor(best) - 120) ? n : best, 1); }
    S.bars = bars; sendBuffer(); sendGlobal(); renderTransport(); save();
  } catch (err) { showErr("Couldn't decode that file: " + (err && err.message || err)); }
  e.target.value = '';
};
$('play').onclick = togglePlay;
function masterSl(id, key, fmtFn) {
  const inp = $(id), v = $(id + 'V'); inp.value = Math.round(S[key] * 1000); v.textContent = fmtFn(S[key]);
  inp.oninput = () => { S[key] = inp.value / 1000; v.textContent = fmtFn(S[key]); sendGlobal(); save(); };
}
masterSl('mMix', 'mix', x => Math.round(x * 100) + '% wet'); masterSl('mSw', 'swing', x => Math.round(x * 100) + '%'); masterSl('mVol', 'vol', x => Math.round(x * 100) + '%');
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  const n = parseInt(e.key, 10); if (n >= 1 && n <= 8) selPat(n - 1);
});

buildGrid(); renderSel(); renderTransport(); renderGrid(); renderPanel();
