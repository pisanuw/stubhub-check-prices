// One-time setup: opens a real Chrome window using a dedicated profile so you
// can sign in / solve any bot challenge once. Cookies persist in PROFILE_DIR
// and are reused by every scheduled run.
//
//   npm run login
//
// Sign in (or just let the event page fully load with prices visible), then
// press ENTER here to close.

import { chromium } from "playwright";
import { PROFILE_DIR, EVENT_URL } from "./config.mjs";

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  channel: "chrome",
  headless: false,
  viewport: { width: 1400, height: 950 },
});

const page = ctx.pages()[0] ?? (await ctx.newPage());
console.log("Opening the event page. Sign in if you want, wait for prices to load.");
await page.goto(EVENT_URL, { waitUntil: "domcontentloaded" });

console.log("\nWhen the page looks good, press ENTER here to save the profile and close...");
await new Promise((resolve) => {
  process.stdin.resume();
  process.stdin.once("data", resolve);
});

await ctx.close();
console.log("Profile saved to", PROFILE_DIR);
process.exit(0);
