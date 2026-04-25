# AV.by Currency Converter Extension

Chrome-first `Manifest V3` extension that adds converted `USD`, `EUR`, or `RUB` prices next to `BYN` prices on `av.by`.

## Local Run

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder: `d:\av_ext`

## Features

- popup for currency and rate source selection
- automatic rates from `NBRB`
- manual override for the selected currency
- cached rates in `chrome.storage.local`
- support for dynamic page updates through `MutationObserver`

## Development

- Run tests with `npm test`
- Run the browser-level smoke test with `npm run smoke`
- The extension fetches rates from `https://api.nbrb.by/exrates/rates/<CURRENCY>?parammode=2`
