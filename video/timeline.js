/**
 * Shared timeline for the Payback.ai demo film.
 *
 * Determinism contract: every scene exposes `window.seek(t)` and NOTHING on screen may depend on wall
 * clock time. No CSS animations, no transitions, no requestAnimationFrame, no `Date.now()`. `seek(t)`
 * is a pure function t -> DOM state, so the same t always screenshots to the same frame. That is what
 * makes the output smooth: the motion is computed from the frame index, not sampled from a live page.
 *
 * Classic script on purpose (no modules), so it loads over file:// in headless Chrome.
 */
(function () {
  "use strict";

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  /** Normalised progress of t through [a, b], clamped to [0, 1]. */
  const prog = (t, a, b) => clamp((t - a) / (b - a || 1), 0, 1);
  const smooth = (t) => {
    const x = clamp(t, 0, 1);
    return x * x * (3 - 2 * x);
  };
  const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const easeInOut = (t) => {
    const x = clamp(t, 0, 1);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  };
  /** Fade in over `in_` seconds, hold, fade out over `out` seconds, inside [a, b]. */
  const pulse = (t, a, b, in_, out_) => {
    const x = prog(t, a, b);
    const rise = Math.min(1, x / (in_ || 0.001));
    const fall = Math.min(1, (1 - x) / (out_ || 0.001));
    return smooth(Math.min(rise, fall));
  };

  const CAPTION_MS = 0.001;

  function injectStyles() {
    if (document.getElementById("pb-styles")) return;
    const style = document.createElement("style");
    style.id = "pb-styles";
    style.textContent = `
      /* Nothing on screen may animate on its own: the timeline owns every value. */
      *, *::before, *::after { animation: none !important; transition: none !important; }

      :root {
        --ink: #ececf2;
        --muted: #a0a0b0;
        --subtle: #85859a;
        --accent: #2dd4bf;
        --violet: #8b5cf6;
        --blue: #3b82f6;
        --gold: #fbbf24;
        --warn: #fbbf24;
        --bad: #f87171;
        --ok: #34d399;
        --grad: linear-gradient(90deg, #8b5cf6, #3b82f6, #2dd4bf);
        --mono: "SF Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        --sans: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
      }

      html, body { margin: 0; padding: 0; width: 1920px; height: 1080px; overflow: hidden; background: #07060f; }
      body { font-family: var(--sans); color: var(--ink); -webkit-font-smoothing: antialiased; }

      .pb-bg {
        position: fixed; inset: 0; z-index: 0;
        background:
          radial-gradient(1150px 820px at var(--gx, 30%) var(--gy, 25%), rgba(139, 92, 246, 0.22), transparent 62%),
          radial-gradient(980px 760px at var(--hx, 78%) var(--hy, 72%), rgba(45, 212, 191, 0.13), transparent 62%),
          radial-gradient(1400px 900px at 50% 118%, rgba(59, 130, 246, 0.16), transparent 66%),
          linear-gradient(158deg, #07060f 0%, #0c0a1d 46%, #1b1640 100%);
      }
      .pb-grid {
        position: fixed; inset: 0; z-index: 1; opacity: .30; pointer-events: none;
        background-image: linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px),
                          linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px);
        background-size: 64px 64px;
        mask-image: radial-gradient(1200px 800px at 50% 45%, #000 25%, transparent 78%);
        -webkit-mask-image: radial-gradient(1200px 800px at 50% 45%, #000 25%, transparent 78%);
      }
      .pb-vignette {
        position: fixed; inset: 0; z-index: 2; pointer-events: none;
        background: radial-gradient(1400px 900px at 50% 45%, transparent 45%, rgba(3,2,8,.72) 100%);
      }
      .pb-layer { position: fixed; z-index: 5; }

      /* ── chrome ───────────────────────────────────────────────────────── */
      .pb-top {
        left: 0; right: 0; top: 26px; height: 40px;
        display: flex; align-items: center; justify-content: space-between;
        padding: 0 54px;
      }
      .pb-wordmark {
        font-family: var(--mono); font-size: 17px; font-weight: 600;
        letter-spacing: .34em; text-transform: uppercase;
        background: var(--grad); -webkit-background-clip: text; background-clip: text; color: transparent;
      }
      .pb-topright {
        font-family: var(--mono); font-size: 13px; letter-spacing: .16em;
        color: var(--subtle); text-transform: uppercase;
      }

      .pb-label { left: 54px; top: 82px; display: flex; align-items: center; gap: 16px; }
      .pb-label__idx {
        font-family: var(--mono); font-size: 13px; letter-spacing: .2em; color: var(--accent);
      }
      .pb-label__rule { width: 46px; height: 1px; background: linear-gradient(90deg, var(--accent), transparent); }
      .pb-label__text {
        font-family: var(--mono); font-size: 13px; letter-spacing: .26em;
        text-transform: uppercase; color: var(--muted);
      }

      /* ── the screen frame ─────────────────────────────────────────────── */
      .pb-frame {
        overflow: hidden; border-radius: 14px;
        background: #101018;
        border: 1px solid rgba(255,255,255,.10);
        box-shadow: 0 40px 120px rgba(0,0,0,.62), 0 0 0 1px rgba(255,255,255,.03) inset;
      }
      .pb-frame__bar {
        height: 34px; display: flex; align-items: center; gap: 8px; padding: 0 14px;
        background: linear-gradient(180deg, #191926, #12121c);
        border-bottom: 1px solid rgba(255,255,255,.07);
      }
      .pb-dot { width: 10px; height: 10px; border-radius: 50%; background: #2f2f3d; }
      .pb-frame__url {
        margin-left: 12px; font-family: var(--mono); font-size: 12px; color: var(--subtle);
        letter-spacing: .04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .pb-frame__body { position: relative; overflow: hidden; }
      .pb-shot {
        position: absolute; left: 0; top: 0; transform-origin: 0 0;
        will-change: transform; display: block;
      }

      /* ── caption strip ────────────────────────────────────────────────── */
      .pb-caption { left: 0; right: 0; bottom: 44px; display: flex; justify-content: center; }
      .pb-caption__inner {
        max-width: 1560px; padding: 16px 30px; border-radius: 16px;
        background: rgba(9, 8, 20, .80);
        border: 1px solid rgba(255,255,255,.11);
        box-shadow: 0 20px 60px rgba(0,0,0,.55);
        backdrop-filter: blur(3px);
        font-size: 26px; line-height: 1.34; font-weight: 500;
        text-align: center; letter-spacing: -.005em;
      }
      .pb-caption__inner em { font-style: normal; color: var(--accent); }
      .pb-caption__inner b { color: #fff; font-weight: 650; }

      /* ── progress ─────────────────────────────────────────────────────── */
      .pb-progress { left: 0; right: 0; bottom: 0; height: 3px; background: rgba(255,255,255,.07); }
      .pb-progress__fill { height: 100%; width: 0; background: var(--grad); }

      /* ── cursor ───────────────────────────────────────────────────────── */
      .pb-cursor { left: 0; top: 0; width: 30px; height: 30px; }
      .pb-cursor svg { filter: drop-shadow(0 3px 7px rgba(0,0,0,.7)); }
      .pb-ripple {
        position: absolute; left: 0; top: 0; width: 20px; height: 20px; border-radius: 50%;
        border: 2px solid rgba(45,212,191,.9); transform: translate(-50%, -50%) scale(1); opacity: 0;
      }

      /* ── terminal panel ───────────────────────────────────────────────── */
      .pb-term {
        border-radius: 14px; overflow: hidden; background: #0b0b14;
        border: 1px solid rgba(255,255,255,.10);
        box-shadow: 0 40px 120px rgba(0,0,0,.62);
        font-family: var(--mono);
      }
      .pb-term__bar {
        height: 34px; display: flex; align-items: center; gap: 8px; padding: 0 14px;
        background: linear-gradient(180deg, #191926, #12121c);
        border-bottom: 1px solid rgba(255,255,255,.07);
      }
      .pb-term__title { margin-left: 12px; font-size: 12px; color: var(--subtle); letter-spacing: .06em; }
      .pb-term__body { padding: 22px 26px; font-size: 16.5px; line-height: 1.62; white-space: pre-wrap; word-break: break-word; }
      .pb-cmd { color: #d7d7e6; }
      .pb-cmd__prompt { color: var(--accent); }
      .pb-out--ok { color: #7ee7c7; }
      .pb-out--bad { color: #ff9c8f; }
      .pb-out--warn { color: #ffd479; }

      /* ── titles ───────────────────────────────────────────────────────── */
      .pb-hero { left: 0; right: 0; top: 0; bottom: 0; display: flex; flex-direction: column;
                 align-items: center; justify-content: center; text-align: center; }
      .pb-hero__eyebrow {
        font-family: var(--mono); font-size: 15px; letter-spacing: .38em; color: var(--accent);
        text-transform: uppercase; margin-bottom: 30px;
      }
      .pb-hero__title { font-size: 86px; line-height: 1.08; font-weight: 700; letter-spacing: -.028em; max-width: 1420px; }
      .pb-hero__title span { background: var(--grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
      .pb-hero__sub { margin-top: 30px; font-size: 27px; color: var(--muted); max-width: 1180px; line-height: 1.5; }

      .pb-badge {
        display: inline-block; padding: 5px 12px; border-radius: 999px; font-family: var(--mono);
        font-size: 12px; letter-spacing: .14em; text-transform: uppercase;
      }
      .pb-badge--ok { background: rgba(52,211,153,.14); color: #7ee7c7; border: 1px solid rgba(52,211,153,.34); }
      .pb-badge--bad { background: rgba(248,113,113,.14); color: #ff9c8f; border: 1px solid rgba(248,113,113,.34); }

      /* Highlight ring used to point at a region of a real screenshot. */
      .pb-callout {
        position: absolute; border-radius: 12px; pointer-events: none;
        border: 2px solid rgba(45,212,191,.95);
        box-shadow: 0 0 0 3px rgba(45,212,191,.14), 0 0 34px rgba(45,212,191,.28);
      }
      .pb-pin {
        position: absolute; padding: 7px 13px; border-radius: 999px; pointer-events: none;
        background: #0b0b14; border: 1px solid rgba(45,212,191,.55);
        box-shadow: 0 10px 28px rgba(0,0,0,.6);
        color: #b8fff1; font-family: var(--mono); font-size: 13px; letter-spacing: .08em;
        white-space: nowrap;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Build the shared chrome and return a handle. `total` is the whole film's length so the progress bar
   * is honest across scene boundaries; `offset` is this scene's start time inside the film.
   */
  function mount(opts) {
    injectStyles();
    const o = Object.assign({ total: 164, offset: 0, duration: 10, labelIndex: "", labelText: "", topRight: "" }, opts);

    const bg = document.createElement("div");
    bg.className = "pb-bg";
    const grid = document.createElement("div");
    grid.className = "pb-grid";
    const vig = document.createElement("div");
    vig.className = "pb-vignette";
    document.body.append(bg, grid, vig);

    const top = document.createElement("div");
    top.className = "pb-layer pb-top";
    top.innerHTML = `<span class="pb-wordmark">Payback.ai</span><span class="pb-topright">${o.topRight}</span>`;

    const label = document.createElement("div");
    label.className = "pb-layer pb-label";
    label.innerHTML =
      `<span class="pb-label__idx">${o.labelIndex}</span><span class="pb-label__rule"></span><span class="pb-label__text">${o.labelText}</span>`;

    const caption = document.createElement("div");
    caption.className = "pb-layer pb-caption";
    caption.innerHTML = `<div class="pb-caption__inner"></div>`;

    const progress = document.createElement("div");
    progress.className = "pb-layer pb-progress";
    progress.innerHTML = `<div class="pb-progress__fill"></div>`;

    const cursor = document.createElement("div");
    cursor.className = "pb-layer pb-cursor";
    cursor.innerHTML = `<svg viewBox="0 0 24 24" width="30" height="30"><path d="M4 2 L4 20 L9 15.4 L12.2 22 L15.2 20.6 L12 14.2 L18.6 14.2 Z" fill="#ffffff" stroke="#0b0b14" stroke-width="1.1"/></svg><span class="pb-ripple"></span>`;

    document.body.append(top, label, caption, progress, cursor);

    const fill = progress.querySelector(".pb-progress__fill");
    const capInner = caption.querySelector(".pb-caption__inner");
    const ripple = cursor.querySelector(".pb-ripple");

    let lastText = null;

    return {
      node: { bg, top, label, caption, progress, cursor },
      /** Section label is part of the set, not an effect: it just changes when t crosses. */
      setLabel(index, text, alpha) {
        label.querySelector(".pb-label__idx").textContent = index;
        label.querySelector(".pb-label__text").textContent = text;
        label.style.opacity = String(alpha ?? 1);
      },
      /** Show `text`; `alpha` drives the fade so the strip never pops. */
      setCaption(text, alpha) {
        if (text !== lastText) {
          capInner.innerHTML = text;
          lastText = text;
        }
        const a = alpha === undefined ? 1 : alpha;
        caption.style.opacity = String(a);
        caption.style.transform = `translateY(${(1 - a) * 14}px)`;
      },
      setProgress(t) {
        fill.style.width = `${clamp(((o.offset + t) / o.total) * 100, 0, 100)}%`;
      },
      /** Slow mesh drift: the two glows orbit on independent periods. */
      moveBg(t) {
        const x = 30 + 26 * Math.sin((t / 19) * Math.PI * 2);
        const y = 25 + 18 * Math.sin((t / 13) * Math.PI * 2 + 1.1);
        const hx = 78 - 24 * Math.sin((t / 23) * Math.PI * 2 + 0.6);
        const hy = 72 + 14 * Math.cos((t / 17) * Math.PI * 2);
        bg.style.setProperty("--gx", `${x}%`);
        bg.style.setProperty("--gy", `${y}%`);
        bg.style.setProperty("--hx", `${hx}%`);
        bg.style.setProperty("--hy", `${hy}%`);
      },
      /**
       * A cursor on an eased path over a list of waypoints; `opacity` and the click ripple at `clickAt`
       * are all functions of t.
       */
      cursorPath(t, waypoints, opts2) {
        const p = Object.assign({ start: 0, end: 1, opacity: 1, clickAt: [], rippleDur: 0.75 }, opts2);
        const x = prog(t, p.start, p.end);
        const n = waypoints.length - 1;
        const seg = clamp(Math.floor(x * n), 0, n - 1);
        const local = easeInOut(clamp(x * n - seg, 0, 1));
        const a = waypoints[seg];
        const b = waypoints[seg + 1] ?? a;
        const px = lerp(a[0], b[0], local);
        const py = lerp(a[1], b[1], local);
        cursor.style.transform = `translate(${px}px, ${py}px)`;
        cursor.style.opacity = String(p.opacity);
        let rippleA = 0;
        let scale = 1;
        for (const c of p.clickAt) {
          const r = prog(t, c, c + p.rippleDur);
          if (r > 0 && r < 1 && t >= c) {
            rippleA = Math.max(rippleA, 1 - r);
            scale = lerp(1, 6.5, easeOut(r));
          }
        }
        ripple.style.opacity = String(rippleA * 0.9 * p.opacity);
        ripple.style.transform = `translate(-50%, -50%) scale(${scale})`;
        return { x: px, y: py };
      },
    };
  }

  /** A framed screenshot: a browser-window shell with the real capture inside, pannable/zoomable. */
  function frame(src, opts) {
    const o = Object.assign({ left: 0, top: 0, width: 1600, height: 900, url: "payback.clarktechventures.workers.dev", shotWidth: 1920 }, opts);
    const el = document.createElement("div");
    el.className = "pb-layer pb-frame";
    el.style.cssText = `left:${o.left}px; top:${o.top}px; width:${o.width}px; height:${o.height}px;`;
    el.innerHTML =
      `<div class="pb-frame__bar"><span class="pb-dot"></span><span class="pb-dot"></span><span class="pb-dot"></span>` +
      `<span class="pb-frame__url">${o.url}</span></div>` +
      `<div class="pb-frame__body" style="height:${o.height - 35}px"><img class="pb-shot" src="${src}" alt=""></div>`;
    const img = el.querySelector(".pb-shot");
    const body = el.querySelector(".pb-frame__body");
    return {
      el,
      body,
      img,
      /** Absolute placement of the screenshot inside the frame; `scale` maps capture px to screen px. */
      place(x, y, scale) {
        img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
      },
      /** Fit to the frame width at a given scale multiplier, then pan by capture-space offsets. */
      fit(fitScale, panX, panY) {
        img.style.transform = `translate(${panX}px, ${panY}px) scale(${fitScale})`;
      },
      /** Add a callout rectangle in *frame body* coordinates. */
      callout(x, y, w, h, label, alpha) {
        let box = el.querySelector(".pb-callout");
        if (!box) {
          box = document.createElement("div");
          box.className = "pb-callout";
          body.appendChild(box);
        }
        box.style.cssText = `left:${x}px; top:${y}px; width:${w}px; height:${h}px; opacity:${alpha}`;
        let pin = el.querySelector(".pb-pin");
        if (label && alpha > 0.02) {
          if (!pin) {
            pin = document.createElement("div");
            pin.className = "pb-pin";
            body.appendChild(pin);
          }
          pin.style.cssText = `left:${Math.max(6, x)}px; top:${Math.max(6, y - 34)}px; opacity:${alpha}`;
          pin.textContent = label;
        } else if (pin) {
          pin.style.opacity = "0";
        }
      },
    };
  }

  /**
   * A camera onto a screenshot, expressed the way a screenshot is actually addressed: a zoom level plus
   * the capture-space point (x0, y0) at the frame's top-left corner. Keeping panX/panY derived from
   * (x0, y0) is what stops a pan from sliding the image off its own edge and showing a blank strip.
   */
  function camera(f, geo) {
    const g = geo || window.PB.GEO;
    return {
      /** Set the transform for a capture-space top-left corner. */
      view(z, x0, y0) {
        f.place(-x0 * z, -y0 * z, z);
      },
      /** Map a capture-space rectangle to frame-body coordinates, for a callout. */
      rect(z, x0, y0, cx, cy, cw, ch) {
        return { x: (cx - x0) * z, y: (cy - y0) * z, w: cw * z, h: ch * z };
      },
      /** The largest zoom at which capture column `x0` still reaches the frame's right edge without gaps. */
      maxZoomTo(x0, captureW) {
        return g.width / (captureW - x0);
      },
    };
  }

  /** HTML-escape captured text before it is placed in the DOM. */
  const esc = (s) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  /** A terminal panel whose text is always verbatim from a captured real response. */
  function terminal(opts) {
    const o = Object.assign({ left: 0, top: 0, width: 1600, title: "zsh — payback" }, opts);
    const el = document.createElement("div");
    el.className = "pb-layer pb-term";
    el.style.cssText = `left:${o.left}px; top:${o.top}px; width:${o.width}px;`;
    el.innerHTML =
      `<div class="pb-term__bar"><span class="pb-dot"></span><span class="pb-dot"></span><span class="pb-dot"></span>` +
      `<span class="pb-term__title">${o.title}</span></div><div class="pb-term__body"></div>`;
    return { el, bodyInfo: el.querySelector(".pb-term__body") };
  }

  window.PB = { mount, frame, camera, terminal, esc, clamp, lerp, prog, smooth, easeOut, easeInOut, pulse, CAPTION_MS };

  /**
   * One geometry for every scene, so the film does not jump between cuts. A 1080p capture is scaled to
   * 1560/1920 = 0.8125 inside the frame; the frame's body is shorter than the scaled capture, so the
   * camera pans within a real screenshot rather than squashing it.
   */
  window.PB.GEO = {
    left: 180, top: 106, width: 1560, height: 780, body: 745,
    scale: 1560 / 1920,          // capture px -> screen px
    captureW: 1920, captureH: 1080,
  };
})();
