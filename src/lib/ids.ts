// معرّفات تُنشأ على الجهاز نفسه (للعمل بدون إنترنت).

function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** UUID ثابت من نص: نفس النص يعطي دائماً نفس المعرّف. */
export function stableUuid(text: string): string {
  const hex = cyrb128(text).map((n) => n.toString(16).padStart(8, "0")).join("");
  // صيغة UUID صالحة (الإصدار 5، المتغيّر RFC 4122)
  const v = "5" + hex.slice(13, 16);
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${v}-${variant}-${hex.slice(20, 32)}`;
}

/** معرّف الحصة لموعد في تاريخ معيّن. جهازان بدون إنترنت يعطيان نفس المعرّف، فلا تتكرر الحصة. */
export function sessionIdFor(slotId: string, date: string): string {
  return stableUuid(`session|${slotId}|${date}`);
}
