// native-app.js — موجود فقط داخل تطبيق أندرويد (mobile/scripts/copy-web.js يضيفه
// في أول <head> لكل صفحة في نسخة التطبيق). الموقع لا يحمّله أبداً.
//
// يضيف الأشياء القليلة التي يحتاجها التطبيق ولا يحتاجها الموقع:
//   • زر الرجوع في أندرويد: يسكّر النافذة المفتوحة ← يرجع صفحة لورا ←
//     الصفحة الرئيسية ← يطلع من التطبيق
//   • لون الشريط فوق (الساعة والبطارية) وتحت (أزرار أندرويد) يمشي مع الوضع
//     الفاتح والداكن، وأيقوناتهما تبقى مقروءة
//   • شاشة البداية تختفي أول ما تجهز الصفحة
//   • تصدير Excel / CSV / النسخة الاحتياطية: أندرويد لا يعرف «تنزيل» ملف يصنعه
//     الموقع بنفسه، فهنا يُحفظ في مجلد التنزيلات (Download) وتُفتح قائمة المشاركة
//   • «طباعة / حفظ PDF»: window.print() لا يعمل في أندرويد، فيفتح شاشة الطباعة
//     الخاصة بأندرويد (فيها «حفظ كـ PDF») — GradePrintPlugin.java
//   • واتساب والروابط الخارجية تفتح في تطبيقاتها (وليس داخل التطبيق)
//
// الصفحة لا تنزل تحت الشريطين: الموقع لا يستعمل viewport-fit=cover، فـ Capacitor
// يضع الصفحة بين الشريطين (إعداد SystemBars في capacitor.config.json).
//
// Capacitor يعطي كل إضافة (plugin) مثبّتة للصفحة كـ window.Capacitor.Plugins.<الاسم>.

(function () {
  "use strict";

  var Cap = window.Capacitor;
  var isNative = !!(Cap && typeof Cap.isNativePlatform === "function" && Cap.isNativePlatform());
  if (!isNative) return; // مفتوح في متصفح عادي — لا شيء

  var Plugins = Cap.Plugins || {};
  var App = Plugins.App;
  var SystemBars = Plugins.SystemBars;
  var SplashScreen = Plugins.SplashScreen;
  var Filesystem = Plugins.Filesystem;
  var Share = Plugins.Share;
  var Toast = Plugins.Toast;
  var GradeWindow = Plugins.GradeWindow;
  var GradePrint = Plugins.GradePrint;

  var root = document.documentElement;
  root.classList.add("native-app", "platform-" + Cap.getPlatform());
  window.GS_IS_NATIVE_APP = true;

  function safe(p) {
    // كل استدعاء لإضافة يرجع Promise؛ أي خطأ يجب ألا يوقف التطبيق.
    if (p && typeof p.catch === "function") p.catch(function () {});
    return p;
  }
  function toast(text) {
    if (Toast) safe(Toast.show({ text: text, duration: "long", position: "bottom" }));
  }

  // ---------------- service worker: لا حاجة له في التطبيق ----------------
  // الملفات كلها داخل التطبيق أصلاً (copy-web.js لا ينسخ sw.js).
  if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
    safe(navigator.serviceWorker.getRegistrations().then(function (rs) { rs.forEach(function (r) { safe(r.unregister()); }); }));
  }

  // ---------------- شريط الحالة وشريط التنقل ----------------
  // الموقع يضع class="dark" على <html> في الوضع الداكن.
  //  • لون الأيقونات: "DARK" = أيقونات فاتحة (لخلفية داكنة)، "LIGHT" = أيقونات داكنة.
  //  • لون الشريطين = لون رأس الصفحة (أبيض / zinc-900) — GradeWindowPlugin.java.
  var BAR_LIGHT = "#ffffff"; // bg-white
  var BAR_DARK = "#18181b";  // dark:bg-zinc-900
  var lastDark = null;
  function syncSystemBars(force) {
    var dark = root.classList.contains("dark");
    if (dark === lastDark && !force) return;
    lastDark = dark;
    if (SystemBars) safe(SystemBars.setStyle({ style: dark ? "DARK" : "LIGHT" }));
    if (GradeWindow) safe(GradeWindow.setBackgroundColor({ color: dark ? BAR_DARK : BAR_LIGHT }));
  }
  syncSystemBars(true);
  new MutationObserver(function () { syncSystemBars(false); }).observe(root, { attributes: true, attributeFilter: ["class"] });

  // ---------------- شاشة البداية ----------------
  function hideSplash() {
    if (SplashScreen) safe(SplashScreen.hide({ fadeOutDuration: 200 }));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hideSplash);
  else hideSplash();

  // ---------------- زر الرجوع في أندرويد ----------------
  // 1. نافذة مفتوحة (حوار، بحث، شرح ⓘ، القائمة) ← تسكّر؛
  // 2. صفحة غير الرئيسية ← صفحة لورا (وإذا ما في، الرئيسية)؛
  // 3. على الصفحة الرئيسية (أو صفحة الدخول) ← يطلع من التطبيق.
  function visible(el) {
    return !!el && el.isConnected && el.getClientRects().length > 0;
  }
  function pressEscape() {
    // من العنصر الحالي (يصل إلى document و window كضغطة حقيقية)
    var target = document.activeElement && document.activeElement !== document.documentElement ? document.activeElement : document.body;
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  }
  function closeTopmostLayer() {
    var menuBtn = document.querySelector("header button[aria-expanded='true']");
    var dialogs = Array.prototype.filter.call(document.querySelectorAll("[role='dialog']"), visible);
    var tips = Array.prototype.filter.call(document.querySelectorAll("[role='tooltip']"), visible);
    if (dialogs.length) {
      var top = dialogs[dialogs.length - 1];
      pressEscape();
      // نوافذ لا تسكّر بـ Escape (مثلاً البحث): ضغطة على الخلفية المظلمة حولها
      setTimeout(function () {
        if (visible(top) && top.parentElement) {
          top.parentElement.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        }
      }, 60);
      return true;
    }
    if (tips.length) { pressEscape(); return true; }
    if (menuBtn) { menuBtn.click(); return true; }
    return false;
  }
  function isHome() {
    var p = location.pathname.replace(/\/+$/, "");
    return p === "" || p === "/index.html" || p === "/login" || p === "/reset-password";
  }

  if (App) {
    safe(App.addListener("backButton", function (ev) {
      if (closeTopmostLayer()) return;
      if (isHome()) { safe(App.exitApp()); return; }
      if (ev && ev.canGoBack) { history.back(); return; }
      location.replace("/"); // فُتح التطبيق مباشرة على هذه الصفحة: الرئيسية
    }));
    // عند الرجوع إلى التطبيق: بعض نسخ أندرويد تعيد لون الأيقونات للأصل
    safe(App.addListener("resume", function () { syncSystemBars(true); }));
  }

  // ---------------- الروابط الخارجية (واتساب…) ----------------
  // window.open(رابط خارجي) → يفتح في التطبيق المناسب (واتساب، المتصفح). Capacitor
  // يحوّل أي انتقال إلى عنوان خارجي إلى التطبيق المناسب في التلفون.
  var originalOpen = window.open;
  window.open = function (url) {
    try {
      var u = new URL(String(url), location.href);
      if (u.origin !== location.origin) {
        location.href = u.href;
        return { closed: false, close: function () {}, focus: function () {} };
      }
    } catch (e) { /* رابط غير صالح: كالعادة */ }
    return originalOpen.apply(window, arguments);
  };

  // ---------------- حفظ الملفات (Excel / CSV / النسخة الاحتياطية) ----------------
  // الموقع يصنع الملف في الذاكرة (blob:) ثم يضغط رابطاً فيه download="الاسم".
  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).replace(/^data:[^,]*,/, "")); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(blob);
    });
  }
  function cleanName(name) {
    return String(name || "ملف").replace(/[\\/:*?"<>|]+/g, "-").trim() || "ملف";
  }
  async function saveFile(href, name) {
    if (!Filesystem) { toast("لا يمكن حفظ الملف في هذه النسخة من التطبيق."); return; }
    name = cleanName(name);
    try {
      var blob = await (await fetch(href)).blob();
      var data = await blobToBase64(blob);
      var uri = null;
      try {
        // مجلد التنزيلات العام (يظهر في تطبيق «الملفات»)
        uri = (await Filesystem.writeFile({ path: "Download/" + name, data: data, directory: "EXTERNAL_STORAGE", recursive: true })).uri;
        toast("✓ حُفظ في مجلد التنزيلات (Download): " + name);
      } catch (e) {
        // تلفونات قديمة / بلا إذن: نسخة مؤقتة للمشاركة فقط
        uri = (await Filesystem.writeFile({ path: name, data: data, directory: "CACHE" })).uri;
      }
      // قائمة المشاركة: واتساب، Drive، إيميل…
      if (Share) await Share.share({ title: name, files: [uri], dialogTitle: "إرسال الملف" }).catch(function () {});
    } catch (e) {
      console.warn("saving file failed", e);
      toast("تعذّر حفظ الملف: " + (e && e.message ? e.message : e));
    }
  }
  function isFileLink(a) {
    return a && a.hasAttribute && a.hasAttribute("download") && /^(blob|data):/i.test(a.href || "");
  }
  var originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (isFileLink(this)) { saveFile(this.href, this.getAttribute("download")); return; }
    return originalClick.apply(this, arguments);
  };
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[download]") : null;
    if (isFileLink(a)) { e.preventDefault(); saveFile(a.href, a.getAttribute("download")); }
  }, true);

  // ---------------- الطباعة / حفظ PDF ----------------
  // شاشة الطباعة في أندرويد تأخذ وقتاً لتجهيز الصفحات، والموقع يرجّع الوضع الداكن
  // بعد نصف ثانية؛ لذلك نُبقي الصفحة فاتحة حتى تُسكَّر شاشة الطباعة.
  var printing = false, wantDark = false;
  new MutationObserver(function () {
    if (printing && root.classList.contains("dark")) { wantDark = true; root.classList.remove("dark"); }
  }).observe(root, { attributes: true, attributeFilter: ["class"] });
  window.print = function () {
    if (!GradePrint) { toast("الطباعة غير متاحة في هذه النسخة من التطبيق."); return; }
    if (printing) return;
    printing = true;
    wantDark = root.classList.contains("dark");
    root.classList.remove("dark");
    var name = cleanName(document.title || "تقرير");
    window.dispatchEvent(new Event("beforeprint"));
    setTimeout(function () {
      GradePrint.print({ name: name }).catch(function (e) { toast("تعذّرت الطباعة: " + (e && e.message ? e.message : e)); }).then(function () {
        printing = false;
        if (wantDark) root.classList.add("dark");
        window.dispatchEvent(new Event("afterprint"));
      });
    }, 150); // لحظة حتى تُرسم الألوان الفاتحة
  };
})();
