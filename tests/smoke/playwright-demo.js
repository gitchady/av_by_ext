const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const EXTENSION_PATH = path.resolve(__dirname, "..", "..");

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
      <title>AV.by Extension Demo</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          padding: 32px;
          background: linear-gradient(180deg, #f3f6fb 0%, #eef2f7 100%);
        }
        .card {
          background: white;
          border-radius: 14px;
          padding: 24px;
          max-width: 620px;
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.08);
        }
        .title {
          font-size: 26px;
          margin-bottom: 12px;
          color: #1b2430;
        }
        .meta {
          color: #667284;
          margin-bottom: 18px;
        }
        .price {
          font-size: 32px;
          font-weight: 700;
          color: #16202c;
          margin-bottom: 14px;
        }
        .hint {
          margin-top: 18px;
          color: #556170;
          line-height: 1.5;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="title">Volkswagen Passat, 2019</div>
        <div class="meta">Synthetic demo page for the extension</div>
        <div id="static-price" class="price">45 000 р.</div>
        <div id="dynamic-price" class="price">Цена уточняется</div>
        <div class="hint">
          Через 600мс вторая цена обновится в уже существующем DOM-узле.
          Это показывает, что расширение реагирует на динамическую перерисовку.
        </div>
      </div>
      <script>
        setTimeout(() => {
          document.getElementById("dynamic-price").textContent = "52 300 р.";
        }, 600);
      </script>
    </body>
  </html>`;
}

async function main() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "av-ext-demo-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`
    ]
  });

  await context.route("https://api.nbrb.by/exrates/rates/*", async (route) => {
    const currency = new URL(route.request().url()).pathname.split("/").pop();
    const payload = buildMockRatePayload(currency);

    await route.fulfill({
      status: payload ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(payload || {})
    });
  });

  await context.route("https://cars.av.by/smoke-demo", async (route) => {
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

  const demoPage = await context.newPage();
  await demoPage.goto("https://cars.av.by/smoke-demo", {
    waitUntil: "domcontentloaded"
  });

  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);

  console.log("Demo is running.");
  console.log(`Popup: chrome-extension://${extensionId}/popup.html`);
  console.log("Demo page: https://cars.av.by/smoke-demo");
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
