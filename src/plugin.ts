import streamDeck from "@elgato/streamdeck";
import { UsageAction } from "./actions/usageActions.js";
import { UsageService } from "./codex/usageService.js";
import { log } from "./logging.js";

const usageService = new UsageService();

streamDeck.settings.useExperimentalMessageIdentifiers = true;

streamDeck.actions.registerAction(new UsageAction("com.codexusage.tracker.overview", usageService));

streamDeck.system.onSystemDidWakeUp(() => {
  void log("systemDidWakeUp");
  void UsageAction.refreshVisible({ force: true });
});

void log("plugin:start");
streamDeck
  .connect()
  .then(() => {
    void log("plugin:connected");
    setTimeout(() => {
      void log("plugin:startupRefresh");
      void UsageAction.refreshVisible({ force: true, indicator: "initial" });
    }, 500);
  })
  .catch((error: unknown) => {
    void log(`plugin:connectError ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  });
