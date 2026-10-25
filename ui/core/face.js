// usagi's face. Two eye states (closed: the "= ㅅ =" peek, open: "• ㅅ •"),
// a mouth, and motion. Modules don't draw the face; they ask for reactions
// and the core blends them every frame:
//
//   bounce(ms)       hop up and down for ms        (attention / ding)
//   nod(ms, depth)   dip down briefly              (acknowledge input; deeper for a "yes")
//   shake(ms)        slide side to side            ("no")
//   tilt(deg)        hold a tilt until changed     (ticking, curiosity)
//   sing(ms)         open the mouth, closing over ms (alarm chime)
//   blink(times)     blink now                     (puzzled)
//   think(ms)        "…" between the ears          (pondering; only seen when he's out in full)
//
// The open eyes also blink on their own every few seconds, sometimes twice.
//
// The audio is set by the core from system audio: kick bobs the head. Vocal is
// kept for modules to read but doesn't move the mouth; only sing() does.
//
//   setAudio(kick, vocal)  0..1 each

const TONGUE = '#E0606A';
const BLINK_MS = 150;
// Open eyes are circles drawn as fully rounded squares, so a blink can shrink
// their height and keep the ends round. Squashing a circle instead leaves a
// pointed lens whose tips smear into stray pixels at the eyes' sides.
const EYE = 15.5556;
const nextBlink = (now) => now + 5000 + Math.random() * 7000;

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
  <rect class="eye" x="0" y="0" width="15.5556" height="15.5556" rx="7.77778"/>
  <rect class="eye" x="54.4443" y="0" width="15.5556" height="15.5556" rx="7.77778"/>
</svg><span class="thought" aria-hidden="true"><i></i><i></i><i></i></span>`;

export function createFace() {
  const wraps = [];
  const tongues = [];
  const eyes = [];
  const s = { bounceUntil: 0, nodUntil: 0, nodDepth: 2.2, shakeAt: 0, shakeMs: 0, tilt: 0, singAt: 0, singMs: 0, thinkUntil: 0, kick: 0, vocal: 0 };
  let blinkAt = nextBlink(performance.now());
  let twice = false;
  let extraBlinks = 0;
  let lastTransform = '';
  let lastThink = false;
  let lastMouth = '';
  let lastEyes = '';

  return {
    mount(el, variant) {
      el.classList.add('face');
      el.innerHTML = variant === 'open' ? OPEN : CLOSED;
      wraps.push(el);
      tongues.push(el.querySelector('.tongue'));
      eyes.push(...el.querySelectorAll('.eye'));
    },
    bounce(ms = 1500) { s.bounceUntil = Math.max(s.bounceUntil, performance.now() + ms); },
    nod(ms = 160, depth = 2.2) { s.nodUntil = performance.now() + ms; s.nodDepth = depth; },
    shake(ms = 800) { s.shakeAt = performance.now(); s.shakeMs = ms; },
    tilt(deg = 0) { s.tilt = deg; },
    sing(ms = 600) { s.singAt = performance.now(); s.singMs = ms; },
    blink(times = 1) { blinkAt = performance.now(); extraBlinks = times - 1; },
    think(ms = 1500) { s.thinkUntil = performance.now() + ms; },
    setAudio(kick, vocal) { s.kick = kick; s.vocal = vocal; },
    get kick() { return s.kick; },
    get vocal() { return s.vocal; },

    frame(now) {
      let y = -s.kick * 3.2;
      if (now < s.nodUntil) y += s.nodDepth;
      if (now < s.bounceUntil) y -= Math.abs(Math.sin(now / 110)) * 5;
      // Shake: three side-to-side swings that die down.
      const k = (now - s.shakeAt) / s.shakeMs;
      const x = k >= 0 && k < 1 ? Math.sin(k * Math.PI * 6) * 7 * (1 - k) : 0;
      const scale = 1 + s.kick * 0.06;
      const t = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${scale.toFixed(3)}) rotate(${s.tilt}deg)`;
      if (t !== lastTransform) {
        lastTransform = t;
        for (const el of wraps) el.style.transform = t;
      }
      const thinking = now < s.thinkUntil;
      if (thinking !== lastThink) {
        lastThink = thinking;
        for (const el of wraps) el.classList.toggle('thinking', thinking);
      }
      // Mouth: hidden when quiet, pops open from under the ㅅ on sing() and eases shut.
      const p = (now - s.singAt) / s.singMs;
      const v = p >= 0 && p < 1 ? (1 - p) ** 2 : 0;
      const opacity = Math.min(1, v * 3).toFixed(2);
      const open = `scaleY(${(0.35 + 0.65 * v).toFixed(2)})`;
      if (opacity + open !== lastMouth) {
        lastMouth = opacity + open;
        for (const el of tongues) {
          el.style.opacity = opacity;
          el.style.transform = open;
        }
      }
      // Blink: close the eyes to a rounded dash and back; one in five is a double blink.
      if (now >= blinkAt + BLINK_MS) {
        if (extraBlinks > 0) { extraBlinks -= 1; twice = true; blinkAt = now + 90; }
        else { twice = !twice && Math.random() < 0.2; blinkAt = twice ? now + 90 : nextBlink(now); }
      }
      const b = (now - blinkAt) / BLINK_MS;
      const lidH = b >= 0 && b < 1 ? EYE * (1 - 0.88 * Math.sin(Math.PI * b)) : EYE;
      const lid = lidH.toFixed(2);
      if (lid !== lastEyes) {
        lastEyes = lid;
        for (const el of eyes) {
          el.setAttribute('y', ((EYE - lidH) / 2).toFixed(2));
          el.setAttribute('height', lid);
          el.setAttribute('rx', (lidH / 2).toFixed(2));
        }
      }
    },
  };
}
