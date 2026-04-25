const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const EXTENSION_PATH = path.resolve(__dirname, "..", "..");
const OUTPUT_DIR = path.resolve(EXTENSION_PATH, "output", "playwright");

function ensureOutputDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function buildMockRatePayload(currency) {
  const payloads = {
    USD: {
      Cur_OfficialRate: 2.5,
      Cur_Scale: 1,
      Date: "2026-04-25T00:00:00"
    },
    EUR: {
      Cur_OfficialRate: 3.1,
      Cur_Scale: 1,
      Date: "2026-04-25T00:00:00"
    },
    RUB: {
      Cur_OfficialRate: 3.7,
      Cur_Scale: 100,
      Date: "2026-04-25T00:00:00"
    }
  };

  return payloads[currency];
}

function buildSyntheticAvByPage() {
  return `<!doctype html>
  <html lang="ru">
    <head>
      <meta charset="utf-8">
      <title>AV.by Smoke Test</title>
      <style>
        body { font-family: sans-serif; padding: 24px; }
        .price { font-size: 24px; margin-bottom: 12px; }
      </style>
    </head>
    <body>
      <div id="static-price" class="price">45 000 р.</div>
      <div id="dynamic-price" class="price">Цена уточняется</div>
      <script>
        setTimeout(() => {
          document.getElementById("dynamic-price").textContent = "52 300 р.";
        }, 400);
      </script>
    </body>
  </html>`;
}

async function main() {
  ensureOutputDir();

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "av-ext-smoke-"));
  const headed = process.argv.includes("--headed");
  let context;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: !headed,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`
      ]
    });

    await context.route("https://api.nbrb.by/exrates/rates/*", async (route) => {
      const currency = new URL(route.request().url()).pathname.split("/").pop();
      const payload = buildMockRatePayload(currency);

      if (!payload) {
        await route.fulfill({ status: 404, body: "{}" });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(payload)
      });
    });

    await context.route("https://cars.av.by/smoke-test", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: buildSyntheticAvByPage()
      });
    });

    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent("serviceworker");
    }

    const extensionId = serviceWorker.url().split("/")[2];
    assert.ok(extensionId, "Extension id was not resolved from the service worker");

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await popupPage.waitForSelector("#currency");
    await popupPage.waitForSelector("#rate-source");
    await popupPage.close();

    const page = await context.newPage();
    await page.goto("https://cars.av.by/smoke-test", {
      waitUntil: "domcontentloaded"
    });

    const badges = page.locator(".av-ext-converted-price");
    await badges.first().waitFor({ state: "visible", timeout: 15000 });
    await page.waitForFunction(() => {
      return document.querySelectorAll(".av-ext-converted-price").length >= 2;
    }, null, { timeout: 15000 });

    const staticBadgeText = await badges.nth(0).textContent();
    const dynamicBadgeText = await badges.nth(1).textContent();

    assert.match(staticBadgeText || "", /^USD /);
    assert.match(dynamicBadgeText || "", /^USD /);

    console.log("Playwright smoke test passed");
  } catch (error) {
    if (context) {
      const pages = context.pages();
      if (pages.length) {
        try {
          await pages[pages.length - 1].screenshot({
            path: path.join(OUTPUT_DIR, "smoke-failure.png"),
            fullPage: true
          });
        } catch (screenshotError) {
          void screenshotError;
        }
      }
    }

    throw error;
  } finally {
    if (context) {
      await context.close();
    }

    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
