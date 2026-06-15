// Canonical dish-name glossary for well-known Southeast Asian dishes (Thai,
// Malay/Singaporean, Vietnamese, Chinese staples). The AI menu-import translate
// step (`translateMenuItems` → `buildTranslatePrompt`) injects matched entries
// into the prompt so a recognized dish renders IDENTICALLY across all 6 locales
// run-to-run instead of drifting between plausible paraphrases.
//
// Pure data + lookup, client-safe — NO imports of prisma/server code.

export interface GlossaryEntry {
  id: string;
  names: {
    en: string;
    th: string;
    vi: string;
    "zh-CN": string;
    "zh-TW": string;
    ms: string;
  };
}

export const DISH_GLOSSARY: GlossaryEntry[] = [
  { id: "pad-thai", names: { en: "Pad Thai", th: "ผัดไทย", vi: "Pad Thai", "zh-CN": "泰式炒河粉", "zh-TW": "泰式炒河粉", ms: "Pad Thai" } },
  { id: "tom-yum-goong", names: { en: "Tom Yum Goong", th: "ต้มยำกุ้ง", vi: "Tom Yum Tôm", "zh-CN": "冬阴功汤", "zh-TW": "冬蔭功湯", ms: "Tom Yam Udang" } },
  { id: "som-tum", names: { en: "Som Tum", th: "ส้มตำ", vi: "Gỏi Đu Đủ Thái", "zh-CN": "青木瓜沙拉", "zh-TW": "青木瓜沙拉", ms: "Som Tum" } },
  { id: "massaman-curry", names: { en: "Massaman Curry", th: "แกงมัสมั่น", vi: "Cà Ri Massaman", "zh-CN": "玛莎曼咖喱", "zh-TW": "瑪莎曼咖哩", ms: "Kari Masaman" } },
  { id: "nasi-lemak", names: { en: "Nasi Lemak", th: "ข้าวมันกะทิ", vi: "Nasi Lemak", "zh-CN": "椰浆饭", "zh-TW": "椰漿飯", ms: "Nasi Lemak" } },
  { id: "char-kuey-teow", names: { en: "Char Kuey Teow", th: "ชาร์กวยเตี๋ยว", vi: "Hủ Tiếu Xào", "zh-CN": "炒粿条", "zh-TW": "炒粿條", ms: "Char Kuey Teow" } },
  { id: "bak-kut-teh", names: { en: "Bak Kut Teh", th: "บะกุ๊ดเต๋", vi: "Trà Sườn Heo", "zh-CN": "肉骨茶", "zh-TW": "肉骨茶", ms: "Bak Kut Teh" } },
  { id: "rendang", names: { en: "Rendang", th: "เรนดัง", vi: "Bò Rendang", "zh-CN": "仁当", "zh-TW": "仁當", ms: "Rendang" } },
  { id: "laksa", names: { en: "Laksa", th: "ลักซา", vi: "Laksa", "zh-CN": "叻沙", "zh-TW": "叻沙", ms: "Laksa" } },
  { id: "hainanese-chicken-rice", names: { en: "Hainanese Chicken Rice", th: "ข้าวมันไก่", vi: "Cơm Gà Hải Nam", "zh-CN": "海南鸡饭", "zh-TW": "海南雞飯", ms: "Nasi Ayam Hainan" } },
  { id: "pho", names: { en: "Pho", th: "เฝอ", vi: "Phở", "zh-CN": "越南河粉", "zh-TW": "越南河粉", ms: "Pho" } },
  { id: "bun-bo-hue", names: { en: "Bun Bo Hue", th: "บุนโบเว้", vi: "Bún Bò Huế", "zh-CN": "顺化牛肉米线", "zh-TW": "順化牛肉米線", ms: "Bun Bo Hue" } },
  { id: "banh-mi", names: { en: "Banh Mi", th: "บั๋นมี", vi: "Bánh Mì", "zh-CN": "越式法包", "zh-TW": "越式法包", ms: "Banh Mi" } },
  { id: "com-tam", names: { en: "Com Tam", th: "คอมตั๊ม", vi: "Cơm Tấm", "zh-CN": "越式碎米饭", "zh-TW": "越式碎米飯", ms: "Com Tam" } },
  { id: "bak-chor-mee", names: { en: "Bak Chor Mee", th: "บะหมี่หมูสับ", vi: "Mì Thịt Băm", "zh-CN": "肉脞面", "zh-TW": "肉脞麵", ms: "Bak Chor Mee" } },
  { id: "white-cut-chicken", names: { en: "White Cut Chicken", th: "ไก่ต้มแบบกวางตุ้ง", vi: "Gà Luộc Trắng", "zh-CN": "白切鸡", "zh-TW": "白切雞", ms: "Pak Cham Kai" } },
  { id: "mee-goreng", names: { en: "Mee Goreng", th: "หมี่โกเร็ง", vi: "Mee Goreng", "zh-CN": "马来炒面", "zh-TW": "馬來炒麵", ms: "Mee Goreng" } },
  { id: "roti-canai", names: { en: "Roti Canai", th: "โรตีคาไน", vi: "Roti Canai", "zh-CN": "印度煎饼", "zh-TW": "印度煎餅", ms: "Roti Canai" } },
  { id: "bun-cha", names: { en: "Bun Cha", th: "บุนจ่า", vi: "Bún Chả", "zh-CN": "越南烤肉米粉", "zh-TW": "越南烤肉米粉", ms: "Bun Cha" } },
  { id: "goi-cuon", names: { en: "Goi Cuon", th: "ปอเปี๊ยะเวียดนาม", vi: "Gỏi Cuốn", "zh-CN": "越式鲜春卷", "zh-TW": "越式鮮春卷", ms: "Popia Vietnam" } },
  { id: "beef-pho", names: { en: "Beef Pho", th: "เฝอเนื้อ", vi: "Phở Bò", "zh-CN": "越南牛肉河粉", "zh-TW": "越南牛肉河粉", ms: "Pho Bo" } },
  { id: "yangzhou-fried-rice", names: { en: "Yangzhou Fried Rice", th: "ข้าวผัดหยางโจว", vi: "Cơm Rang Dương Châu", "zh-CN": "扬州炒饭", "zh-TW": "揚州炒飯", ms: "Nasi Goreng Yangzhou" } },
  { id: "char-siu-rice", names: { en: "Char Siu Rice", th: "ข้าวหมูแดง", vi: "Cơm Xá Xíu", "zh-CN": "叉烧饭", "zh-TW": "叉燒飯", ms: "Nasi Char Siu" } },
];

// Reverse index: every locale rendering (case/space-normalized) → its entry.
// First-writer-wins on collisions so a shared romanization can't shadow another
// dish silently. Built once at module load.
const INDEX: Map<string, GlossaryEntry> = (() => {
  const m = new Map<string, GlossaryEntry>();
  for (const e of DISH_GLOSSARY) {
    for (const v of Object.values(e.names)) {
      const k = v.trim().toLowerCase();
      if (k && !m.has(k)) m.set(k, e);
    }
  }
  return m;
})();

/**
 * Look up a glossary entry by any of its locale renderings. Case- and
 * surrounding-space-tolerant. Returns null for an unknown dish.
 */
export function lookupGlossary(name: string): GlossaryEntry | null {
  if (!name) return null;
  return INDEX.get(name.trim().toLowerCase()) ?? null;
}
