// Egyptian Arabic → Latin, the way Cairo street signs and OSM's Latin index spell
// things. Rule-based (no AI). Used ONLY to build extra geocoder query variants for
// Arabic-script addresses; every hit is still scored against the guest's words and
// zone-filtered, so a wrong transliteration can never produce a wrong fee — at worst
// it produces nothing and the guest is asked for a pin.
//   1. a dictionary of the common name-words (short vowels are unwritten in Arabic,
//      so "المهدي" must map to "mahdy", not the skeleton "mhdi")
//   2. a per-letter fallback for everything else
const WORDS = {
  // people / common street names
  "ابراهيم": "ibrahim", "إبراهيم": "ibrahim", "محمد": "mohamed", "احمد": "ahmed", "أحمد": "ahmed", "علي": "ali", "على": "ali", "عمر": "omar", "عثمان": "osman", "حسن": "hassan", "حسين": "hussein", "الحسن": "el hassan", "الحسين": "el hussein",
  "مصطفى": "mostafa", "محمود": "mahmoud", "خالد": "khaled", "طارق": "tarek", "يوسف": "youssef", "سعد": "saad", "سعيد": "said", "صلاح": "salah", "سالم": "salem", "زايد": "zayed", "الشيخ": "el sheikh", "شيخ": "sheikh",
  "المهدي": "el mahdy", "مهدي": "mahdy", "الهيثم": "el haitham", "هيثم": "haitham", "خليل": "khalil", "جبران": "gebran", "نجيب": "naguib", "شوقي": "shawky", "شوقى": "shawky", "عباس": "abbas", "العقاد": "el akkad", "النحاس": "el nahas",
  "جمال": "gamal", "عبد": "abd", "الناصر": "el nasser", "ناصر": "nasser", "السادات": "el sadat", "مكرم": "makram", "عبيد": "ebeid", "الطيار": "el tayar", "طيار": "tayar", "الثورة": "el thawra", "النصر": "el nasr", "نصر": "nasr",
  "الشهيد": "el shahid", "شهيد": "shahid", "الدكتور": "el doctor", "دكتور": "doctor", "المشير": "el moshir", "احمد عرابي": "ahmed orabi", "عرابي": "orabi", "الجلاء": "el galaa", "التحرير": "el tahrir", "رمسيس": "ramses",
  "الاهرام": "el ahram", "الأهرام": "el ahram", "الهرم": "el haram", "الفردوس": "el ferdous", "النزهة": "el nozha", "الحجاز": "el hegaz", "الميرغني": "el merghany", "الخليفة": "el khalifa", "المأمون": "el maamoun", "المامون": "el maamoun",
  "الرحمن": "el rahman", "الرحيم": "el rahim", "العزيز": "el aziz", "الحميد": "el hamid", "الوهاب": "el wahab", "الله": "allah", "الدين": "el din",
  // street vocabulary
  "شارع": "", "ش": "", "محور": "axis", "طريق": "road", "ميدان": "square", "كورنيش": "corniche", "الدائري": "ring road", "الدائرى": "ring road",
  "التسعين": "teseen", "تسعين": "teseen", "الجنوبي": "el ganouby", "الجنوبى": "el ganouby", "الشمالي": "el shamaly", "الشمالى": "el shamaly", "الجانبي": "side", "الجانبى": "side",
  "التجمع": "tagamoa", "الخامس": "el khames", "الاول": "el awal", "الأول": "el awal", "الثالث": "el talet", "الجديدة": "el gedida", "القاهرة": "cairo", "مدينة": "madinet",
  "النرجس": "el narges", "الياسمين": "el yasmeen", "البنفسج": "el banafseg", "اللوتس": "el lotus", "الاندلس": "el andalus", "الأندلس": "el andalus", "الرحاب": "el rehab", "مدينتي": "madinaty",
  "عمارة": "", "فيلا": "", "شقة": "", "الدور": "", "بجوار": "", "جنب": "", "امام": "", "أمام": "", "خلف": "",
};
const CH = { "ا": "a", "أ": "a", "إ": "e", "آ": "a", "ب": "b", "ت": "t", "ث": "th", "ج": "g", "ح": "h", "خ": "kh", "د": "d", "ذ": "z", "ر": "r", "ز": "z", "س": "s", "ش": "sh", "ص": "s", "ض": "d", "ط": "t", "ظ": "z", "ع": "a", "غ": "gh", "ف": "f", "ق": "k", "ك": "k", "ل": "l", "م": "m", "ن": "n", "ه": "h", "ة": "a", "و": "o", "ؤ": "o", "ي": "y", "ى": "a", "ئ": "e", "ء": "" };
const strip = (s) => String(s || "").replace(/[ً-ْـ]/g, "");
export function transliterateArabic(text) {
  const s = strip(text).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const words = s.split(/\s+/).filter(Boolean).map((w) => {
    if (WORDS[w] !== undefined) return WORDS[w];
    if (w.startsWith("ال") && WORDS[w.slice(2)] !== undefined) return `el ${WORDS[w.slice(2)]}`.trim();
    // per-letter fallback (skeleton) — Photon is fuzzy enough for common names
    let body = w, prefix = "";
    if (body.startsWith("ال")) { prefix = "el "; body = body.slice(2); }
    let r = "";
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (/[0-9]/.test(c)) { r += c; continue; }
      if (c === "ي") { r += i === body.length - 1 ? "i" : "y"; continue; }
      if (c === "و") { r += i === body.length - 1 ? "o" : "ou"; continue; }
      r += CH[c] ?? "";
    }
    return prefix + r;
  });
  return words.join(" ").replace(/\s+/g, " ").trim();
}
