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

const DEFAULT_GOOGLE_SHEET_ID =
  "1Viy7WMI2UQFS6DuH2Sg0JOhlWt-a_ave8khLk5oTO1s";

type OrgType = (typeof ORG_TYPES)[number];

type EnglishCard = {
  position_index: number;
  first_name: string;
  last_name: string;
  chinese_name: string;
  title: string;
  affiliation: string;
  email: string;
  phone: string;
  organization_type: string;
  notes: string;
};

type ChineseCard = {
  position_index: number;
  chinese_name: string;
  email: string;
  notes: string;
};

type FinalCard = EnglishCard;

type DuplicateMatch = {
  sheetName: string;
  rowNumber: number;
  reasons: string[];
  existing: {
    timestamp: string;
    first_name: string;
    last_name: string;
    chinese_name: string;
    title: string;
    affiliation: string;
    email: string;
    phone: string;
  };
};

type DuplicateReview = {
  cardIndex: number;
  card: FinalCard;
  matches: DuplicateMatch[];
};

type SheetsContext = {
  spreadsheetId: string;
  sheetName: string;
  hasCustomSheetName: boolean;
  sheets: ReturnType<typeof google.sheets>;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (Array.isArray(body.approvedCards)) {
      const approvedCards = body.approvedCards.map(normalizeCardFromBody);

      await appendCardsToSheet({
        cards: approvedCards,
        preferredLanguage: normalizeLanguage(body.preferredLanguage),
        sourceName: clean(body.sourceName),
        targetSheetId: clean(body.targetSheetId),
        targetSheetName: clean(body.targetSheetName),
      });

      return Response.json({
        ok: true,
        added: approvedCards.length,
        cards: approvedCards,
      });
    }

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

    const duplicateReviews = await findDuplicateReviews({
      cards,
      targetSheetId: clean(body.targetSheetId),
      targetSheetName: clean(body.targetSheetName),
    });

    if (duplicateReviews.length > 0) {
      return Response.json({
        ok: true,
        needsDuplicateReview: true,
        added: 0,
        cards,
        duplicateReviews,
      });
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
- Use an empty string for chinese_name.
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
        items: englishCardSchema(),
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
  englishCards: EnglishCard[],
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

    const sameSideChineseName = clean(englishCard.chinese_name);

    return {
      ...englishCard,
      chinese_name:
        sameSideChineseName || clean(matchedChineseCard?.chinese_name),
    };
  });
}

async function findDuplicateReviews({
  cards,
  targetSheetId,
  targetSheetName,
}: {
  cards: FinalCard[];
  targetSheetId: string;
  targetSheetName: string;
}): Promise<DuplicateReview[]> {
  const context = getSheetsContext({ targetSheetId, targetSheetName });
  const existingRecords = await loadExistingSheetRecords(context);

  return cards
    .map((card, cardIndex) => ({
      cardIndex,
      card,
      matches: findDuplicateMatches(card, existingRecords).slice(0, 4),
    }))
    .filter((review) => review.matches.length > 0);
}

async function loadExistingSheetRecords(context: SheetsContext) {
  const spreadsheet = await context.sheets.spreadsheets.get({
    spreadsheetId: context.spreadsheetId,
    fields: "sheets.properties.title",
  });

  const sheetNames =
    spreadsheet.data.sheets
      ?.map((sheet) => clean(sheet.properties?.title))
      .filter(Boolean) || [];

  if (sheetNames.length === 0) return [];

  const ranges = sheetNames.map((sheetName) => `${quoteSheetName(sheetName)}!A:K`);
  const response = await context.sheets.spreadsheets.values.batchGet({
    spreadsheetId: context.spreadsheetId,
    ranges,
    majorDimension: "ROWS",
  });

  const records: Array<{
    sheetName: string;
    rowNumber: number;
    timestamp: string;
    first_name: string;
    last_name: string;
    chinese_name: string;
    title: string;
    affiliation: string;
    email: string;
    phone: string;
  }> = [];

  for (const valueRange of response.data.valueRanges || []) {
    const sheetName = getSheetNameFromRange(valueRange.range || "");
    const rows = valueRange.values || [];

    rows.forEach((row, index) => {
      const record = {
        sheetName,
        rowNumber: index + 1,
        timestamp: clean(row[0]),
        first_name: clean(row[1]),
        last_name: clean(row[2]),
        chinese_name: clean(row[3]),
        title: clean(row[4]),
        affiliation: clean(row[5]),
        email: clean(row[6]),
        phone: clean(row[7]),
      };

      if (
        record.first_name ||
        record.last_name ||
        record.chinese_name ||
        record.email ||
        record.phone
      ) {
        records.push(record);
      }
    });
  }

  return records;
}

function findDuplicateMatches(
  card: FinalCard,
  records: Awaited<ReturnType<typeof loadExistingSheetRecords>>
): DuplicateMatch[] {
  const matches: Array<DuplicateMatch & { score: number }> = [];

  for (const record of records) {
    const reasons = getDuplicateReasons(card, record);

    if (reasons.length === 0) continue;

    matches.push({
      sheetName: record.sheetName,
      rowNumber: record.rowNumber,
      reasons,
      score: scoreDuplicateReasons(reasons),
      existing: {
        timestamp: record.timestamp,
        first_name: record.first_name,
        last_name: record.last_name,
        chinese_name: record.chinese_name,
        title: record.title,
        affiliation: record.affiliation,
        email: record.email,
        phone: record.phone,
      },
    });
  }

  return matches
    .sort((a, b) => b.score - a.score)
    .map(({ score, ...match }) => match);
}

function getDuplicateReasons(
  card: FinalCard,
  record: Awaited<ReturnType<typeof loadExistingSheetRecords>>[number]
) {
  const reasons: string[] = [];

  const cardEmail = normalizeEmail(card.email);
  const recordEmail = normalizeEmail(record.email);
  const cardPhone = normalizePhone(card.phone);
  const recordPhone = normalizePhone(record.phone);
  const cardChineseName = normalizeLooseText(card.chinese_name);
  const recordChineseName = normalizeLooseText(record.chinese_name);
  const cardName = normalizePersonName(card.first_name, card.last_name);
  const recordName = normalizePersonName(record.first_name, record.last_name);
  const cardAffiliation = normalizeLooseText(card.affiliation);
  const recordAffiliation = normalizeLooseText(record.affiliation);

  if (cardEmail && recordEmail && cardEmail === recordEmail) {
    reasons.push("same email");
  }

  if (phonesLookSimilar(cardPhone, recordPhone)) {
    reasons.push("same phone");
  }

  if (
    cardChineseName &&
    recordChineseName &&
    cardChineseName === recordChineseName
  ) {
    reasons.push("same Chinese name");
  }

  if (cardName && recordName) {
    const nameSimilarity = similarity(cardName, recordName);
    const affiliationSimilarity =
      cardAffiliation && recordAffiliation
        ? similarity(cardAffiliation, recordAffiliation)
        : 0;

    if (cardName === recordName && affiliationSimilarity >= 0.72) {
      reasons.push("same name and organization");
    } else if (nameSimilarity >= 0.9 && affiliationSimilarity >= 0.78) {
      reasons.push("similar name and organization");
    } else if (cardName === recordName && (cardEmail || recordEmail)) {
      reasons.push("same name");
    }
  }

  return reasons;
}

function scoreDuplicateReasons(reasons: string[]) {
  return reasons.reduce((score, reason) => {
    if (reason === "same email") return score + 100;
    if (reason === "same phone") return score + 85;
    if (reason === "same Chinese name") return score + 70;
    if (reason === "same name and organization") return score + 65;
    if (reason === "similar name and organization") return score + 50;
    if (reason === "same name") return score + 30;
    return score + 10;
  }, 0);
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
  const context = getSheetsContext({ targetSheetId, targetSheetName });

  const timestamp = formatTimestamp();

  const rows = cards.map((card) => [
    timestamp,
    clean(card.first_name),
    clean(card.last_name),
    clean(card.chinese_name),
    clean(card.title),
    clean(card.affiliation),
    clean(card.email),
    formatPhoneForSheet(card.phone),
    normalizeOrgType(card.organization_type),
    preferredLanguage,
    sourceName,
  ]);

  if (rows.length === 0) return;

  const sheetName = await resolveAppendSheetName(context);
  const startRow = await getNextWriteRow(context, sheetName);
  const endRow = startRow + rows.length - 1;

  await context.sheets.spreadsheets.values.update({
    spreadsheetId: context.spreadsheetId,
    range: `${quoteSheetName(sheetName)}!A${startRow}:K${endRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: rows,
    },
  });
}

function getSheetsContext({
  targetSheetId,
  targetSheetName,
}: {
  targetSheetId: string;
  targetSheetName: string;
}): SheetsContext {
  const spreadsheetId =
    targetSheetId ||
    DEFAULT_GOOGLE_SHEET_ID ||
    process.env.GOOGLE_SHEET_ID ||
    "";
  const customSheetName = clean(targetSheetName);
  const sheetName = customSheetName || process.env.SHEET_NAME || "Sheet1";

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

  return {
    spreadsheetId,
    sheetName,
    hasCustomSheetName: Boolean(customSheetName),
    sheets: google.sheets({ version: "v4", auth }),
  };
}

async function resolveAppendSheetName(context: SheetsContext) {
  const spreadsheet = await context.sheets.spreadsheets.get({
    spreadsheetId: context.spreadsheetId,
    fields: "sheets.properties.title",
  });

  const sheetNames =
    spreadsheet.data.sheets
      ?.map((sheet) => clean(sheet.properties?.title))
      .filter(Boolean) || [];

  if (sheetNames.length === 0) {
    throw new Error("The spreadsheet does not have any tabs.");
  }

  const exactMatch = sheetNames.find(
    (sheetName) => sheetName === context.sheetName
  );
  if (exactMatch) return exactMatch;

  const looseMatch = sheetNames.find(
    (sheetName) => sheetName.toLowerCase() === context.sheetName.toLowerCase()
  );
  if (looseMatch) return looseMatch;

  if (context.hasCustomSheetName) {
    throw new Error(
      `The sheet/tab "${context.sheetName}" was not found in the spreadsheet.`
    );
  }

  return sheetNames[0];
}

async function getNextWriteRow(context: SheetsContext, sheetName: string) {
  const response = await context.sheets.spreadsheets.values.get({
    spreadsheetId: context.spreadsheetId,
    range: `${quoteSheetName(sheetName)}!A:K`,
    majorDimension: "ROWS",
  });

  return (response.data.values || []).length + 1;
}

function normalizeCardFromBody(value: unknown): FinalCard {
  const card = (value || {}) as Partial<FinalCard>;

  return {
    position_index: Number(card.position_index) || 0,
    first_name: clean(card.first_name),
    last_name: clean(card.last_name),
    chinese_name: clean(card.chinese_name),
    title: clean(card.title),
    affiliation: clean(card.affiliation),
    email: clean(card.email),
    phone: clean(card.phone),
    organization_type: normalizeOrgType(clean(card.organization_type)),
    notes: clean(card.notes),
  };
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

function normalizePhone(value: string) {
  return clean(value).replace(/\D/g, "");
}

function formatPhoneForSheet(value: string) {
  const phone = clean(value);

  if (!phone) return "";

  return `'${phone}`;
}

function normalizeLooseText(value: string) {
  return clean(value)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normalizePersonName(firstName: string, lastName: string) {
  return normalizeLooseText(`${firstName} ${lastName}`);
}

function phonesLookSimilar(firstPhone: string, secondPhone: string) {
  if (firstPhone.length < 7 || secondPhone.length < 7) return false;

  if (firstPhone === secondPhone) return true;

  const firstLastDigits = firstPhone.slice(-7);
  const secondLastDigits = secondPhone.slice(-7);

  return firstLastDigits === secondLastDigits;
}

function similarity(firstValue: string, secondValue: string) {
  if (!firstValue && !secondValue) return 1;
  if (!firstValue || !secondValue) return 0;
  if (firstValue === secondValue) return 1;

  const distance = levenshteinDistance(firstValue, secondValue);
  return 1 - distance / Math.max(firstValue.length, secondValue.length);
}

function levenshteinDistance(firstValue: string, secondValue: string) {
  const previous = Array.from({ length: secondValue.length + 1 }, (_, i) => i);
  const current = Array(secondValue.length + 1).fill(0);

  for (let i = 1; i <= firstValue.length; i++) {
    current[0] = i;

    for (let j = 1; j <= secondValue.length; j++) {
      const cost = firstValue[i - 1] === secondValue[j - 1] ? 0 : 1;

      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }

    for (let j = 0; j < previous.length; j++) {
      previous[j] = current[j];
    }
  }

  return previous[secondValue.length];
}

function isValidSheetId(value: string) {
  return /^[a-zA-Z0-9-_]{20,}$/.test(value);
}

function getSheetNameFromRange(value: string) {
  const range = value.split("!")[0] || "";
  const unquoted = range.startsWith("'") && range.endsWith("'")
    ? range.slice(1, -1).replace(/''/g, "'")
    : range;

  return clean(unquoted);
}

function quoteSheetName(value: string) {
  const safeName = value.replace(/'/g, "''");
  return `'${safeName}'`;
}

function clean(value: unknown) {
  return value ? String(value).trim() : "";
}
