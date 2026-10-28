// بعد البناء: يضع رقم نسخة جديداً داخل out/sw.js حتى يعرف التطبيق أن هناك تحديثاً.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const file = new URL("../out/sw.js", import.meta.url);
if (existsSync(file)) {
  const id = process.env.GITHUB_SHA?.slice(0, 12) || Date.now().toString(36);
  writeFileSync(file, readFileSync(file, "utf8").replace("__BUILD_ID__", id));
  console.log("sw.js version:", id);
}
