import { google } from "googleapis";

export const runtime = "nodejs";
export const maxDuration = 60;

const ORG_TYPES = [
  "Academic",
  "NPO/Think tank",
  "Corporate",
  "Foreign Representative",
  "Taiwan Government Rep",
  "Media",
] as const;

type OrgType = (typeof ORG_TYPES)[number];

type EnglishCard = {
  position_index: number;
  first_name: string;
  last_name: string;
  title: string;
  affiliation: string;
  email: string;
  phone: string;
  organization_type: string;
  notes: string;
};

type BilingualEnglishCard = EnglishCard & {
  chinese_name: string;
};

type ChineseCard = {
  position_index: number;
  chinese_name: string;
  email: string;
  notes: string;
};

type FinalCard = EnglishCard & {
  chinese_name: string;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!process.env.OPENAI_API_KEY) {
      throw new Error("Missing OPENAI_API_KEY.");
    }

    if (!body.imageBase64) {
      return Response.json(
        { ok: false, error: "Missing English-side image." },
        { status: 400 }
      );
    }

    const englishImageDataUrl = makeImageDataUrl(
      body.imageBase64,
      body.mimeType || "image/jpeg"
    );

    let cards: FinalCard[];

    if (body.scanChineseNames && body.chineseImageBase64) {
      const chineseImageDataUrl = makeImageDataUrl(
        body.chineseImageBase64,
        body.chineseMimeType || "image/jpeg"
      );

      const extracted = await extractBusinessCardsWithChineseNames(
        englishImageDataUrl,
        chineseImageDataUrl
      );

      cards = mergeEnglishAndChineseCards(
        extracted.english_cards || [],
        extracted.chinese_cards || []
      );
    } else {
      const extracted = await extractEnglishBusinessCards(englishImageDataUrl);

      cards = (extracted.cards || []).map((card: EnglishCard) => ({
        ...card,
        chinese_name: "",
      }));
    }

    await appendCardsToSheet({
      cards,
      preferredLanguage: normalizeLanguage(body.preferredLanguage),
      sourceName: clean(body.sourceName),
      targetSheetId: clean(body.targetSheetId),
      targetSheetName: clean(body.targetSheetName),
    });

    return Response.json({
      ok: true,
      added: cards.length,
      cards,
    });
  } catch (err: unknown) {
    console.error(err);

    const message = err instanceof Error ? err.message : String(err);

    return Response.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}

async function extractEnglishBusinessCards(imageDataUrl: string) {
  const model = process.env.OPENAI_MODEL || "gpt-5-mini";

  const prompt = `
Extract information from every visible business card in this image.

Rules:
- One object per business card.
- Assign position_index by visual order, starting at 1, reading top-to-bottom and left-to-right.
- Prioritize office phone over mobile phone if both are listed.
- If a field is unreadable or missing, use an empty string.
- Split names into first_name and last_name.
- Organization type must be exactly one of:
  Academic, NPO/Think tank, Corporate, Foreign Representative, Taiwan Government Rep, Media.
- Classify universities and research institutes as Academic unless clearly a think tank/NPO.
- Classify companies as Corporate.
- Classify foundations, NGOs, policy organizations, and think tanks as NPO/Think tank.
- Do not invent information.
`;

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["cards"],
    properties: {
      cards: {
        type: "array",
        items: englishCardSchema(),
      },
    },
  };

  return callOpenAIForJson({
    model,
    schemaName: "english_business_card_extraction",
    schema,
    content: [
      {
        type: "input_text",
        text: prompt,
      },
      {
        type: "input_image",
        image_url: imageDataUrl,
        detail: "high",
      },
    ],
  });
}

async function extractBusinessCardsWithChineseNames(
  englishImageDataUrl: string,
  chineseImageDataUrl: string
) {
  const model = process.env.OPENAI_MODEL || "gpt-5-mini";

  const prompt = `
You will receive two images from the same batch of business cards.

Image 1 is the English-side photo.
Image 2 is the Chinese-side photo.

Task:
1. From Image 1, extract the English-side business card information.
2. From Image 1, also extract the Traditional Chinese name if it is printed on the same side as the English/romanized name.
3. From Image 2, extract the Traditional Chinese name and email address from each matching card.
4. Do NOT combine the cards yourself. Return two separate arrays: english_cards and chinese_cards.
5. The app will keep Chinese names found on Image 1 first, then use Image 2 to fill in missing Chinese names.

Rules for english_cards:
- One object per visible English-side card.
- Assign position_index by visual order, starting at 1, reading top-to-bottom and left-to-right.
- Prioritize office phone over mobile phone if both are listed.
- If a field is unreadable or missing, use an empty string.
- Split romanized/English names into first_name and last_name.
- If a Traditional Chinese person name appears on the same side, put it in chinese_name.
- Do not put company names, departments, addresses, titles, or honorifics in chinese_name.
- If no Traditional Chinese person name is visible on Image 1 for that card, use an empty string for chinese_name.
- Organization type must be exactly one of:
  Academic, NPO/Think tank, Corporate, Foreign Representative, Taiwan Government Rep, Media.
- Classify universities and research institutes as Academic unless clearly a think tank/NPO.
- Classify companies as Corporate.
- Classify foundations, NGOs, policy organizations, and think tanks as NPO/Think tank.
- Do not invent information.

Rules for chinese_cards:
- One object per visible Chinese-side card.
- Assign position_index by visual order, starting at 1, reading top-to-bottom and left-to-right.
- Extract the person's Traditional Chinese name only into chinese_name.
- Do not include titles, company names, departments, addresses, or honorifics in chinese_name.
- Extract the email address on the Chinese side if visible.
- If the Chinese name is unreadable or missing, use an empty string.
- If the email is unreadable or missing, use an empty string.
- Do not invent information.
`;

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["english_cards", "chinese_cards"],
    properties: {
      english_cards: {
        type: "array",
        items: bilingualEnglishCardSchema(),
      },
      chinese_cards: {
        type: "array",
        items: chineseCardSchema(),
      },
    },
  };

  return callOpenAIForJson({
    model,
    schemaName: "bilingual_business_card_extraction",
    schema,
    content: [
      {
        type: "input_text",
        text: prompt,
      },
      {
        type: "input_text",
        text: "Image 1: English-side business cards.",
      },
      {
        type: "input_image",
        image_url: englishImageDataUrl,
        detail: "high",
      },
      {
        type: "input_text",
        text: "Image 2: Chinese-side business cards.",
      },
      {
        type: "input_image",
        image_url: chineseImageDataUrl,
        detail: "high",
      },
    ],
  });
}

function englishCardSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "position_index",
      "first_name",
      "last_name",
      "title",
      "affiliation",
      "email",
      "phone",
      "organization_type",
      "notes",
    ],
    properties: {
      position_index: { type: "integer" },
      first_name: { type: "string" },
      last_name: { type: "string" },
      title: { type: "string" },
      affiliation: { type: "string" },
      email: { type: "string" },
      phone: { type: "string" },
      organization_type: {
        type: "string",
        enum: [...ORG_TYPES],
      },
      notes: { type: "string" },
    },
  };
}

function bilingualEnglishCardSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "position_index",
      "first_name",
      "last_name",
      "chinese_name",
      "title",
      "affiliation",
      "email",
      "phone",
      "organization_type",
      "notes",
    ],
    properties: {
      position_index: { type: "integer" },
      first_name: { type: "string" },
      last_name: { type: "string" },
      chinese_name: { type: "string" },
      title: { type: "string" },
      affiliation: { type: "string" },
      email: { type: "string" },
      phone: { type: "string" },
      organization_type: {
        type: "string",
        enum: [...ORG_TYPES],
      },
      notes: { type: "string" },
    },
  };
}

function chineseCardSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["position_index", "chinese_name", "email", "notes"],
    properties: {
      position_index: { type: "integer" },
      chinese_name: { type: "string" },
      email: { type: "string" },
      notes: { type: "string" },
    },
  };
}

async function callOpenAIForJson({
  model,
  schemaName,
  schema,
  content,
}: {
  model: string;
  schemaName: string;
  schema: object;
  content: Array<Record<string, unknown>>;
}) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "user",
          content,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: schemaName,
          schema,
          strict: true,
        },
        verbosity: "low",
      },
    }),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`OpenAI API error ${response.status}: ${text}`);
  }

  const data = JSON.parse(text);
  const outputText = getOutputText(data);

  if (!outputText) {
    throw new Error("No output text returned from OpenAI.");
  }

  return JSON.parse(outputText);
}

function mergeEnglishAndChineseCards(
  englishCards: Array<EnglishCard | BilingualEnglishCard>,
  chineseCards: ChineseCard[]
): FinalCard[] {
  const chineseByEmail = new Map<string, ChineseCard>();
  const usedChineseCards = new Set<ChineseCard>();

  for (const chineseCard of chineseCards) {
    const email = normalizeEmail(chineseCard.email);

    if (email && !chineseByEmail.has(email)) {
      chineseByEmail.set(email, chineseCard);
    }
  }

  return englishCards.map((englishCard, index) => {
    const englishEmail = normalizeEmail(englishCard.email);
    let matchedChineseCard: ChineseCard | undefined;

    if (englishEmail) {
      matchedChineseCard = chineseByEmail.get(englishEmail);
    }

    if (!matchedChineseCard) {
      matchedChineseCard = chineseCards.find(
        (chineseCard) =>
          chineseCard.position_index === englishCard.position_index &&
          !usedChineseCards.has(chineseCard)
      );
    }

    if (!matchedChineseCard && chineseCards[index] && !usedChineseCards.has(chineseCards[index])) {
      matchedChineseCard = chineseCards[index];
    }

    if (matchedChineseCard) {
      usedChineseCards.add(matchedChineseCard);
    }

    const sameSideChineseName =
      "chinese_name" in englishCard ? clean(englishCard.chinese_name) : "";

    return {
      ...englishCard,
      chinese_name: sameSideChineseName || clean(matchedChineseCard?.chinese_name),
    };
  });
}

async function appendCardsToSheet({
  cards,
  preferredLanguage,
  sourceName,
  targetSheetId,
  targetSheetName,
}: {
  cards: FinalCard[];
  preferredLanguage: string;
  sourceName: string;
  targetSheetId: string;
  targetSheetName: string;
}) {
  const spreadsheetId = targetSheetId || process.env.GOOGLE_SHEET_ID || "";
  const sheetName = targetSheetName || process.env.SHEET_NAME || "Sheet1";

  if (!spreadsheetId) {
    throw new Error("Missing Google Sheet ID.");
  }

  if (!isValidSheetId(spreadsheetId)) {
    throw new Error("Invalid Google Sheet ID.");
  }

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL.");
  }

  if (!process.env.GOOGLE_PRIVATE_KEY) {
    throw new Error("Missing GOOGLE_PRIVATE_KEY.");
  }

  const privateKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  const timestamp = formatTimestamp();

  const rows = cards.map((card) => [
    timestamp,
    clean(card.first_name),
    clean(card.last_name),
    clean(card.chinese_name),
    clean(card.title),
    clean(card.affiliation),
    clean(card.email),
    clean(card.phone),
    normalizeOrgType(card.organization_type),
    preferredLanguage,
    sourceName,
  ]);

  if (rows.length === 0) return;

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${quoteSheetName(sheetName)}!A:K`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: rows,
    },
  });
}

function makeImageDataUrl(imageBase64: string, mimeType: string) {
  let raw = String(imageBase64 || "").trim();

  raw = raw.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
  raw = raw.replace(/\s/g, "");

  if (!raw) {
    throw new Error("Image base64 is empty after cleaning.");
  }

  if (!/^[A-Za-z0-9+/=]+$/.test(raw)) {
    throw new Error("Image base64 contains invalid characters.");
  }

  return `data:${mimeType};base64,${raw}`;
}

function getOutputText(data: any) {
  if (data.output_text) return data.output_text;

  if (!data.output) return "";

  for (const item of data.output) {
    if (!item.content) continue;

    for (const part of item.content) {
      if (part.type === "output_text" && part.text) {
        return part.text;
      }
    }
  }

  return "";
}

function formatTimestamp() {
  const timezone = process.env.TIMEZONE || "Asia/Taipei";

  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "2-digit",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

function normalizeLanguage(value: string) {
  const lang = clean(value).toLowerCase();

  if (lang === "chinese") return "Chinese";
  return "English";
}

function normalizeOrgType(value: string) {
  const cleaned = clean(value);

  if ((ORG_TYPES as readonly string[]).includes(cleaned)) {
    return cleaned as OrgType;
  }

  return "";
}

function normalizeEmail(value: string) {
  return clean(value)
    .toLowerCase()
    .replace(/^mailto:/i, "")
    .replace(/\s/g, "")
    .replace(/[<>]/g, "");
}

function isValidSheetId(value: string) {
  return /^[a-zA-Z0-9-_]{20,}$/.test(value);
}

function quoteSheetName(value: string) {
  const safeName = value.replace(/'/g, "''");
  return `'${safeName}'`;
}

function clean(value: unknown) {
  return value ? String(value).trim() : "";
}
