import React, { useEffect, useRef, useState } from 'react';

/** Current effective theme, and a hook that re-fires when it changes. */
export function effectiveTheme() {
  const set = document.documentElement.getAttribute('data-theme');
  if (set === 'dark' || set === 'light') return set;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setTheme] = useState(() =>
    typeof document === 'undefined' ? 'light' : effectiveTheme());
  useEffect(() => {
    const sync = () => setTheme(effectiveTheme());
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', sync);
    return () => { mo.disconnect(); mq.removeEventListener?.('change', sync); };
  }, []);
  return theme;
}

/**
 * The signature element.
 *
 * A field of short angled dashes — flight vectors on an ops screen. They hold a
 * calm drift until the pointer enters, then DEFLECT around it: each vector inside
 * the influence radius slides outward and swings tangential, then eases back once
 * the pointer passes.
 *
 * That is the product thesis rendered as background. The pointer is a disruption;
 * routes bend around it and re-form. Nothing is lost, everything re-routes.
 *
 * Honours prefers-reduced-motion by rendering the field once, statically, with no
 * pointer reaction and no animation frame loop at all.
 */
export function VectorField({ density = 0.00046, radius = 200 }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let vectors = [];
    let raf = 0;
    let w = 0, h = 0, dpr = 1;
    const pointer = { x: -9999, y: -9999, active: false };

    const isDark = () => {
      const set = document.documentElement.getAttribute('data-theme');
      if (set === 'dark') return true;
      if (set === 'light') return false;
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    };

    function build() {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width; h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const target = Math.round(w * h * density);
      const count = Math.max(60, Math.min(target, 900));
      const cols = Math.ceil(Math.sqrt(count * (w / h)));
      const rows = Math.ceil(count / cols);
      const cw = w / cols, ch = h / rows;

      vectors = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // jittered grid — regular enough to read as a field, irregular enough
          // not to read as a pattern
          const jx = (Math.sin(r * 12.9898 + c * 78.233) * 43758.5453) % 1;
          const jy = (Math.sin(c * 39.3468 + r * 11.135) * 24634.6345) % 1;
          const x = c * cw + cw * (0.5 + jx * 0.42);
          const y = r * ch + ch * (0.5 + jy * 0.42);
          if (x > w || y > h) continue;
          const base = -0.62 + jx * 0.34;            // baseline heading, up-right
          vectors.push({ x, y, hx: x, hy: y, a: base, base, len: 7 + jy * 7 });
        }
      }
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);
      const dark = isDark();

      for (const v of vectors) {
        let tx = v.x, ty = v.y, ta = v.base, boost = 0;

        if (pointer.active) {
          const dx = v.x - pointer.x;
          const dy = v.y - pointer.y;
          const d = Math.hypot(dx, dy);
          if (d < radius && d > 0.001) {
            const f = 1 - d / radius;            // 0 at the rim, 1 at the centre
            const push = f * f * 34;
            tx = v.x + (dx / d) * push;
            ty = v.y + (dy / d) * push;
            ta = Math.atan2(dy, dx) + Math.PI / 2; // swing tangential
            boost = f;
          }
        }

        // ease — the deflection should feel like water, not like a switch
        v.hx += (tx - v.hx) * 0.14;
        v.hy += (ty - v.hy) * 0.14;
        let da = ta - v.a;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        v.a += da * 0.12;

        // Hue graded across the field: cool blue at the origin, amber downstream.
        // Cool is departure, amber is a flight in trouble — the accent colour the
        // whole system is built around, so the field resolves into the brand.
        const t = (v.hx / w) * 0.58 + (v.hy / h) * 0.42;
        // Travel the hue wheel the LONG way — blue → violet → rose → amber —
        // rather than the short way, which would pass through green. Green is a
        // semantic colour here (outcome A, recovered on time) and background
        // texture must never borrow it.
        const hue = (252 + t * 178) % 360;           // 252 → 300 → 350 → 70
        const L = dark ? 58 + boost * 24 : 56 + boost * 16;
        const C = dark ? 0.115 + boost * 0.075 : 0.105 + boost * 0.065;
        const alpha = (dark ? 0.42 : 0.32) + boost * 0.48;

        const half = (v.len + boost * 5) / 2;
        const cos = Math.cos(v.a), sin = Math.sin(v.a);
        ctx.beginPath();
        ctx.moveTo(v.hx - cos * half, v.hy - sin * half);
        ctx.lineTo(v.hx + cos * half, v.hy + sin * half);
        ctx.strokeStyle = `oklch(${L}% ${C.toFixed(3)} ${hue.toFixed(1)} / ${alpha.toFixed(3)})`;
        ctx.lineWidth = 1.6 + boost * 0.9;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    }

    function loop() { draw(); raf = requestAnimationFrame(loop); }

    const onMove = (e) => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true; };
    const onLeave = () => { pointer.active = false; };
    const onResize = () => { build(); if (reduce) draw(); };

    build();
    if (reduce) {
      draw();                       // one static frame, no loop, no pointer
    } else {
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerleave', onLeave);
      loop();
    }
    window.addEventListener('resize', onResize);

    const mo = new MutationObserver(() => { if (reduce) draw(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('resize', onResize);
      mo.disconnect();
    };
  }, [density, radius]);

  return <canvas className="vfield" ref={ref} aria-hidden="true" />;
}
