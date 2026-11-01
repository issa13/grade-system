#!/usr/bin/env node
// copy-web.js — يضع نسخة من الموقع (المجلد فوق mobile/) داخل mobile/www/،
// وهو المجلد الذي يضعه Capacitor داخل تطبيق أندرويد.
// يُشغَّل عبر `npm run sync` (قبل `npx cap sync` تلقائياً)، ولا تعدّل www/ بيدك.
//
// الموقع مكتوب بـ Next.js، فلا يمكن نسخ الكود كما هو: يجب «بناؤه» أولاً.
// لذلك هذا السكربت:
//   1. يبني الموقع (npm run build في المجلد الأعلى) بإعدادين خاصين بالتطبيق:
//        • بدون NEXT_PUBLIC_BASE_PATH: داخل التطبيق الموقع في الجذر "/"،
//          وليس في "/grade-system" كما على GitHub Pages.
//        • NEXT_PUBLIC_SITE_URL = عنوان الموقع المنشور: رابط الطالب الخاص وروابط
//          الإيميلات تشير إلى الموقع الحقيقي (داخل التطبيق العنوان هو https://localhost).
//      عنوان Supabase والمفتاح يُقرآن كالعادة: من .env.local على جهازك، أو من
//      متغيّرات GitHub عند البناء على GitHub Actions.
//   2. ينسخ الناتج (out/) إلى mobile/www/، بدون sw.js (لا حاجة له في التطبيق).
//   3. يضيف native-app.js و native-app.css (من mobile/native/) إلى كل صفحة.
//      ملفات الموقع نفسها لا تُلمس.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const MOBILE = path.join(__dirname, "..");
const WEBSITE = path.join(MOBILE, "..");
const OUT_SITE = path.join(WEBSITE, "out");
const OUT = path.join(MOBILE, "www");
const NATIVE = path.join(MOBILE, "native");
const NATIVE_FILES = ["native-app.js", "native-app.css"];

// عنوان الموقع على GitHub Pages. غيّره هنا إذا نقلت الموقع (أو ضع GS_SITE_URL).
const SITE_URL = (process.env.GS_SITE_URL || "https://issa13.github.io/grade-system").replace(/\/+$/, "");

function fail(msg) {
  console.error("\n❌ " + msg + "\n");
  process.exit(1);
}

// ---- 0. فحوصات قبل البدء ----
if (!fs.existsSync(path.join(WEBSITE, "package.json"))) fail("لم أجد package.json الخاص بالموقع فوق مجلد mobile/.");
if (!fs.existsSync(path.join(WEBSITE, "node_modules", "next"))) {
  fail("مكتبات الموقع غير مثبّتة. شغّل أولاً في مجلد الموقع (وليس mobile/):\n   npm install");
}
for (const f of NATIVE_FILES) {
  if (!fs.existsSync(path.join(NATIVE, f))) fail(`ينقص الملف mobile/native/${f}`);
}
const envText = [".env.local", ".env.production.local", ".env.production", ".env"]
  .map((f) => path.join(WEBSITE, f))
  .filter((f) => fs.existsSync(f))
  .map((f) => fs.readFileSync(f, "utf8"))
  .join("\n");
if (!process.env.NEXT_PUBLIC_SUPABASE_URL && !/^\s*NEXT_PUBLIC_SUPABASE_URL\s*=\s*\S+/m.test(envText)) {
  fail("عنوان Supabase غير موجود. ضع NEXT_PUBLIC_SUPABASE_URL و NEXT_PUBLIC_SUPABASE_ANON_KEY في ملف .env.local\n   في مجلد الموقع (مثل .env.example)، وإلا يفتح التطبيق على رسالة «الموقع غير مربوط بقاعدة البيانات بعد».");
}

// ---- 1. بناء الموقع للتطبيق ----
console.log(`⏳ بناء الموقع للتطبيق (روابط الطلاب تشير إلى ${SITE_URL}) …`);
try {
  execSync("npm run build", {
    cwd: WEBSITE,
    stdio: "inherit",
    env: { ...process.env, NEXT_PUBLIC_BASE_PATH: "", NEXT_PUBLIC_SITE_URL: SITE_URL },
  });
} catch {
  fail("فشل بناء الموقع (اقرأ الخطأ فوق). جرّب `npm run build` في مجلد الموقع لترى المشكلة.");
}
if (!fs.existsSync(path.join(OUT_SITE, "index.html"))) fail("انتهى البناء لكن out/index.html غير موجود.");

// ---- 2. نسخة جديدة ----
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(OUT_SITE, OUT, { recursive: true });
fs.rmSync(path.join(OUT, "sw.js"), { force: true });
for (const f of NATIVE_FILES) fs.copyFileSync(path.join(NATIVE, f), path.join(OUT, f));

// ---- 3. native-app.js و native-app.css في كل صفحة ----
const stamp = Date.now().toString(36);
const tags = `<link rel="stylesheet" href="/native-app.css?v=${stamp}"/><script src="/native-app.js?v=${stamp}"></script>`;
let pages = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".html")) {
      const html = fs.readFileSync(p, "utf8");
      const i = html.indexOf("<head>");
      if (i < 0) fail(`لم أجد <head> في ${path.relative(OUT, p)}`);
      // أول شيء في <head>: يعمل قبل سكربتات الموقع
      fs.writeFileSync(p, html.slice(0, i + 6) + tags + html.slice(i + 6), "utf8");
      pages++;
    }
  }
})(OUT);

// ---- 4. ملخّص ----
let bytes = 0, files = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else { files++; bytes += fs.statSync(p).size; }
  }
})(OUT);
console.log(`✅ نُسخ الموقع إلى mobile/www/ — ${files} ملف، ${(bytes / 1048576).toFixed(1)} MB، ${pages} صفحة فيها native-app.js.`);
console.log("   ملاحظة: مجلد out/ في الموقع صار الآن نسخة التطبيق. لا ترفعه إلى GitHub Pages بيدك (GitHub Actions يبني نسخته الخاصة).");
