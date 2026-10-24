// Media — now playing, transport controls, and a volume rail on the left.

import { icons } from '../../core/icons.js';

export default {
  id: 'media',
  name: 'Media',
  description: 'Now playing, transport controls and system volume',
  icon: icons.note,
  order: 1,
  styles: true,

  create(ctx) {
    const { h, icons, system, face } = ctx;
    let current = { available: false, playing: false };

    // ---- main panel ----
    const art = h('div', { class: 'm-art', html: icons.note, 'aria-hidden': 'true' });
    const title = h('div', { class: 'm-title' }, 'Nothing playing');
    const artist = h('div', { class: 'm-artist' }, '');
    const playBtn = h('button', { class: 'btn-round', 'aria-label': 'Play', onclick: () => command('toggle') });
    const prevBtn = h('button', { class: 'btn-ghost', 'aria-label': 'Previous track', html: icons.prev, onclick: () => command('prev') });
    const nextBtn = h('button', { class: 'btn-ghost', 'aria-label': 'Next track', html: icons.next, onclick: () => command('next') });

    const el = h('div', { class: 'm-root' },
      art,
      h('div', { class: 'm-meta' }, title, artist),
      h('div', { class: 'm-controls' }, prevBtn, playBtn, nextBtn));

    // ---- left rail: volume ----
    const fill = h('div', { class: 'vslider-fill' });
    const input = h('input', { type: 'range', min: '0', max: '100', value: '50', 'aria-label': 'Volume' });
    const rail = h('div', { class: 'm-vol' },
      h('span', { class: 'rail-icon', html: icons.speaker }),
      h('div', { class: 'vslider' }, fill, input));

    let sendTimer = 0;
    function setVolumeUI(pct) {
      input.value = String(pct);
      fill.style.setProperty('--value', `${pct}%`);
    }
    function setVolume(pct) {
      pct = Math.max(0, Math.min(100, Math.round(pct)));
      setVolumeUI(pct);
      clearTimeout(sendTimer);
      sendTimer = setTimeout(() => system.volume?.set(pct / 100), 30);
    }
    input.addEventListener('input', () => setVolume(+input.value));
    rail.addEventListener('wheel', (e) => {
      e.stopPropagation(); // don't switch modules
      setVolume(+input.value + (e.deltaY < 0 ? 4 : -4));
    }, { passive: true });

    // ---- state ----
    function render(m) {
      const available = !!m?.available;
      title.textContent = available ? (m.title || 'Unknown title') : 'Nothing playing';
      artist.textContent = available ? (m.artist || '') : '';
      playBtn.innerHTML = m?.playing ? icons.pause : icons.play;
      playBtn.setAttribute('aria-label', m?.playing ? 'Pause' : 'Play');
      if (m?.thumbnail) {
        art.style.backgroundImage = `url("${m.thumbnail}")`;
        art.classList.add('has-art');
      } else {
        art.style.backgroundImage = '';
        art.classList.remove('has-art');
      }
      [playBtn, prevBtn, nextBtn].forEach((b) => { b.disabled = !available; });
    }

    function update(m) {
      if (m?.playing && !current.playing) face.flash(600);       // music started: delighted
      if (m?.available && current.available && m.title !== current.title) face.nod(200); // new track
      current = m || { available: false, playing: false };
      render(current);
    }

    async function command(cmd) {
      face.flash(450);
      if (cmd === 'toggle') update({ ...current, playing: !current.playing }); // optimistic
      try { await system.media?.command(cmd); } catch {}
    }

    const off = system.media?.onChange(update);
    system.media?.get().then(update).catch(() => {});
    render(current);

    return {
      el,
      rail,
      show() { system.volume?.get().then((v) => setVolumeUI(Math.round((v ?? 0.5) * 100))).catch(() => {}); },
      destroy() { off?.(); clearTimeout(sendTimer); },
    };
  },
};
