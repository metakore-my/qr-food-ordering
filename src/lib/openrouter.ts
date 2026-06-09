import { getSettings } from "@/lib/settings";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface ExtractedOptionChoice {
  name_th: string;
  name_en: string;
  name_zh_CN: string;
  priceAdjustment: number;
}

export interface ExtractedOptionGroup {
  name_th: string;
  name_en: string;
  name_zh_CN: string;
  selectionType: "SINGLE" | "MULTIPLE";
  isRequired: boolean;
  choices: ExtractedOptionChoice[];
}

export interface ExtractedItem {
  name_th: string;
  name_en: string;
  name_zh_CN: string;
  price: number;
  category: string;
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000); // 55s timeout (under Next.js 60s maxDuration)

  let res: Response;
  try {
    res = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXTAUTH_URL || "http://localhost:3000",
        "X-Title": `${appName} Food Ordering`,
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

// One attempt in a strict per-model provider chain. Unlike OpenRouter's
// single-request `models` fallback (which shares one `provider` block across
// every model), each attempt here pins its own provider — so the primary and
// fallback can route to different providers. `allow_fallbacks` is forced off so
// a model is only ever served by the provider it's pinned to.
interface ChainAttempt {
  model: string;
  provider?: { order?: string[]; quantizations?: string[] };
}

// Tries each attempt in order as a separate request, returning the first
// success. Throws an aggregated error only if every attempt fails.
async function callOpenRouterChain(
  attempts: ChainAttempt[],
  messages: OpenRouterMessage[],
  baseOptions: Omit<CallOptions, "provider" | "models"> = {}
): Promise<string> {
  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      return await callOpenRouter(attempt.model, messages, {
        ...baseOptions,
        provider: attempt.provider
          ? { ...attempt.provider, allow_fallbacks: false }
          : undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${attempt.model}: ${msg}`);
    }
  }
  throw new Error(`All OpenRouter models failed — ${errors.join(" | ")}`);
}

export async function extractMenuItems(
  base64Images: string[],
  existingCategories?: string[],
  currency = "THB"
): Promise<ExtractedItem[]> {
  const imageContent = base64Images.map((img) => ({
    type: "image_url" as const,
    image_url: { url: img.startsWith("data:") ? img : `data:image/jpeg;base64,${img}` },
  }));

  const categoryInstruction = existingCategories && existingCategories.length > 0
    ? `- category: PREFER assigning items to one of these existing categories: [${existingCategories.map((c) => `"${c}"`).join(", ")}]. Use the EXACT name from this list when a category fits the item well. Only create a new category name if none of the existing ones are suitable. When creating new categories, use specific, descriptive English names (e.g. "Appetizers", "Soups", "Stir-Fried Dishes"). Never use "General".`
    : `- category: ALWAYS classify each item into a specific, descriptive category. Use the menu's own section headings if visible. If the menu has no clear sections, infer appropriate categories based on the type of dish (e.g. "Appetizers", "Soups", "Salads", "Stir-Fried Dishes", "Curries", "Rice & Noodles", "Seafood", "Grilled", "Drinks", "Desserts"). Never use "General" — always assign a meaningful category. Aim for at least 3-5 distinct categories across all items.`;

  const messages: OpenRouterMessage[] = [
    {
      role: "system",
      content: `You are a restaurant menu extraction assistant. Analyze the provided menu images and extract every food and drink item you can find.

Return a JSON object with this structure:
{
  "items": [
    {
      "name_th": "ผัดไทย",
      "name_en": "Pad Thai",
      "name_zh_CN": "泰式炒河粉",
      "price": 12.50,
      "category": "Noodles",
      "optionGroups": [
        {
          "name_th": "ระดับความเผ็ด",
          "name_en": "Spice Level",
          "name_zh_CN": "辣度",
          "selectionType": "SINGLE",
          "isRequired": true,
          "choices": [
            { "name_th": "ไม่เผ็ด", "name_en": "Not Spicy", "name_zh_CN": "不辣", "priceAdjustment": 0 },
            { "name_th": "เผ็ดมาก", "name_en": "Very Spicy", "name_zh_CN": "很辣", "priceAdjustment": 0 }
          ]
        }
      ]
    }
  ]
}

Rules:
- Extract ALL items visible in the menu images
- name_th: Thai name as shown on the menu. If not visible, transliterate from the English/Chinese name. Preserve the original Thai script exactly as printed.
- name_en: English name. If not visible, translate from Thai/Chinese. For well-known Thai dishes, use the established English name (e.g. "Pad Thai", "Tom Yum Goong", "Som Tum", "Massaman Curry") — do NOT invent literal translations.
- name_zh_CN: Simplified Chinese name. If not visible, translate from Thai/English.
- price: The price shown on the menu as a plain decimal number in ${currency} (the menu's currency). Strip any currency symbols (e.g. ฿, RM, $, S$, ₫) and thousands separators. Keep the decimal point EXACTLY as printed — "9.50" is the number 9.5, NOT 950; "12" is 12. Never multiply by 100 or convert to cents. If the price says "Market Price"/"Seasonal" (or its local-language equivalent), use -1. If truly unclear or missing, use 0.
${categoryInstruction}
- optionGroups: If the menu shows customer choices for an item (e.g. spice level, noodle type, size, toppings, add-ons, protein choice), extract them as optionGroups. If no options are visible for an item, OMIT the optionGroups field entirely (do not include an empty array).
  - selectionType: "SINGLE" if the customer must pick exactly one (e.g. spice level, size), "MULTIPLE" if they can pick several (e.g. toppings, add-ons)
  - isRequired: true if the customer must choose (e.g. spice level, noodle type), false if optional (e.g. extra toppings)
  - choices: each option with name in 3 languages and priceAdjustment (0 if no extra charge, positive number if there is an upcharge)
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

  // VLM extraction with strict per-model provider pinning:
  //   primary  → mistralai/mistral-small-2603 via Mistral
  //   fallback → mistralai/mistral-small-3.2-24b-instruct via DeepInfra (fp8)
  const raw = await callOpenRouterChain(
    [
      { model: "mistralai/mistral-small-2603", provider: { order: ["mistral"] } },
      {
        model: "mistralai/mistral-small-3.2-24b-instruct",
        provider: { order: ["deepinfra/fp8"] },
      },
    ],
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

  const items = (parsed as Record<string, unknown>)?.items;
  if (!Array.isArray(items)) {
    throw new Error("Extraction response missing 'items' array");
  }

  return items.map((item: Record<string, unknown>) => {
    const base: ExtractedItem = {
      name_th: String(item.name_th ?? ""),
      name_en: String(item.name_en ?? ""),
      name_zh_CN: String(item.name_zh_CN ?? ""),
      price: Number(item.price) === -1 ? -1 : Math.max(0, Number(item.price) || 0),
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
              priceAdjustment: Math.max(0, Number(c.priceAdjustment) || 0),
            });
          }
          if (choices.length > 0) {
            groups.push({
              name_th: String(g.name_th ?? g.name_en ?? ""),
              name_en: String(g.name_en ?? g.name_th ?? ""),
              name_zh_CN: String(g.name_zh_CN ?? g.name_en ?? ""),
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
}

export async function translateMenuItems(
  items: Array<{ name_th: string; name_en: string; name_zh_CN: string }>
): Promise<TranslatedNames[]> {
  const messages: OpenRouterMessage[] = [
    {
      role: "system",
      content: `You are a professional restaurant menu translator. Translate the given food/drink names into ALL of the following languages: English (en), Thai (th), Vietnamese (vi), Simplified Chinese (zh-CN), Traditional Chinese (zh-TW), Malay (ms).

Return a JSON object with this exact structure:
{"translations": [{"en": "...", "th": "...", "vi": "...", "zh-CN": "...", "zh-TW": "...", "ms": "..."}]}

Rules:
- The translations array must have the same length and order as the input items array.
- Use natural, appetizing food terminology appropriate for a restaurant menu in each language.
- For well-known dish names (e.g. Pad Thai, Tom Yum, Som Tum, Khao Pad, Massaman, Nasi Lemak, Pho), use the established name/transliteration in each language rather than literal translation.
- Do NOT literally translate proper dish names. "Pad Thai" should NOT become "Thai stir-fry" in any language.
- Return ONLY valid JSON.`,
    },
    {
      role: "user",
      content: JSON.stringify(items),
    },
  ];

  const raw = await callOpenRouter("openai/gpt-4o-mini", messages, {
    temperature: 0.2,
    response_format: { type: "json_object" },
    models: ["openai/gpt-4o-mini", "deepseek/deepseek-v4-flash"],
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
  names: string[]
): Promise<AllLocaleNames[]> {
  const messages: OpenRouterMessage[] = [
    {
      role: "system",
      content: `You are a professional restaurant menu translator. Translate the given food category names into ALL of the following languages: English (en), Thai (th), Vietnamese (vi), Simplified Chinese (zh-CN), Traditional Chinese (zh-TW), Malay (ms).

Return a JSON object with this exact structure:
{"translations": [{"en": "...", "th": "...", "vi": "...", "zh-CN": "...", "zh-TW": "...", "ms": "..."}]}

Rules:
- The translations array must have the same length and order as the input names array.
- Use natural terminology appropriate for a restaurant menu category.
- For region-specific category names (e.g. "Yum" salads, "Tom" soups, "Kaeng" curries, "Nasi" rice dishes), use the established terminology in each language rather than generic translations.
- Return ONLY valid JSON.`,
    },
    {
      role: "user",
      content: JSON.stringify(names),
    },
  ];

  const raw = await callOpenRouter("openai/gpt-4o-mini", messages, {
    temperature: 0.2,
    response_format: { type: "json_object" },
    models: ["openai/gpt-4o-mini", "deepseek/deepseek-v4-flash"],
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

export interface OptionTranslationOutput {
  groups: Array<{
    name: TranslatedNames;
    choices: Array<{ name: TranslatedNames }>;
  }>;
}

export async function translateOptionNames(
  input: OptionTranslationInput
): Promise<OptionTranslationOutput> {
  // Flatten all names into a single array for efficient batch translation
  const allNames: Array<{ th: string; en: string; zh_CN: string }> = [];
  const structure: Array<{ groupIdx: number; type: "group" | "choice"; choiceIdx?: number }> = [];

  for (let gi = 0; gi < input.groups.length; gi++) {
    const g = input.groups[gi];
    allNames.push({ th: g.name_th, en: g.name_en, zh_CN: g.name_zh_CN });
    structure.push({ groupIdx: gi, type: "group" });
    for (let ci = 0; ci < g.choices.length; ci++) {
      const c = g.choices[ci];
      allNames.push({ th: c.name_th, en: c.name_en, zh_CN: c.name_zh_CN });
      structure.push({ groupIdx: gi, type: "choice", choiceIdx: ci });
    }
  }

  if (allNames.length === 0) {
    return { groups: [] };
  }

  const messages: OpenRouterMessage[] = [
    {
      role: "system",
      content: `You are a professional restaurant menu translator. The input contains option group names and option choice names for food items (e.g. "Spice Level", "Not Spicy", "Egg Noodle", "Large", "Extra Cheese"). Translate them into ALL of the following languages: English (en), Thai (th), Vietnamese (vi), Simplified Chinese (zh-CN), Traditional Chinese (zh-TW), Malay (ms).

Return a JSON object with this exact structure:
{"translations": [{"en": "...", "th": "...", "vi": "...", "zh-CN": "...", "zh-TW": "...", "ms": "..."}]}

Rules:
- The translations array must have the same length and order as the input array.
- Use natural, appropriate food terminology for a restaurant menu.
- For region-specific terms (e.g. noodle types like "Sen Yai", "Sen Lek", "Ba Mee"), use the established transliteration in each language where one exists, otherwise translate the meaning.
- Return ONLY valid JSON.`,
    },
    {
      role: "user",
      content: JSON.stringify(
        allNames.map((n) => ({ name_th: n.th, name_en: n.en, name_zh_CN: n.zh_CN }))
      ),
    },
  ];

  const raw = await callOpenRouter("openai/gpt-4o-mini", messages, {
    temperature: 0.2,
    response_format: { type: "json_object" },
    models: ["openai/gpt-4o-mini", "deepseek/deepseek-v4-flash"],
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
    const fallback = allNames[i]?.en || "";
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
