/**
 * Playing a tour: the camera, the marks and the voice, one frame after another.
 *
 * A topic plays like a short video. Each frame is carried out — the camera
 * flown, lines boxed, an arrow drawn, a sentence said — and the next follows
 * once both the voice and the camera are done with this one: a frame read aloud
 * lasts as long as its sentences take, and one that is not lasts the
 * `frameSeconds` the bar was drawn from. The last frame of a topic hands on to
 * the first of the next, and the last topic stops.
 *
 * Every frame names its places by file and by a few lines of code, never by
 * where they were, and is resolved against the cards as they stand when it
 * plays. A place that is not there any more draws around the whole card, or
 * nothing; a tour never stops because a line moved.
 *
 * One counter, `run`, is what keeps a stopped frame stopped. Everything a frame
 * waits on — a flight landing, a sentence ending, a timer — checks it on the way
 * back, and every jump, pause and seek moves it on, so nothing from a frame the
 * reader has left can advance the one they are on.
 */

import {
  frameSeconds,
  topicSeconds,
  type ArrowFrame,
  type End,
  arrowsOf,
  highlightsOf,
  type Frame,
  type Topic,
} from "@odin/core/tour/tour.js";

import * as camera from "../canvas/camera.svelte.js";
import type { Placed } from "../canvas/camera.svelte.js";
import { legibleAt } from "../canvas/legible.js";
import { lineAt } from "../canvas/measured.svelte.js";
import type { Box } from "../canvas/wire.js";
import { sentences, voiced, writtenSpan } from "../hud/voiced.js";
import { canSpeak, prepare, silence, utter } from "../hud/voices.js";
import { model, notify, settings, ui, view } from "../state.svelte.js";
import { findAnchor, type Side } from "./anchors.js";
import { markBox } from "./drawing.js";
import { cameraFrom, endOf, frameAt, keptFrom, startOf, step, wordBefore } from "./playhead.js";
import { placeBeside } from "./placing.js";
import { tour, type Attached, type Mark } from "./state.svelte.js";

/** Characters a second, as `frameSeconds` counts them. */
const READING = 14;

let run = 0;
/** When the current frame came on screen, by the page's clock. */
let began = 0;
let ticker: ReturnType<typeof setInterval> | undefined;
let reporting: ReturnType<typeof setTimeout> | undefined;
/** The voice is reading this frame, so it is the voice that ends it. */
let speaking = false;
function setSpeaking(on: boolean): void {
  speaking = on;
  tour.speaking = on;
}
/** The last topic played to its end: playing again starts it over. */
let ended = false;

/* ----------------------------------------------------------------- the API */

/**
 * Into tour mode, and playing from where the reader left it.
 *
 * The host is told so it can put its side bar away; the canvas is the player's
 * from here until `leaveTour`.
 */
export function startTour(topic = tour.topic, frame = tour.frame): void {
  if (!tour.data?.topics.length) return;
  if (!tour.active) {
    tour.active = true;
    notify("tourMode", { on: true });
  }
  ended = false;
  tour.playing = true;
  tick();
  begin(topic, frame, true);
}

/**
 * Playing on — from where the guide was, not from where the reader wandered.
 *
 * Paused, the drawing is theirs to pan about. Playing again flies back to the
 * place the current frame stands at and starts the frame over, so the sentence
 * that was cut off is heard whole over what it was about.
 */
export function play(): void {
  if (!tour.data?.topics.length) return;
  if (!tour.active) return startTour();
  if (tour.playing) return;
  tour.playing = true;
  tick();
  if (ended) {
    ended = false;
    jumping(() => begin(tour.topic, 0, true));
  } else begin(tour.topic, tour.frame, true);
}

/** Stops where it is, leaving the marks and the subtitle on screen. */
export function pause(): void {
  if (!tour.playing) return;
  run++;
  tour.playing = false;
  stopTicking();
  hush();
}

let flashes = 0;

export function toggle(): void {
  if (tour.playing) pause();
  else play();
  tour.flash = { playing: tour.playing, id: ++flashes };
}

/** Seconds into the whole tour, topics before this one included. */
function position(): number {
  const topics = tour.data?.topics ?? [];
  return topics.slice(0, tour.topic).reduce((sum, one) => sum + topicSeconds(one), 0) + tour.elapsed;
}

let jumps = 0;
let lastJump = 0;

/**
 * Says how far a jump went, the way a video player does at the edge it went
 * towards. Presses in quick succession the same way add up, so three nexts
 * read as one jump of their sum rather than three flashes of a frame each.
 */
function jumping(move: () => void): void {
  const before = position();
  move();
  const moved = Math.round(position() - before);
  if (moved === 0) return;
  const now = Date.now();
  const held = tour.jump;
  const adds = held && now - lastJump < 900 && Math.sign(held.seconds) === Math.sign(moved);
  lastJump = now;
  tour.jump = { seconds: adds ? held.seconds + moved : moved, id: ++jumps };
}

/** The next frame, into the next topic past the end of this one. */
export function next(): void {
  const topics = tour.data?.topics;
  if (!topics) return;
  const to = step(topics, tour.topic, tour.frame, 1);
  if (to) jumping(() => begin(to.topic, to.frame, true));
}

/** The frame before, into the end of the topic before past the start of this one. */
export function previous(): void {
  const topics = tour.data?.topics;
  if (!topics) return;
  const to = step(topics, tour.topic, tour.frame, -1);
  if (to) jumping(() => begin(to.topic, to.frame, true));
}

export function goToTopic(index: number): void {
  if (!tour.data?.topics[index]) return;
  jumping(() => begin(index, 0, true));
}

/**
 * A point on the current topic's bar.
 *
 * The frame that owns that second is started from its beginning, since a frame
 * is a sentence and half a sentence is not worth hearing. Paused, the clock is
 * left where the reader dropped it, so the bar does not jump under their hand.
 */
export function seek(seconds: number): void {
  const topic = current();
  if (!topic) return;
  const frame = frameAt(topic, seconds);
  jumping(() => {
    begin(tour.topic, frame, true);
    if (!tour.playing) {
      tour.elapsed = Math.max(startOf(topic, frame), Math.min(seconds, endOf(topic, frame)));
    }
  });
}

/**
 * The frame on screen, taken into the conversation: paused where it is, and
 * pointed at the code it is about — its own anchor, or for a frame that only
 * talks, the place the frames before it left the camera.
 */
export function attachFrame(): Attached | null {
  const topic = current();
  if (!topic) return null;
  pause();
  let say = "";
  let anchor: { file: string; code?: string; side?: "head" | "base" } | null = null;
  for (let at = tour.frame; at >= 0; at--) {
    const frame = topic.frames[at]!;
    if (!say && frame.say && frame.kind !== "title") say = frame.say;
    if (frame.kind === "focus" || frame.kind === "highlight") anchor = frame;
    else if (frame.kind === "arrow") anchor = frame.from;
    else if (frame.kind === "go") anchor = { file: frame.file };
    if (anchor && say) break;
  }
  const attached: Attached = {
    topic: tour.topic,
    topicTitle: topic.title,
    frame: tour.frame + 1,
    say: say || tour.subtitle,
  };
  if (anchor) {
    attached.file = anchor.file;
    const place = resolve(anchor);
    if (anchor.code) attached.code = anchor.code;
    if (place && place.start > 0) {
      attached.side = place.side;
      attached.start = place.start;
      attached.end = place.end;
    }
  }
  tour.attached = attached;
  return attached;
}

/** Out of tour mode: the voice stopped, the marks gone, the side bar back. */
export function leaveTour(): void {
  run++;
  tour.playing = false;
  stopTicking();
  hush();
  clearDrawn();
  tour.subtitle = "";
  tour.spokenTo = 0;
  if (tour.active) {
    tour.active = false;
    notify("tourMode", { on: false });
  }
  report(true);
}

/**
 * Where a mark is drawn, against the cards as they are placed now.
 *
 * For the layer that draws them, which hands in the boxes the canvas already
 * worked out rather than having every mark place the whole drawing again.
 */
export function markArea(
  boxes: Record<string, Box>,
  nodeId: string,
  side: Side,
  start: number,
  end: number,
): Box | null {
  const card = boxes[nodeId];
  if (!card) return null;
  const node = model.current.nodes.find((one) => one.id === nodeId);
  const half = settings.unified || node?.single ? null : side === "base" ? "left" : "right";
  return markBox(
    card,
    (line) => lineAt(nodeId, side, line, false),
    start,
    end,
    rowHeight(),
    half,
  );
}

let row = 0;

/**
 * How tall one line of code is, read off the page's own tokens the once.
 *
 * The layout engine's number, which the host writes into the page's style
 * rather than into the model; eighteen is its default, for a page with no
 * document to read it from.
 */
function rowHeight(): number {
  if (row > 0) return row;
  if (typeof document === "undefined") return 18;
  const said = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--line-height"),
  );
  row = said > 0 ? said : 18;
  return row;
}

/* -------------------------------------------------------------- playing */

function current(): Topic | undefined {
  return tour.data?.topics[tour.topic];
}

/**
 * Puts a frame on screen, and — playing — books what ends it.
 *
 * `jumped` is for arriving anywhere but from the frame before: the marks still
 * standing at this frame are redrawn, and the camera is put where the guide
 * last put it, before the frame itself plays.
 */
function begin(topicIndex: number, frameIndex: number, jumped: boolean): void {
  const topics = tour.data?.topics;
  if (!topics?.length) return;
  const t = Math.max(0, Math.min(topicIndex, topics.length - 1));
  const topic = topics[t]!;
  if (!topic.frames.length) return;
  const f = Math.max(0, Math.min(frameIndex, topic.frames.length - 1));
  const frame = topic.frames[f]!;

  const mine = ++run;
  hush();
  tour.topic = t;
  tour.frame = f;
  tour.frames = { ...tour.frames, [topic.id]: f };
  tour.elapsed = startOf(topic, f);
  began = performance.now();

  if (jumped) {
    clearDrawn();
    for (let at = keptFrom(topic.frames, f); at < f; at++) draw(topic.frames[at]!, false);
    const placed = cameraFrom(topic.frames, f);
    if (placed >= 0 && placed < f) move(topic.frames[placed]!, mine);
  }

  tour.subtitle = frame.say ?? "";
  tour.spokenTo = 0;
  if (!frame.keep) clearDrawn();
  const flight = carryOut(frame, mine);
  report();

  if (tour.playing) book(frame, mine, flight);
}

/** What has to be over before the frame after this one: the flight, the voice, the time. */
function book(frame: Frame, mine: number, flight: Promise<void> | null): void {
  const waits: Promise<void>[] = [];
  if (flight) waits.push(flight);

  const aloud = tour.narrated && !!frame.say && canSpeak();
  setSpeaking(aloud);
  if (frame.kind === "pause") {
    waits.push(
      aloud
        ? narrate(frame.say!, mine).then(() => wait(frame.seconds * 1000))
        : wait(frameSeconds(frame) * 1000),
    );
  } else if (aloud) waits.push(narrate(frame.say!, mine));
  else waits.push(wait(frameSeconds(frame) * 1000));

  void Promise.all(waits).then(() => {
    if (mine === run && tour.playing) finished();
  });
}

/** The frame is over: the next, the next topic, or the end. */
function finished(): void {
  const topics = tour.data?.topics;
  const topic = current();
  if (!topics || !topic) return;
  setSpeaking(false);
  if (tour.frame + 1 < topic.frames.length) return begin(tour.topic, tour.frame + 1, false);

  if (!tour.watched.includes(topic.id)) tour.watched = [...tour.watched, topic.id];
  tour.frames = Object.fromEntries(Object.entries(tour.frames).filter(([id]) => id !== topic.id));
  if (tour.topic + 1 < topics.length) return begin(tour.topic + 1, 0, false);

  run++;
  ended = true;
  tour.playing = false;
  tour.elapsed = topicSeconds(topic);
  tour.spokenTo = tour.subtitle.length;
  stopTicking();
  report(true);
}

/**
 * The clock, while playing.
 *
 * Held inside the frame on screen: a voice slower than the estimate does not
 * walk the bar into a frame that has not started. A frame that is not read
 * aloud moves its subtitle along at the pace it was timed at, and narration
 * turned off halfway through a sentence stops the voice and lets the time the
 * frame has left run out instead.
 */
function tick(): void {
  if (ticker) return;
  ticker = setInterval(() => {
    const topic = current();
    if (!topic || !tour.playing) return;
    const into = (performance.now() - began) / 1000;
    tour.elapsed = Math.min(
      startOf(topic, tour.frame) + into,
      endOf(topic, tour.frame) - 0.05,
    );
    if (speaking && !tour.narrated) {
      setSpeaking(false);
      silence();
      const mine = ++run;
      const left = endOf(topic, tour.frame) - tour.elapsed;
      void wait(Math.max(0, left) * 1000).then(() => {
        if (mine === run && tour.playing) finished();
      });
    }
    if (!speaking && tour.subtitle) {
      tour.spokenTo = wordBefore(tour.subtitle, into * READING);
    }
  }, 100);
}

function stopTicking(): void {
  if (ticker) clearInterval(ticker);
  ticker = undefined;
}

function hush(): void {
  if (!speaking) return;
  setSpeaking(false);
  silence();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reads a frame's words, a sentence at a time, the way the answers are read.
 *
 * The subtitle is the written text and the voice is given the spoken one, so
 * where the voice says it is has to be turned back into a place in what is on
 * screen — `writtenSpan` is that map. A reading that was stopped never
 * resolves; the frame it belonged to has already been left.
 */
function narrate(say: string, mine: number): Promise<void> {
  return new Promise((resolve) => {
    const parts = sentences(say);
    const speak = (index: number): void => {
      if (mine !== run) return;
      const part = parts[index];
      if (!part) {
        tour.spokenTo = say.length;
        resolve();
        return;
      }
      const spoken = voiced(part.text, settings.narrateExtensions);
      const after = parts[index + 1];
      if (after) prepare(voiced(after.text, settings.narrateExtensions).text);
      utter(
        spoken.text,
        (at) => {
          if (mine !== run) return;
          const span = writtenSpan(spoken, at);
          if (span) tour.spokenTo = part.start + span.start;
        },
        () => speak(index + 1),
      );
    };
    speak(0);
  });
}

/** Sends where the reader is to the host, which keeps it with the tour. */
function report(now = false): void {
  if (reporting) clearTimeout(reporting);
  const send = () => {
    reporting = undefined;
    notify("tourProgress", {
      topic: tour.topic,
      frame: tour.frame,
      watched: tour.watched,
      frames: tour.frames,
    });
  };
  if (now) send();
  else reporting = setTimeout(send, 400);
}

/* ------------------------------------------------------- carrying it out */

/** Does what a frame says; answers with its flight, when it flew. */
function carryOut(frame: Frame, mine: number): Promise<void> | null {
  switch (frame.kind) {
    case "go":
    case "focus":
      return move(frame, mine);
    case "diagram": {
      const area = draw(frame, true);
      if (!area) return null;
      camera.showAround(area, area, legible());
      return landed();
    }
    case "highlight":
    case "arrow": {
      const area = draw(frame, true);
      const route = frame.kind === "arrow" && !frame.also?.length ? travel(frame, mine) : null;
      if (route) return route;
      return area && reveal(area) ? landed() : null;
    }
    default:
      return null;
  }
}

/**
 * An arrow whose ends cannot be read together, followed end to end.
 *
 * Framing both ends at once of an arrow between distant cards shows the reader
 * two smudges and a line. So the camera stops close on where it leaves and
 * close on where it lands, the sentence spread over the two. Never on the
 * middle: there the reader sees a line running off both edges of the screen. Ends that fit on screen at reading distance answer nothing, and
 * are shown together the way a highlight is.
 */
function travel(frame: ArrowFrame, mine: number): Promise<void> | null {
  const from = resolve(frame.from);
  const to = resolve(frame.to);
  if (!from || !to) return null;
  const a = areaOf(from);
  const b = areaOf(to);
  if (!a || !b) return null;
  if (camera.fitScale(union(a, b)) >= camera.readingScale()) return null;

  const stops: (() => void)[] = [() => closeOn(from, a), () => closeOn(to, b)];

  const spoken = ((frame.say?.length ?? 0) / READING) * 1000;
  const hold = Math.max(900, spoken / stops.length - camera.motion.flight);
  return stops.reduce<Promise<void>>(
    (before, stop, index) =>
      before.then(() => {
        if (mine !== run) return;
        stop();
        return landed().then(() => {
          if (mine !== run || index === stops.length - 1) return;
          return wait(hold);
        });
      }),
    Promise.resolve(),
  );
}

/** The camera on one end of an arrow: its lines, or the top of its file. */
function closeOn(place: Place, area: Box): void {
  if (place.start <= 0) camera.showAround(place.card, place.card, legible(), "top");
  else camera.showAround(area, place.card, legible());
}

function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** The camera half of a "go" or a "focus". */
function move(frame: Frame, mine: number): Promise<void> | null {
  if (frame.kind === "go") {
    const card = cardFor(frame.file);
    if (!card) return null;
    const zoom = frame.zoom ?? "read";
    const fits = camera.fitScale(card) >= legible();
    if (zoom === "card" && fits) {
      camera.showPoint(card.x + card.width / 2, card.y + card.height / 2, camera.fitScale(card));
    } else camera.showAround(card, card, legible(), "top");
    return landed();
  }
  if (frame.kind !== "focus") return null;

  const place = resolve(frame);
  if (!place) return null;
  const scale = scaleFor(frame.zoom ?? "read", place.card);
  const area = (): Box =>
    markArea(
      { [place.card.node.id]: place.card },
      place.card.node.id,
      place.side,
      place.start,
      place.end,
    )!;
  const aim = (): { x: number; y: number } => {
    const at = area();
    return { x: at.x + at.width / 2, y: at.y + at.height / 2 };
  };
  if (place.start <= 0) camera.showAround(place.card, place.card, legible(), "top");
  else camera.showAround(area(), place.card, legible());

  /*
   * A card seen from too far out has not drawn its rows, so where its lines
   * are was a guess. Once the flight has landed they are drawn, and the aim is
   * taken again: a short hop inside a card already on screen, which reads as
   * the camera settling on the lines rather than as a second journey.
   */
  if (place.start <= 0) return landed();
  const first = aim();
  return landed().then(() => {
    if (mine !== run) return;
    const again = aim();
    if (Math.hypot(again.x - first.x, again.y - first.y) * scale < 3) return;
    camera.showAround(area(), place.card, legible());
    return landed();
  });
}

/**
 * Adds what a highlight or an arrow draws; answers with the area it covers, so
 * the camera can be brought round to it.
 */
function draw(frame: Frame, live: boolean): Box | null {
  let covered: Box | null = null;
  const cover = (area: Box | null) => {
    if (area) covered = covered ? union(covered, area) : area;
  };
  if (frame.kind === "diagram") {
    const spot = placeDiagram(frame.near);
    tour.diagram = { id: ++diagrams, code: frame.mermaid, ...spot };
    return live ? spot : null;
  }
  if (frame.kind === "highlight") {
    for (const one of highlightsOf(frame)) {
      const place = resolve(one);
      if (!place) continue;
      push({
        kind: "highlight",
        nodeId: place.card.node.id,
        side: place.side,
        start: place.start,
        end: place.end,
        label: one.label,
      });
      if (live) cover(areaOf(place));
    }
    return covered;
  }
  if (frame.kind === "arrow") {
    for (const one of arrowsOf(frame)) {
      const from = resolve(one.from);
      const to = resolve(one.to);
      if (!from || !to) continue;
      push({
        kind: "arrow",
        nodeId: from.card.node.id,
        side: from.side,
        start: from.start,
        end: from.end,
        to: { nodeId: to.card.node.id, side: to.side, start: to.start, end: to.end },
        label: one.label,
      });
      if (live) {
        cover(areaOf(from));
        cover(areaOf(to));
      }
    }
    return covered;
  }
  return null;
}

function clearDrawn(): void {
  tour.marks = [];
  tour.diagram = null;
}

let diagrams = 0;

/** Room for a frame's diagram beside the card it is about, clear of every card. */
function placeDiagram(near: string | undefined): Box {
  const cards = camera.shown();
  const seen = camera.clearOnScreen();
  const middle = { x: seen.left + seen.width / 2, y: seen.top + seen.height / 2 };
  const anchored = near ? cardFor(near) : null;
  const closest = [...cards].sort(
    (a, b) =>
      Math.hypot(a.x + a.width / 2 - middle.x, a.y + a.height / 2 - middle.y) -
      Math.hypot(b.x + b.width / 2 - middle.x, b.y + b.height / 2 - middle.y),
  )[0];
  const card = anchored ?? closest;
  const anchor = card
    ? { x: card.x, y: card.y, width: card.width, height: card.height }
    : { x: middle.x, y: middle.y, width: 0, height: 0 };
  const unit = model.current.charWidth || 7;
  const taken = cards.map((one) => ({ x: one.x, y: one.y, width: one.width, height: one.height }));
  return placeBeside(anchor, { width: Math.round(unit * 92), height: Math.round(unit * 58) }, taken, unit * 6);
}

function push(mark: Mark): void {
  tour.marks = [...tour.marks, mark];
}

/**
 * Brings an area on screen if it is not, without zooming in on a reader who is
 * already close. Answers whether the camera moved.
 */
function reveal(area: Box): boolean {
  const seen = camera.clearOnScreen();
  if (seen.width <= 0) return false;
  const inside =
    area.x >= seen.left &&
    area.y >= seen.top &&
    area.x + area.width <= seen.left + seen.width &&
    area.y + area.height <= seen.top + seen.height;
  // The card the area is in, so the code fills the screen's width rather than
  // the few lines being marked filling all of it.
  const card = camera.shown().find(
    (placed) =>
      area.x >= placed.x - 1 &&
      area.x + area.width <= placed.x + placed.width + 1 &&
      area.y >= placed.y - 1 &&
      area.y + area.height <= placed.y + placed.height + 1,
  );
  const across = card ?? area;
  const ideal = camera.aroundScale(area, across, legible());
  if (inside && Math.abs(view.scale - ideal) / ideal < 0.2) return false;
  camera.showAround(area, across, legible());
  return true;
}

/** Resolves once the flight just booked has landed. */
function landed(): Promise<void> {
  return wait(camera.motion.flight + 60);
}

/**
 * The furthest out the tour may stand: where cards still draw their text.
 *
 * Below it a card is drawn as blocks of colour, and a tour that shows the
 * reader a file they cannot read has shown them nothing. A little over the
 * line, so a card on the edge of it is not drawn as blocks one moment and text
 * the next as the flight settles.
 */
function legible(): number {
  return legibleAt(model.current.charWidth) * 1.15;
}

/** How close each of a frame's zooms is, for this page's font and this card. */
function scaleFor(zoom: "card" | "read" | "close", card: Box): number {
  if (zoom === "card") return Math.max(camera.fitScale(card), legible());
  if (zoom === "close") return camera.readingScale() * 1.75;
  return camera.readingScale();
}

/**
 * A file's card, opening the drawing up to the whole change when the tab the
 * reader is on does not show it — the tour is about the change, not the tab.
 */
function cardFor(path: string): Placed | undefined {
  let card = camera.shown().find((placed) => placed.node.path === path);
  if (!card && ui.part && model.current.nodes.some((node) => node.path === path)) {
    ui.part = null;
    notify("part", { paths: null });
    card = camera.shown().find((placed) => placed.node.path === path);
  }
  return card;
}

interface Place {
  card: Placed;
  side: Side;
  /** Nought for the whole card: the file is here and the lines are not. */
  start: number;
  end: number;
}

/**
 * An anchor, found on the canvas as it is now.
 *
 * The card, then the lines on it by what they say. Lines that cannot be found
 * — rewritten past recognition since the tour was made — still have a file, so
 * the answer is the whole card rather than nothing. Only a file that is not on
 * the canvas at all comes back empty.
 */
function resolve(anchor: End): Place | null {
  const card = cardFor(anchor.file);
  if (!card) return null;
  if (!anchor.code) return { card, side: anchor.side ?? "head", start: 0, end: 0 };
  const found = findAnchor(card.node.rows ?? [], { code: anchor.code, side: anchor.side });
  if (found) return { card, ...found };
  return { card, side: anchor.side ?? "head", start: 0, end: 0 };
}

function areaOf(place: Place): Box | null {
  return markArea(
    { [place.card.node.id]: place.card },
    place.card.node.id,
    place.side,
    place.start,
    place.end,
  );
}
