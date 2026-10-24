// usagi's face. Two eye states (closed: the "= ㅅ =" peek, open: "• ㅅ •"),
// a mouth, and motion. Modules don't draw the face; they ask for reactions
// and the core blends them every frame:
//
//   bounce(ms)  hop up and down for ms        (attention / ding)
//   nod(ms)     dip down briefly              (acknowledge input)
//   tilt(deg)   hold a tilt until changed     (ticking, curiosity)
//
// The audio is set by the core from system audio: kick bobs the head, vocal
// opens the mouth. Nothing else opens the mouth.
//
//   setAudio(kick, vocal)  0..1 each

const TONGUE = '#E0606A';

const CLOSED = `
<svg viewBox="0 0 90 20" fill="currentColor" aria-hidden="true">
  <path class="tongue" fill="${TONGUE}" d="M40 12.6Q40 19.6 45 19.6Q50 19.6 50 12.6L45 10.8Z"/>
  <path d="M59.8898 13.1926C60.0658 12.657 59.7615 12.0819 59.2231 11.9145C51.5666 9.53482 48.8318 7.25976 48.251 2.22395C48.1904 1.69907 47.7572 1.28571 47.2288 1.28571H42.7712C42.2428 1.28571 41.8096 1.69907 41.749 2.22395C41.1682 7.25976 38.4334 9.53482 30.7769 11.9145C30.2385 12.0819 29.9342 12.657 30.1102 13.1926L31.38 17.0562C31.5516 17.5784 32.1156 17.8638 32.6377 17.6918C38.9335 15.618 41.8858 14.0823 44.1339 11.4146C44.5802 10.885 45.4198 10.885 45.8661 11.4146C48.1142 14.0823 51.0665 15.618 57.3623 17.6918C57.8844 17.8638 58.4484 17.5784 58.62 17.0562L59.8898 13.1926Z"/>
  <path d="M69.7183 1C69.7183 0.447714 70.166 0 70.7183 0H89C89.5523 0 90 0.447715 90 1V4.78572C90 5.338 89.5523 5.78571 89 5.78571H70.7183C70.166 5.78571 69.7183 5.338 69.7183 4.78571V1Z"/>
  <path d="M0 12.5714C0 12.0191 0.447715 11.5714 1 11.5714H19.2817C19.834 11.5714 20.2817 12.0191 20.2817 12.5714V16.3571C20.2817 16.9094 19.834 17.3571 19.2817 17.3571H1C0.447715 17.3571 0 16.9094 0 16.3571V12.5714Z"/>
  <path d="M0 1C0 0.447714 0.447715 0 1 0H19.2817C19.834 0 20.2817 0.447715 20.2817 1V4.78572C20.2817 5.338 19.834 5.78571 19.2817 5.78571H1C0.447715 5.78571 0 5.338 0 4.78571V1Z"/>
  <path d="M69.7183 12.5714C69.7183 12.0191 70.166 11.5714 70.7183 11.5714H89C89.5523 11.5714 90 12.0191 90 12.5714V16.3571C90 16.9094 89.5523 17.3571 89 17.3571H70.7183C70.166 17.3571 69.7183 16.9094 69.7183 16.3571V12.5714Z"/>
</svg>`;

const OPEN = `
<svg viewBox="0 0 70 18" fill="currentColor" aria-hidden="true">
  <path class="tongue" fill="${TONGUE}" d="M31 11.2Q31 17.6 35 17.6Q39 17.6 39 11.2L35 9.55Z"/>
  <path d="M46.8309 11.0557C39.9111 9.00423 37.7493 7.16498 37.4647 2.55566H32.5351C32.2506 7.16498 30.0888 9.00423 23.1689 11.0557L24.6478 15.5557C30.7417 13.5972 33.0627 12.3121 34.9999 9.55566C36.9372 12.3121 39.2582 13.5972 45.352 15.5557L46.8309 11.0557Z"/>
  <circle cx="7.77778" cy="7.77778" r="7.77778"/>
  <circle cx="62.2221" cy="7.77778" r="7.77778"/>
</svg>`;

export function createFace() {
  const wraps = [];
  const tongues = [];
  const s = { bounceUntil: 0, nodUntil: 0, tilt: 0, kick: 0, vocal: 0 };
  let lastTransform = '';
  let lastMouth = '';

  return {
    mount(el, variant) {
      el.classList.add('face');
      el.innerHTML = variant === 'open' ? OPEN : CLOSED;
      wraps.push(el);
      tongues.push(el.querySelector('.tongue'));
    },
    bounce(ms = 1500) { s.bounceUntil = Math.max(s.bounceUntil, performance.now() + ms); },
    nod(ms = 160) { s.nodUntil = performance.now() + ms; },
    tilt(deg = 0) { s.tilt = deg; },
    setAudio(kick, vocal) { s.kick = kick; s.vocal = vocal; },
    get kick() { return s.kick; },
    get vocal() { return s.vocal; },

    frame(now) {
      let y = -s.kick * 3.2;
      if (now < s.nodUntil) y += 2.2;
      if (now < s.bounceUntil) y -= Math.abs(Math.sin(now / 110)) * 5;
      const scale = 1 + s.kick * 0.06;
      const t = `translateY(${y.toFixed(2)}px) scale(${scale.toFixed(3)}) rotate(${s.tilt}deg)`;
      if (t !== lastTransform) {
        lastTransform = t;
        for (const el of wraps) el.style.transform = t;
      }
      // Mouth: hidden when quiet, grows down from under the ㅅ as the voice swells.
      const v = s.vocal < 0.06 ? 0 : s.vocal;
      const opacity = Math.min(1, v * 3).toFixed(2);
      const open = `scaleY(${(0.35 + 0.65 * v).toFixed(2)})`;
      if (opacity + open !== lastMouth) {
        lastMouth = opacity + open;
        for (const el of tongues) {
          el.style.opacity = opacity;
          el.style.transform = open;
        }
      }
    },
  };
}
