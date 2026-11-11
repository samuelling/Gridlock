# Gridlock

A step-sequenced multi-effect for the browser, in the spirit of Sugar Bytes' Effectrix. Paint effect blocks on a 16/32-step grid over a loop and the effects fire in time.

**Play it:** https://samuelling.github.io/gridlock/

## Effects
Buffer effects (these move the read head; when blocks overlap, the lower row wins):
X-Loop · Loop · Scratch · Reverse · Stretch · Vinyl

Effects the audio passes through:
Tonal Delay · Stutter · Crush · Filter · Phaser · Chorus · Delay · Reverb
(Delay, Reverb and Tonal Delay are send-style and keep ringing after their block ends.)

Each effect has two parameters, a mix, a mode where relevant, and two per-step modulation lanes with depth.
You also get 8 pattern slots, Chaos, Copy/Paste, swing, a built-in synthesized break, or load your own loop.

## Layout
- `src/engine.js`: the DSP engine. A single `Engine` class runs in an AudioWorklet, with a ScriptProcessor fallback.
- `src/demo.js`: generates the built-in 2-bar breakbeat.
- `src/main.js`: the UI and state, saved to localStorage.
- `src/shell.html`: the markup and CSS.
- `build.py`: inlines `src/` into the single-file `index.html` (run it after editing).
