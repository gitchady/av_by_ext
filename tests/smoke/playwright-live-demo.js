const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const EXTENSION_PATH = path.resolve(__dirname, "..", "..");
const LIVE_URL = "https://cars.av.by/";

async function main() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "av-ext-live-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`
    ]
  });

  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker");
  }

  const extensionId = serviceWorker.url().split("/")[2];

  const livePage = await context.newPage();
  await livePage.goto(LIVE_URL, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });

  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);

  console.log("Live AV.by demo is running.");
  console.log(`Live page: ${LIVE_URL}`);
  console.log(`Popup: chrome-extension://${extensionId}/popup.html`);
  console.log("If AV.by shows 'Confirm You Are Human', complete it manually in the opened Chromium window.");
  console.log("After that, navigate inside AV.by if needed and inspect whether converted prices appear.");
  console.log("Close the Chromium window when you are done.");

  await new Promise((resolve) => {
    context.on("close", resolve);
  });

  fs.rmSync(userDataDir, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
