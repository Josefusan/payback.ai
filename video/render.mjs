#!/usr/bin/env node
/**
 * Render + encode. Deterministic: for every integer frame index the renderer calls `window.seek(i/fps)`
 * exactly once and screenshots the result. Nothing on the page reads the wall clock, so a re-run produces
 * the same film.
 *
 * Each scene is rendered to its own frame directory, encoded to an intermediate MP4, and its frames are
 * deleted immediately — the peak disk cost is one scene, not the whole film.
 *
 *   node video/render.mjs                       # everything
 *   node video/render.mjs --scene 03-review     # one scene (keeps frames, for inspection)
 *   node video/render.mjs --fps 30              # fall back if 60 is too slow
 *   node video/render.mjs --probe 03-review     # render a handful of t values only
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

const HERE = import.meta.dirname;
const SCENES_DIR = path.join(HERE, "scenes");
const FRAME_ROOT = path.join(HERE, "tmp", "frames");
const OUT_DIR = path.join(HERE, "out");

/**
 * The film. Times are in seconds and must sum to under 179 s; the progress bar in every scene is drawn
 * against TOTAL, so it is continuous across scene cuts.
 */
export const SCENES = [
  { id: "01-open", file: "01-open.html", duration: 12 },
  { id: "02-books", file: "02-books.html", duration: 20 },
  { id: "03-review", file: "03-review.html", duration: 27 },
  { id: "04-approve", file: "04-approve.html", duration: 15 },
  { id: "05-actions", file: "05-actions.html", duration: 26 },
  { id: "06-audit", file: "06-audit.html", duration: 18 },
  { id: "07-managerial", file: "07-managerial.html", duration: 20 },
  { id: "08-dial", file: "08-dial.html", duration: 18 },
  { id: "09-close", file: "09-close.html", duration: 8 },
];
const TOTAL = SCENES.reduce((n, s) => n + s.duration, 0);

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
};
const has = (name) => argv.includes(`--${name}`);

const FPS = Number(arg("fps", "60"));
const ONLY = arg("scene", null);
const PROBE = arg("probe", null);
const OUT = path.join(OUT_DIR, "payback-demo.mp4");

const sceneTime = (id) => SCENES.slice(0, SCENES.findIndex((s) => s.id === id)).reduce((n, s) => n + s.duration, 0);

function encode(framesDir, dest, pattern) {
  const args = [
    "-y", "-loglevel", "error",
    "-framerate", String(FPS), "-i", path.join(framesDir, pattern),
    // The frames are JPEG, which is full-range. Tagging the output yuv420p without converting the range
    // produces `yuvj420p` — full-range levels in a format players expect to be limited-range, which washes
    // out on some players. Scale the range explicitly and tag it, so the encode matches the spec.
    "-vf", "scale=in_range=full:out_range=limited",
    "-c:v", "libx264", "-crf", "16", "-preset", "slow",
    "-pix_fmt", "yuv420p", "-color_range", "tv",
    "-r", String(FPS),
    "-g", String(FPS * 2), "-keyint_min", String(FPS * 2), "-sc_threshold", "0",
    "-movflags", "+faststart",
    dest,
  ];
  const res = spawnSync("ffmpeg", args, { stdio: ["ignore", "inherit", "inherit"] });
  if (res.status !== 0) throw new Error(`ffmpeg failed for ${dest}`);
}

async function renderScene(page, scene, { probe = false } = {}) {
  const frames = Math.round(scene.duration * FPS);
  const dir = path.join(FRAME_ROOT, scene.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const url = `file://${path.join(SCENES_DIR, scene.file)}`;
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.seek === "function", null, { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  // Every screenshot before the first seek would otherwise show an uninitialised stage.
  await page.evaluate((t) => window.seek(t), 0);

  const indices = probe ? probeFrames(frames, probe) : Array.from({ length: frames }, (_, i) => i);
  const started = Date.now();
  // JPEG at q95, not PNG: Chrome's PNG encoder costs ~345 ms/frame at 1080p versus ~43 ms for JPEG, and
  // the film is re-encoded to H.264 4:2:0 anyway. Measured, not assumed — see the benchmark in the report.
  for (const i of indices) {
    const t = i / FPS;
    await page.evaluate((seconds) => window.seek(seconds), t);
    await page.screenshot({ path: path.join(dir, `f${String(i).padStart(6, "0")}.jpg`), type: "jpeg", quality: 95, animations: "disabled" });
  }
  const secs = (Date.now() - started) / 1000;
  return { dir, frames, indices, secs };
}

/** A spread of sample frames (plus the first and last) to eyeball without rendering the whole scene. */
function probeFrames(frames, spec) {
  const list = String(spec)
    .split(",")
    .flatMap((piece) => {
      if (piece.includes("-")) {
        const [a, b] = piece.split("-").map(Number);
        const step = Math.max(1, Math.round((b - a) / 5));
        const out = [];
        for (let v = a; v <= b; v += step) out.push(v);
        return out;
      }
      return [Number(piece)];
    })
    .filter((n) => Number.isFinite(n) && n >= 0 && n < frames);
  return [...new Set([0, ...list, frames - 1])].sort((a, b) => a - b);
}

async function main() {
  fs.mkdirSync(FRAME_ROOT, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const chosen = ONLY ? SCENES.filter((s) => s.id === ONLY) : SCENES;
  if (chosen.length === 0) throw new Error(`no such scene: ${ONLY}`);

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`  [page error] ${m.text()}`);
  });
  page.on("pageerror", (e) => console.log(`  [page exception] ${e.message}`));

  const segments = [];
  try {
    for (const scene of chosen) {
      await page.addInitScript(
        ([dur, total, offset]) => {
          window.SCENE_DURATION = dur;
          window.FILM_TOTAL = total;
          window.SCENE_OFFSET = offset;
        },
        [scene.duration, TOTAL, sceneTime(scene.id)],
      );
      process.stdout.write(`▸ ${scene.id} (${scene.duration}s, ${Math.round(scene.duration * FPS)} frames @ ${FPS}fps) … `);
      const { dir, frames, indices, secs } = await renderScene(page, scene, PROBE ? { probe: PROBE } : {});
      const perFrame = secs / indices.length;
      console.log(`${secs.toFixed(1)}s (${(perFrame * 1000).toFixed(0)} ms/frame)`);

      if (PROBE) {
        console.log(`  probe frames in ${dir}: ${indices.slice(0, 12).join(", ")}${indices.length > 12 ? ", …" : ""}`);
        continue;
      }
      const segment = path.join(FRAME_ROOT, `${scene.id}.mp4`);
      encode(dir, segment, "f%06d.jpg");
      fs.rmSync(dir, { recursive: true, force: true });
      segments.push(segment);
    }

    if (PROBE) return;

    if (segments.length === 1) {
      fs.copyFileSync(segments[0], OUT);
    } else {
      const listFile = path.join(FRAME_ROOT, "concat.txt");
      fs.writeFileSync(listFile, segments.map((s) => `file '${s}'`).join("\n") + "\n");
      const res = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", OUT], {
        stdio: ["ignore", "inherit", "inherit"],
      });
      if (res.status !== 0) throw new Error("concat failed");
      for (const s of segments) fs.rmSync(s, { force: true });
    }
    console.log(`\nwrote ${OUT}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
