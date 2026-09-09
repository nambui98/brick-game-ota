// ../../packages/sdk/src/ads/AdsPolicy.ts
var ZERO_COUNTERS = { offers: 0, watched: 0, skipped: 0, interstitials: 0 };
var DEFAULT_ADS_SETTINGS = {
  interstitialEvery: 3,
  minIntervalMs: 3 * 60 * 1000,
  rewardedContinue: true,
  minLevel: 0,
  minSessionMs: 0,
  vetoWhenRewardedThisRound: false,
  minRunMs: 0,
  minRunScore: 0,
  firstSessionGraceMs: 0
};
var DEFAULT_ADS_STATE_KEY = "ads:state";

class AdsPolicy {
  storage;
  now;
  storageKey;
  settings;
  state;
  continueUsed = false;
  rewardedThisRound = false;
  sessionStartedAt;
  constructor(storage, settings = {}, now = () => Date.now(), storageKey = DEFAULT_ADS_STATE_KEY) {
    this.storage = storage;
    this.now = now;
    this.storageKey = storageKey;
    this.settings = { ...DEFAULT_ADS_SETTINGS, ...settings };
    this.state = this.load();
    this.sessionStartedAt = this.now();
  }
  get current() {
    return this.settings;
  }
  get roundsCompleted() {
    return this.state.roundsCompleted;
  }
  get counters() {
    return this.state.counters;
  }
  updateSettings(patch) {
    this.settings = { ...this.settings, ...patch };
  }
  onRoundStart() {
    this.continueUsed = false;
    this.rewardedThisRound = false;
  }
  onRoundCompleted() {
    this.state = { ...this.state, roundsCompleted: this.state.roundsCompleted + 1 };
    this.persist();
  }
  canOfferContinue(run) {
    if (!this.settings.rewardedContinue || this.continueUsed) {
      return false;
    }
    return run === undefined || run.runMs >= this.settings.minRunMs && run.score >= this.settings.minRunScore;
  }
  markContinueUsed() {
    this.continueUsed = true;
  }
  markOfferShown() {
    this.markContinueUsed();
    this.bump("offers");
  }
  markContinueResult(result) {
    if (result === "completed") {
      this.noteRewardedShown();
      this.bump("watched");
    } else {
      this.bump("skipped");
    }
  }
  noteRewardedShown() {
    this.rewardedThisRound = true;
    this.state = { ...this.state, lastAdAt: this.now() };
    this.persist();
  }
  shouldShowInterstitial(context = {}) {
    if (context.skip) {
      return false;
    }
    const every = Math.max(1, Math.floor(this.settings.interstitialEvery));
    const { roundsCompleted, lastAdAt, installedAt } = this.state;
    if (roundsCompleted === 0 || roundsCompleted % every !== 0) {
      return false;
    }
    if (this.now() - installedAt < this.settings.firstSessionGraceMs) {
      return false;
    }
    if (context.level !== undefined && context.level < this.settings.minLevel) {
      return false;
    }
    if (this.now() - this.sessionStartedAt < this.settings.minSessionMs) {
      return false;
    }
    if (this.settings.vetoWhenRewardedThisRound && this.rewardedThisRound) {
      return false;
    }
    return lastAdAt === null || this.now() - lastAdAt >= this.settings.minIntervalMs;
  }
  markInterstitialShown() {
    this.state = { ...this.state, lastAdAt: this.now() };
    this.bump("interstitials");
  }
  bump(key) {
    this.state = { ...this.state, counters: { ...this.state.counters, [key]: this.state.counters[key] + 1 } };
    this.persist();
  }
  persist() {
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(this.state));
    } catch {}
  }
  load() {
    const fallback = { roundsCompleted: 0, lastAdAt: null, installedAt: this.now(), counters: { ...ZERO_COUNTERS } };
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) {
        return fallback;
      }
      const v = JSON.parse(raw);
      const rounds = nonNegativeInt(v.roundsCompleted ?? v.gameOvers);
      const last = nonNegativeInt(v.lastAdAt ?? v.lastInterstitialAt);
      const installedAt = nonNegativeInt(v.installedAt);
      const counters = { ...ZERO_COUNTERS };
      const rawCounters = typeof v.counters === "object" && v.counters !== null ? v.counters : {};
      for (const key of Object.keys(ZERO_COUNTERS)) {
        counters[key] = nonNegativeInt(rawCounters[key]) ?? 0;
      }
      return {
        roundsCompleted: rounds ?? 0,
        lastAdAt: last !== null && last <= this.now() ? last : null,
        installedAt: installedAt !== null && installedAt <= this.now() ? installedAt : this.now(),
        counters
      };
    } catch {
      return fallback;
    }
  }
}
function nonNegativeInt(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}
// assets/scripts/core/AdsConfig.ts
var ADS_STATE_KEY = "brick-game:ads";

// assets/scripts/core/LcdFrame.ts
var COLS = 10;
var ROWS = 20;
var PREVIEW_SIZE = 4;
var CELL_COUNT = COLS * ROWS;
var PREVIEW_COUNT = PREVIEW_SIZE * PREVIEW_SIZE;

class LcdFrame {
  main = new Uint8Array(CELL_COUNT);
  preview = new Uint8Array(PREVIEW_COUNT);
  score = 0;
  hiScore = 0;
  level = 1;
  speed = 1;
  indicators = { sound: false, pause: false };
  clear() {
    this.main.fill(0);
    this.preview.fill(0);
  }
  powerOff() {
    this.clear();
    this.score = null;
    this.hiScore = null;
    this.level = null;
    this.speed = null;
    this.indicators = { sound: false, pause: false };
  }
  inBounds(x, y) {
    return x >= 0 && x < COLS && y >= 0 && y < ROWS;
  }
  set(x, y, on) {
    if (this.inBounds(x, y)) {
      this.main[y * COLS + x] = on ? 1 : 0;
    }
  }
  get(x, y) {
    return this.inBounds(x, y) && this.main[y * COLS + x] === 1;
  }
  fillRow(y, on = true) {
    if (y < 0 || y >= ROWS) {
      return;
    }
    this.main.fill(on ? 1 : 0, y * COLS, (y + 1) * COLS);
  }
  blit(sprite, x, y) {
    for (let row = 0;row < sprite.length; row++) {
      const line = sprite[row];
      for (let col = 0;col < line.length; col++) {
        if (line[col] === "#") {
          this.set(x + col, y + row, true);
        }
      }
    }
  }
  setPreview(x, y, on) {
    if (x >= 0 && x < PREVIEW_SIZE && y >= 0 && y < PREVIEW_SIZE) {
      this.preview[y * PREVIEW_SIZE + x] = on ? 1 : 0;
    }
  }
  clearPreview() {
    this.preview.fill(0);
  }
  blitPreview(sprite, x = 0, y = 0) {
    for (let row = 0;row < sprite.length; row++) {
      const line = sprite[row];
      for (let col = 0;col < line.length; col++) {
        if (line[col] === "#") {
          this.setPreview(x + col, y + row, true);
        }
      }
    }
  }
  copyFrom(other) {
    this.main.set(other.main);
    this.preview.set(other.preview);
    this.score = other.score;
    this.hiScore = other.hiScore;
    this.level = other.level;
    this.speed = other.speed;
    this.indicators = { ...other.indicators };
  }
  clone() {
    const copy = new LcdFrame;
    copy.copyFrom(this);
    return copy;
  }
  diff(prev) {
    const changed = [];
    for (let i = 0;i < CELL_COUNT; i++) {
      if (this.main[i] !== prev.main[i]) {
        changed.push(i);
      }
    }
    for (let i = 0;i < PREVIEW_COUNT; i++) {
      if (this.preview[i] !== prev.preview[i]) {
        changed.push(CELL_COUNT + i);
      }
    }
    return changed;
  }
  toStrings() {
    const rows = [];
    for (let y = 0;y < ROWS; y++) {
      let line = "";
      for (let x = 0;x < COLS; x++) {
        line += this.main[y * COLS + x] ? "#" : ".";
      }
      rows.push(line);
    }
    return rows;
  }
}

// assets/scripts/core/Curtain.ts
var CURTAIN_ROW_MS = 25;

class Curtain {
  rowMs;
  phase = "idle";
  progress = 0;
  timer = 0;
  constructor(rowMs = CURTAIN_ROW_MS) {
    this.rowMs = rowMs;
  }
  start() {
    this.phase = "fill";
    this.progress = 0;
    this.timer = 0;
  }
  get done() {
    return this.phase === "done";
  }
  get running() {
    return this.phase === "fill" || this.phase === "clear";
  }
  get totalMs() {
    return ROWS * 2 * this.rowMs;
  }
  tick(dtMs) {
    if (!this.running) {
      return;
    }
    this.timer += dtMs;
    while (this.timer >= this.rowMs && this.running) {
      this.timer -= this.rowMs;
      this.progress++;
      if (this.progress >= ROWS) {
        if (this.phase === "fill") {
          this.phase = "clear";
          this.progress = 0;
        } else {
          this.phase = "done";
        }
      }
    }
  }
  draw(frame) {
    if (this.phase === "fill") {
      for (let y = ROWS - this.progress;y < ROWS; y++) {
        frame.fillRow(y, true);
      }
    } else if (this.phase === "clear") {
      for (let y = 0;y < ROWS; y++) {
        frame.fillRow(y, y >= this.progress);
      }
    }
  }
}

// assets/scripts/core/Glyphs.ts
var LETTER_GLYPHS = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."]
};
var PLAY_GLYPH = ["#...", "##..", "###.", "##.."];
var ICON_GLYPHS = {
  sound: ["...#..#", "..##.#.", "####..#", "####..#", "####..#", "..##.#.", "...#..#"],
  pause: ["##.##", "##.##", "##.##", "##.##", "##.##", "##.##", "##.##"]
};
var SEGMENT_MASKS = [63, 6, 91, 79, 102, 109, 125, 7, 127, 111];
function readoutMasks(value, digits) {
  const masks = new Array(digits).fill(0);
  if (value === null) {
    return masks;
  }
  let v = Math.max(0, Math.floor(value));
  for (let i = digits - 1;i >= 0; i--) {
    masks[i] = SEGMENT_MASKS[v % 10];
    v = Math.floor(v / 10);
    if (v === 0) {
      break;
    }
  }
  return masks;
}

// assets/scripts/core/Input.ts
var BUTTONS = [
  "up",
  "down",
  "left",
  "right",
  "rotate",
  "start",
  "sound",
  "reset",
  "power"
];
var REPEATABLE = new Set(["left", "right", "down"]);
var REPEAT_DELAY_MS = 170;
var REPEAT_INTERVAL_MS = 50;

class InputSnapshot {
  held;
  pressed;
  constructor(held, pressed) {
    this.held = held;
    this.pressed = pressed;
  }
  isHeld(button) {
    return this.held.has(button);
  }
  isPressed(button) {
    return this.pressed.has(button);
  }
  heldOnly() {
    return new InputSnapshot(this.held, EMPTY);
  }
  static NONE = new InputSnapshot(new Set, new Set);
}
var EMPTY = new Set;

class InputController {
  repeatDelayMs;
  repeatIntervalMs;
  held = new Set;
  pendingPress = new Set;
  repeatTimers = new Map;
  constructor(repeatDelayMs = REPEAT_DELAY_MS, repeatIntervalMs = REPEAT_INTERVAL_MS) {
    this.repeatDelayMs = repeatDelayMs;
    this.repeatIntervalMs = repeatIntervalMs;
  }
  press(button) {
    if (this.held.has(button)) {
      return;
    }
    this.held.add(button);
    this.pendingPress.add(button);
    if (REPEATABLE.has(button)) {
      this.repeatTimers.set(button, this.repeatDelayMs);
    }
  }
  release(button) {
    this.held.delete(button);
    this.repeatTimers.delete(button);
  }
  releaseAll() {
    this.held.clear();
    this.repeatTimers.clear();
  }
  isHeld(button) {
    return this.held.has(button);
  }
  sample(dtMs) {
    const pressed = this.pendingPress;
    this.pendingPress = new Set;
    for (const [button, remaining] of this.repeatTimers) {
      let left = remaining - dtMs;
      while (left <= 0) {
        pressed.add(button);
        left += this.repeatIntervalMs;
      }
      this.repeatTimers.set(button, left);
    }
    return new InputSnapshot(new Set(this.held), pressed);
  }
}

// assets/scripts/core/ConsoleState.ts
var TRANSITIONS = {
  OFF: ["POWER_ON"],
  POWER_ON: ["SELECT", "OFF"],
  SELECT: ["PLAYING", "OFF"],
  PLAYING: ["PAUSED", "CONTINUE_OFFER", "GAME_OVER", "SELECT", "OFF"],
  PAUSED: ["PLAYING", "SELECT", "OFF"],
  CONTINUE_OFFER: ["PLAYING", "GAME_OVER", "OFF"],
  GAME_OVER: ["SELECT", "OFF"]
};
function canTransition(from, to) {
  return TRANSITIONS[from].includes(to);
}
function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal console transition ${from} → ${to}`);
  }
}

// assets/scripts/core/GameModule.ts
var GAME_IDS = ["A", "B", "C", "D"];

// assets/scripts/core/Registry.ts
var factories = new Map;
function registerGame(id, factory) {
  factories.set(id, factory);
}
var createGame = (id) => {
  const factory = factories.get(id);
  if (!factory) {
    throw new Error(`No game registered for "${id}"`);
  }
  return factory();
};
function nextGameId(id) {
  return GAME_IDS[(GAME_IDS.indexOf(id) + 1) % GAME_IDS.length];
}

// assets/scripts/core/Speed.ts
var SPEED_TABLE_MS = [1000, 850, 720, 600, 500, 400, 320, 250, 190, 140];
var MIN_SPEED = 1;
var MAX_SPEED = 10;
var MIN_LEVEL = 1;
var MAX_LEVEL = 10;
function clampSpeed(speed) {
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(speed)));
}
function clampLevel(level) {
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(level)));
}
function speedInterval(speed, scale = 1) {
  return Math.round(SPEED_TABLE_MS[clampSpeed(speed) - 1] * scale);
}

// assets/scripts/data/SaveData.ts
function defaultSaveData() {
  return {
    version: 1,
    hiScores: { A: 0, B: 0, C: 0, D: 0 },
    sound: true,
    lastGame: "A",
    level: 1,
    speed: 1
  };
}
function isSaveData(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value;
  const hi = v.hiScores;
  return v.version === 1 && typeof hi === "object" && hi !== null && ["A", "B", "C", "D"].every((id) => typeof hi[id] === "number") && typeof v.sound === "boolean" && (v.lastGame === "A" || v.lastGame === "B" || v.lastGame === "C" || v.lastGame === "D") && typeof v.level === "number" && typeof v.speed === "number";
}

// assets/scripts/data/SaveManager.ts
var SAVE_KEY = "brick-game:save";

class SaveManager {
  storage;
  data;
  constructor(storage) {
    this.storage = storage;
    this.data = this.load();
  }
  get save() {
    return this.data;
  }
  update(patch) {
    this.data = { ...this.data, ...patch, hiScores: { ...this.data.hiScores, ...patch.hiScores } };
    this.persist();
  }
  recordScore(game, score) {
    if (score > this.data.hiScores[game]) {
      this.update({ hiScores: { ...this.data.hiScores, [game]: score } });
    }
    return this.data.hiScores[game];
  }
  reset() {
    this.data = defaultSaveData();
    this.persist();
  }
  load() {
    try {
      const raw = this.storage.getItem(SAVE_KEY);
      if (!raw) {
        return defaultSaveData();
      }
      const parsed = JSON.parse(raw);
      return isSaveData(parsed) ? parsed : defaultSaveData();
    } catch {
      return defaultSaveData();
    }
  }
  persist() {
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch {}
  }
}

// assets/scripts/utils/Random.ts
function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = state + 1831565813 >>> 0;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function randomInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}
function shuffle(rng, items) {
  for (let i = items.length - 1;i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}
function pick(rng, items) {
  if (items.length === 0) {
    throw new Error("pick() from an empty array");
  }
  return items[Math.floor(rng() * items.length)];
}

// assets/scripts/core/Console.ts
var MAX_SCORE = 999999;
var BLINK_MS = 500;
var CONTINUE_OFFER_MS = 6000;
var CONTINUE_AWAIT_MAX_MS = 30000;
var SELECT_DEMO_MS = 250;
var SELECT_DEMO_FRAMES = [
  ["#...", ".#..", "..#.", "...#"],
  ["..#.", "..#.", ".#..", ".#.."],
  ["...#", "..#.", ".#..", "#..."],
  [".#..", ".#..", "..#.", "..#."]
];

class Console {
  createGame;
  frame = new LcdFrame;
  stateValue = "OFF";
  input = new InputController;
  curtain = new Curtain;
  saves;
  seed;
  gameId;
  level;
  speed;
  score = 0;
  game = null;
  ctx = null;
  blinkTimer = 0;
  blinkPhaseValue = true;
  demoTimer = 0;
  demoFrame = 0;
  pendingSounds = [];
  pendingRequests = [];
  offerContinue;
  offerTimer = 0;
  runMs = 0;
  awaitTimer = 0;
  awaitingAd = false;
  constructor(storage, createGame2, options = {}) {
    this.createGame = createGame2;
    this.saves = new SaveManager(storage);
    this.seed = options.seed ?? (() => Date.now() >>> 0);
    this.offerContinue = options.offerContinue ?? (() => false);
    this.gameId = this.saves.save.lastGame;
    this.level = clampLevel(this.saves.save.level);
    this.speed = clampSpeed(this.saves.save.speed);
    this.frame.powerOff();
  }
  get state() {
    return this.stateValue;
  }
  get selectedGame() {
    return this.gameId;
  }
  get currentLevel() {
    return this.level;
  }
  get currentSpeed() {
    return this.speed;
  }
  get currentScore() {
    return this.score;
  }
  get soundEnabled() {
    return this.saves.save.sound;
  }
  get blinkPhase() {
    return this.blinkPhaseValue;
  }
  hiScore(id = this.gameId) {
    return this.saves.save.hiScores[id];
  }
  drainSounds() {
    const out = this.pendingSounds;
    this.pendingSounds = [];
    return out;
  }
  drainRequests() {
    const out = this.pendingRequests;
    this.pendingRequests = [];
    return out;
  }
  acceptContinue() {
    if (this.stateValue !== "CONTINUE_OFFER" || this.awaitingAd) {
      return;
    }
    this.awaitingAd = true;
    this.awaitTimer = CONTINUE_AWAIT_MAX_MS;
    this.pendingRequests.push("continueRequested");
    this.drawOffer();
  }
  declineContinue() {
    if (this.stateValue !== "CONTINUE_OFFER" || this.awaitingAd) {
      return;
    }
    this.endGame();
  }
  resolveContinue(result) {
    if (this.stateValue !== "CONTINUE_OFFER") {
      return;
    }
    this.awaitingAd = false;
    if (result === "completed" && this.game?.revive?.()) {
      this.transition("PLAYING");
      this.emit("start");
      this.drawGame();
      return;
    }
    this.endGame();
  }
  press(button) {
    this.input.press(button);
  }
  release(button) {
    this.input.release(button);
  }
  releaseAll() {
    this.input.releaseAll();
  }
  tick(dtMs) {
    const input = this.input.sample(dtMs);
    this.advanceBlink(dtMs);
    if (input.isPressed("power")) {
      this.togglePower();
    }
    if (this.stateValue === "OFF") {
      return;
    }
    if (input.isPressed("sound")) {
      this.toggleSound();
    }
    switch (this.stateValue) {
      case "POWER_ON":
        this.tickPowerOn(dtMs);
        break;
      case "SELECT":
        this.tickSelect(dtMs, input);
        break;
      case "PLAYING":
        this.tickPlaying(dtMs, input);
        break;
      case "PAUSED":
        this.tickPaused(input);
        break;
      case "CONTINUE_OFFER":
        this.tickOffer(dtMs, input);
        break;
      case "GAME_OVER":
        this.tickGameOver(dtMs);
        break;
    }
    this.frame.indicators = {
      sound: this.saves.save.sound,
      pause: this.stateValue === "PAUSED"
    };
  }
  transition(to) {
    assertTransition(this.stateValue, to);
    this.stateValue = to;
  }
  togglePower() {
    if (this.stateValue === "OFF") {
      this.transition("POWER_ON");
      this.curtain.start();
      this.frame.clear();
      this.frame.score = 0;
      this.frame.hiScore = this.hiScore();
      this.frame.level = this.level;
      this.frame.speed = this.speed;
      this.emit("power");
    } else {
      this.transition("OFF");
      this.game = null;
      this.ctx = null;
      this.score = 0;
      this.awaitingAd = false;
      this.frame.powerOff();
      this.input.releaseAll();
    }
  }
  toggleSound() {
    this.saves.update({ sound: !this.saves.save.sound });
    this.emit("select");
  }
  enterSelect() {
    this.transition("SELECT");
    this.game = null;
    this.ctx = null;
    this.score = 0;
    this.demoTimer = 0;
    this.demoFrame = 0;
  }
  startGame() {
    this.transition("PLAYING");
    this.score = 0;
    this.runMs = 0;
    this.saves.update({ lastGame: this.gameId, level: this.level, speed: this.speed });
    const ctx = new MutableContext(this.level, this.speed, createRng(this.seed()), (e) => this.emit(e));
    this.ctx = ctx;
    this.game = this.createGame(this.gameId);
    this.game.reset(ctx);
    this.emit("start");
  }
  endGame() {
    this.transition("GAME_OVER");
    this.curtain.start();
    this.emit("gameOver");
  }
  beginGameOver() {
    if (this.game?.revive && this.offerContinue({ score: this.score, runMs: this.runMs })) {
      this.transition("CONTINUE_OFFER");
      this.offerTimer = CONTINUE_OFFER_MS;
      this.awaitingAd = false;
      this.emit("select");
      this.drawOffer();
      return;
    }
    this.endGame();
  }
  tickOffer(dtMs, input) {
    if (this.awaitingAd) {
      this.awaitTimer -= dtMs;
      if (this.awaitTimer <= 0) {
        this.awaitingAd = false;
        this.endGame();
        return;
      }
      this.drawOffer();
      return;
    }
    if (input.isPressed("start")) {
      this.acceptContinue();
      return;
    }
    this.offerTimer -= dtMs;
    if (input.isPressed("reset") || this.offerTimer <= 0) {
      this.endGame();
      return;
    }
    this.drawOffer();
  }
  drawOffer() {
    const frame = this.frame;
    frame.clear();
    if (this.blinkPhaseValue || this.awaitingAd) {
      frame.blit(LETTER_GLYPHS.A, 0, 6);
      frame.blit(LETTER_GLYPHS.D, 5, 6);
    }
    frame.blitPreview(PLAY_GLYPH);
    frame.score = this.score;
    frame.hiScore = this.hiScore();
    frame.level = this.level;
    frame.speed = this.speed;
  }
  tickPowerOn(dtMs) {
    this.curtain.tick(dtMs);
    this.frame.clear();
    this.curtain.draw(this.frame);
    if (this.curtain.done) {
      this.enterSelect();
      this.drawSelect(0);
    }
  }
  tickSelect(dtMs, input) {
    if (input.isPressed("rotate")) {
      this.gameId = nextGameId(this.gameId);
      this.emit("select");
    }
    if (input.isPressed("up")) {
      this.setLevel(this.level + 1);
    }
    if (input.isPressed("down")) {
      this.setLevel(this.level - 1);
    }
    if (input.isPressed("right")) {
      this.setSpeed(this.speed + 1);
    }
    if (input.isPressed("left")) {
      this.setSpeed(this.speed - 1);
    }
    if (input.isPressed("start")) {
      this.startGame();
      this.drawGame();
      return;
    }
    this.drawSelect(dtMs);
  }
  tickPlaying(dtMs, input) {
    if (input.isPressed("start")) {
      this.transition("PAUSED");
      this.emit("select");
      return;
    }
    if (input.isPressed("reset")) {
      this.enterSelect();
      this.drawSelect(0);
      return;
    }
    this.runMs += dtMs;
    const game = this.game;
    if (!game) {
      throw new Error("PLAYING without a game");
    }
    const result = game.update(dtMs, input);
    this.score = Math.min(MAX_SCORE, Math.max(0, Math.floor(result.score)));
    this.saves.recordScore(this.gameId, this.score);
    if (result.speedUp) {
      this.autoSpeedUp();
    }
    this.drawGame();
    if (result.gameOver) {
      this.beginGameOver();
    }
  }
  tickPaused(input) {
    if (input.isPressed("start")) {
      this.transition("PLAYING");
      this.emit("select");
      return;
    }
    if (input.isPressed("reset")) {
      this.enterSelect();
      this.drawSelect(0);
    }
  }
  tickGameOver(dtMs) {
    this.curtain.tick(dtMs);
    this.drawGame();
    this.curtain.draw(this.frame);
    if (this.curtain.done) {
      this.enterSelect();
      this.drawSelect(0);
    }
  }
  setLevel(level) {
    const next = clampLevel(level);
    if (next !== this.level) {
      this.level = next;
      this.emit("select");
    }
  }
  setSpeed(speed) {
    const next = clampSpeed(speed);
    if (next !== this.speed) {
      this.speed = next;
      this.emit("select");
    }
  }
  autoSpeedUp() {
    if (this.speed < MAX_SPEED) {
      this.speed++;
    } else if (this.level < MAX_LEVEL) {
      this.speed = MIN_SPEED;
      this.level++;
    }
    this.ctx?.setSpeed(this.speed);
    this.ctx?.setLevel(this.level);
    this.saves.update({ level: this.level, speed: this.speed });
  }
  drawSelect(dtMs) {
    const frame = this.frame;
    frame.clear();
    frame.blit(LETTER_GLYPHS[this.gameId], 2, 6);
    this.demoTimer += dtMs;
    while (this.demoTimer >= SELECT_DEMO_MS) {
      this.demoTimer -= SELECT_DEMO_MS;
      this.demoFrame = (this.demoFrame + 1) % SELECT_DEMO_FRAMES.length;
    }
    frame.blitPreview(SELECT_DEMO_FRAMES[this.demoFrame]);
    frame.score = this.hiScore();
    frame.hiScore = this.hiScore();
    frame.level = this.blinkPhaseValue ? this.level : null;
    frame.speed = this.blinkPhaseValue ? this.speed : null;
  }
  drawGame() {
    const game = this.game;
    if (!game) {
      return;
    }
    const frame = this.frame;
    frame.clear();
    game.draw(frame, this.blinkPhaseValue);
    frame.score = this.score;
    frame.hiScore = this.hiScore();
    frame.level = this.level;
    frame.speed = this.speed;
  }
  advanceBlink(dtMs) {
    this.blinkTimer += dtMs;
    while (this.blinkTimer >= BLINK_MS) {
      this.blinkTimer -= BLINK_MS;
      this.blinkPhaseValue = !this.blinkPhaseValue;
    }
  }
  emit(event) {
    this.pendingSounds.push(event);
  }
}

class MutableContext {
  rng;
  emit;
  levelValue;
  speedValue;
  constructor(level, speed, rng, emit) {
    this.rng = rng;
    this.emit = emit;
    this.levelValue = level;
    this.speedValue = speed;
  }
  get level() {
    return this.levelValue;
  }
  get speed() {
    return this.speedValue;
  }
  setLevel(level) {
    this.levelValue = level;
  }
  setSpeed(speed) {
    this.speedValue = speed;
  }
  sound(event) {
    this.emit(event);
  }
}

// assets/scripts/core/SoundEvent.ts
var SOUND_EVENTS = [
  "move",
  "rotate",
  "land",
  "clear",
  "shoot",
  "hit",
  "eat",
  "crash",
  "gameOver",
  "start",
  "select",
  "power"
];

// assets/scripts/core/SoundSpecs.ts
var SOUND_ASSET_DIR = "audio";
function soundFileName(event) {
  return `${event}.wav`;
}

// assets/scripts/core/StepClock.ts
class StepClock {
  maxStepsPerFrame;
  accumulator = 0;
  constructor(maxStepsPerFrame = 5) {
    this.maxStepsPerFrame = maxStepsPerFrame;
  }
  reset() {
    this.accumulator = 0;
  }
  advance(dtMs, intervalMs) {
    this.accumulator += Math.max(0, dtMs);
    let steps = 0;
    while (this.accumulator >= intervalMs && steps < this.maxStepsPerFrame) {
      this.accumulator -= intervalMs;
      steps++;
    }
    if (steps === this.maxStepsPerFrame) {
      this.accumulator = 0;
    }
    return steps;
  }
}

// assets/scripts/games/racing/RacingSprites.ts
var CAR_SPRITE = [".#.", "###", ".#.", "#.#"];

// assets/scripts/games/racing/RacingModule.ts
var LANE_X = [1, 4, 7];
var RACING_GAP = [8, 7, 7, 6, 6, 5, 5, 4, 4, 4];
var PLAYER_Y = 16;
var SPAWN_Y = -4;
var OCCUPIED_WINDOW = 8;
var STEP_SCALE = 0.4;
var CRASH_TOGGLE_MS = 100;
var CRASH_TOGGLES = 6;
var CRASH_DURATION_MS = CRASH_TOGGLE_MS * CRASH_TOGGLES;
var PASS_SCORE = 100;
var PASSES_PER_SPEED_UP = 10;
function carsOverlap(ax, ay, bx, by) {
  for (let row = 0;row < CAR_SPRITE.length; row++) {
    const line = CAR_SPRITE[row];
    for (let col = 0;col < line.length; col++) {
      if (line[col] !== "#") {
        continue;
      }
      const localRow = ay + row - by;
      const localCol = ax + col - bx;
      if (localRow < 0 || localRow >= CAR_SPRITE.length) {
        continue;
      }
      if (localCol < 0 || localCol >= CAR_SPRITE[localRow].length) {
        continue;
      }
      if (CAR_SPRITE[localRow][localCol] === "#") {
        return true;
      }
    }
  }
  return false;
}
function kerbLit(y, scroll) {
  const phase = ((y - scroll) % 4 + 4) % 4;
  return phase < 3;
}

class RacingModule {
  id = "D";
  ctx;
  clock = new StepClock;
  scroll = 0;
  playerLane = 1;
  enemies = [];
  spawnCountdown = RACING_GAP[0];
  score = 0;
  passCount = 0;
  crashing = false;
  crashElapsedMs = 0;
  crashVisible = true;
  reset(ctx) {
    this.ctx = ctx;
    this.clock.reset();
    this.scroll = 0;
    this.playerLane = 1;
    this.enemies = [];
    this.spawnCountdown = this.gapForLevel();
    this.score = 0;
    this.passCount = 0;
    this.crashing = false;
    this.crashElapsedMs = 0;
    this.crashVisible = true;
  }
  update(dtMs, input) {
    if (this.crashing) {
      this.crashElapsedMs += dtMs;
      const toggles = Math.floor(this.crashElapsedMs / CRASH_TOGGLE_MS);
      this.crashVisible = toggles % 2 === 0;
      const gameOver = this.crashElapsedMs >= CRASH_DURATION_MS;
      return { score: this.score, gameOver, speedUp: false };
    }
    if (input.isPressed("left") && this.playerLane > 0) {
      this.playerLane -= 1;
      this.ctx.sound("move");
    }
    if (input.isPressed("right") && this.playerLane < LANE_X.length - 1) {
      this.playerLane += 1;
      this.ctx.sound("move");
    }
    const baseInterval = speedInterval(this.ctx.speed, STEP_SCALE);
    const interval = input.isHeld("down") ? Math.round(baseInterval / 2) : baseInterval;
    const steps = this.clock.advance(dtMs, interval);
    let speedUp = false;
    for (let i = 0;i < steps; i++) {
      this.scroll = (this.scroll + 1) % 4;
      this.spawnCountdown -= 1;
      if (this.spawnCountdown <= 0) {
        this.spawnFairly();
        this.spawnCountdown = this.gapForLevel();
      }
      for (const enemy of this.enemies) {
        enemy.y += 1;
      }
      this.enemies = this.enemies.filter((enemy) => {
        if (enemy.y < ROWS) {
          return true;
        }
        this.score += PASS_SCORE;
        this.passCount += 1;
        this.ctx.sound("select");
        if (this.passCount % PASSES_PER_SPEED_UP === 0) {
          speedUp = true;
        }
        return false;
      });
      if (this.enemies.some((enemy) => this.collidesWithPlayer(enemy))) {
        this.ctx.sound("crash");
        this.crashing = true;
        this.crashElapsedMs = 0;
        this.crashVisible = true;
        break;
      }
    }
    return { score: this.score, gameOver: false, speedUp };
  }
  draw(frame) {
    frame.clearPreview();
    for (let y = 0;y < ROWS; y++) {
      frame.set(0, y, kerbLit(y, this.scroll));
    }
    for (const enemy of this.enemies) {
      frame.blit(CAR_SPRITE, LANE_X[enemy.lane], enemy.y);
    }
    if (!this.crashing || this.crashVisible) {
      frame.blit(CAR_SPRITE, LANE_X[this.playerLane], PLAYER_Y);
    }
  }
  revive() {
    this.enemies = [];
    this.spawnCountdown = this.gapForLevel();
    this.crashing = false;
    this.crashElapsedMs = 0;
    this.crashVisible = true;
    this.clock.reset();
    return true;
  }
  spawnEnemy(lane, y) {
    if (!Number.isInteger(lane) || lane < 0 || lane >= LANE_X.length) {
      throw new Error(`lane ${lane} is not one of the ${LANE_X.length} lanes`);
    }
    this.enemies.push({ lane, y });
  }
  get lane() {
    return this.playerLane;
  }
  get activeEnemies() {
    return this.enemies;
  }
  gapForLevel() {
    const level = Math.min(Math.max(Math.round(this.ctx.level), 1), 10);
    return RACING_GAP[level - 1];
  }
  collidesWithPlayer(enemy) {
    return carsOverlap(LANE_X[this.playerLane], PLAYER_Y, LANE_X[enemy.lane], enemy.y);
  }
  spawnFairly() {
    const occupied = LANE_X.map((_, lane2) => this.laneOccupiedNearTop(lane2));
    const allowed = [];
    for (let lane2 = 0;lane2 < LANE_X.length; lane2++) {
      const otherA = occupied[(lane2 + 1) % LANE_X.length];
      const otherB = occupied[(lane2 + 2) % LANE_X.length];
      if (!(otherA && otherB)) {
        allowed.push(lane2);
      }
    }
    const lane = pick(this.ctx.rng, allowed);
    this.spawnEnemy(lane, SPAWN_Y);
  }
  laneOccupiedNearTop(lane) {
    return this.enemies.some((enemy) => enemy.lane === lane && enemy.y < OCCUPIED_WINDOW);
  }
}

// assets/scripts/games/snake/SnakeWalls.ts
var ROW_WALLS = [5, 14].flatMap((y) => [3, 4, 5, 6].map((x) => ({ x, y })));
var COLUMN_WALLS = [1, 8].flatMap((x) => [15, 16, 17, 18].map((y) => ({ x, y })));
function wallsForLevel(level) {
  if (level < 4) {
    return [];
  }
  if (level < 7) {
    return ROW_WALLS;
  }
  return [...ROW_WALLS, ...COLUMN_WALLS];
}

// assets/scripts/games/snake/SnakeModule.ts
var DIRECTIONS = ["up", "down", "left", "right"];
var DIRECTION_VECTORS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
};
var OPPOSITE = {
  up: "down",
  down: "up",
  left: "right",
  right: "left"
};
var SPEED_SCALE = 0.6;
var FOODS_PER_SPEED_UP = 10;
var PREVIEW_CELL_COUNT = PREVIEW_SIZE * PREVIEW_SIZE;
function key(x, y) {
  return `${x},${y}`;
}

class SnakeModule {
  id = "C";
  ctx = null;
  body = [];
  direction = "right";
  nextDirection = "right";
  food = { x: 0, y: 0 };
  score = 0;
  foodsEaten = 0;
  over = false;
  speedUpPending = false;
  clock = new StepClock;
  wallCells = [];
  wallSet = new Set;
  reset(ctx) {
    this.ctx = ctx;
    this.body = [
      { x: 5, y: 10 },
      { x: 4, y: 10 },
      { x: 3, y: 10 }
    ];
    this.direction = "right";
    this.nextDirection = "right";
    this.score = 0;
    this.foodsEaten = 0;
    this.over = false;
    this.speedUpPending = false;
    this.clock.reset();
    this.wallCells = wallsForLevel(ctx.level);
    this.wallSet = new Set(this.wallCells.map((c) => key(c.x, c.y)));
    this.spawnFood();
  }
  update(dtMs, input) {
    if (!this.ctx) {
      throw new Error("SnakeModule.update called before reset");
    }
    if (!this.over) {
      this.handleInput(input);
      this.speedUpPending = false;
      const interval = speedInterval(this.ctx.speed, SPEED_SCALE);
      const steps = this.clock.advance(dtMs, interval);
      for (let i = 0;i < steps && !this.over; i++) {
        this.step();
      }
    }
    return { score: this.score, gameOver: this.over, speedUp: this.speedUpPending };
  }
  draw(frame, blinkPhase) {
    for (const cell of this.wallCells) {
      frame.set(cell.x, cell.y, true);
    }
    for (const cell of this.body) {
      frame.set(cell.x, cell.y, true);
    }
    if (blinkPhase) {
      frame.set(this.food.x, this.food.y, true);
    }
    this.drawPreview(frame);
  }
  getHead() {
    return { ...this.body[0] };
  }
  getBody() {
    return this.body.map((c) => ({ ...c }));
  }
  getFood() {
    return { ...this.food };
  }
  getFoodsEaten() {
    return this.foodsEaten;
  }
  placeFood(x, y) {
    this.food = { x, y };
  }
  handleInput(input) {
    for (const dir of DIRECTIONS) {
      if (input.isPressed(dir) && dir !== OPPOSITE[this.direction] && dir !== this.nextDirection) {
        this.nextDirection = dir;
        this.ctx?.sound("move");
      }
    }
  }
  step() {
    const ctx = this.ctx;
    if (!ctx || this.over) {
      return;
    }
    this.direction = this.nextDirection;
    const vector = DIRECTION_VECTORS[this.direction];
    const head = this.body[0];
    const next = { x: head.x + vector.x, y: head.y + vector.y };
    if (!this.inBounds(next) || this.wallSet.has(key(next.x, next.y))) {
      this.over = true;
      ctx.sound("crash");
      return;
    }
    const willEat = next.x === this.food.x && next.y === this.food.y;
    const bodyToCheck = willEat ? this.body : this.body.slice(0, -1);
    if (bodyToCheck.some((c) => c.x === next.x && c.y === next.y)) {
      this.over = true;
      ctx.sound("crash");
      return;
    }
    this.body.unshift(next);
    if (willEat) {
      this.score += 10 * ctx.level;
      this.foodsEaten++;
      ctx.sound("eat");
      if (this.foodsEaten % FOODS_PER_SPEED_UP === 0) {
        this.speedUpPending = true;
      }
      this.spawnFood();
    } else {
      this.body.pop();
    }
  }
  inBounds(p) {
    return p.x >= 0 && p.x < COLS && p.y >= 0 && p.y < ROWS;
  }
  revive() {
    const back = OPPOSITE[this.direction];
    const v = DIRECTION_VECTORS[back];
    const head = this.body[0] ?? { x: 5, y: 10 };
    let cells = [head, { x: head.x + v.x, y: head.y + v.y }, { x: head.x + 2 * v.x, y: head.y + 2 * v.y }];
    const blocked = (p) => !this.inBounds(p) || this.wallSet.has(key(p.x, p.y));
    if (cells.some(blocked)) {
      cells = [
        { x: 5, y: 10 },
        { x: 4, y: 10 },
        { x: 3, y: 10 }
      ];
      this.direction = "right";
      this.nextDirection = "right";
    } else {
      this.nextDirection = this.direction;
    }
    this.body = cells;
    const bodySet = new Set(cells.map((c) => key(c.x, c.y)));
    const candidates = [this.direction, ...DIRECTIONS.filter((d) => d !== this.direction && d !== OPPOSITE[this.direction]), OPPOSITE[this.direction]];
    for (const dir of candidates) {
      const step = DIRECTION_VECTORS[dir];
      const next = { x: cells[0].x + step.x, y: cells[0].y + step.y };
      if (!blocked(next) && !bodySet.has(key(next.x, next.y))) {
        this.direction = dir;
        this.nextDirection = dir;
        break;
      }
    }
    this.over = false;
    this.clock.reset();
    this.spawnFood();
    return true;
  }
  spawnFood() {
    const ctx = this.ctx;
    if (!ctx) {
      return;
    }
    const occupied = new Set(this.body.map((c) => key(c.x, c.y)));
    const free = [];
    for (let y = 0;y < ROWS; y++) {
      for (let x = 0;x < COLS; x++) {
        const k = key(x, y);
        if (!occupied.has(k) && !this.wallSet.has(k)) {
          free.push({ x, y });
        }
      }
    }
    if (free.length === 0) {
      return;
    }
    this.food = pick(ctx.rng, free);
  }
  drawPreview(frame) {
    const count = this.foodsEaten % PREVIEW_CELL_COUNT;
    for (let i = 0;i < count; i++) {
      frame.setPreview(i % PREVIEW_SIZE, Math.floor(i / PREVIEW_SIZE), true);
    }
  }
}

// assets/scripts/games/tank/TankRules.ts
function boxesOverlap(a, b, size = 3) {
  return a.x < b.x + size && a.x + size > b.x && a.y < b.y + size && a.y + size > b.y;
}
function boxInBounds(x, y, size, cols, rows) {
  return x >= 0 && y >= 0 && x + size <= cols && y + size <= rows;
}
function cellLit(sprite, originX, originY, cellX, cellY) {
  const row = cellY - originY;
  const col = cellX - originX;
  if (row < 0 || row >= sprite.length) {
    return false;
  }
  const line = sprite[row];
  if (col < 0 || col >= line.length) {
    return false;
  }
  return line[col] === "#";
}
function chooseSpawnSlot(rng, slots, isOccupied) {
  const free = slots.filter((x) => !isOccupied(x));
  if (free.length === 0) {
    return null;
  }
  return pick(rng, free);
}

// assets/scripts/games/tank/TankSprites.ts
var TANK_SIZE = 3;
var TANK_SPRITES = {
  up: [".#.", "###", "#.#"],
  down: ["#.#", "###", ".#."],
  left: [".##", "##.", ".##"],
  right: ["##.", ".##", "##."]
};
var EXPLOSION_SPRITE = ["#.#", ".#.", "#.#"];
var FACING_DELTA = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 }
};
function frontOf(box, facing) {
  const { dx, dy } = FACING_DELTA[facing];
  const centerX = box.x + 1;
  const centerY = box.y + 1;
  return { x: centerX + dx * 2, y: centerY + dy * 2 };
}

// assets/scripts/games/tank/TankModule.ts
var BULLET_INTERVAL_MS = 40;
var ENEMY_SPEED_SCALE = 0.5;
var MAX_LIVES = 3;
var KILLS_PER_SPEEDUP = 10;
var EXPLOSION_STEPS = 2;
var SPAWN_SLOTS = [0, 3, 6];
var SPAWN_Y2 = 0;
var BOTTOM_WRAP_Y = 17;
var PLAYER_SPAWN = { x: 3, y: 17 };
var RESPAWN_CLEAR_SIZE = 6;
var RESPAWN_GRACE_STEPS = 4;
var LIFE_CELLS = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 0, y: 2 }
];
var DIRECTION_BUTTONS = [
  ["up", "up"],
  ["down", "down"],
  ["left", "left"],
  ["right", "right"]
];
function enemyCap(level) {
  return Math.min(1 + Math.floor(level / 3), 4);
}

class TankModule {
  id = "B";
  ctx = null;
  bulletClock = new StepClock;
  enemyClock = new StepClock;
  player = {
    x: PLAYER_SPAWN.x,
    y: PLAYER_SPAWN.y,
    facing: "up"
  };
  bullets = [];
  enemies = [];
  explosions = [];
  nextEnemyId = 1;
  score = 0;
  livesLeft = MAX_LIVES;
  invulnerableSteps = 0;
  kills = 0;
  gameOver = false;
  pendingSpeedUp = false;
  reset(ctx) {
    this.ctx = ctx;
    this.bulletClock.reset();
    this.enemyClock.reset();
    this.player = { x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y, facing: "up" };
    this.bullets = [];
    this.enemies = [];
    this.explosions = [];
    this.nextEnemyId = 1;
    this.score = 0;
    this.livesLeft = MAX_LIVES;
    this.kills = 0;
    this.gameOver = false;
    this.pendingSpeedUp = false;
  }
  update(dtMs, input) {
    const ctx = this.requireCtx();
    this.pendingSpeedUp = false;
    this.handleInput(input);
    const bulletSteps = this.bulletClock.advance(dtMs, BULLET_INTERVAL_MS);
    for (let i = 0;i < bulletSteps && !this.gameOver; i++) {
      this.stepBullets();
    }
    const enemyIntervalMs = speedInterval(ctx.speed, ENEMY_SPEED_SCALE);
    const enemySteps = this.enemyClock.advance(dtMs, enemyIntervalMs);
    for (let i = 0;i < enemySteps && !this.gameOver; i++) {
      this.stepEnemies();
    }
    return { score: this.score, gameOver: this.gameOver, speedUp: this.pendingSpeedUp };
  }
  draw(frame, blinkPhase) {
    for (const enemy of this.enemies) {
      frame.blit(TANK_SPRITES.down, enemy.x, enemy.y);
    }
    if (this.invulnerableSteps === 0 || blinkPhase) {
      frame.blit(TANK_SPRITES[this.player.facing], this.player.x, this.player.y);
    }
    for (const bullet of this.bullets) {
      frame.set(bullet.x, bullet.y, true);
    }
    if (blinkPhase) {
      for (const explosion of this.explosions) {
        frame.blit(EXPLOSION_SPRITE, explosion.x, explosion.y);
      }
    }
    for (let i = 0;i < this.livesLeft && i < LIFE_CELLS.length; i++) {
      const cell = LIFE_CELLS[i];
      frame.setPreview(cell.x, cell.y, true);
    }
  }
  get playerPosition() {
    return { x: this.player.x, y: this.player.y, facing: this.player.facing };
  }
  get lives() {
    return this.livesLeft;
  }
  get killCount() {
    return this.kills;
  }
  get enemyList() {
    return this.enemies;
  }
  get bulletList() {
    return this.bullets;
  }
  spawnEnemyAt(x, y) {
    if (!boxInBounds(x, y, TANK_SIZE, COLS, ROWS)) {
      return false;
    }
    if (this.enemies.some((enemy) => boxesOverlap({ x, y }, enemy))) {
      return false;
    }
    this.enemies.push({ id: this.nextEnemyId++, x, y });
    return true;
  }
  requireCtx() {
    if (!this.ctx) {
      throw new Error("TankModule.update called before reset");
    }
    return this.ctx;
  }
  handleInput(input) {
    for (const [button, facing] of DIRECTION_BUTTONS) {
      if (input.isPressed(button)) {
        this.tryMoveOrTurn(facing);
        break;
      }
    }
    if (input.isPressed("rotate")) {
      this.tryFire();
    }
  }
  tryMoveOrTurn(facing) {
    if (this.player.facing !== facing) {
      this.player.facing = facing;
      return;
    }
    const { dx, dy } = FACING_DELTA[facing];
    const nx = this.player.x + dx;
    const ny = this.player.y + dy;
    if (!boxInBounds(nx, ny, TANK_SIZE, COLS, ROWS)) {
      return;
    }
    if (this.enemies.some((enemy) => boxesOverlap({ x: nx, y: ny }, enemy))) {
      return;
    }
    this.player.x = nx;
    this.player.y = ny;
    this.ctx?.sound("move");
  }
  tryFire() {
    if (this.bullets.some((bullet) => bullet.owner === "player")) {
      return;
    }
    const front = frontOf(this.player, this.player.facing);
    const { dx, dy } = FACING_DELTA[this.player.facing];
    this.bullets.push({ x: front.x, y: front.y, dx, dy, owner: "player" });
    this.ctx?.sound("shoot");
  }
  stepBullets() {
    for (const bullet of this.bullets) {
      bullet.x += bullet.dx;
      bullet.y += bullet.dy;
    }
    this.bullets = this.bullets.filter((b) => b.x >= 0 && b.x < COLS && b.y >= 0 && b.y < ROWS);
    const playerBullet = this.bullets.find((b) => b.owner === "player");
    if (playerBullet) {
      const enemyBullet = this.bullets.find((b) => b.owner === "enemy" && b.x === playerBullet.x && b.y === playerBullet.y);
      if (enemyBullet) {
        this.bullets = this.bullets.filter((b) => b !== playerBullet && b !== enemyBullet);
      }
    }
    const survivingPlayerBullet = this.bullets.find((b) => b.owner === "player");
    if (survivingPlayerBullet) {
      const target = this.enemies.find((enemy) => cellLit(TANK_SPRITES.down, enemy.x, enemy.y, survivingPlayerBullet.x, survivingPlayerBullet.y));
      if (target) {
        this.killEnemy(target);
        this.bullets = this.bullets.filter((b) => b !== survivingPlayerBullet);
      }
    }
    if (this.gameOver) {
      return;
    }
    const hitByEnemyBullet = this.bullets.find((b) => b.owner === "enemy" && cellLit(TANK_SPRITES[this.player.facing], this.player.x, this.player.y, b.x, b.y));
    if (hitByEnemyBullet && this.invulnerableSteps === 0) {
      this.loseLife();
    }
  }
  killEnemy(enemy) {
    this.enemies = this.enemies.filter((e) => e !== enemy);
    this.explosions.push({ x: enemy.x, y: enemy.y, stepsLeft: EXPLOSION_STEPS });
    this.score += 100;
    this.kills++;
    this.ctx?.sound("hit");
    if (this.kills % KILLS_PER_SPEEDUP === 0) {
      this.pendingSpeedUp = true;
    }
  }
  loseLife() {
    this.livesLeft--;
    this.bullets = [];
    this.ctx?.sound("crash");
    if (this.livesLeft <= 0) {
      this.gameOver = true;
      return;
    }
    this.player = { x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y, facing: "up" };
    this.enemies = this.enemies.filter((enemy) => !boxesOverlap(this.player, enemy, RESPAWN_CLEAR_SIZE));
    this.invulnerableSteps = RESPAWN_GRACE_STEPS;
  }
  revive() {
    this.livesLeft = Math.max(this.livesLeft, 1);
    this.gameOver = false;
    this.bullets = [];
    this.player = { x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y, facing: "up" };
    this.enemies = this.enemies.filter((enemy) => !boxesOverlap(this.player, enemy, RESPAWN_CLEAR_SIZE));
    this.invulnerableSteps = RESPAWN_GRACE_STEPS;
    return true;
  }
  get invulnerable() {
    return this.invulnerableSteps > 0;
  }
  stepEnemies() {
    const ctx = this.requireCtx();
    for (const enemy of [...this.enemies]) {
      if (!this.enemies.includes(enemy)) {
        continue;
      }
      const roll = ctx.rng();
      if (roll < 0.6) {
        this.moveEnemyDown(enemy);
      } else if (roll < 0.9) {
        this.moveEnemySideways(enemy);
      } else {
        this.tryEnemyFire(enemy);
      }
    }
    if (this.invulnerableSteps > 0) {
      this.invulnerableSteps--;
    } else if (!this.gameOver) {
      const collided = this.enemies.find((enemy) => boxesOverlap(this.player, enemy));
      if (collided) {
        this.loseLife();
      }
    }
    this.explosions = this.explosions.filter((explosion) => --explosion.stepsLeft > 0);
    this.trySpawnEnemy();
  }
  moveEnemyDown(enemy) {
    const ny = enemy.y + 1;
    if (ny > BOTTOM_WRAP_Y) {
      this.enemies = this.enemies.filter((e) => e !== enemy);
      return;
    }
    const blocked = this.enemies.some((other) => other !== enemy && boxesOverlap({ x: enemy.x, y: ny }, other));
    if (!blocked) {
      enemy.y = ny;
    }
  }
  moveEnemySideways(enemy) {
    const ctx = this.requireCtx();
    const dir = ctx.rng() < 0.5 ? -1 : 1;
    const nx = enemy.x + dir;
    if (!boxInBounds(nx, enemy.y, TANK_SIZE, COLS, ROWS)) {
      return;
    }
    const blocked = this.enemies.some((other) => other !== enemy && boxesOverlap({ x: nx, y: enemy.y }, other));
    if (!blocked) {
      enemy.x = nx;
    }
  }
  tryEnemyFire(enemy) {
    if (this.bullets.some((b) => b.owner === "enemy" && b.enemyId === enemy.id)) {
      return;
    }
    const front = frontOf(enemy, "down");
    this.bullets.push({ x: front.x, y: front.y, dx: 0, dy: 1, owner: "enemy", enemyId: enemy.id });
  }
  trySpawnEnemy() {
    const ctx = this.requireCtx();
    const cap = enemyCap(ctx.level);
    if (this.enemies.length >= cap) {
      return;
    }
    const slot = chooseSpawnSlot(ctx.rng, SPAWN_SLOTS, (x) => this.enemies.some((enemy) => boxesOverlap({ x, y: SPAWN_Y2 }, enemy)) || boxesOverlap({ x, y: SPAWN_Y2 }, this.player));
    if (slot === null) {
      return;
    }
    this.enemies.push({ id: this.nextEnemyId++, x: slot, y: SPAWN_Y2 });
  }
}

// assets/scripts/games/tetris/Pieces.ts
var PIECE_TYPES = ["I", "O", "T", "S", "Z", "J", "L"];
var ROTATIONS = 4;
var BOX_SIZE = {
  I: 4,
  O: 2,
  T: 3,
  S: 3,
  Z: 3,
  J: 3,
  L: 3
};
var PIECE_SHAPES = {
  I: [
    ["....", "####", "....", "...."],
    ["..#.", "..#.", "..#.", "..#."],
    ["....", "....", "####", "...."],
    [".#..", ".#..", ".#..", ".#.."]
  ],
  O: [
    ["##", "##"],
    ["##", "##"],
    ["##", "##"],
    ["##", "##"]
  ],
  T: [
    [".#.", "###", "..."],
    [".#.", ".##", ".#."],
    ["...", "###", ".#."],
    [".#.", "##.", ".#."]
  ],
  S: [
    [".##", "##.", "..."],
    [".#.", ".##", "..#"],
    ["...", ".##", "##."],
    ["#..", "##.", ".#."]
  ],
  Z: [
    ["##.", ".##", "..."],
    ["..#", ".##", ".#."],
    ["...", "##.", ".##"],
    [".#.", "##.", "#.."]
  ],
  J: [
    ["#..", "###", "..."],
    [".##", ".#.", ".#."],
    ["...", "###", "..#"],
    [".#.", ".#.", "##."]
  ],
  L: [
    ["..#", "###", "..."],
    [".#.", ".#.", ".##"],
    ["...", "###", "#.."],
    ["##.", ".#.", ".#."]
  ]
};
function pieceCells(type, rotation) {
  const shape = PIECE_SHAPES[type][(rotation % ROTATIONS + ROTATIONS) % ROTATIONS];
  const cells = [];
  for (let y = 0;y < shape.length; y++) {
    const row = shape[y];
    for (let x = 0;x < row.length; x++) {
      if (row[x] === "#") {
        cells.push([x, y]);
      }
    }
  }
  return cells;
}

// assets/scripts/games/tetris/TetrisRules.ts
var BOARD_COLS = 10;
var BOARD_ROWS = 20;
var LINE_SCORE = [0, 100, 300, 700, 1500];
function createEmptyBoard() {
  return Array.from({ length: BOARD_ROWS }, () => new Array(BOARD_COLS).fill(false));
}
function collides(board, type, rotation, x, y) {
  for (const [dx, dy] of pieceCells(type, rotation)) {
    const cx = x + dx;
    const cy = y + dy;
    if (cx < 0 || cx >= BOARD_COLS || cy >= BOARD_ROWS) {
      return true;
    }
    if (cy >= 0 && board[cy][cx]) {
      return true;
    }
  }
  return false;
}
function mergePiece(board, type, rotation, x, y) {
  for (const [dx, dy] of pieceCells(type, rotation)) {
    const cx = x + dx;
    const cy = y + dy;
    if (cx >= 0 && cx < BOARD_COLS && cy >= 0 && cy < BOARD_ROWS) {
      board[cy][cx] = true;
    }
  }
  return board;
}
function findFullRows(board) {
  const rows = [];
  for (let y = 0;y < BOARD_ROWS; y++) {
    if (board[y].every((cell) => cell)) {
      rows.push(y);
    }
  }
  return rows;
}
function collapseRows(board, rows) {
  if (rows.length === 0) {
    return board;
  }
  const toRemove = new Set(rows);
  const kept = board.filter((_, y) => !toRemove.has(y));
  const fresh = Array.from({ length: rows.length }, () => new Array(BOARD_COLS).fill(false));
  board.length = 0;
  board.push(...fresh, ...kept);
  return board;
}
function scoreForLines(count) {
  return LINE_SCORE[Math.min(Math.max(count, 0), 4)];
}
function crossesSpeedUpThreshold(beforeTotal, afterTotal) {
  return Math.floor(afterTotal / 10) > Math.floor(beforeTotal / 10);
}
function generateGarbageRows(rng, rowCount) {
  const rows = [];
  for (let i = 0;i < rowCount; i++) {
    const filledCount = randomInt(rng, 5, 7);
    const allCols = Array.from({ length: BOARD_COLS }, (_, i2) => i2);
    const filledCols = shuffle(rng, allCols).slice(0, filledCount);
    const row = new Array(BOARD_COLS).fill(false);
    for (const col of filledCols) {
      row[col] = true;
    }
    rows.push(row);
  }
  return rows;
}

// assets/scripts/games/tetris/TetrisModule.ts
var SOFT_DROP_MS = 50;
var BLINK_TOGGLE_MS = 100;
var BLINK_TOGGLES = 6;

class TetrisModule {
  id = "A";
  ctx = null;
  board = createEmptyBoard();
  piece = null;
  next = "I";
  scoreValue = 0;
  over = false;
  linesCleared = 0;
  gravity = new StepClock;
  softDropping = false;
  clearing = false;
  clearingRows = [];
  blinkAccumulator = 0;
  blinkTogglesLeft = 0;
  blinkVisible = true;
  reset(ctx) {
    this.ctx = ctx;
    this.board = createEmptyBoard();
    const garbageRowCount = Math.max(0, ctx.level - 1);
    if (garbageRowCount > 0) {
      const garbage = generateGarbageRows(ctx.rng, garbageRowCount);
      for (let i = 0;i < garbage.length; i++) {
        this.board[BOARD_ROWS - garbage.length + i] = garbage[i];
      }
    }
    this.scoreValue = 0;
    this.over = false;
    this.linesCleared = 0;
    this.clearing = false;
    this.clearingRows = [];
    this.blinkAccumulator = 0;
    this.blinkTogglesLeft = 0;
    this.blinkVisible = true;
    this.gravity.reset();
    this.softDropping = false;
    this.next = this.randomPieceType();
    this.piece = null;
    this.spawnNext();
  }
  update(dtMs, input) {
    if (this.over) {
      return { score: this.scoreValue, gameOver: true, speedUp: false };
    }
    if (this.clearing) {
      this.advanceClear(dtMs);
      return { score: this.scoreValue, gameOver: this.over, speedUp: false };
    }
    if (input.isPressed("left")) {
      this.tryMove(-1, 0);
    } else if (input.isPressed("right")) {
      this.tryMove(1, 0);
    }
    if (input.isPressed("rotate")) {
      this.tryRotate();
    }
    const softDrop = input.isHeld("down");
    if (softDrop !== this.softDropping) {
      this.softDropping = softDrop;
      this.gravity.reset();
      this.softDropping = false;
    }
    const intervalMs = softDrop ? SOFT_DROP_MS : speedInterval(this.requireCtx().speed);
    const steps = this.gravity.advance(dtMs, intervalMs);
    let speedUp = false;
    for (let i = 0;i < steps; i++) {
      if (this.gravityStep()) {
        speedUp = true;
      }
      if (this.over || this.clearing) {
        break;
      }
    }
    return { score: this.scoreValue, gameOver: this.over, speedUp };
  }
  draw(frame, _blinkPhase) {
    for (let y = 0;y < BOARD_ROWS; y++) {
      if (this.clearing && this.clearingRows.includes(y) && !this.blinkVisible) {
        continue;
      }
      const row = this.board[y];
      for (let x = 0;x < BOARD_COLS; x++) {
        if (row[x]) {
          frame.set(x, y, true);
        }
      }
    }
    if (!this.clearing && this.piece) {
      for (const [dx, dy] of pieceCells(this.piece.type, this.piece.rotation)) {
        frame.set(this.piece.x + dx, this.piece.y + dy, true);
      }
    }
    const box = BOX_SIZE[this.next];
    const offset = Math.floor((4 - box) / 2);
    frame.blitPreview(PIECE_SHAPES[this.next][0], offset, offset);
  }
  get boardRows() {
    return this.board.map((row) => row.map((cell) => cell ? "#" : ".").join(""));
  }
  loadBoard(rows) {
    if (rows.length !== BOARD_ROWS) {
      throw new Error(`loadBoard expects ${BOARD_ROWS} rows, got ${rows.length}`);
    }
    this.board = rows.map((row) => {
      if (row.length !== BOARD_COLS) {
        throw new Error(`loadBoard expects rows of ${BOARD_COLS} cells, got ${row.length}`);
      }
      return row.split("").map((cell) => cell === "#");
    });
  }
  get activePiece() {
    return this.piece ? { ...this.piece } : null;
  }
  get nextPieceType() {
    return this.next;
  }
  get score() {
    return this.scoreValue;
  }
  requireCtx() {
    if (!this.ctx) {
      throw new Error("TetrisModule used before reset");
    }
    return this.ctx;
  }
  randomPieceType() {
    return pick(this.requireCtx().rng, PIECE_TYPES);
  }
  tryMove(dx, dy) {
    const piece = this.piece;
    if (!piece) {
      return;
    }
    const nx = piece.x + dx;
    const ny = piece.y + dy;
    if (!collides(this.board, piece.type, piece.rotation, nx, ny)) {
      piece.x = nx;
      piece.y = ny;
      this.requireCtx().sound("move");
    }
  }
  tryRotate() {
    const piece = this.piece;
    if (!piece) {
      return;
    }
    const nextRotation = (piece.rotation + 1) % ROTATIONS;
    if (!collides(this.board, piece.type, nextRotation, piece.x, piece.y)) {
      piece.rotation = nextRotation;
      this.requireCtx().sound("rotate");
    }
  }
  gravityStep() {
    const piece = this.piece;
    if (!piece) {
      return false;
    }
    if (!collides(this.board, piece.type, piece.rotation, piece.x, piece.y + 1)) {
      piece.y += 1;
      return false;
    }
    mergePiece(this.board, piece.type, piece.rotation, piece.x, piece.y);
    this.piece = null;
    this.requireCtx().sound("land");
    const fullRows = findFullRows(this.board);
    if (fullRows.length === 0) {
      this.spawnNext();
      return false;
    }
    const before = this.linesCleared;
    this.linesCleared += fullRows.length;
    this.scoreValue += scoreForLines(fullRows.length);
    this.requireCtx().sound("clear");
    this.beginClear(fullRows);
    return crossesSpeedUpThreshold(before, this.linesCleared);
  }
  beginClear(rows) {
    this.clearing = true;
    this.clearingRows = rows;
    this.blinkAccumulator = 0;
    this.blinkTogglesLeft = BLINK_TOGGLES;
    this.blinkVisible = true;
  }
  advanceClear(dtMs) {
    this.blinkAccumulator += dtMs;
    while (this.blinkTogglesLeft > 0 && this.blinkAccumulator >= BLINK_TOGGLE_MS) {
      this.blinkAccumulator -= BLINK_TOGGLE_MS;
      this.blinkVisible = !this.blinkVisible;
      this.blinkTogglesLeft -= 1;
    }
    if (this.blinkTogglesLeft === 0) {
      collapseRows(this.board, this.clearingRows);
      this.clearing = false;
      this.clearingRows = [];
      this.blinkVisible = true;
      this.spawnNext();
    }
  }
  revive() {
    collapseRows(this.board, [BOARD_ROWS - 4, BOARD_ROWS - 3, BOARD_ROWS - 2, BOARD_ROWS - 1]);
    this.clearing = false;
    this.clearingRows = [];
    this.over = false;
    this.gravity.reset();
    this.spawnNext();
    return !this.over;
  }
  spawnNext() {
    const type = this.next;
    this.next = this.randomPieceType();
    const box = BOX_SIZE[type];
    const x = Math.floor((BOARD_COLS - box) / 2);
    const y = 0;
    if (collides(this.board, type, 0, x, y)) {
      this.over = true;
      this.piece = null;
      return;
    }
    this.piece = { type, rotation: 0, x, y };
  }
}

// assets/scripts/games/index.ts
var registered = false;
function registerAllGames() {
  if (registered) {
    return;
  }
  registered = true;
  registerGame("A", () => new TetrisModule);
  registerGame("B", () => new TankModule);
  registerGame("C", () => new SnakeModule);
  registerGame("D", () => new RacingModule);
}

// assets/scripts/core/ShellPalettes.ts
var YELLOW_BUTTON = { button: "#F2C230", buttonEdge: "#B8891A", buttonHighlight: "#FFE07A" };
var SHELL_PALETTES = [
  {
    id: "yellow",
    nameKey: "colorYellow",
    backdrop: "#3A2E0E",
    body: "#F2C230",
    bodyEdge: "#B8891A",
    bodyHighlight: "#FFE07A",
    print: "#3A2E0E",
    button: "#2F9E8F",
    buttonEdge: "#1B6B60",
    buttonHighlight: "#7FD8C9",
    smallButton: "#222222"
  },
  {
    id: "green",
    nameKey: "colorGreen",
    backdrop: "#0F2A22",
    body: "#2E9E7A",
    bodyEdge: "#1F6F55",
    bodyHighlight: "#7FD9B9",
    print: "#FFF7E0",
    ...YELLOW_BUTTON,
    smallButton: "#1F4F40"
  },
  {
    id: "black",
    nameKey: "colorBlack",
    backdrop: "#0A0A0A",
    body: "#262626",
    bodyEdge: "#0D0D0D",
    bodyHighlight: "#5A5A5A",
    print: "#F5F0E0",
    ...YELLOW_BUTTON,
    smallButton: "#4A4A4A"
  },
  {
    id: "blue",
    nameKey: "colorBlue",
    backdrop: "#0E2440",
    body: "#3E8FD9",
    bodyEdge: "#2A5F99",
    bodyHighlight: "#9CC8F0",
    print: "#FFFFFF",
    ...YELLOW_BUTTON,
    smallButton: "#1F3F66"
  },
  {
    id: "pink",
    nameKey: "colorPink",
    backdrop: "#3A1226",
    body: "#E9679A",
    bodyEdge: "#A83E6C",
    bodyHighlight: "#F7B3CC",
    print: "#FFFFFF",
    ...YELLOW_BUTTON,
    smallButton: "#6E2A4A"
  }
];
var DEFAULT_SHELL = "yellow";
var DEFAULT_CUSTOM_COLOR = "#8FBF5A";
function isShellId(value) {
  return typeof value === "string" && (value === "custom" || SHELL_PALETTES.some((p) => p.id === value));
}
function isHexColor(value) {
  return typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value);
}
function paletteOf(id, customColor = DEFAULT_CUSTOM_COLOR) {
  if (id === "custom") {
    return derivePalette(customColor);
  }
  return SHELL_PALETTES.find((p) => p.id === id) ?? SHELL_PALETTES[0];
}
function hexToRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}
function rgbToHex(r, g, b) {
  const c = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}
function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) {
    return [0, 0, l];
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) {
    h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  } else if (max === gn) {
    h = ((bn - rn) / d + 2) * 60;
  } else {
    h = ((rn - gn) / d + 4) * 60;
  }
  return [h, s, l];
}
function hslToHex(h, s, l) {
  const hue = (h % 360 + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(hue / 60 % 2 - 1));
  const m = l - c / 2;
  const sector = Math.floor(hue / 60);
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x]
  ][sector] ?? [0, 0, 0];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function derivePalette(bodyHex) {
  const body = isHexColor(bodyHex) ? bodyHex.toUpperCase() : DEFAULT_CUSTOM_COLOR;
  const [h, s, l] = rgbToHsl(...hexToRgb(body));
  const yellowish = h >= 35 && h <= 70 && s > 0.4 && l > 0.4;
  return {
    id: "custom",
    nameKey: "colorCustom",
    backdrop: hslToHex(h, Math.min(s, 0.6), Math.max(0.06, l * 0.22)),
    body,
    bodyEdge: hslToHex(h, s, l * 0.72),
    bodyHighlight: hslToHex(h, s, l + (1 - l) * 0.4),
    print: bestInk(body),
    button: yellowish ? "#2F9E8F" : "#F2C230",
    buttonEdge: yellowish ? "#1B6B60" : "#B8891A",
    buttonHighlight: yellowish ? "#7FD8C9" : "#FFE07A",
    smallButton: hslToHex(h, Math.min(s, 0.5), 0.16)
  };
}
function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function bestInk(body) {
  const dark = "#2A2210";
  const light = "#FFF7E0";
  return contrastRatio(body, dark) >= contrastRatio(body, light) ? dark : light;
}

// assets/scripts/core/ShellConfig.ts
var GLASS_PRESETS = {
  classic: { glass: "#9EAD86", glassEdge: "#7F8D6A", ink: "#1B1F1A" },
  amber: { glass: "#D9B36A", glassEdge: "#B08E4A", ink: "#3A2A10" },
  blue: { glass: "#8FB3C7", glassEdge: "#6C8FA3", ink: "#10202A" }
};
var GLASS_IDS = ["classic", "amber", "blue", "custom"];
var DPAD_STYLES = ["round", "cross"];
var MASCOT_IDS = ["cheer", "mouse", "robot"];
var STICKER_MIN_SCALE = 0.06;
var STICKER_MAX_SCALE = 0.7;
var MAX_STICKERS = 12;
var MAX_MODEL_LABEL = 12;
function defaultShellConfig() {
  return {
    shell: DEFAULT_SHELL,
    customColor: DEFAULT_CUSTOM_COLOR,
    buttonColor: null,
    smallButtonColor: null,
    printColor: null,
    glass: "classic",
    customGlass: GLASS_PRESETS.classic.glass,
    ribbed: true,
    dpad: "round",
    mascot: "cheer",
    modelLabel: "E-9999",
    stickers: []
  };
}
function resolveShell(config) {
  const palette = paletteOf(config.shell, config.customColor);
  const glass = resolveGlass(config);
  const button = config.buttonColor ?? palette.button;
  const small = config.smallButtonColor ?? palette.smallButton;
  return {
    ...palette,
    button,
    buttonEdge: config.buttonColor ? shade(button, 0.72) : palette.buttonEdge,
    buttonHighlight: config.buttonColor ? tint(button, 0.4) : palette.buttonHighlight,
    smallButton: small,
    print: config.printColor ?? palette.print,
    ...glass
  };
}
function resolveGlass(config) {
  if (config.glass !== "custom") {
    return GLASS_PRESETS[config.glass];
  }
  const glass = isHexColor(config.customGlass) ? config.customGlass.toUpperCase() : GLASS_PRESETS.classic.glass;
  const dark = "#1B1F1A";
  const light = "#F2F6EA";
  return {
    glass,
    glassEdge: shade(glass, 0.8),
    ink: contrastRatio(glass, dark) >= contrastRatio(glass, light) ? dark : light
  };
}
function shade(hex, factor) {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex));
  return hslToHex(h, s, l * factor);
}
function tint(hex, amount) {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex));
  return hslToHex(h, s, l + (1 - l) * amount);
}
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function normalizeSticker(sticker) {
  const rotation = (sticker.rotation % 360 + 360) % 360;
  return {
    id: sticker.id,
    x: clamp(Number.isFinite(sticker.x) ? sticker.x : 0, -0.5, 0.5),
    y: clamp(Number.isFinite(sticker.y) ? sticker.y : 0, -0.5, 0.5),
    scale: clamp(Number.isFinite(sticker.scale) ? sticker.scale : 0.2, STICKER_MIN_SCALE, STICKER_MAX_SCALE),
    rotation: Number.isFinite(rotation) ? rotation : 0
  };
}
function isSticker(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value;
  return typeof v.id === "string" && v.id.length > 0 && typeof v.x === "number" && typeof v.y === "number";
}
function normalizeShellConfig(value) {
  const base = defaultShellConfig();
  if (typeof value !== "object" || value === null) {
    return base;
  }
  const v = value;
  const hexOrNull = (x) => isHexColor(x) ? x.toUpperCase() : null;
  const stickers = Array.isArray(v.stickers) ? v.stickers.filter(isSticker).slice(0, MAX_STICKERS).map((s) => normalizeSticker({ id: s.id, x: s.x, y: s.y, scale: Number(s.scale), rotation: Number(s.rotation) })) : base.stickers;
  return {
    shell: isShellId(v.shell) ? v.shell : base.shell,
    customColor: isHexColor(v.customColor) ? v.customColor.toUpperCase() : base.customColor,
    buttonColor: hexOrNull(v.buttonColor),
    smallButtonColor: hexOrNull(v.smallButtonColor),
    printColor: hexOrNull(v.printColor),
    glass: typeof v.glass === "string" && GLASS_IDS.includes(v.glass) ? v.glass : base.glass,
    customGlass: isHexColor(v.customGlass) ? v.customGlass.toUpperCase() : base.customGlass,
    ribbed: typeof v.ribbed === "boolean" ? v.ribbed : base.ribbed,
    dpad: typeof v.dpad === "string" && DPAD_STYLES.includes(v.dpad) ? v.dpad : base.dpad,
    mascot: typeof v.mascot === "string" && MASCOT_IDS.includes(v.mascot) ? v.mascot : base.mascot,
    modelLabel: typeof v.modelLabel === "string" ? sanitizeModelLabel(v.modelLabel) : base.modelLabel,
    stickers
  };
}
function sanitizeModelLabel(text) {
  return text.replace(/[^\w\- ]/g, "").trim().slice(0, MAX_MODEL_LABEL).toUpperCase();
}
var SHARE_PREFIX = "BG1-";
function encodeShareCode(config) {
  const { stickers, ...rest } = config;
  return SHARE_PREFIX + base64UrlEncode(JSON.stringify(rest));
}
function decodeShareCode(code) {
  const trimmed = code.trim();
  if (!trimmed.startsWith(SHARE_PREFIX)) {
    return null;
  }
  try {
    const json = base64UrlDecode(trimmed.slice(SHARE_PREFIX.length));
    const parsed = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    return normalizeShellConfig({ ...parsed, stickers: [] });
  } catch {
    return null;
  }
}
var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function base64UrlEncode(text) {
  const bytes = utf8Encode(text);
  let out = "";
  for (let i = 0;i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = a << 16 | b << 8 | c;
    out += B64[n >> 18 & 63] + B64[n >> 12 & 63];
    out += i + 1 < bytes.length ? B64[n >> 6 & 63] : "";
    out += i + 2 < bytes.length ? B64[n & 63] : "";
  }
  return out;
}
function base64UrlDecode(text) {
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of text) {
    const v = B64.indexOf(ch);
    if (v < 0) {
      throw new Error("bad share code");
    }
    buffer = buffer << 6 | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push(buffer >> bits & 255);
    }
  }
  return utf8Decode(bytes);
}
function utf8Encode(text) {
  const out = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 128) {
      out.push(cp);
    } else if (cp < 2048) {
      out.push(192 | cp >> 6, 128 | cp & 63);
    } else if (cp < 65536) {
      out.push(224 | cp >> 12, 128 | cp >> 6 & 63, 128 | cp & 63);
    } else {
      out.push(240 | cp >> 18, 128 | cp >> 12 & 63, 128 | cp >> 6 & 63, 128 | cp & 63);
    }
  }
  return out;
}
function utf8Decode(bytes) {
  let out = "";
  for (let i = 0;i < bytes.length; ) {
    const b = bytes[i];
    let cp;
    let extra;
    if (b < 128) {
      cp = b;
      extra = 0;
    } else if (b < 224) {
      cp = b & 31;
      extra = 1;
    } else if (b < 240) {
      cp = b & 15;
      extra = 2;
    } else {
      cp = b & 7;
      extra = 3;
    }
    for (let k = 1;k <= extra; k++) {
      cp = cp << 6 | bytes[i + k] & 63;
    }
    out += String.fromCodePoint(cp);
    i += extra + 1;
  }
  return out;
}

// assets/scripts/i18n/translations.ts
var LOCALES = ["en", "vi"];
var LOCALE_NAMES = { en: "English", vi: "Tiếng Việt" };
var en = {
  brand: "BRICK GAME",
  model: "9999 in 1",
  modelCode: "E-33",
  super: "SUPER",
  score: "SCORE",
  hiScore: "HI-SCORE",
  level: "LEVEL",
  speed: "SPEED",
  power: "ON/OFF",
  startPause: "START/PAUSE",
  sound: "SOUND",
  reset: "RESET",
  rotate: "ROTATE",
  setButton: "SET",
  settings: "SETTINGS",
  language: "LANGUAGE",
  shellColor: "SHELL COLOR",
  colorYellow: "Yellow",
  colorGreen: "Green",
  colorBlack: "Black",
  colorBlue: "Blue",
  colorPink: "Pink",
  colorCustom: "Custom",
  pickColor: "Tap a colour",
  tabLanguage: "LANGUAGE",
  tabColors: "COLOURS",
  tabShape: "SHAPE",
  tabStickers: "STICKERS",
  tabPresets: "PRESETS",
  bodyColor: "BODY",
  buttonColor: "BIG BUTTONS",
  smallButtonColor: "SMALL BUTTONS",
  printColor: "PRINT INK",
  glassColor: "LCD GLASS",
  auto: "Auto",
  glassClassic: "Classic",
  glassAmber: "Amber",
  glassBlue: "Blue",
  ribbed: "Ribbed grip",
  dpadStyle: "D-PAD",
  dpadRound: "Four buttons",
  dpadCross: "Cross",
  mascot: "MASCOT",
  mascotCheer: "Cheer",
  mascotMouse: "Super Mouse",
  mascotRobot: "Robot",
  modelLabel: "MODEL LABEL",
  addSticker: "Add image",
  arrange: "Arrange on shell",
  arrangeHint: "Drag to move · pinch to resize/rotate · tap ✕ to remove",
  done: "DONE",
  deleteSticker: "Remove",
  editSticker: "Edit",
  stickerTooBig: "Not enough space for this image. Remove a sticker first.",
  stickerLimit: "Sticker limit reached.",
  noStickers: "No stickers yet.",
  savePreset: "Save current",
  presetName: "Preset name",
  apply: "Apply",
  delete: "Delete",
  shareCode: "SHARE CODE",
  copy: "Copy",
  copied: "Copied",
  importCode: "Paste a code",
  importButton: "Import",
  invalidCode: "That code is not valid.",
  presetLimit: "Preset limit reached.",
  resetShell: "Reset shell",
  close: "CLOSE",
  hint: "Keys: arrows · Space/X rotate · Enter start/pause · P power · S sound · R reset",
  adContinueTitle: "Continue this run?",
  adContinueSub: "Watch a short ad and keep your score, level and speed.",
  adWatch: "Watch ad",
  adNoThanks: "No thanks",
  adSkip: "Skip",
  adLoading: "Loading…",
  adUnavailable: "Ad unavailable",
  adInterstitialTitle: "Advertisement",
  adsStats: "Ads: {offers} offers · {watched} watched · {skipped} skipped · {interstitials} interstitials",
  version: "Version",
  updateReady: "Update ready",
  restart: "Restart"
};
var vi = {
  brand: "BRICK GAME",
  model: "9999 trong 1",
  modelCode: "E-33",
  super: "SUPER",
  score: "ĐIỂM",
  hiScore: "KỶ LỤC",
  level: "MÀN",
  speed: "TỐC ĐỘ",
  power: "BẬT/TẮT",
  startPause: "CHẠY/DỪNG",
  sound: "ÂM THANH",
  reset: "CHƠI LẠI",
  rotate: "XOAY",
  setButton: "CÀI ĐẶT",
  settings: "CÀI ĐẶT",
  language: "NGÔN NGỮ",
  shellColor: "MÀU VỎ",
  colorYellow: "Vàng",
  colorGreen: "Xanh lá",
  colorBlack: "Đen",
  colorBlue: "Xanh dương",
  colorPink: "Hồng",
  colorCustom: "Tuỳ chọn",
  pickColor: "Chạm để chọn màu",
  tabLanguage: "NGÔN NGỮ",
  tabColors: "MÀU SẮC",
  tabShape: "HÌNH DÁNG",
  tabStickers: "STICKER",
  tabPresets: "BỘ LƯU",
  bodyColor: "VỎ MÁY",
  buttonColor: "NÚT LỚN",
  smallButtonColor: "NÚT NHỎ",
  printColor: "MỰC IN",
  glassColor: "KÍNH LCD",
  auto: "Tự động",
  glassClassic: "Cổ điển",
  glassAmber: "Hổ phách",
  glassBlue: "Xanh lam",
  ribbed: "Dải gân cầm tay",
  dpadStyle: "NÚT ĐIỀU HƯỚNG",
  dpadRound: "Bốn nút tròn",
  dpadCross: "Chữ thập",
  mascot: "LINH VẬT",
  mascotCheer: "Cổ vũ",
  mascotMouse: "Chuột siêu cấp",
  mascotRobot: "Rô-bốt",
  modelLabel: "MÃ MÁY",
  addSticker: "Thêm ảnh",
  arrange: "Sắp xếp trên vỏ",
  arrangeHint: "Kéo để di chuyển · hai ngón để phóng/xoay · chạm ✕ để xoá",
  done: "XONG",
  deleteSticker: "Xoá",
  editSticker: "Sửa",
  stickerTooBig: "Không đủ chỗ lưu ảnh này. Hãy xoá bớt sticker.",
  stickerLimit: "Đã đủ số sticker tối đa.",
  noStickers: "Chưa có sticker nào.",
  savePreset: "Lưu bộ hiện tại",
  presetName: "Tên bộ lưu",
  apply: "Dùng",
  delete: "Xoá",
  shareCode: "MÃ CHIA SẺ",
  copy: "Sao chép",
  copied: "Đã chép",
  importCode: "Dán mã vào đây",
  importButton: "Nhập",
  invalidCode: "Mã không hợp lệ.",
  presetLimit: "Đã đủ số bộ lưu tối đa.",
  resetShell: "Về mặc định",
  close: "ĐÓNG",
  hint: "Phím: mũi tên · Space/X xoay · Enter chạy/dừng · P nguồn · S âm · R chơi lại",
  adContinueTitle: "Chơi tiếp ván này?",
  adContinueSub: "Xem một quảng cáo ngắn, giữ nguyên điểm, level và tốc độ.",
  adWatch: "Xem quảng cáo",
  adNoThanks: "Không",
  adSkip: "Bỏ qua",
  adLoading: "Đang tải…",
  adUnavailable: "Quảng cáo không khả dụng",
  adInterstitialTitle: "Quảng cáo",
  adsStats: "Quảng cáo: {offers} lời mời · {watched} đã xem · {skipped} bỏ qua · {interstitials} xen kẽ",
  version: "Phiên bản",
  updateReady: "Đã có bản cập nhật",
  restart: "Khởi động lại"
};
var TRANSLATIONS = { en, vi };

// assets/scripts/data/SettingsStore.ts
var SETTINGS_KEY = "brick-game:settings";
var MAX_PRESETS = 8;
var MAX_PRESET_NAME = 16;

class SettingsStore {
  storage;
  now;
  data;
  listeners = new Set;
  counter = 0;
  constructor(storage, defaults, now = () => Date.now()) {
    this.storage = storage;
    this.now = now;
    this.data = { ...defaults, ...this.load() };
  }
  get settings() {
    return this.data;
  }
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  setLocale(locale) {
    if (locale !== this.data.locale) {
      this.commit({ ...this.data, locale });
    }
  }
  updateShell(patch) {
    const shell = normalizeShellConfig({ ...this.data.shell, ...patch });
    if (JSON.stringify(shell) === JSON.stringify(this.data.shell)) {
      return;
    }
    this.commit({ ...this.data, shell });
  }
  setShell(shell) {
    this.updateShell({ shell });
  }
  setCustomColor(hex) {
    if (isHexColor(hex)) {
      this.updateShell({ shell: "custom", customColor: hex });
    }
  }
  resetShell() {
    this.commit({ ...this.data, shell: defaultShellConfig() });
  }
  addSticker(partial = {}) {
    if (this.data.shell.stickers.length >= MAX_STICKERS) {
      return null;
    }
    const id = `s${this.now().toString(36)}${(this.counter++).toString(36)}`;
    const sticker = normalizeSticker({ id, x: 0, y: -0.1, scale: 0.25, rotation: 0, ...partial });
    this.updateShell({ stickers: [...this.data.shell.stickers, sticker] });
    return id;
  }
  updateSticker(id, patch) {
    const stickers = this.data.shell.stickers.map((s) => s.id === id ? normalizeSticker({ ...s, ...patch }) : s);
    this.updateShell({ stickers });
  }
  removeSticker(id) {
    this.updateShell({ stickers: this.data.shell.stickers.filter((s) => s.id !== id) });
  }
  raiseSticker(id) {
    const s = this.data.shell.stickers.find((x) => x.id === id);
    if (s) {
      this.updateShell({ stickers: [...this.data.shell.stickers.filter((x) => x.id !== id), s] });
    }
  }
  savePreset(name) {
    if (this.data.presets.length >= MAX_PRESETS) {
      return null;
    }
    const clean = name.trim().slice(0, MAX_PRESET_NAME) || `Preset ${this.data.presets.length + 1}`;
    const id = `p${this.now().toString(36)}${(this.counter++).toString(36)}`;
    const preset = { id, name: clean, shell: normalizeShellConfig(this.data.shell) };
    this.commit({ ...this.data, presets: [...this.data.presets, preset] });
    return id;
  }
  applyPreset(id) {
    const preset = this.data.presets.find((p) => p.id === id);
    if (!preset) {
      return false;
    }
    this.commit({ ...this.data, shell: normalizeShellConfig(preset.shell) });
    return true;
  }
  deletePreset(id) {
    this.commit({ ...this.data, presets: this.data.presets.filter((p) => p.id !== id) });
  }
  importShareCode(code) {
    const shell = decodeShareCode(code);
    if (!shell) {
      return false;
    }
    this.commit({ ...this.data, shell: { ...shell, stickers: this.data.shell.stickers } });
    return true;
  }
  commit(next) {
    this.data = next;
    try {
      this.storage.setItem(SETTINGS_KEY, JSON.stringify(this.data));
    } catch {}
    for (const listener of [...this.listeners]) {
      listener(this.data);
    }
  }
  load() {
    try {
      const raw = this.storage.getItem(SETTINGS_KEY);
      if (!raw) {
        return {};
      }
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) {
        return {};
      }
      const v = parsed;
      const out = {};
      if (typeof v.locale === "string" && LOCALES.includes(v.locale)) {
        out.locale = v.locale;
      }
      if (typeof v.shell === "string" || "customColor" in v) {
        out.shell = normalizeShellConfig({ shell: v.shell, customColor: v.customColor });
      } else if (typeof v.shell === "object" && v.shell !== null) {
        out.shell = normalizeShellConfig(v.shell);
      }
      if (Array.isArray(v.presets)) {
        out.presets = v.presets.filter((p) => typeof p === "object" && p !== null).filter((p) => typeof p.id === "string" && typeof p.name === "string").slice(0, MAX_PRESETS).map((p) => ({ id: p.id, name: p.name.slice(0, MAX_PRESET_NAME), shell: normalizeShellConfig(p.shell) }));
      }
      return out;
    } catch {
      return {};
    }
  }
}
function defaultSettings(locale) {
  return { locale, shell: defaultShellConfig(), presets: [] };
}

// assets/scripts/data/StickerImages.ts
var STICKER_IMAGES_KEY = "brick-game:sticker-images";
var STICKER_STORAGE_CAP = 1e6;

class StickerImages {
  storage;
  images;
  constructor(storage) {
    this.storage = storage;
    this.images = this.load();
  }
  get(id) {
    return this.images[id];
  }
  ids() {
    return Object.keys(this.images);
  }
  get totalSize() {
    return Object.values(this.images).reduce((n, v) => n + v.length, 0);
  }
  put(id, dataUrl) {
    if (!dataUrl.startsWith("data:image/")) {
      return false;
    }
    const others = this.totalSize - (this.images[id]?.length ?? 0);
    if (others + dataUrl.length > STICKER_STORAGE_CAP) {
      return false;
    }
    this.images = { ...this.images, [id]: dataUrl };
    return this.persist();
  }
  remove(id) {
    if (id in this.images) {
      const { [id]: _gone, ...rest } = this.images;
      this.images = rest;
      this.persist();
    }
  }
  prune(liveIds) {
    const live = new Set(liveIds);
    for (const id of this.ids()) {
      if (!live.has(id)) {
        this.remove(id);
      }
    }
  }
  persist() {
    try {
      this.storage.setItem(STICKER_IMAGES_KEY, JSON.stringify(this.images));
      return true;
    } catch {
      return false;
    }
  }
  load() {
    try {
      const raw = this.storage.getItem(STICKER_IMAGES_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      if (typeof parsed !== "object" || parsed === null) {
        return {};
      }
      const out = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string" && v.startsWith("data:image/")) {
          out[k] = v;
        }
      }
      return out;
    } catch {
      return {};
    }
  }
}

// assets/scripts/i18n/I18n.ts
class I18n {
  locale = "en";
  listeners = new Set;
  get current() {
    return this.locale;
  }
  setLocale(locale) {
    if (this.locale === locale) {
      return;
    }
    this.locale = locale;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
  detect(tag) {
    const lower = (tag ?? "").toLowerCase();
    for (const locale of LOCALES) {
      if (lower === locale || lower.startsWith(`${locale}-`)) {
        return locale;
      }
    }
    return "en";
  }
  isLocale(value) {
    return typeof value === "string" && LOCALES.includes(value);
  }
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  t(key2) {
    return TRANSLATIONS[this.locale][key2];
  }
}
var i18n = new I18n;

// preview/ads/mock-ads-provider.ts
var REWARDED_SECONDS = 5;
var REWARDED_SKIP_AFTER_SECONDS = 2;
var INTERSTITIAL_SECONDS = 3;
function requireEl(id) {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`mock ads provider: #${id} is missing from index.html`);
  }
  return el;
}
function createMockAdsProvider() {
  const els = {
    overlay: requireEl("ad-overlay"),
    title: requireEl("ad-title"),
    countdown: requireEl("ad-countdown"),
    skip: requireEl("ad-skip"),
    close: requireEl("ad-close")
  };
  let active = null;
  function finish(result) {
    if (!active) {
      return;
    }
    const { cleanup, resolve } = active;
    active = null;
    cleanup();
    els.overlay.hidden = true;
    els.skip.hidden = true;
    els.close.hidden = true;
    resolve(result);
  }
  els.skip.addEventListener("click", () => finish("skipped"));
  els.close.addEventListener("click", () => finish("completed"));
  window.__brickAds = { finish };
  function show(kind) {
    return new Promise((resolve) => {
      const total = kind === "rewarded" ? REWARDED_SECONDS : INTERSTITIAL_SECONDS;
      els.title.textContent = i18n.t(kind === "rewarded" ? "adContinueTitle" : "adInterstitialTitle");
      els.skip.textContent = i18n.t("adSkip");
      els.countdown.textContent = String(total);
      els.skip.hidden = true;
      els.close.hidden = kind !== "interstitial";
      els.overlay.hidden = false;
      let elapsedSeconds = 0;
      const interval = setInterval(() => {
        elapsedSeconds += 1;
        els.countdown.textContent = String(Math.max(0, total - elapsedSeconds));
        if (kind === "rewarded" && elapsedSeconds >= REWARDED_SKIP_AFTER_SECONDS) {
          els.skip.hidden = false;
        }
        if (elapsedSeconds >= total) {
          finish("completed");
        }
      }, 1000);
      active = { cleanup: () => clearInterval(interval), resolve };
    });
  }
  return { isReady: () => true, show };
}

// preview/ads/native-ads-provider.ts
var REQUEST_TIMEOUT_MS = 15000;
function createNativeAdsProvider() {
  const handler = window.webkit?.messageHandlers?.ads;
  if (!handler) {
    return null;
  }
  const readiness = {};
  const pending = new Map;
  let nextId = 0;
  window.__brickNative = {
    ...window.__brickNative,
    onAdResult(id, result) {
      const resolve = pending.get(id);
      if (resolve) {
        pending.delete(id);
        resolve(result);
      }
    },
    onAdReady(kind, ready) {
      readiness[kind] = ready;
    }
  };
  return {
    isReady(kind) {
      return readiness[kind] === true;
    },
    show(kind) {
      return new Promise((resolve) => {
        const id = String(nextId++);
        const timer = setTimeout(() => {
          if (pending.delete(id)) {
            resolve("error");
          }
        }, REQUEST_TIMEOUT_MS);
        pending.set(id, (result) => {
          clearTimeout(timer);
          resolve(result);
        });
        handler.postMessage({ id, kind });
      });
    }
  };
}

// preview/lcd-canvas.ts
var DEFAULT_INK = "#1b1f1a";
var GHOST_ALPHA = 0.12;
var SEGMENT_GHOST_ALPHA = 0.16;
var LCD_W = 440;
var LCD_H = 560;
var CELL = 24;
var GAP = 2;
var PITCH = CELL + GAP;
var GRID_LEFT = 16;
var GRID_TOP = 21;
var SIDEBAR_LEFT = 290;
var SIDEBAR_W = 134;
var PREVIEW_CELL = 18;
var SCORE_SCALE = 1.45;
var DIAL_SCALE = 2.1;
var LABEL_PX = 15;
var ICON_CELL = 3;

class LcdCanvas {
  ctx;
  pixelRatio;
  ink = DEFAULT_INK;
  constructor(ctx, pixelRatio = 1) {
    this.ctx = ctx;
    this.pixelRatio = pixelRatio;
  }
  setInk(ink) {
    this.ink = ink;
  }
  render(frame) {
    const ctx = this.ctx;
    if (!ctx) {
      return;
    }
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    ctx.clearRect(0, 0, LCD_W, LCD_H);
    ctx.fillStyle = this.ink;
    for (let i = 0;i < CELL_COUNT; i++) {
      const x = GRID_LEFT + i % COLS * PITCH;
      const y2 = GRID_TOP + Math.floor(i / COLS) * PITCH;
      this.cell(ctx, x, y2, CELL, frame.main[i] === 1);
    }
    const mid = SIDEBAR_LEFT + SIDEBAR_W / 2;
    let y = GRID_TOP + 4;
    y = this.readout(ctx, "SCORE", frame.score, 6, y, SCORE_SCALE);
    y = this.readout(ctx, "HI-SCORE", frame.hiScore, 6, y, SCORE_SCALE);
    y += 8;
    const ppitch = PREVIEW_CELL + GAP;
    const pw = PREVIEW_CELL * PREVIEW_SIZE + GAP * (PREVIEW_SIZE - 1);
    const px = mid - pw / 2;
    for (let i = 0;i < PREVIEW_SIZE * PREVIEW_SIZE; i++) {
      const cx = px + i % PREVIEW_SIZE * ppitch;
      const cy = y + Math.floor(i / PREVIEW_SIZE) * ppitch;
      this.cell(ctx, cx, cy, PREVIEW_CELL, frame.preview[i] === 1);
    }
    y += pw + 22;
    y = this.readout(ctx, "LEVEL", frame.level, 2, y, DIAL_SCALE);
    y = this.readout(ctx, "SPEED", frame.speed, 2, y, DIAL_SCALE);
    y += 10;
    this.icon(ctx, ICON_GLYPHS.sound, SIDEBAR_LEFT + 16, y, frame.indicators.sound);
    this.icon(ctx, ICON_GLYPHS.pause, SIDEBAR_LEFT + SIDEBAR_W - 16 - 5 * ICON_CELL, y, frame.indicators.pause);
  }
  cell(ctx, x, y, size, lit) {
    ctx.globalAlpha = lit ? 1 : GHOST_ALPHA;
    const border = Math.max(2, Math.round(size * 0.12));
    ctx.fillRect(x, y, size, border);
    ctx.fillRect(x, y + size - border, size, border);
    ctx.fillRect(x, y, border, size);
    ctx.fillRect(x + size - border, y, border, size);
    const core = size - border * 4;
    ctx.fillRect(x + border * 2, y + border * 2, core, core);
    ctx.globalAlpha = 1;
  }
  readout(ctx, label, value, digits, y, scale) {
    ctx.globalAlpha = 0.9;
    ctx.font = `bold ${LABEL_PX}px "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.letterSpacing = "1px";
    ctx.fillText(label, SIDEBAR_LEFT + SIDEBAR_W / 2, y + LABEL_PX);
    ctx.letterSpacing = "0px";
    ctx.globalAlpha = 1;
    const dw = 12 * scale;
    const dh = 22 * scale;
    const pitch = (12 + 3) * scale;
    const right = SIDEBAR_LEFT + SIDEBAR_W - (digits === 2 ? 10 : 0);
    const top = y + LABEL_PX + 10;
    const masks = readoutMasks(value, digits);
    for (let i = 0;i < digits; i++) {
      const x = right - (digits - i) * pitch + (pitch - dw);
      this.digit(ctx, x, top, dw, dh, scale, masks[i]);
    }
    return top + dh + 16;
  }
  digit(ctx, x, y, w, h, scale, mask) {
    const t = 3 * scale;
    const half = (h - t) / 2;
    const boxes = [
      [x + t, y, w - 2 * t, t],
      [x + w - t, y + t, t, half - t],
      [x + w - t, y + half + t, t, half - t],
      [x + t, y + h - t, w - 2 * t, t],
      [x, y + half + t, t, half - t],
      [x, y + t, t, half - t],
      [x + t, y + half, w - 2 * t, t]
    ];
    boxes.forEach(([bx, by, bw, bh], bit) => {
      ctx.globalAlpha = mask & 1 << bit ? 1 : SEGMENT_GHOST_ALPHA;
      ctx.fillRect(bx, by, bw, bh);
    });
    ctx.globalAlpha = 1;
  }
  icon(ctx, glyph, x, y, on) {
    ctx.globalAlpha = on ? 1 : GHOST_ALPHA;
    for (let row = 0;row < glyph.length; row++) {
      for (let col = 0;col < glyph[row].length; col++) {
        if (glyph[row][col] === "#") {
          ctx.fillRect(x + col * ICON_CELL, y + row * ICON_CELL, ICON_CELL, ICON_CELL);
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}

// assets/scripts/core/config/RemoteConfig.ts
var DEFAULT_CONFIG = {
  ads: { ...DEFAULT_ADS_SETTINGS, minRunMs: 45 * 1000, firstSessionGraceMs: 10 * 60 * 1000 },
  features: {},
  updatedAt: ""
};
var MAX_INTERVAL_MS = 30 * 60 * 1000;
var MAX_RUN_MS = 10 * 60 * 1000;
var MAX_RUN_SCORE = 1e6;
var MAX_GRACE_MS = 60 * 60 * 1000;
function clampInt(value, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}
function parseRemoteConfig(value) {
  const out = { ads: { ...DEFAULT_CONFIG.ads }, features: {}, updatedAt: "" };
  if (typeof value !== "object" || value === null) {
    return out;
  }
  const v = value;
  const ads = typeof v.ads === "object" && v.ads !== null ? v.ads : {};
  if (typeof ads.interstitialEvery === "number" && Number.isFinite(ads.interstitialEvery)) {
    out.ads.interstitialEvery = Math.min(20, Math.max(1, Math.round(ads.interstitialEvery)));
  }
  if (typeof ads.minIntervalMs === "number" && Number.isFinite(ads.minIntervalMs)) {
    out.ads.minIntervalMs = Math.min(MAX_INTERVAL_MS, Math.max(0, Math.round(ads.minIntervalMs)));
  }
  if (typeof ads.rewardedContinue === "boolean") {
    out.ads.rewardedContinue = ads.rewardedContinue;
  }
  out.ads.minLevel = clampInt(ads.minLevel, 0, 99) ?? out.ads.minLevel;
  out.ads.minSessionMs = clampInt(ads.minSessionMs, 0, MAX_GRACE_MS) ?? out.ads.minSessionMs;
  if (typeof ads.vetoWhenRewardedThisRound === "boolean") {
    out.ads.vetoWhenRewardedThisRound = ads.vetoWhenRewardedThisRound;
  }
  out.ads.minRunMs = clampInt(ads.minRunMs, 0, MAX_RUN_MS) ?? out.ads.minRunMs;
  out.ads.minRunScore = clampInt(ads.minRunScore, 0, MAX_RUN_SCORE) ?? out.ads.minRunScore;
  out.ads.firstSessionGraceMs = clampInt(ads.firstSessionGraceMs, 0, MAX_GRACE_MS) ?? out.ads.firstSessionGraceMs;
  if (typeof v.features === "object" && v.features !== null) {
    for (const [key2, flag] of Object.entries(v.features)) {
      if (typeof flag === "boolean" && /^[a-zA-Z][\w-]{0,40}$/.test(key2)) {
        out.features[key2] = flag;
      }
    }
  }
  if (typeof v.updatedAt === "string" && v.updatedAt.length <= 40) {
    out.updatedAt = v.updatedAt;
  }
  return out;
}

// preview/remote-config.ts
var REMOTE_CONFIG_KEY = "brick-game:remote-config";
var FETCH_TIMEOUT_MS = 4000;
function readCached(storage) {
  try {
    const raw = storage.getItem(REMOTE_CONFIG_KEY);
    return raw ? parseRemoteConfig(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
function writeCache(storage, config) {
  try {
    storage.setItem(REMOTE_CONFIG_KEY, JSON.stringify(config));
  } catch {}
}
async function loadRemoteConfig(url, storage) {
  const cached = readCached(storage);
  if (typeof fetch !== "function") {
    return cached ?? DEFAULT_CONFIG;
  }
  const controller = new AbortController;
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`remote config fetch failed: ${res.status}`);
    }
    const json = await res.json();
    const parsed = parseRemoteConfig(json);
    writeCache(storage, parsed);
    return parsed;
  } catch {
    return cached ?? DEFAULT_CONFIG;
  } finally {
    clearTimeout(timer);
  }
}

// assets/scripts/core/Decor.ts
var SIDE_BRICKS = [
  ["####"],
  ["##", "##"],
  ["###", ".#."],
  [".##", "##."],
  ["##.", ".##"],
  ["#..", "###"],
  ["..#", "###"]
];
var LEFT_BRICKS = [SIDE_BRICKS[0], SIDE_BRICKS[2], SIDE_BRICKS[3], SIDE_BRICKS[5]];
var RIGHT_BRICKS = [SIDE_BRICKS[1], SIDE_BRICKS[4], SIDE_BRICKS[6], SIDE_BRICKS[2]];
var MASCOT = [
  "......####......",
  ".....######.....",
  "....##....##....",
  "....#.#..#.#....",
  "....#......#....",
  "....##.##.##....",
  ".....######.....",
  "..#...####...#..",
  ".#.#.######.#.#.",
  ".#..########..#.",
  "..#.##.##.##.#..",
  "....########....",
  "....##.##.##....",
  ".....##..##.....",
  ".....##..##.....",
  ".....##..##.....",
  "....###..###....",
  "....###..###...."
];
var MASCOT_MOUSE = [
  ".###........###.",
  "#####......#####",
  "#####......#####",
  ".###.######.###.",
  "...##......##...",
  "..#..##..##..#..",
  "..#..##..##..#..",
  "..#....##....#..",
  "..#.#......#.#..",
  "...#.######.#...",
  "....########....",
  "..###.####.###..",
  ".#...######...#.",
  ".#...######...#.",
  ".....##..##.....",
  ".....##..##..##.",
  "....###..###.#..",
  "....###..###.#.."
];
var MASCOT_ROBOT = [
  ".......##.......",
  "......####......",
  "..############..",
  "..#..........#..",
  "..#.###..###.#..",
  "..#.###..###.#..",
  "..#..........#..",
  "..#.########.#..",
  "..############..",
  "#....######....#",
  "#.#..######..#.#",
  "#.#..######..#.#",
  "###..######..###",
  ".....######.....",
  "....##....##....",
  "....##....##....",
  "...###....###...",
  "...###....###..."
];
var MASCOTS = { cheer: MASCOT, mouse: MASCOT_MOUSE, robot: MASCOT_ROBOT };

// preview/shell-shape.ts
function spriteCanvas(sprite, cell, color, target) {
  const canvas = target ?? document.createElement("canvas");
  canvas.width = sprite[0].length * cell;
  canvas.height = sprite.length * cell;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color;
    sprite.forEach((row, y) => {
      for (let x = 0;x < row.length; x++) {
        if (row[x] === "#") {
          ctx.fillRect(x * cell, y * cell, cell, cell);
        }
      }
    });
  }
  return canvas;
}
function brickCanvas(sprite, cell, color) {
  const canvas = document.createElement("canvas");
  canvas.width = sprite[0].length * cell;
  canvas.height = sprite.length * cell;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const border = Math.max(2, Math.round(cell * 0.14));
    const core = cell - border * 4;
    ctx.fillStyle = color;
    sprite.forEach((row, y) => {
      for (let x = 0;x < row.length; x++) {
        if (row[x] !== "#") {
          continue;
        }
        const cx = x * cell;
        const cy = y * cell;
        ctx.fillRect(cx, cy, cell, border);
        ctx.fillRect(cx, cy + cell - border, cell, border);
        ctx.fillRect(cx, cy, border, cell);
        ctx.fillRect(cx + cell - border, cy, border, cell);
        ctx.fillRect(cx + border * 2, cy + border * 2, core, core);
      }
    });
  }
  return canvas;
}
var MASCOT_NAME_KEY = {
  cheer: "mascotCheer",
  mouse: "mascotMouse",
  robot: "mascotRobot"
};
function drawDecals(color, mascot) {
  const fill = (id, sprites) => {
    const host = document.getElementById(id);
    if (!host) {
      return;
    }
    host.replaceChildren(...sprites.map((s) => {
      const canvas = brickCanvas(s, 14, color);
      canvas.style.setProperty("--cells", String(s[0].length));
      return canvas;
    }));
  };
  fill("bricks-left", LEFT_BRICKS);
  fill("bricks-right", RIGHT_BRICKS);
  const mascotCanvas = document.getElementById("mascot");
  if (mascotCanvas) {
    spriteCanvas(MASCOTS[mascot], 6, color, mascotCanvas);
  }
  const mascotName = document.getElementById("mascot-name");
  if (mascotName) {
    mascotName.textContent = i18n.t(MASCOT_NAME_KEY[mascot]);
  }
}
function applyRibbed(ribbed) {
  const host = document.getElementById("ribs");
  if (!host) {
    return;
  }
  const existing = host.querySelector(".rib-band");
  if (ribbed && !existing) {
    const band = document.createElement("div");
    band.className = "rib-band";
    host.appendChild(band);
  } else if (!ribbed && existing) {
    existing.remove();
  }
}
function applyDpadStyle(style) {
  const dpad = document.getElementById("dpad");
  dpad?.classList.toggle("dpad-cross", style === "cross");
}
function applyModelLabel(label) {
  const el = document.getElementById("model-label");
  if (el) {
    el.textContent = label;
  }
}
function renderShellShape(config, print) {
  drawDecals(print, config.mascot);
  applyRibbed(config.ribbed);
  applyDpadStyle(config.dpad);
  applyModelLabel(config.modelLabel);
}

// preview/settings-card.ts
var GLASS_LABEL_KEY = {
  classic: "glassClassic",
  amber: "glassAmber",
  blue: "glassBlue"
};
var DPAD_LABEL_KEY = { round: "dpadRound", cross: "dpadCross" };
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
function pillGroup(host, options, current, labelKey, onPick) {
  host.replaceChildren(...options.map((opt) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pill";
    b.textContent = i18n.t(labelKey(opt));
    b.setAttribute("aria-pressed", String(opt === current));
    b.addEventListener("click", () => onPick(opt));
    return b;
  }));
}
function colorRow(host, current, resolved, onAuto, onPick) {
  const autoBtn = document.createElement("button");
  autoBtn.type = "button";
  autoBtn.className = "pill";
  autoBtn.textContent = i18n.t("auto");
  autoBtn.setAttribute("aria-pressed", String(current === null));
  autoBtn.addEventListener("click", onAuto);
  const input = document.createElement("input");
  input.type = "color";
  input.className = "color-input";
  input.value = (current ?? resolved).toLowerCase();
  input.addEventListener("input", () => onPick(input.value));
  host.replaceChildren(autoBtn, input);
}
function setupSettingsCard(store, onOpenChange) {
  const overlay = document.getElementById("settings");
  const opener = document.getElementById("open-settings");
  const close = document.getElementById("close-settings");
  const tabButtons = [...document.querySelectorAll("#settings-tabs .tab-btn")];
  const panels = [...document.querySelectorAll(".tab-panel")];
  const glassColorInput = document.getElementById("glass-color");
  const bodyColorInput = document.getElementById("custom-color");
  const modelInput = document.getElementById("model-label-input");
  const resetButton = document.getElementById("reset-shell");
  const presetNameInput = document.getElementById("preset-name");
  const saveButton = document.getElementById("save-preset");
  const presetList = document.getElementById("preset-list");
  const presetMessage = document.getElementById("preset-message");
  const shareCodeEl = document.getElementById("share-code");
  const copyButton = document.getElementById("copy-share");
  const importInput = document.getElementById("import-code");
  const importButton = document.getElementById("import-share");
  let activeTab = "colors";
  function showTab(tab) {
    activeTab = tab;
    for (const btn of tabButtons) {
      btn.setAttribute("aria-pressed", String(btn.dataset.tab === tab));
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.panel !== tab;
    }
  }
  for (const btn of tabButtons) {
    btn.addEventListener("click", () => showTab(btn.dataset.tab ?? "colors"));
  }
  bodyColorInput?.addEventListener("input", () => store.setCustomColor(bodyColorInput.value));
  glassColorInput?.addEventListener("input", () => {
    if (isHexColor(glassColorInput.value)) {
      store.updateShell({ glass: "custom", customGlass: glassColorInput.value });
    }
  });
  modelInput?.addEventListener("input", () => store.updateShell({ modelLabel: sanitizeModelLabel(modelInput.value) }));
  resetButton?.addEventListener("click", () => store.resetShell());
  function setPresetMessage(text) {
    if (presetMessage) {
      presetMessage.textContent = text;
    }
  }
  saveButton?.addEventListener("click", () => {
    const id = store.savePreset(presetNameInput?.value ?? "");
    if (id === null) {
      setPresetMessage(i18n.t("presetLimit"));
    } else {
      if (presetNameInput) {
        presetNameInput.value = "";
      }
      setPresetMessage("");
    }
  });
  copyButton?.addEventListener("click", () => {
    copyText(shareCodeEl?.textContent ?? "").then((ok) => setPresetMessage(ok ? i18n.t("copied") : ""));
  });
  importButton?.addEventListener("click", () => {
    const ok = store.importShareCode(importInput?.value ?? "");
    if (!ok) {
      setPresetMessage(i18n.t("invalidCode"));
    } else {
      if (importInput) {
        importInput.value = "";
      }
      setPresetMessage("");
    }
  });
  function renderPresets(presets) {
    if (!presetList) {
      return;
    }
    if (presets.length === 0) {
      presetList.replaceChildren();
      return;
    }
    presetList.replaceChildren(...presets.map((preset) => {
      const row = document.createElement("div");
      row.className = "preset-row";
      const name = document.createElement("span");
      name.className = "preset-name";
      name.textContent = preset.name;
      const apply = document.createElement("button");
      apply.type = "button";
      apply.className = "pill";
      apply.textContent = i18n.t("apply");
      apply.addEventListener("click", () => store.applyPreset(preset.id));
      const del = document.createElement("button");
      del.type = "button";
      del.className = "pill";
      del.textContent = i18n.t("delete");
      del.addEventListener("click", () => store.deletePreset(preset.id));
      row.append(name, apply, del);
      return row;
    }));
  }
  function renderGlass(shell) {
    const host = document.getElementById("glass-pills");
    if (!host) {
      return;
    }
    const presetIds = GLASS_IDS.filter((id) => id !== "custom");
    const buttons = presetIds.map((id) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pill";
      b.textContent = i18n.t(GLASS_LABEL_KEY[id]);
      b.setAttribute("aria-pressed", String(shell.glass === id));
      b.addEventListener("click", () => store.updateShell({ glass: id }));
      return b;
    });
    const custom = document.createElement("button");
    custom.type = "button";
    custom.className = "pill";
    custom.textContent = i18n.t("colorCustom");
    custom.setAttribute("aria-pressed", String(shell.glass === "custom"));
    custom.addEventListener("click", () => {
      store.updateShell({ glass: "custom" });
      if (glassColorInput) {
        glassColorInput.value = store.settings.shell.customGlass.toLowerCase();
        glassColorInput.click();
      }
    });
    host.replaceChildren(...buttons, custom);
  }
  function renderBodySwatches(shell) {
    const swatches = document.getElementById("swatches");
    if (!swatches) {
      return;
    }
    const presets = SHELL_PALETTES.map((p) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "swatch";
      b.title = i18n.t(p.nameKey);
      b.style.setProperty("--fill", p.body);
      b.style.setProperty("--edge", p.bodyEdge);
      b.setAttribute("aria-pressed", String(p.id === shell.shell));
      b.addEventListener("click", () => store.setShell(p.id));
      return b;
    });
    const custom = document.createElement("button");
    custom.type = "button";
    custom.className = "swatch custom";
    custom.id = "swatch-custom";
    custom.title = i18n.t("colorCustom");
    custom.style.setProperty("--fill", shell.customColor);
    custom.setAttribute("aria-pressed", String(shell.shell === "custom"));
    custom.addEventListener("click", () => {
      store.setShell("custom");
      if (bodyColorInput) {
        bodyColorInput.value = store.settings.shell.customColor.toLowerCase();
        bodyColorInput.click();
      }
    });
    swatches.replaceChildren(...presets, custom);
    const name = document.getElementById("shell-name");
    if (name) {
      const p = paletteOf(shell.shell, shell.customColor);
      name.textContent = shell.shell === "custom" ? `${i18n.t(p.nameKey)} ${shell.customColor}` : i18n.t(p.nameKey);
    }
  }
  function render() {
    const { locale, shell, presets } = store.settings;
    const resolved = resolveShell(shell);
    const pills = document.getElementById("lang-pills");
    if (pills) {
      pills.replaceChildren(...LOCALES.map((code) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pill";
        b.textContent = LOCALE_NAMES[code];
        b.setAttribute("aria-pressed", String(code === locale));
        b.addEventListener("click", () => store.setLocale(code));
        return b;
      }));
    }
    renderBodySwatches(shell);
    const rowButton = document.getElementById("row-button");
    if (rowButton) {
      colorRow(rowButton, shell.buttonColor, resolved.button, () => store.updateShell({ buttonColor: null }), (hex) => store.updateShell({ buttonColor: hex }));
    }
    const rowSmall = document.getElementById("row-small");
    if (rowSmall) {
      colorRow(rowSmall, shell.smallButtonColor, resolved.smallButton, () => store.updateShell({ smallButtonColor: null }), (hex) => store.updateShell({ smallButtonColor: hex }));
    }
    const rowPrint = document.getElementById("row-print");
    if (rowPrint) {
      colorRow(rowPrint, shell.printColor, resolved.print, () => store.updateShell({ printColor: null }), (hex) => store.updateShell({ printColor: hex }));
    }
    renderGlass(shell);
    const ribbedToggle2 = document.getElementById("ribbed-toggle");
    if (ribbedToggle2) {
      ribbedToggle2.textContent = i18n.t("ribbed");
      ribbedToggle2.setAttribute("aria-pressed", String(shell.ribbed));
    }
    const dpadHost = document.getElementById("dpad-pills");
    if (dpadHost) {
      pillGroup(dpadHost, DPAD_STYLES, shell.dpad, (d) => DPAD_LABEL_KEY[d], (d) => store.updateShell({ dpad: d }));
    }
    const mascotHost = document.getElementById("mascot-pills");
    if (mascotHost) {
      pillGroup(mascotHost, MASCOT_IDS, shell.mascot, (m) => MASCOT_NAME_KEY[m], (m) => store.updateShell({ mascot: m }));
    }
    if (modelInput && document.activeElement !== modelInput) {
      modelInput.value = shell.modelLabel;
    }
    renderPresets(presets);
    if (shareCodeEl) {
      shareCodeEl.textContent = encodeShareCode(shell);
    }
  }
  const ribbedToggle = document.getElementById("ribbed-toggle");
  ribbedToggle?.addEventListener("click", () => store.updateShell({ ribbed: !store.settings.shell.ribbed }));
  if (modelInput) {
    modelInput.maxLength = MAX_MODEL_LABEL;
  }
  let closeTimer = null;
  function setVisible(visible, animate = true) {
    if (!overlay) {
      return;
    }
    if (closeTimer !== null) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    if (visible) {
      overlay.hidden = false;
      if (animate && typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => overlay.classList.add("open"));
      } else {
        overlay.classList.add("open");
      }
      return;
    }
    overlay.classList.remove("open");
    if (!animate) {
      overlay.hidden = true;
      return;
    }
    closeTimer = setTimeout(() => {
      overlay.hidden = true;
      closeTimer = null;
    }, 260);
  }
  function isOpen() {
    return overlay !== null && !overlay.hidden && overlay.classList.contains("open");
  }
  function setOpen(open) {
    if (!overlay) {
      return;
    }
    setVisible(open);
    onOpenChange(open);
    if (open) {
      showTab(activeTab);
      render();
    }
  }
  opener?.addEventListener("click", () => setOpen(true));
  close?.addEventListener("click", () => setOpen(false));
  overlay?.addEventListener("click", (e) => {
    if (e.target === overlay) {
      setOpen(false);
    }
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) {
      setOpen(false);
    }
  });
  store.onChange(() => {
    if (isOpen()) {
      render();
    }
  });
  return {
    setOverlayHidden(hidden) {
      if (!overlay) {
        return;
      }
      setVisible(!hidden, false);
      if (!hidden) {
        showTab("stickers");
        render();
      }
    }
  };
}

// preview/stickers.ts
var MAX_SIDE = 256;
function readAndDownscale(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader;
    reader.onerror = () => reject(new Error("could not read file"));
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      const img = new Image;
      img.onload = () => {
        const longest = Math.max(img.naturalWidth, img.naturalHeight) || 1;
        const factor = Math.min(1, MAX_SIDE / longest);
        const w = Math.max(1, Math.round(img.naturalWidth * factor));
        const h = Math.max(1, Math.round(img.naturalHeight * factor));
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);
        const keepPng = file.type === "image/png";
        resolve(keepPng ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}
function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
function angleDeg(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
}
function normalizeDeg(deg) {
  return (deg % 360 + 360) % 360;
}
function initStickers(store, images, onArrangeChange) {
  const fileInput = document.getElementById("sticker-file");
  const addButton = document.getElementById("add-sticker");
  const list = document.getElementById("sticker-list");
  const message = document.getElementById("sticker-message");
  const arrangeButton = document.getElementById("arrange-stickers");
  const arrangeBar = document.getElementById("arrange-bar");
  const arrangeDone = document.getElementById("arrange-done");
  const layer = document.getElementById("stickers-layer");
  const shell = document.getElementById("console");
  let arranging = false;
  let selectedId = null;
  const showMessage = (text) => {
    if (message) {
      message.textContent = text;
    }
  };
  const setArranging = (next, select = null) => {
    arranging = next;
    selectedId = select;
    arrangeBar?.toggleAttribute("hidden", !next);
    layer?.classList.toggle("arranging", next);
    onArrangeChange(next);
    renderLayer();
  };
  addButton?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) {
      return;
    }
    readAndDownscale(file).then((dataUrl) => {
      const id = store.addSticker();
      if (id === null) {
        showMessage(i18n.t("stickerLimit"));
        return;
      }
      if (!images.put(id, dataUrl)) {
        store.removeSticker(id);
        showMessage(i18n.t("stickerTooBig"));
        return;
      }
      showMessage("");
      renderList();
      setArranging(true, id);
    }).catch(() => showMessage(i18n.t("stickerTooBig")));
  });
  arrangeButton?.addEventListener("click", () => setArranging(true));
  arrangeDone?.addEventListener("click", () => setArranging(false));
  function renderList() {
    if (!list) {
      return;
    }
    const stickers = store.settings.shell.stickers;
    if (stickers.length === 0) {
      list.replaceChildren();
      const empty = document.createElement("p");
      empty.textContent = i18n.t("noStickers");
      list.appendChild(empty);
      return;
    }
    list.replaceChildren(...stickers.map((sticker) => {
      const row = document.createElement("div");
      row.className = "sticker-row";
      const thumb = document.createElement("img");
      thumb.className = "sticker-thumb";
      thumb.src = images.get(sticker.id) ?? "";
      thumb.alt = "";
      const editSticker = () => setArranging(true, sticker.id);
      thumb.addEventListener("click", editSticker);
      const edit = document.createElement("button");
      edit.className = "pill sticker-edit";
      edit.textContent = i18n.t("editSticker");
      edit.addEventListener("click", editSticker);
      const remove = document.createElement("button");
      remove.className = "pill";
      remove.textContent = i18n.t("deleteSticker");
      remove.addEventListener("click", () => {
        store.removeSticker(sticker.id);
        images.remove(sticker.id);
      });
      row.append(thumb, edit, remove);
      return row;
    }));
  }
  function stickerStyle(el, sticker) {
    el.style.position = "absolute";
    el.style.left = `${50 + sticker.x * 100}%`;
    el.style.top = `${50 - sticker.y * 100}%`;
    el.style.width = `${sticker.scale * 100}%`;
    el.style.transform = "translate(-50%, -50%)";
    const img = el.querySelector("img");
    if (img) {
      img.style.transform = `rotate(${-sticker.rotation}deg)`;
    }
  }
  let gestureActive = false;
  let layerDirty = false;
  const readout = document.getElementById("arrange-readout");
  const showReadout = (sticker) => {
    if (readout) {
      readout.textContent = sticker ? `${Math.round(sticker.scale * 100)}% · ${Math.round(sticker.rotation)}°` : "";
    }
  };
  const snapRotation = (deg) => {
    for (const target of [0, 90, 180, 270]) {
      const diff = Math.abs((deg - target + 540) % 360 - 180);
      if (diff <= 4) {
        return target;
      }
    }
    return deg;
  };
  const pointers = new Map;
  let activeId = null;
  let activeWrapper = null;
  let live = null;
  let anchor = null;
  let pinch = null;
  let moved = false;
  const rebaseline = () => {
    if (!live) {
      return;
    }
    const pts = [...pointers.values()];
    if (pts.length >= 2) {
      pinch = { dist: Math.max(1, distance(pts[0], pts[1])), angle: angleDeg(pts[0], pts[1]), scale: live.scale, rotation: live.rotation };
      anchor = null;
    } else if (pts.length === 1) {
      anchor = { x: live.x, y: live.y, px: pts[0].x, py: pts[0].y };
      pinch = null;
    }
  };
  const finishGesture = () => {
    const final = live;
    const id = activeId;
    live = null;
    activeId = null;
    activeWrapper = null;
    anchor = null;
    pinch = null;
    gestureActive = false;
    showReadout(null);
    if (!final || !id) {
      return;
    }
    if (moved) {
      store.updateSticker(id, { x: final.x, y: final.y, scale: final.scale, rotation: snapRotation(final.rotation) });
    } else {
      store.raiseSticker(id);
    }
    if (layerDirty || !moved) {
      renderLayer();
    }
  };
  layer?.addEventListener("pointerdown", (e) => {
    if (!arranging || !layer) {
      return;
    }
    if (pointers.size === 0) {
      const target = e.target?.closest?.(".sticker");
      const id = target?.dataset.stickerId;
      const current = id ? store.settings.shell.stickers.find((st) => st.id === id) : undefined;
      if (!target || !id || !current) {
        return;
      }
      activeId = id;
      activeWrapper = target;
      live = { ...current };
      moved = false;
      gestureActive = true;
      if (selectedId !== id) {
        selectedId = id;
        layerDirty = true;
      }
    } else if (!activeId) {
      return;
    }
    e.preventDefault();
    layer.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    rebaseline();
  });
  layer?.addEventListener("pointermove", (e) => {
    if (!live || !activeWrapper || !pointers.has(e.pointerId)) {
      return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = shell?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    if (pinch && pointers.size >= 2) {
      const [pa, pb] = [...pointers.values()];
      const dist = Math.max(1, distance(pa, pb));
      const angle = angleDeg(pa, pb);
      live = normalizeSticker({
        ...live,
        scale: pinch.scale * (dist / pinch.dist),
        rotation: snapRotation(normalizeDeg(pinch.rotation - (angle - pinch.angle)))
      });
      moved = true;
    } else if (anchor) {
      const dx = (e.clientX - anchor.px) / rect.width;
      const dy = (e.clientY - anchor.py) / rect.height;
      if (Math.abs(e.clientX - anchor.px) + Math.abs(e.clientY - anchor.py) > 3) {
        moved = true;
      }
      live = normalizeSticker({ ...live, x: anchor.x + dx, y: anchor.y - dy });
    }
    stickerStyle(activeWrapper, live);
    showReadout(live);
  });
  const lift = (e) => {
    if (!pointers.delete(e.pointerId) || !live) {
      return;
    }
    if (pointers.size > 0) {
      rebaseline();
      return;
    }
    finishGesture();
  };
  layer?.addEventListener("pointerup", lift);
  layer?.addEventListener("pointercancel", lift);
  function attachHandle(handle, wrapper, id) {
    let centre = null;
    let start = null;
    let handleLive = null;
    let handlePointer = null;
    handle.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const current = store.settings.shell.stickers.find((st) => st.id === id);
      const rect = wrapper.getBoundingClientRect();
      if (!current) {
        return;
      }
      handle.setPointerCapture(e.pointerId);
      handlePointer = e.pointerId;
      centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const p = { x: e.clientX, y: e.clientY };
      start = { dist: Math.max(1, distance(centre, p)), angle: angleDeg(centre, p), scale: current.scale, rotation: current.rotation };
      handleLive = { ...current };
      gestureActive = true;
    });
    handle.addEventListener("pointermove", (e) => {
      if (!centre || !start || !handleLive || e.pointerId !== handlePointer) {
        return;
      }
      const p = { x: e.clientX, y: e.clientY };
      handleLive = normalizeSticker({
        ...handleLive,
        scale: start.scale * (Math.max(1, distance(centre, p)) / start.dist),
        rotation: snapRotation(normalizeDeg(start.rotation - (angleDeg(centre, p) - start.angle)))
      });
      stickerStyle(wrapper, handleLive);
      showReadout(handleLive);
    });
    const done = (e) => {
      if (e.pointerId !== handlePointer || !handleLive) {
        return;
      }
      e.stopPropagation();
      const final = handleLive;
      handleLive = null;
      centre = null;
      start = null;
      handlePointer = null;
      gestureActive = false;
      showReadout(null);
      store.updateSticker(id, { scale: final.scale, rotation: final.rotation });
      if (layerDirty) {
        renderLayer();
      }
    };
    handle.addEventListener("pointerup", done);
    handle.addEventListener("pointercancel", done);
  }
  function renderLayer() {
    if (!layer) {
      return;
    }
    if (gestureActive) {
      layerDirty = true;
      return;
    }
    layerDirty = false;
    const stickers = store.settings.shell.stickers;
    layer.replaceChildren(...stickers.flatMap((sticker) => {
      const src = images.get(sticker.id);
      if (!src) {
        return [];
      }
      const wrapper = document.createElement("div");
      wrapper.className = "sticker";
      wrapper.dataset.stickerId = sticker.id;
      const img = document.createElement("img");
      img.src = src;
      img.alt = "";
      img.draggable = false;
      img.style.display = "block";
      img.style.width = "100%";
      img.style.height = "auto";
      wrapper.appendChild(img);
      stickerStyle(wrapper, sticker);
      if (arranging) {
        wrapper.style.touchAction = "none";
        wrapper.style.cursor = "grab";
        if (selectedId === sticker.id) {
          wrapper.classList.add("selected");
          const badge = (cls, text, label, onTap) => {
            const b = document.createElement("button");
            b.className = `sticker-badge ${cls}`;
            b.textContent = text;
            b.setAttribute("aria-label", label);
            b.addEventListener("pointerdown", (e) => e.stopPropagation());
            b.addEventListener("click", (e) => {
              e.stopPropagation();
              onTap();
            });
            wrapper.appendChild(b);
            return b;
          };
          badge("sticker-remove", "✕", i18n.t("deleteSticker"), () => {
            store.removeSticker(sticker.id);
            images.remove(sticker.id);
          });
          badge("sticker-ok", "✓", i18n.t("done"), () => setArranging(false));
          const handle = document.createElement("div");
          handle.className = "sticker-badge sticker-handle";
          handle.textContent = "⟳";
          handle.setAttribute("role", "slider");
          handle.setAttribute("aria-label", i18n.t("arrangeHint"));
          wrapper.appendChild(handle);
          attachHandle(handle, wrapper, sticker.id);
        }
      }
      return [wrapper];
    }));
  }
  images.prune(store.settings.shell.stickers.map((s) => s.id));
  renderList();
  renderLayer();
  store.onChange((s) => {
    images.prune(s.shell.stickers.map((sticker) => sticker.id));
    renderList();
    renderLayer();
  });
}

// preview/shell-ui.ts
function applyTranslations() {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const key2 = el.dataset.i18n;
    if (key2) {
      el.textContent = i18n.t(key2);
    }
  }
  document.documentElement.lang = i18n.current;
}
function applyPalette(settings, lcd) {
  const resolved = resolveShell(settings.shell);
  const root = document.documentElement.style;
  root.setProperty("--backdrop", resolved.backdrop);
  root.setProperty("--body", resolved.body);
  root.setProperty("--body-edge", resolved.bodyEdge);
  root.setProperty("--body-highlight", resolved.bodyHighlight);
  root.setProperty("--print", resolved.print);
  root.setProperty("--button", resolved.button);
  root.setProperty("--button-edge", resolved.buttonEdge);
  root.setProperty("--button-highlight", resolved.buttonHighlight);
  root.setProperty("--small", resolved.smallButton);
  root.setProperty("--glass", resolved.glass);
  root.setProperty("--glass-edge", resolved.glassEdge);
  root.setProperty("--ink", resolved.ink);
  renderShellShape(settings.shell, resolved.print);
  lcd?.setInk(resolved.ink);
}
function setupSettings(store, images, lcd, onOpenChange) {
  const card = setupSettingsCard(store, onOpenChange);
  initStickers(store, images, (arranging) => card.setOverlayHidden(arranging));
  store.onChange((s) => {
    i18n.setLocale(s.locale);
    applyTranslations();
    applyPalette(s, lcd);
  });
}

// preview/main.ts
class HtmlSoundPlayer {
  clips = new Map;
  muted = false;
  unlocked = false;
  constructor() {
    if (typeof Audio === "undefined") {
      return;
    }
    for (const event of SOUND_EVENTS) {
      const audio = new Audio(`${SOUND_ASSET_DIR}/${soundFileName(event)}`);
      audio.preload = "auto";
      this.clips.set(event, audio);
    }
  }
  unlock() {
    if (this.unlocked) {
      return;
    }
    this.unlocked = true;
    for (const clip of this.clips.values()) {
      const priming = clip.play();
      if (priming) {
        priming.then(() => clip.pause()).catch(() => {
          return;
        });
      }
      clip.currentTime = 0;
    }
  }
  play(event) {
    const clip = this.clips.get(event);
    if (this.muted || !clip) {
      return;
    }
    clip.currentTime = 0;
    clip.play().catch(() => {
      return;
    });
  }
  setMuted(muted) {
    this.muted = muted;
  }
}
var KEYMAP = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  " ": "rotate",
  x: "rotate",
  X: "rotate",
  Enter: "start",
  p: "power",
  P: "power",
  s: "sound",
  S: "sound",
  r: "reset",
  R: "reset"
};
function configUrl() {
  if (typeof window.__brickConfigUrl === "string" && window.__brickConfigUrl.length > 0) {
    return window.__brickConfigUrl;
  }
  const meta = document.querySelector('meta[name="brick-config"]');
  return meta?.getAttribute("content") ?? "./config.json";
}
function isButton(value) {
  return value !== undefined && BUTTONS.includes(value);
}
async function boot() {
  registerAllGames();
  const settings = new SettingsStore(window.localStorage, defaultSettings(i18n.detect(navigator.language)));
  const images = new StickerImages(window.localStorage);
  i18n.setLocale(settings.settings.locale);
  applyTranslations();
  const provider = createNativeAdsProvider() ?? createMockAdsProvider();
  const policy = new AdsPolicy(window.localStorage, {}, () => Date.now(), ADS_STATE_KEY);
  let currentConfig = null;
  const versionFooter = document.getElementById("settings-footer");
  function renderVersionFooter() {
    if (!versionFooter || !currentConfig) {
      return;
    }
    const version = window.__brickBundleVersion ?? "dev";
    const c = policy.counters;
    const stats = i18n.t("adsStats").replace("{offers}", String(c.offers)).replace("{watched}", String(c.watched)).replace("{skipped}", String(c.skipped)).replace("{interstitials}", String(c.interstitials));
    versionFooter.textContent = `${i18n.t("version")} ${version} · ${currentConfig.updatedAt}
${stats}`;
  }
  async function refreshConfig() {
    currentConfig = await loadRemoteConfig(configUrl(), window.localStorage);
    policy.updateSettings(currentConfig.ads);
    renderVersionFooter();
  }
  await refreshConfig();
  settings.onChange(() => renderVersionFooter());
  const machine = new Console(window.localStorage, createGame, {
    offerContinue: (run) => policy.canOfferContinue(run) && provider.isReady("rewarded")
  });
  const continueOverlay = document.getElementById("continue-overlay");
  const continueTimerBar = document.getElementById("continue-timer-bar");
  document.getElementById("continue-watch")?.addEventListener("click", () => machine.acceptContinue());
  document.getElementById("continue-decline")?.addEventListener("click", () => machine.declineContinue());
  let continueHideTimer = null;
  function showContinuePrompt(show) {
    if (!continueOverlay) {
      return;
    }
    if (continueHideTimer !== null) {
      clearTimeout(continueHideTimer);
      continueHideTimer = null;
    }
    const animate = typeof requestAnimationFrame === "function" && !window.__brickGameHeadless;
    if (show) {
      continueOverlay.hidden = false;
      if (continueTimerBar) {
        continueTimerBar.style.transition = "none";
        continueTimerBar.style.width = "100%";
      }
      const open = () => {
        continueOverlay.classList.add("open");
        if (continueTimerBar) {
          continueTimerBar.style.transition = `width ${CONTINUE_OFFER_MS}ms linear`;
          continueTimerBar.style.width = "0%";
        }
      };
      if (animate) {
        requestAnimationFrame(() => requestAnimationFrame(open));
      } else {
        open();
      }
      return;
    }
    continueOverlay.classList.remove("open");
    if (!animate) {
      continueOverlay.hidden = true;
      return;
    }
    continueHideTimer = setTimeout(() => {
      continueOverlay.hidden = true;
      continueHideTimer = null;
    }, 260);
  }
  const sound = new HtmlSoundPlayer;
  const canvas = document.getElementById("lcd");
  const pixelRatio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  if (canvas) {
    canvas.width = Math.round(LCD_W * pixelRatio);
    canvas.height = Math.round(LCD_H * pixelRatio);
  }
  const ctx = canvas?.getContext("2d");
  const lcd = new LcdCanvas(ctx ?? null, pixelRatio);
  applyPalette(settings.settings, lcd);
  const pauseReasons = new Set;
  function setPaused(reason, on) {
    if (on) {
      pauseReasons.add(reason);
      machine.releaseAll();
    } else {
      pauseReasons.delete(reason);
    }
  }
  function isPaused() {
    return pauseReasons.size > 0;
  }
  setupSettings(settings, images, lcd, (open) => setPaused("settings", open));
  const present = () => {
    sound.setMuted(!machine.soundEnabled);
    for (const event of machine.drainSounds()) {
      sound.play(event);
    }
    lcd.render(machine.frame);
  };
  let prevState = machine.state;
  function showAdWithDeadline(kind) {
    const deadline = new Promise((resolve) => setTimeout(() => resolve("error"), CONTINUE_AWAIT_MAX_MS));
    return Promise.race([provider.show(kind), deadline]);
  }
  function handleContinueRequests() {
    for (const request of machine.drainRequests()) {
      if (request === "continueRequested") {
        setPaused("ad", true);
        showContinuePrompt(false);
        showAdWithDeadline("rewarded").then((result) => {
          policy.markContinueResult(result);
          machine.resolveContinue(result);
          setPaused("ad", false);
          renderVersionFooter();
        });
      }
    }
  }
  function handleStateTransitions() {
    const state = machine.state;
    if (prevState === "SELECT" && state === "PLAYING") {
      policy.onRoundStart();
    }
    if (prevState !== "CONTINUE_OFFER" && state === "CONTINUE_OFFER") {
      policy.markOfferShown();
      showContinuePrompt(true);
    } else if (prevState === "CONTINUE_OFFER" && state !== "CONTINUE_OFFER") {
      showContinuePrompt(false);
    }
    if (prevState !== "GAME_OVER" && state === "GAME_OVER") {
      policy.onRoundCompleted();
    }
    if (prevState === "GAME_OVER" && state === "SELECT" && policy.shouldShowInterstitial()) {
      setPaused("ad", true);
      policy.markInterstitialShown();
      showAdWithDeadline("interstitial").then(() => {
        setPaused("ad", false);
        renderVersionFooter();
      });
    }
    prevState = state;
  }
  function afterTick() {
    handleContinueRequests();
    handleStateTransitions();
  }
  for (const el of document.querySelectorAll("[data-button]")) {
    const button = el.dataset.button;
    if (!isButton(button)) {
      continue;
    }
    const press = (e) => {
      e.preventDefault();
      sound.unlock();
      if (isPaused()) {
        return;
      }
      el.classList.add("down");
      machine.press(button);
      if (e instanceof PointerEvent && typeof el.setPointerCapture === "function") {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {}
      }
    };
    const release = () => {
      el.classList.remove("down");
      machine.release(button);
    };
    el.addEventListener("pointerdown", press);
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("pointerleave", release);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  if (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches) {
    document.getElementById("hint")?.setAttribute("hidden", "");
  }
  const INTERACTIVE = "button, input, select, textarea, label, a, [data-button], .sticker";
  let lastTapAt = 0;
  document.addEventListener("touchend", (e) => {
    const now = performance.now();
    const target = e.target instanceof Element ? e.target : null;
    if (now - lastTapAt < 350 && !(target && target.closest(INTERACTIVE))) {
      e.preventDefault();
    }
    lastTapAt = now;
  }, { passive: false });
  document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
  window.addEventListener("keydown", (e) => {
    const button = KEYMAP[e.key];
    if (button && !isPaused()) {
      e.preventDefault();
      sound.unlock();
      machine.press(button);
    }
  });
  window.addEventListener("keyup", (e) => {
    const button = KEYMAP[e.key];
    if (button) {
      machine.release(button);
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      machine.releaseAll();
    }
  });
  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(100, now - last);
    last = now;
    if (!isPaused()) {
      machine.tick(dt);
      afterTick();
      present();
    }
    requestAnimationFrame(loop);
  };
  if (typeof requestAnimationFrame === "function" && !window.__brickGameHeadless) {
    requestAnimationFrame(loop);
  }
  present();
  window.webkit?.messageHandlers?.ota?.postMessage({ type: "markHealthy" });
  const updateToast = document.getElementById("update-toast");
  const updateRestart = document.getElementById("update-restart");
  updateRestart?.addEventListener("click", () => {
    const ota = window.webkit?.messageHandlers?.ota;
    if (ota) {
      ota.postMessage({ type: "applyUpdate" });
    } else {
      window.location.reload();
    }
  });
  window.__brickNative = {
    ...window.__brickNative,
    onUpdateReady(version) {
      updateToast?.setAttribute("data-version", version);
      updateToast?.removeAttribute("hidden");
    }
  };
  return {
    console: machine,
    step: (ms) => {
      if (!isPaused()) {
        machine.tick(ms);
        afterTick();
        present();
      }
    },
    reloadConfig: refreshConfig
  };
}
window.__brickGame = await boot();
