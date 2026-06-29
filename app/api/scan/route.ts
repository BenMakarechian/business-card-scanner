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

type Card = {
  first_name: string;
  last_name: string;
  title: string;
  affiliation: string;
  email: string;
  phone: string;
  organization_type: string;
  notes: string;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!process.env.OPENAI_API_KEY) {
      throw new Error("Missing OPENAI_API_KEY.");
    }

    if (!body.imageBase64) {
      return Response.json(
        { ok: false, error: "Missing image." },
        { status: 400 }
      );
    }

    const imageDataUrl = makeImageDataUrl(
      body.imageBase64,
      body.mimeType || "image/jpeg"
    );

    const extracted = await extractBusinessCards(imageDataUrl);
    const cards: Card[] = extracted.cards || [];

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

async function extractBusinessCards(imageDataUrl: string) {
  const model = process.env.OPENAI_MODEL || "gpt-5-mini";

  const prompt = `
Extract information from every visible business card in this image.

Rules:
- One object per business card.
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
        items: {
          type: "object",
          additionalProperties: false,
          required: [
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
            first_name: { type: "string" },
            last_name: { type: "string" },
            title: { type: "string" },
            affiliation: { type: "string" },
            email: { type: "string" },
            phone: { type: "string" },
            organization_type: {
              type: "string",
              enum: ORG_TYPES,
            },
            notes: { type: "string" },
          },
        },
      },
    },
  };

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
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "business_card_extraction",
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

async function appendCardsToSheet({
  cards,
  preferredLanguage,
  sourceName,
  targetSheetId,
  targetSheetName,
}: {
  cards: Card[];
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
    "",
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
    return cleaned;
  }

  return "";
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
