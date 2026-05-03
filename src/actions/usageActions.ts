import streamDeck, {
  Target,
  type DidReceiveSettingsEvent,
  type KeyAction,
  type KeyDownEvent,
  type KeyUpEvent,
  type SendToPluginEvent,
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";
import { log } from "../logging.js";
import { renderLoadingPngDataUri, renderRefreshingPngDataUri, renderUsagePngDataUri } from "../render/keyPng.js";
import { normalizeSettings, settingsForPersistence, type NormalizedUsageSettings, type UsageSettings } from "../settings/settings.js";
import { UsageService } from "../codex/usageService.js";

type PropertyInspectorMessage =
  | {
      type: "refresh";
    }
  | {
      type: "saveSettings";
      settings: UsageSettings;
    };

type UpdateIndicator = "initial" | "manual" | "none";

type PressState = {
  longPressTriggered: boolean;
  timer: NodeJS.Timeout;
};

const LONG_PRESS_MS = 700;
const MIN_REFRESH_INDICATOR_MS = 500;
const timers = new Map<string, NodeJS.Timeout>();
const presses = new Map<string, PressState>();
const dataSignatures = new Map<string, string>();
const manualRefreshes = new Set<string>();

export class UsageAction extends SingletonAction<UsageSettings> {
  static readonly instances = new Set<UsageAction>();

  override readonly manifestId: string;
  readonly #usageService: UsageService;

  constructor(manifestId: string, usageService: UsageService) {
    super();
    this.manifestId = manifestId;
    this.#usageService = usageService;
    UsageAction.instances.add(this);
  }

  override async onWillAppear(ev: WillAppearEvent<UsageSettings>): Promise<void> {
    await log(`willAppear action=${ev.action.id}`);
    if (!ev.action.isKey()) return;
    dataSignatures.set(ev.action.id, dataSignature(normalizeSettings(ev.payload.settings)));
    await this.#updateKey(ev.action, ev.payload.settings, { indicator: "initial" });
    this.#restartTimer(ev.action, ev.payload.settings);
  }

  override onWillDisappear(ev: WillDisappearEvent<UsageSettings>): void {
    void log(`willDisappear action=${ev.action.id}`);
    clearTimer(ev.action.id);
    clearPress(ev.action.id);
    dataSignatures.delete(ev.action.id);
    manualRefreshes.delete(ev.action.id);
  }

  override async onKeyDown(ev: KeyDownEvent<UsageSettings>): Promise<void> {
    await log(`keyDown action=${ev.action.id}`);
    if (!ev.action.isKey()) return;

    clearPress(ev.action.id);
    const state: PressState = {
      longPressTriggered: false,
      timer: setTimeout(() => {
        state.longPressTriggered = true;
        void log(`longPressRefresh action=${ev.action.id}`);
        void this.#manualRefresh(ev.action);
      }, LONG_PRESS_MS)
    };
    presses.set(ev.action.id, state);
  }

  override async onKeyUp(ev: KeyUpEvent<UsageSettings>): Promise<void> {
    await log(`keyUp action=${ev.action.id}`);
    if (!ev.action.isKey()) return;

    const state = presses.get(ev.action.id);
    clearPress(ev.action.id);
    if (state?.longPressTriggered) return;

    await this.#cycleScreen(ev.action);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<UsageSettings>): Promise<void> {
    await log(`didReceiveSettings action=${ev.action.id}`);
    if (!ev.action.isKey()) return;

    const settings = normalizeSettings(ev.payload.settings);
    const previousSignature = dataSignatures.get(ev.action.id);
    const nextSignature = dataSignature(settings);
    const force = previousSignature !== undefined && previousSignature !== nextSignature;
    dataSignatures.set(ev.action.id, nextSignature);

    this.#restartTimer(ev.action, ev.payload.settings);
    await this.#updateKey(ev.action, ev.payload.settings, { force, indicator: force ? "initial" : "none" });
  }

  override async onPropertyInspectorDidAppear(): Promise<void> {
    await log("propertyInspectorDidAppear");
    await this.#sendInspectorStatus();
  }

  override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, UsageSettings>): Promise<void> {
    if (!ev.action.isKey()) return;
    const message = ev.payload as PropertyInspectorMessage;
    await log(`sendToPlugin action=${ev.action.id} payload=${JSON.stringify(message)}`);

    if (message?.type === "saveSettings") {
      await ev.action.setSettings(message.settings);
      return;
    }

    if (message?.type === "refresh") {
      await this.#manualRefresh(ev.action);
      await this.#sendInspectorStatus();
    }
  }

  static async refreshVisible(options: { force?: boolean; indicator?: UpdateIndicator } = {}): Promise<void> {
    const tasks: Promise<void>[] = [];
    let count = 0;
    for (const instance of UsageAction.instances) {
      for (const action of instance.actions) {
        if (action.isKey()) {
          count += 1;
          tasks.push(action.getSettings<UsageSettings>().then((settings) => instance.#updateKey(action, settings, options)));
        }
      }
    }
    await log(`refreshVisible count=${count} force=${Boolean(options.force)} indicator=${options.indicator ?? "none"}`);
    await Promise.allSettled(tasks);
  }

  async #manualRefresh(action: KeyAction<UsageSettings>): Promise<void> {
    if (manualRefreshes.has(action.id)) return;
    manualRefreshes.add(action.id);
    try {
      await this.#updateKey(action, await action.getSettings<UsageSettings>(), { force: true, indicator: "manual" });
    } finally {
      manualRefreshes.delete(action.id);
    }
  }

  async #cycleScreen(action: KeyAction<UsageSettings>): Promise<void> {
    const current = await action.getSettings<UsageSettings>();
    const currentSettings = settingsForPersistence(current);
    const normalized = normalizeSettings(currentSettings);
    const nextSettings: UsageSettings = {
      ...currentSettings,
      screenMode: normalized.screenMode === "usage" ? "details" : "usage"
    };

    await log(`cycleScreen action=${action.id} next=${nextSettings.screenMode}`);
    await action.setSettings(nextSettings);
    this.#restartTimer(action, nextSettings);
    await this.#updateKey(action, nextSettings, { indicator: "none" });
  }

  async #updateKey(
    action: KeyAction<UsageSettings>,
    rawSettings: UsageSettings | undefined,
    options: { force?: boolean; indicator?: UpdateIndicator } = {}
  ): Promise<void> {
    const settings = normalizeSettings(rawSettings);
    const indicator = options.indicator ?? "none";
    let indicatorRenderedAt: number | undefined;
    await log(`update:start action=${action.id} force=${Boolean(options.force)} indicator=${indicator} screen=${settings.screenMode}`);

    if (indicator === "initial") {
      await action.setImage(renderLoadingPngDataUri(), { target: Target.HardwareAndSoftware });
      await action.setTitle("", { target: Target.HardwareAndSoftware });
      await log(`update:loadingRendered action=${action.id}`);
    } else if (indicator === "manual") {
      await action.setImage(renderRefreshingPngDataUri(), { target: Target.HardwareAndSoftware });
      await action.setTitle("", { target: Target.HardwareAndSoftware });
      indicatorRenderedAt = Date.now();
      await log(`update:refreshRendered action=${action.id}`);
    }

    const result = await this.#usageService.getUsage(settings, { force: options.force });
    await log(
      result.status === "ok"
        ? `update:ok action=${action.id} source=${result.snapshot.source.kind} selected=${result.snapshot.selected.limitId} primary=${result.snapshot.selected.primary?.usedPercent ?? "na"} secondary=${result.snapshot.selected.secondary?.usedPercent ?? "na"} warning=${result.warning ?? ""}`
        : `update:error action=${action.id} error=${result.error}`
    );

    if (indicatorRenderedAt !== undefined) {
      const remainingMs = MIN_REFRESH_INDICATOR_MS - (Date.now() - indicatorRenderedAt);
      if (remainingMs > 0) {
        await sleep(remainingMs);
        await log(`update:refreshDelay action=${action.id} ms=${remainingMs}`);
      }
    }

    await action.setImage(
      renderUsagePngDataUri({
        result,
        screenMode: settings.screenMode
      }),
      { target: Target.HardwareAndSoftware }
    );
    await action.setTitle("", { target: Target.HardwareAndSoftware });
    await log(`update:rendered action=${action.id} screen=${settings.screenMode}`);

    if (result.status === "error") await action.showAlert();
  }

  #restartTimer(action: KeyAction<UsageSettings>, rawSettings: UsageSettings | undefined): void {
    clearTimer(action.id);
    const settings = normalizeSettings(rawSettings);
    void log(`timer action=${action.id} refreshSeconds=${settings.refreshSeconds}`);
    if (settings.refreshSeconds === 0) return;

    const timer = setInterval(() => {
      void this.#updateKey(action, rawSettings, { force: true, indicator: "none" });
    }, settings.refreshSeconds * 1000);
    timers.set(action.id, timer);
  }

  async #sendInspectorStatus(): Promise<void> {
    const snapshot = this.#usageService.lastSnapshot;
    await streamDeck.ui.sendToPropertyInspector({
      fetchedAt: snapshot?.fetchedAt ?? null,
      source: snapshot?.source.kind ?? "none",
      stale: snapshot?.stale ?? false,
      type: "status"
    });
  }
}

function dataSignature(settings: NormalizedUsageSettings): string {
  return JSON.stringify({
    allowWindowsAppsCopy: settings.allowWindowsAppsCopy,
    codexPath: settings.codexPath ?? "",
    limitId: settings.limitId,
    preferSessionFilesFallback: settings.preferSessionFilesFallback
  });
}

function clearTimer(actionId: string): void {
  const timer = timers.get(actionId);
  if (timer) clearInterval(timer);
  timers.delete(actionId);
}

function clearPress(actionId: string): void {
  const state = presses.get(actionId);
  if (state) clearTimeout(state.timer);
  presses.delete(actionId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
