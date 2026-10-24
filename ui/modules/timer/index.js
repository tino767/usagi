// Timer — a countdown with presets. Keeps running while usagi is closed;
// when it finishes he peeks out and bounces.

import { icons } from '../../core/icons.js';

const PRESETS = [5, 15, 25];
const MAX = 99 * 60;
const RING_MS = 1400;  // one chime (~0.8s) plus a beat of silence

export default {
  id: 'timer',
  name: 'Timer',
  description: 'Countdown with quick presets',
  icon: icons.timer,
  order: 2,
  styles: true,

  create(ctx) {
    const { h, face, island, store } = ctx;
    let total = store.get('total', 300);
    let endAt = 0;          // epoch ms while running
    let left = total;       // seconds while paused
    let loop = 0;
    let alarm = 0;          // interval while the alarm rings

    const status = h('span', { class: 'eyebrow' });
    const time = h('span', { class: 't-time' });
    const playBtn = h('button', { class: 'btn-round', onclick: toggle });
    const bar = h('div', { class: 't-bar-fill' });
    const chips = PRESETS.map((m) => h('button', { class: 'chip', 'aria-label': `Set ${m} minutes`, onclick: () => preset(m) }, `${m}m`));

    const el = h('div', { class: 't-root' },
      h('div', { class: 't-top' },
        h('div', { class: 't-readout' }, status, time),
        h('div', { class: 't-controls' },
          h('button', { class: 'chip t-step', 'aria-label': 'Remove one minute', onclick: () => bump(-60) }, '−1m'),
          playBtn,
          h('button', { class: 'chip t-step', 'aria-label': 'Add one minute', onclick: () => bump(60) }, '+1m'),
          h('button', { class: 'btn-ghost t-reset', 'aria-label': 'Reset timer', html: icons.reset, onclick: reset }))),
      h('div', { class: 't-bottom' }, ...chips, h('div', { class: 't-bar', 'aria-hidden': 'true' }, bar)));

    const running = () => endAt > 0;
    const remaining = () => (running() ? Math.max(0, (endAt - Date.now()) / 1000) : left);

    function render() {
      const r = remaining();
      const secs = Math.ceil(r);
      time.textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
      status.textContent = running() ? 'Running' : r <= 0 ? "Time's up" : r >= total ? 'Ready' : 'Paused';
      playBtn.innerHTML = alarm ? icons.stop : running() ? icons.pause : icons.play;
      playBtn.setAttribute('aria-label', alarm ? 'Stop alarm' : running() ? 'Pause timer' : 'Start timer');
      playBtn.classList.toggle('t-ringing', !!alarm);
      island.status(running() ? time.textContent : null);
      bar.style.width = `${Math.min(100, (1 - r / total) * 100)}%`;
      chips.forEach((c, i) => c.setAttribute('aria-pressed', String(total === PRESETS[i] * 60)));
    }

    function tick() {
      const r = remaining();
      if (r <= 0) return finish();
      face.tilt(Math.ceil(r) % 2 ? 3 : -3); // tick-tock
      render();
    }

    function start() {
      if (left <= 0) left = total;
      endAt = Date.now() + left * 1000;
      face.nod();
      clearInterval(loop);
      loop = setInterval(tick, 250);
      tick();
    }
    function pause() {
      silence();
      left = remaining();
      endAt = 0;
      clearInterval(loop);
      face.tilt(0);
      render();
    }
    function toggle() {
      if (alarm) { silence(); left = total; render(); return; }
      running() ? pause() : start();
    }
    function reset() { pause(); left = total; render(); }
    function preset(min) { pause(); total = left = min * 60; store.set('total', total); render(); }
    function bump(d) {
      silence();
      const wasFull = remaining() >= total;
      total = Math.max(60, Math.min(MAX, total + d));
      store.set('total', total);
      if (running()) endAt = Math.max(Date.now(), endAt + d * 1000);
      else left = wasFull ? total : Math.max(0, Math.min(total, left + d));
      render();
    }

    function finish() {
      clearInterval(loop);
      endAt = 0;
      left = 0;
      face.tilt(0);
      // Ring until the play/pause button (or reset / a preset) stops it.
      // The mouth opens on each of the chime's two notes.
      const ring = () => {
        face.bounce(RING_MS);
        island.attention(RING_MS + 200);
        chime();
        face.sing();
        setTimeout(() => alarm && face.sing(), 180);
      };
      ring();
      alarm = setInterval(ring, RING_MS);
      render();
    }
    function silence() { clearInterval(alarm); alarm = 0; }

    render();
    return {
      el,
      destroy() { clearInterval(loop); silence(); face.tilt(0); island.status(null); },
    };
  },
};

function chime() {
  try {
    const ac = new AudioContext();
    [[987.77, 0], [1318.51, 0.18]].forEach(([freq, at]) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      const t = ac.currentTime + at;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      osc.connect(gain).connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.65);
    });
    setTimeout(() => ac.close(), 1200);
  } catch {}
}
