// Egyptian-Arabic → Latin, the way Cairo street signs / OSM Latin names spell things.
const MAP = [
  // multi-letter first
  ["ابراهيم","ibrahim"],["إبراهيم","ibrahim"],["محمد","mohamed"],["احمد","ahmed"],["أحمد","ahmed"],["علي","ali"],["عمر","omar"],["حسن","hassan"],["حسين","hussein"],["مصطفى","mostafa"],["محمود","mahmoud"],["عبد","abd"],["الله","allah"],["شارع",""],["ش",""],["محور","axis"],["طريق","road"],["ميدان","square"],["التسعين","teseen"],["تسعين","teseen"],["٩٠","90"],["الجنوبي","el ganouby"],["الشمالي","el shamaly"],["الجنوبى","el ganouby"],["الشمالى","el shamaly"],
  ["ال","el "],
];
const CH = { "ا":"a","أ":"a","إ":"e","آ":"a","ب":"b","ت":"t","ث":"th","ج":"g","ح":"h","خ":"kh","د":"d","ذ":"z","ر":"r","ز":"z","س":"s","ش":"sh","ص":"s","ض":"d","ط":"t","ظ":"z","ع":"a","غ":"gh","ف":"f","ق":"k","ك":"k","ل":"l","م":"m","ن":"n","ه":"h","ة":"a","و":"o","ؤ":"o","ي":"y","ى":"a","ئ":"e","ء":"","ـ":"", "ً":"","ٌ":"","ٍ":"","َ":"","ُ":"","ِ":"","ّ":"","ْ":"" };
export function translit(ar) {
  let s = String(ar||"").replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
  const words = s.split(/\s+/).map(w => {
    for (const [a,l] of MAP) if (w === a) return l;
    let out = w;
    if (out.startsWith("ال")) out = "el " + out.slice(2);
    // per-letter with a couple of vowel heuristics: word-final ي → i, medial و → ou
    let r = "";
    for (let i = 0; i < out.length; i++) {
      const c = out[i];
      if (/[a-z0-9 ]/i.test(c)) { r += c; continue; }
      if (c === "ي") { r += (i === out.length - 1 ? "i" : "y"); continue; }
      if (c === "و") { r += (i === out.length - 1 ? "o" : "ou"); continue; }
      r += CH[c] ?? "";
    }
    return r;
  });
  return words.join(" ").replace(/\s+/g," ").trim();
}
for (const s of ["شارع ابراهيم بن المهدي","شارع ٩٠ الجنوبي","محور محمد نجيب","شارع الشيخ زايد","شارع مصطفى النحاس","شارع عباس العقاد","شارع احمد شوقي","شارع الحسن بن الهيثم","شارع جبران خليل جبران"]) console.log(s.padEnd(30), "→", translit(s));
