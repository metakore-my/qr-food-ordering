import { getSettings } from "@/lib/settings";
import { log } from "@/lib/logger";
import { dedupeExtractedItems } from "./menu-extraction";
import { lookupGlossary } from "./dish-glossary";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

// HTTP header values must be Latin-1 (ByteString, code points 0–255). The app
// name is runtime DB config and is routinely non-Latin-1 for our markets (Thai
// "ครัวบ้านไทย", Chinese, etc.); putting it raw into `X-Title` makes `fetch`
// throw "Cannot convert argument to a ByteString" BEFORE the request is sent,
// which broke every AI feature for any non-ASCII-named restaurant. Strip the
// out-of-range characters and collapse whitespace; if nothing usable remains,
// fall back to a fixed ASCII title (the header is only OpenRouter dashboard
// attribution, so a generic value is fine).
export function toLatin1Title(appName: string): string {
  const cleaned = appName
    // Normalize whitespace (tabs/newlines included) to single spaces FIRST, so a
    // tab between two words becomes a separator rather than vanishing.
    .replace(/\s+/g, " ")
    // Keep printable Latin-1 only: ASCII (0x20–0x7E) + Latin-1 Supplement
    // (0xA0–0xFF, e.g. é ñ ü). Everything else — Thai, CJK, emoji, and C0/C1
    // control chars — is dropped, since those cannot survive ByteString encoding.
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "")
    // Collapse any double spaces left where a non-Latin-1 run was removed.
    .replace(/ {2,}/g, " ")
    .trim();
  const base = cleaned || "QR";
  return `${base} Food Ordering`;
}

// Hard cap on extracted items — a backstop against a VLM repetition/hallucination
// loop (observed: a 10-item menu blowing up to 300+ phantom rows). Far above any
// real single-deploy menu; if hit, the response is almost certainly junk, so we
// truncate and log rather than flood the review UI / DB.
const MAX_EXTRACTED_ITEMS = 200;

export interface ExtractedOptionChoice {
  name_th: string;
  name_en: string;
  name_zh_CN: string;
  name_ms: string;
  name_vi: string;
  priceAdjustment: number;
}

export interface ExtractedOptionGroup {
  name_th: string;
  name_en: string;
  name_zh_CN: string;
  name_ms: string;
  name_vi: string;
  selectionType: "SINGLE" | "MULTIPLE";
  isRequired: boolean;
  choices: ExtractedOptionChoice[];
}

export interface ExtractedItem {
  name_th: string;
  name_en: string;
  name_zh_CN: string;
  name_ms: string;
  name_vi: string;
  price: number;
  category: string;
  /** Set when merged rows had different non-sentinel prices. `kept` is the price used. */
  priceConflict?: { prices: number[]; kept: number };
  optionGroups?: ExtractedOptionGroup[];
}

export interface TranslatedNames {
  en: string;
  th: string;
  vi: string;
  "zh-CN": string;
  "zh-TW": string;
  ms: string;
}

export interface AllLocaleNames {
  en: string;
  th: string;
  vi: string;
  "zh-CN": string;
  "zh-TW": string;
  ms: string;
}

interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

interface CallOptions {
  temperature?: number;
  response_format?: { type: string };
  provider?: { order?: string[]; quantizations?: string[]; allow_fallbacks?: boolean };
  models?: string[]; // Fallback model list — OpenRouter tries in order
  // OpenRouter reasoning controls (for thinking-capable models, e.g.
  // deepseek-v4-flash which supports effort "high"/"xhigh"; "xhigh" = max).
  reasoning?: { effort?: "low" | "medium" | "high" | "xhigh"; max_tokens?: number };
}

async function callOpenRouter(
  model: string,
  messages: OpenRouterMessage[],
  options: CallOptions = {}
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY environment variable is not set");
  }

  // App name for the OpenRouter X-Title header comes from runtime DB settings
  // (getSettings is cached ~10s). Non-critical: fall back to "Restaurant" if the
  // settings read fails, since the header is only dashboard attribution.
  let appName = "Restaurant";
  try {
    appName = (await getSettings()).appName;
  } catch {
    // keep the fallback
  }

  const body: Record<string, unknown> = {
    model,
    messages,
  };
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.response_format) body.response_format = options.response_format;
  if (options.provider) body.provider = options.provider;
  if (options.models) body.models = options.models;
  if (options.reasoning) body.reasoning = options.reasoning;

  const controller = new AbortController();
  // 55s default (under Next.js 60s maxDuration). Reasoning calls (xhigh effort)
  // think before answering and routinely exceed 55s, so allow longer when
  // reasoning is requested — these run outside the request path (or need the
  // route's maxDuration raised) so the 60s cap doesn't apply there.
  const timeoutMs = options.reasoning ? 280_000 : 55_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXTAUTH_URL || "http://localhost:3000",
        "X-Title": toLatin1Title(appName),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("OpenRouter API request timed out after 55s");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter API error (${res.status}): ${text}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("OpenRouter returned unexpected response format");
  }

  return content;
}

export async function extractMenuItems(
  base64Images: string[],
  existingCategories?: string[],
  currency = "THB",
  decimals = 2,
  sourceLocale = "en"
): Promise<ExtractedItem[]> {
  const imageContent = base64Images.map((img) => ({
    type: "image_url" as const,
    image_url: { url: img.startsWith("data:") ? img : `data:image/jpeg;base64,${img}` },
  }));

  // Currency-aware price rule. The trap is the separator character: for a
  // zero-decimal currency (VND) the "." in "65.000" is a THOUSANDS separator,
  // not a decimal point — so it must be stripped and the full integer emitted
  // (65000), never read as 65. For decimal currencies the "." IS the decimal
  // point and must be preserved (9.50 → 9.5). We branch on `decimals`.
  const priceInstruction = decimals === 0
    ? `- price: The price shown on the menu as a plain WHOLE NUMBER in ${currency}. ${currency} has NO minor unit (no cents/decimals). Both "." and "," in the printed price are THOUSANDS SEPARATORS — strip them and keep ALL the digits: "65.000" is the integer 65000 (NOT 65), "5,000" is 5000, "1.250.000" is 1250000. Strip any currency symbol (e.g. ₫, đ, VND). NEVER drop the trailing zeros and NEVER read a thousands group as a decimal. If the price says "Market Price"/"Seasonal" (or its local-language equivalent, e.g. "Giá Theo Mùa"), use -1. If truly unclear or missing, use 0.`
    : `- price: The price shown on the menu as a plain decimal number in ${currency} (the menu's currency). Strip any currency symbols (e.g. ฿, RM, $, S$) and thousands separators (",", e.g. "1,250.00" → 1250). Keep the decimal point EXACTLY as printed — "9.50" is the number 9.5, NOT 950; "12" is 12. Never multiply by 100 or convert to cents. If the price says "Market Price"/"Seasonal" (or its local-language equivalent), use -1. If truly unclear or missing, use 0.`;

  const categoryInstruction = existingCategories && existingCategories.length > 0
    ? `- category: PREFER assigning items to one of these existing categories: [${existingCategories.map((c) => `"${c}"`).join(", ")}]. Use the EXACT name from this list when a category fits the item well. Only create a new category name if none of the existing ones are suitable. When creating new categories, use specific, descriptive English names (e.g. "Appetizers", "Soups", "Stir-Fried Dishes"). Never use "General".`
    : `- category: ALWAYS classify each item into a specific, descriptive category. Use the menu's own section headings if visible. If the menu has no clear sections, infer an appropriate category from the type of dish (e.g. "Appetizers", "Soups", "Salads", "Stir-Fried Dishes", "Curries", "Rice & Noodles", "Seafood", "Grilled", "Drinks", "Desserts"). Never use "General" — always assign a meaningful category. Let the categories follow naturally from the items that are actually on the menu; do not invent extra items to fill out categories.`;

  const messages: OpenRouterMessage[] = [
    {
      role: "system",
      content: `You are a restaurant menu extraction assistant for Southeast Asian restaurants (Thailand, Malaysia, Singapore, Vietnam, and similar). The menu may be printed in ANY language — Thai, Malay, English, Chinese, Vietnamese, or a mix. Read the menu in whatever language it is printed and extract the items that are actually on it.

For each item emit FIVE name fields — name_th, name_ms, name_vi, name_zh_CN, name_en — plus price, category, and any options. Transcribe whatever language(s) the menu actually prints into the matching field(s) VERBATIM; leave the others blank ("") for a later translation step. Only Traditional Chinese (zh-TW) is filled entirely by translation later, so never emit it here.

Return a JSON object with this structure:
{
  "items": [
    {
      "name_th": "ผัดไทย",
      "name_en": "Pad Thai",
      "name_zh_CN": "",
      "name_ms": "",
      "name_vi": "",
      "price": 12.50,
      "category": "Noodles",
      "optionGroups": [
        {
          "name_th": "ระดับความเผ็ด",
          "name_en": "Spice Level",
          "name_zh_CN": "",
          "name_ms": "",
          "name_vi": "",
          "selectionType": "SINGLE",
          "isRequired": true,
          "choices": [
            { "name_th": "ไม่เผ็ด", "name_en": "Not Spicy", "name_zh_CN": "", "name_ms": "", "name_vi": "", "priceAdjustment": 0 },
            { "name_th": "เผ็ดมาก", "name_en": "Very Spicy", "name_zh_CN": "", "name_ms": "", "name_vi": "", "priceAdjustment": 0 }
          ]
        }
      ]
    }
  ]
}
(In this example the menu was printed in Thai, so only name_th is transcribed and name_en is the established name; the other languages are left blank for translation.)

Rules:
- Extract every item that is ACTUALLY VISIBLE in the menu images — and extract each one EXACTLY ONCE. Do NOT invent, guess, or pad the list with items that are not printed (e.g. do not generate a long series of drink variations that aren't on the menu). Do NOT repeat an item. A typical single-page menu has 10–40 items; if you find yourself emitting many near-identical entries, STOP — you are hallucinating. It is far better to return only the real items than to fill a long list.
- name_th / name_ms / name_vi: the Thai, Malay, and Vietnamese names. For EACH of these, if the menu actually PRINTS that language, transcribe it VERBATIM (preserve the script/diacritics exactly as printed — Thai script, Malay spelling, Vietnamese tone marks). If the menu does NOT print that language, leave the field BLANK (""). Do NOT invent or guess a translation — a wrong guess here is worse than a blank, and a separate translation step fills the gaps later.
- name_zh_CN: Simplified Chinese name. If the menu prints one, use it exactly; otherwise leave it BLANK ("") for the later translation step.
- name_en: English name. If the menu prints English (or a romanized name), use it. For well-known dishes from ANY of these cuisines, use the established/conventional English or romanized name, NOT a literal word-for-word translation — e.g. "Pad Thai", "Tom Yum Goong", "Som Tum", "Massaman Curry" (Thai); "Nasi Lemak", "Char Kuey Teow", "Bak Kut Teh", "Rendang" (Malay/Singaporean); "Pho", "Bun Bo Hue", "Banh Mi", "Com Tam" (Vietnamese); "Hainanese Chicken Rice", "Laksa", "Bak Chor Mee" (Singaporean). If the dish has no established English name and none is printed, leave it BLANK ("").
${priceInstruction}
${categoryInstruction}
- optionGroups: If the menu shows customer choices for an item (e.g. spice level, noodle type, size, toppings, add-ons, protein choice), extract them as optionGroups. If no options are visible for an item, OMIT the optionGroups field entirely (do not include an empty array).
  - selectionType: "SINGLE" if the customer must pick exactly one (e.g. spice level, size), "MULTIPLE" if they can pick several (e.g. toppings, add-ons)
  - isRequired: true if the customer must choose (e.g. spice level, noodle type), false if optional (e.g. extra toppings)
  - choices: each option with the same five name fields (transcribe whatever the menu prints verbatim, leave the rest blank "") and priceAdjustment (0 if no extra charge, positive number if there is an upcharge)
  - Common option groups to look for: spice level, size (S/M/L), noodle type (egg noodle, rice noodle, glass noodle), protein (chicken, pork, beef, shrimp), add-ons/extras
- If the same item appears multiple times across images (duplicates), merge them into a single entry. Use the most complete name and the most accurate price.
- Return ONLY valid JSON, no extra text`,
    },
    {
      role: "user",
      content: [
        { type: "text", text: "Extract all menu items from these restaurant menu photos:" },
        ...imageContent,
      ],
    },
  ];

  // VLM extraction model: qwen/qwen3.5-flash-02-23. `provider` is left unset —
  // Alibaba is this model's only OpenRouter provider, so default routing lands
  // there anyway with no functional difference. Chosen over mistral-small after
  // a 4-market (TH/MY/SG/VN) head-to-head: Qwen does NOT hallucinate Thai names
  // on non-Thai menus (Mistral turned "Nasi Lemak" → "orange juice" in Thai)
  // and reads sharper English dish names. It is slower (~16s vs ~4s — the model
  // reasons before answering) but extraction is a one-off import action, so the
  // latency is acceptable and well under the 55s timeout. No fallback model by
  // design. The hardened anti-repetition prompt + the dedup/cap backstop below
  // guard against runaway output regardless of model.
  const raw = await callOpenRouter(
    "qwen/qwen3.5-flash-02-23",
    messages,
    {
      temperature: 0.1,
      response_format: { type: "json_object" },
    }
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Failed to parse extraction response as JSON");
  }

  const rawItems = (parsed as Record<string, unknown>)?.items;
  if (!Array.isArray(rawItems)) {
    throw new Error("Extraction response missing 'items' array");
  }

  // For a zero-decimal currency (VND) a fractional value can't be stored and is
  // almost always a misparsed thousands group, so round to an integer — a
  // backstop in case the model ignores the prompt's "no decimals" rule. The
  // -1 "Market Price" sentinel is preserved. Decimal currencies pass through.
  const normalizePrice = (raw: number): number => {
    if (raw === -1) return -1;
    const v = Math.max(0, raw || 0);
    return decimals === 0 ? Math.round(v) : v;
  };

  // Map raw LLM rows → typed ExtractedItem[] with all five name fields +
  // normalized price, THEN dedup on the typed shape (identity keys on every
  // printed name, not just name_en) and cap. Dedup must run AFTER the map so it
  // sees the normalized 5-field shape (see dedupeExtractedItems).
  const items: ExtractedItem[] = (rawItems as Record<string, unknown>[]).map((item) => {
    const base: ExtractedItem = {
      name_th: String(item.name_th ?? ""),
      name_en: String(item.name_en ?? ""),
      name_zh_CN: String(item.name_zh_CN ?? ""),
      name_ms: String(item.name_ms ?? ""),
      name_vi: String(item.name_vi ?? ""),
      price: normalizePrice(Number(item.price)),
      category: String(item.category ?? "Other Dishes"),
    };

    // Parse option groups if present (lenient — bad data is silently dropped)
    if (Array.isArray(item.optionGroups) && item.optionGroups.length > 0) {
      try {
        const groups: ExtractedOptionGroup[] = [];
        for (const g of item.optionGroups as Record<string, unknown>[]) {
          if (!Array.isArray(g.choices) || g.choices.length === 0) continue;
          const choices: ExtractedOptionChoice[] = [];
          for (const c of g.choices as Record<string, unknown>[]) {
            choices.push({
              name_th: String(c.name_th ?? c.name_en ?? ""),
              name_en: String(c.name_en ?? c.name_th ?? ""),
              name_zh_CN: String(c.name_zh_CN ?? c.name_en ?? ""),
              name_ms: String(c.name_ms ?? ""),
              name_vi: String(c.name_vi ?? ""),
              priceAdjustment: normalizePrice(Math.max(0, Number(c.priceAdjustment) || 0)),
            });
          }
          if (choices.length > 0) {
            groups.push({
              name_th: String(g.name_th ?? g.name_en ?? ""),
              name_en: String(g.name_en ?? g.name_th ?? ""),
              name_zh_CN: String(g.name_zh_CN ?? g.name_en ?? ""),
              name_ms: String(g.name_ms ?? ""),
              name_vi: String(g.name_vi ?? ""),
              selectionType: g.selectionType === "MULTIPLE" ? "MULTIPLE" : "SINGLE",
              isRequired: Boolean(g.isRequired),
              choices,
            });
          }
        }
        if (groups.length > 0) {
          base.optionGroups = groups;
        }
      } catch {
        // Silently ignore malformed option groups — the item is still valid
      }
    }

    return base;
  });

  // Backstop against a runaway VLM (repetition/hallucination loop): merge rows
  // that share any printed name (identity-based, source-language-aware — see
  // dedupeExtractedItems; collapses both exact repeats AND two romanizations of
  // one dish), then hard-cap the count. Both are belt-and-suspenders for the
  // prompt's anti-repetition rule; the human review step is still the primary
  // guard for hallucinated-but-distinct rows.
  let deduped = dedupeExtractedItems(items, sourceLocale);
  if (deduped.length > MAX_EXTRACTED_ITEMS) {
    log.warn("Extract", "Item count exceeded cap — truncating (likely model hallucination loop)", {
      returned: rawItems.length,
      afterDedup: deduped.length,
      cap: MAX_EXTRACTED_ITEMS,
    });
    deduped = deduped.slice(0, MAX_EXTRACTED_ITEMS);
  }

  return deduped;
}

// Human-readable language label per locale code — used to name the source
// language in the source-aware translation prompts.
const LOCALE_LABELS: Record<string, string> = {
  en: "English",
  th: "Thai",
  vi: "Vietnamese",
  "zh-CN": "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
  ms: "Malay",
};

// Builds the dish-name translation system prompt, naming `sourceLocale` as the
// source of truth. Defaults to English for backward compatibility with the
// legacy trio-shape import flow (callers that don't pass a source locale).
//
// `sourceNames` (the actual dish names being translated) are matched against the
// canonical DISH_GLOSSARY; any hits are appended as an exact-name glossary block
// so well-known dishes render IDENTICALLY every run instead of drifting between
// plausible paraphrases. No matches → the base prompt is returned unchanged.
export function buildTranslatePrompt(
  sourceLocale: string = "en",
  sourceNames: string[] = []
): string {
  const label = LOCALE_LABELS[sourceLocale] ?? "English";
  const base = `You are a professional restaurant menu translator. Translate the given food/drink names into ALL of the following languages: English (en), Thai (th), Vietnamese (vi), Simplified Chinese (zh-CN), Traditional Chinese (zh-TW), Malay (ms).

Return a JSON object with this exact structure:
{"translations": [{"en": "...", "th": "...", "vi": "...", "zh-CN": "...", "zh-TW": "...", "ms": "..."}]}

Rules:
- The translations array must have the same length and order as the input items array.
- The "${sourceLocale}" (${label}) field is the SOURCE OF TRUTH — use it as your primary reference for the dish's meaning. Other inputs may be missing or imperfect; defer to "${sourceLocale}" when they conflict.
- Use natural, appetizing food terminology appropriate for a restaurant menu in each language.
- For well-known dish names from any Southeast Asian cuisine, use the established name/transliteration in each language rather than a literal translation — e.g. Pad Thai, Tom Yum, Som Tum, Massaman (Thai); Nasi Lemak, Char Kuey Teow, Bak Kut Teh, Rendang (Malay/Singaporean); Pho, Bun Bo Hue, Banh Mi (Vietnamese); Hainanese Chicken Rice, Laksa, Bak Chor Mee (Singaporean).
- Do NOT literally translate proper dish names. "Pad Thai" should NOT become "Thai stir-fry" in any language.
- When a name is ALREADY written in the target language, keep it as-is rather than paraphrasing it.
- Return ONLY valid JSON.`;

  const hits = new Map<string, ReturnType<typeof lookupGlossary>>();
  for (const n of sourceNames) {
    const e = lookupGlossary(n);
    if (e && !hits.has(e.id)) hits.set(e.id, e);
  }
  if (hits.size === 0) return base;

  const lines = [...hits.values()].map((e) => {
    const n = e!.names;
    return `- "${n[sourceLocale as keyof typeof n] || n.en}" → en:"${n.en}", th:"${n.th}", vi:"${n.vi}", zh-CN:"${n["zh-CN"]}", zh-TW:"${n["zh-TW"]}", ms:"${n.ms}"`;
  });
  return `${base}

GLOSSARY — for any input dish matching the left side, use these exact names (do not paraphrase):
${lines.join("\n")}`;
}

// Builds the option-name translation system prompt, naming `sourceLocale` as the
// source of truth. Defaults to English for backward compatibility.
export function buildOptionTranslatePrompt(sourceLocale: string = "en"): string {
  const label = LOCALE_LABELS[sourceLocale] ?? "English";
  return `You are a professional restaurant menu translator. The input contains option group names and option choice names for food items (e.g. "Spice Level", "Not Spicy", "Egg Noodle", "Large", "Extra Cheese"). Translate them into ALL of the following languages: English (en), Thai (th), Vietnamese (vi), Simplified Chinese (zh-CN), Traditional Chinese (zh-TW), Malay (ms).

Return a JSON object with this exact structure:
{"translations": [{"en": "...", "th": "...", "vi": "...", "zh-CN": "...", "zh-TW": "...", "ms": "..."}]}

Rules:
- The translations array must have the same length and order as the input array.
- The "${sourceLocale}" (${label}) field is the SOURCE OF TRUTH — use it as your primary reference; defer to it if the other inputs conflict.
- Use natural, appropriate food terminology for a restaurant menu.
- For region-specific terms (e.g. noodle types like "Sen Yai", "Sen Lek", "Ba Mee"), use the established transliteration in each language where one exists, otherwise translate the meaning.
- When a term is ALREADY written in the target language, keep it as-is rather than paraphrasing it.
- Return ONLY valid JSON.`;
}

export async function translateMenuItems(
  items: Array<{ name: string }>,
  sourceLocale: string = "en"
): Promise<TranslatedNames[]> {
  const messages: OpenRouterMessage[] = [
    {
      role: "system",
      content: buildTranslatePrompt(sourceLocale, items.map((it) => it.name)),
    },
    {
      role: "user",
      // Tag each name with its source language so the model knows the input locale.
      content: JSON.stringify(items.map((it) => ({ [sourceLocale]: it.name }))),
    },
  ];

  const raw = await callOpenRouter("deepseek/deepseek-v4-flash", messages, {
    temperature: 0.2,
    response_format: { type: "json_object" },
    // Primary deepseek-v4-flash uses xhigh reasoning (best translation accuracy).
    // Fallback gpt-4o-mini does NOT support `reasoning` — OpenRouter silently
    // IGNORES the param for it (verified: returns 200, no error), so the fallback
    // works fine, just without reasoning. It's a degraded-but-functional safety net
    // only hit if deepseek is unavailable; do not assume it reasons.
    models: ["deepseek/deepseek-v4-flash", "openai/gpt-4o-mini"],
    reasoning: { effort: "xhigh" },
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Failed to parse translation response as JSON");
  }

  const translations = (parsed as Record<string, unknown>)?.translations;
  if (!Array.isArray(translations)) {
    throw new Error("Translation response missing 'translations' array");
  }

  return translations.map((t: Record<string, unknown>) => ({
    en: String(t.en ?? ""),
    th: String(t.th ?? ""),
    vi: String(t.vi ?? ""),
    "zh-CN": String(t["zh-CN"] ?? ""),
    "zh-TW": String(t["zh-TW"] ?? ""),
    ms: String(t.ms ?? ""),
  }));
}

export async function translateCategoryNames(
  names: string[],
  sourceLocale: string = "en"
): Promise<AllLocaleNames[]> {
  // Name the source language as the source of truth (mirrors buildTranslatePrompt
  // for dish names). Defaults to English for backward compat with any caller that
  // doesn't pass it. On a non-English deployment the printed category names are
  // in the source language, NOT English, so anchoring on en would re-translate.
  const label = LOCALE_LABELS[sourceLocale] ?? "English";
  const messages: OpenRouterMessage[] = [
    {
      role: "system",
      content: `You are a professional restaurant menu translator. Translate the given food category names into ALL of the following languages: English (en), Thai (th), Vietnamese (vi), Simplified Chinese (zh-CN), Traditional Chinese (zh-TW), Malay (ms).

Return a JSON object with this exact structure:
{"translations": [{"en": "...", "th": "...", "vi": "...", "zh-CN": "...", "zh-TW": "...", "ms": "..."}]}

Rules:
- The translations array must have the same length and order as the input names array.
- The input names are written in "${sourceLocale}" (${label}) — treat that as the SOURCE OF TRUTH for each category's meaning.
- Use natural terminology appropriate for a restaurant menu category.
- For region-specific category names (e.g. "Yum" salads, "Tom" soups, "Kaeng" curries, "Nasi" rice dishes), use the established terminology in each language rather than generic translations.
- When a category name is ALREADY written in the target language, keep it as-is rather than paraphrasing it.
- Return ONLY valid JSON.`,
    },
    {
      role: "user",
      content: JSON.stringify(names),
    },
  ];

  const raw = await callOpenRouter("deepseek/deepseek-v4-flash", messages, {
    temperature: 0.2,
    response_format: { type: "json_object" },
    // Primary deepseek-v4-flash uses xhigh reasoning (best translation accuracy).
    // Fallback gpt-4o-mini does NOT support `reasoning` — OpenRouter silently
    // IGNORES the param for it (verified: returns 200, no error), so the fallback
    // works fine, just without reasoning. It's a degraded-but-functional safety net
    // only hit if deepseek is unavailable; do not assume it reasons.
    models: ["deepseek/deepseek-v4-flash", "openai/gpt-4o-mini"],
    reasoning: { effort: "xhigh" },
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Failed to parse category translation response as JSON");
  }

  const translations = (parsed as Record<string, unknown>)?.translations;
  if (!Array.isArray(translations)) {
    throw new Error("Category translation response missing 'translations' array");
  }

  return translations.map((t: Record<string, unknown>, idx: number) => ({
    en: String(t.en || names[idx]),
    th: String(t.th || names[idx]),
    vi: String(t.vi || names[idx]),
    "zh-CN": String(t["zh-CN"] || names[idx]),
    "zh-TW": String(t["zh-TW"] || names[idx]),
    ms: String(t.ms || names[idx]),
  }));
}

// Legacy trio-shaped option input — retained for any external reference. The
// route now maps this to SourceOptionTranslationInput before calling.
export interface OptionTranslationInput {
  groups: Array<{
    name_th: string;
    name_en: string;
    name_zh_CN: string;
    choices: Array<{
      name_th: string;
      name_en: string;
      name_zh_CN: string;
    }>;
  }>;
}

// Source-locale-aware option input: a single source `name` per group/choice,
// translated against the prompt's `sourceLocale`.
export interface SourceOptionTranslationInput {
  groups: Array<{
    name: string;
    choices: Array<{ name: string }>;
  }>;
}

export interface OptionTranslationOutput {
  groups: Array<{
    name: TranslatedNames;
    choices: Array<{ name: TranslatedNames }>;
  }>;
}

export async function translateOptionNames(
  input: SourceOptionTranslationInput,
  sourceLocale: string = "en"
): Promise<OptionTranslationOutput> {
  // Flatten all names into a single array for efficient batch translation
  const allNames: string[] = [];
  const structure: Array<{ groupIdx: number; type: "group" | "choice"; choiceIdx?: number }> = [];

  for (let gi = 0; gi < input.groups.length; gi++) {
    const g = input.groups[gi];
    allNames.push(g.name);
    structure.push({ groupIdx: gi, type: "group" });
    for (let ci = 0; ci < g.choices.length; ci++) {
      allNames.push(g.choices[ci].name);
      structure.push({ groupIdx: gi, type: "choice", choiceIdx: ci });
    }
  }

  if (allNames.length === 0) {
    return { groups: [] };
  }

  const messages: OpenRouterMessage[] = [
    { role: "system", content: buildOptionTranslatePrompt(sourceLocale) },
    {
      role: "user",
      content: JSON.stringify(allNames.map((n) => ({ [sourceLocale]: n }))),
    },
  ];

  const raw = await callOpenRouter("deepseek/deepseek-v4-flash", messages, {
    temperature: 0.2,
    response_format: { type: "json_object" },
    // Primary deepseek-v4-flash uses xhigh reasoning (best translation accuracy).
    // Fallback gpt-4o-mini does NOT support `reasoning` — OpenRouter silently
    // IGNORES the param for it (verified: returns 200, no error), so the fallback
    // works fine, just without reasoning. It's a degraded-but-functional safety net
    // only hit if deepseek is unavailable; do not assume it reasons.
    models: ["deepseek/deepseek-v4-flash", "openai/gpt-4o-mini"],
    reasoning: { effort: "xhigh" },
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Failed to parse option translation response as JSON");
  }

  const translations = (parsed as Record<string, unknown>)?.translations;
  if (!Array.isArray(translations)) {
    throw new Error("Option translation response missing 'translations' array");
  }

  // Rebuild the grouped structure
  const result: OptionTranslationOutput = {
    groups: input.groups.map((g) => ({
      name: { en: "", th: "", vi: "", "zh-CN": "", "zh-TW": "", ms: "" },
      choices: g.choices.map(() => ({
        name: { en: "", th: "", vi: "", "zh-CN": "", "zh-TW": "", ms: "" },
      })),
    })),
  };

  for (let i = 0; i < structure.length; i++) {
    const s = structure[i];
    const t = translations[i] as Record<string, unknown> | undefined;
    const fallback = allNames[i] ?? "";
    const translated: TranslatedNames = {
      en: String(t?.en ?? fallback),
      th: String(t?.th ?? fallback),
      vi: String(t?.vi ?? fallback),
      "zh-CN": String(t?.["zh-CN"] ?? fallback),
      "zh-TW": String(t?.["zh-TW"] ?? fallback),
      ms: String(t?.ms ?? fallback),
    };

    if (s.type === "group") {
      result.groups[s.groupIdx].name = translated;
    } else if (s.choiceIdx !== undefined) {
      result.groups[s.groupIdx].choices[s.choiceIdx].name = translated;
    }
  }

  return result;
}
