"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

type ScanCard = {
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
  card: ScanCard;
  matches: DuplicateMatch[];
};

type DuplicateDecision = "add" | "ignore";

export default function Page() {
  const [language, setLanguage] = useState("English");
  const [sourceName, setSourceName] = useState("");

  const [scanChineseNames, setScanChineseNames] = useState(false);

  const [englishPhoto, setEnglishPhoto] = useState<File | null>(null);
  const [chinesePhoto, setChinesePhoto] = useState<File | null>(null);

  const [englishPreviewUrl, setEnglishPreviewUrl] = useState("");
  const [chinesePreviewUrl, setChinesePreviewUrl] = useState("");

  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState<"neutral" | "success" | "error">(
    "neutral"
  );
  const [isLoading, setIsLoading] = useState(false);
  const [pendingCards, setPendingCards] = useState<ScanCard[]>([]);
  const [duplicateReviews, setDuplicateReviews] = useState<DuplicateReview[]>(
    []
  );
  const [duplicateDecisions, setDuplicateDecisions] = useState<
    Record<number, DuplicateDecision>
  >({});

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [targetSheetId, setTargetSheetId] = useState("");
  const [targetSheetName, setTargetSheetName] = useState("");

  useEffect(() => {
    const savedSheetId = window.localStorage.getItem("superScannerSheetId") || "";
    const savedSheetName =
      window.localStorage.getItem("superScannerSheetName") || "";

    setTargetSheetId(savedSheetId);
    setTargetSheetName(savedSheetName);
  }, []);

  function saveSettings() {
    window.localStorage.setItem("superScannerSheetId", targetSheetId.trim());
    window.localStorage.setItem("superScannerSheetName", targetSheetName.trim());
    setIsSettingsOpen(false);
    showSuccess("Settings saved");
  }

  function clearSettings() {
    setTargetSheetId("");
    setTargetSheetName("");
    window.localStorage.removeItem("superScannerSheetId");
    window.localStorage.removeItem("superScannerSheetName");
    setIsSettingsOpen(false);
    showSuccess("Using default spreadsheet");
  }

  async function handleSubmit() {
    try {
      if (!sourceName.trim()) {
        showError("Please enter the uploader name.");
        return;
      }

      if (!englishPhoto) {
        showError("Please take or upload the English-side photo.");
        return;
      }

      if (scanChineseNames && !chinesePhoto) {
        showError("Please take or upload the Chinese-side photo.");
        return;
      }

      setIsLoading(true);
      showNeutral(
        scanChineseNames
          ? "Scanning English and Chinese sides. This may take 20–45 seconds."
          : "Scanning image. This may take 10–30 seconds."
      );

      const imageBase64 = await resizeAndEncodeImage(englishPhoto, 1600);

      let chineseImageBase64 = "";
      if (scanChineseNames && chinesePhoto) {
        chineseImageBase64 = await resizeAndEncodeImage(chinesePhoto, 1600);
      }

      const response = await fetch("/api/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          preferredLanguage: language,
          sourceName: sourceName.trim(),
          mimeType: "image/jpeg",
          imageBase64,
          scanChineseNames,
          chineseMimeType: "image/jpeg",
          chineseImageBase64,
          targetSheetId: targetSheetId.trim(),
          targetSheetName: targetSheetName.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Unknown error.");
      }

      if (data.needsDuplicateReview) {
        const reviews: DuplicateReview[] = data.duplicateReviews || [];
        const initialDecisions: Record<number, DuplicateDecision> = {};

        reviews.forEach((review) => {
          initialDecisions[review.cardIndex] = "ignore";
        });

        setPendingCards(data.cards || []);
        setDuplicateReviews(reviews);
        setDuplicateDecisions(initialDecisions);
        showNeutral(
          `${reviews.length} possible duplicate ${
            reviews.length === 1 ? "card needs" : "cards need"
          } review before saving.`
        );
        return;
      }

      showSuccess(`Successfully added ${data.added} cards`);
      clearPendingDuplicateReview();
      resetPhotos();
    } catch (err: unknown) {
      if (err instanceof Error) {
        showError(err.message);
      } else {
        showError(String(err));
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDuplicateReviewSubmit() {
    try {
      const duplicateCardIndexes = new Set(
        duplicateReviews.map((review) => review.cardIndex)
      );
      const approvedCards = pendingCards.filter((card, index) => {
        if (!duplicateCardIndexes.has(index)) return true;
        return duplicateDecisions[index] === "add";
      });

      setIsLoading(true);
      showNeutral("Saving approved cards.");

      const response = await fetch("/api/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          preferredLanguage: language,
          sourceName: sourceName.trim(),
          approvedCards,
          targetSheetId: targetSheetId.trim(),
          targetSheetName: targetSheetName.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Unknown error.");
      }

      showSuccess(`Successfully added ${data.added} cards`);
      clearPendingDuplicateReview();
      resetPhotos();
    } catch (err: unknown) {
      if (err instanceof Error) {
        showError(err.message);
      } else {
        showError(String(err));
      }
    } finally {
      setIsLoading(false);
    }
  }

  function handleEnglishPhotoChange(file: File | null) {
    setEnglishPhoto(file);
    clearPendingDuplicateReview();

    if (!file) {
      setEnglishPreviewUrl("");
      return;
    }

    setEnglishPreviewUrl(URL.createObjectURL(file));
    setStatus("");
  }

  function handleChinesePhotoChange(file: File | null) {
    setChinesePhoto(file);
    clearPendingDuplicateReview();

    if (!file) {
      setChinesePreviewUrl("");
      return;
    }

    setChinesePreviewUrl(URL.createObjectURL(file));
    setStatus("");
  }

  function handleScanChineseNamesChange(checked: boolean) {
    setScanChineseNames(checked);
    clearPendingDuplicateReview();

    if (!checked) {
      setChinesePhoto(null);
      setChinesePreviewUrl("");

      const chineseInput = document.getElementById(
        "chinesePhoto"
      ) as HTMLInputElement;
      if (chineseInput) chineseInput.value = "";
    }
  }

  function updateDuplicateDecision(
    cardIndex: number,
    decision: DuplicateDecision
  ) {
    setDuplicateDecisions((current) => ({
      ...current,
      [cardIndex]: decision,
    }));
  }

  function clearPendingDuplicateReview() {
    setPendingCards([]);
    setDuplicateReviews([]);
    setDuplicateDecisions({});
  }

  function resetPhotos() {
    setEnglishPhoto(null);
    setChinesePhoto(null);
    setEnglishPreviewUrl("");
    setChinesePreviewUrl("");

    const englishInput = document.getElementById(
      "englishPhoto"
    ) as HTMLInputElement;
    if (englishInput) englishInput.value = "";

    const chineseInput = document.getElementById(
      "chinesePhoto"
    ) as HTMLInputElement;
    if (chineseInput) chineseInput.value = "";
  }

  function showNeutral(message: string) {
    setStatusType("neutral");
    setStatus(message);
  }

  function showSuccess(message: string) {
    setStatusType("success");
    setStatus(message);
  }

  function showError(message: string) {
    setStatusType("error");
    setStatus(message);
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <button
          type="button"
          aria-label="Settings"
          onClick={() => setIsSettingsOpen(true)}
          style={styles.settingsButton}
        >
          ⚙
        </button>

        <div style={styles.headerAccent}></div>

        <h1 style={styles.h1}>Multi Scan</h1>
        <p style={styles.creator}>Created by Ben Makarechian</p>

        {targetSheetId && (
          <div style={styles.sheetNotice}>
            Custom spreadsheet active
            {targetSheetName ? ` · ${targetSheetName}` : ""}
          </div>
        )}

        <label style={styles.label}>Uploader</label>
        <input
          value={sourceName}
          onChange={(e) => setSourceName(e.target.value)}
          placeholder="Enter uploader name"
          style={styles.input}
        />

        <label style={styles.label}>Contact&apos;s preferred language</label>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          style={styles.input}
        >
          <option value="English">English</option>
          <option value="Chinese">Chinese</option>
        </select>

        <label style={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={scanChineseNames}
            onChange={(e) => handleScanChineseNamesChange(e.target.checked)}
            style={styles.checkbox}
          />
          <span style={styles.checkboxText}>Scan Chinese names</span>
        </label>

        {scanChineseNames && (
          <p style={styles.helperText}>
            Take the English-side photo first. If Chinese names are visible
            there, they will be recorded. Then flip the same cards and take the
            Chinese-side photo to fill in any missing Chinese names.
          </p>
        )}

        <label style={styles.label}>
          {scanChineseNames
            ? "English-side business card photo"
            : "Business card photo"}
        </label>
        <input
          id="englishPhoto"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => handleEnglishPhotoChange(e.target.files?.[0] || null)}
          style={styles.input}
        />

        {englishPreviewUrl && (
          <img src={englishPreviewUrl} alt="English side preview" style={styles.preview} />
        )}

        {scanChineseNames && (
          <>
            <label style={styles.label}>Chinese-side business card photo</label>
            <input
              id="chinesePhoto"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) =>
                handleChinesePhotoChange(e.target.files?.[0] || null)
              }
              style={styles.input}
            />

            {chinesePreviewUrl && (
              <img
                src={chinesePreviewUrl}
                alt="Chinese side preview"
                style={styles.preview}
              />
            )}
          </>
        )}

        <button
          onClick={handleSubmit}
          disabled={isLoading || duplicateReviews.length > 0}
          style={{
            ...styles.button,
            opacity: isLoading || duplicateReviews.length > 0 ? 0.65 : 1,
          }}
        >
          {isLoading
            ? "Scanning..."
            : duplicateReviews.length > 0
            ? "Review Possible Duplicates"
            : "Scan and Add Cards"}
        </button>

        {duplicateReviews.length > 0 && (
          <section style={styles.duplicatePanel}>
            <h2 style={styles.duplicateTitle}>Possible duplicates</h2>
            <p style={styles.duplicateIntro}>
              These scanned cards look similar to records already in the
              spreadsheet. Choose whether each one should still be added.
            </p>

            {duplicateReviews.map((review) => (
              <div key={review.cardIndex} style={styles.duplicateCard}>
                <div style={styles.scannedCardName}>
                  {formatCardName(review.card)}
                </div>
                <div style={styles.scannedCardMeta}>
                  {[review.card.chinese_name, review.card.affiliation, review.card.email]
                    .filter(Boolean)
                    .join(" · ")}
                </div>

                {review.matches.map((match) => (
                  <div
                    key={`${match.sheetName}-${match.rowNumber}`}
                    style={styles.matchRow}
                  >
                    <div style={styles.matchHeader}>
                      {formatExistingName(match.existing)}
                    </div>
                    <div style={styles.matchMeta}>
                      {[match.existing.chinese_name, match.existing.affiliation, match.existing.email]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    <div style={styles.matchLocation}>
                      {match.sheetName} row {match.rowNumber} ·{" "}
                      {match.reasons.join(", ")}
                    </div>
                  </div>
                ))}

                <div style={styles.decisionRow}>
                  <button
                    type="button"
                    onClick={() => updateDuplicateDecision(review.cardIndex, "add")}
                    style={{
                      ...styles.decisionButton,
                      ...(duplicateDecisions[review.cardIndex] === "add"
                        ? styles.decisionButtonActive
                        : {}),
                    }}
                  >
                    Add anyway
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateDuplicateDecision(review.cardIndex, "ignore")
                    }
                    style={{
                      ...styles.decisionButton,
                      ...(duplicateDecisions[review.cardIndex] === "ignore"
                        ? styles.decisionButtonActive
                        : {}),
                    }}
                  >
                    Ignore
                  </button>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={handleDuplicateReviewSubmit}
              disabled={isLoading}
              style={{
                ...styles.button,
                marginTop: 16,
                opacity: isLoading ? 0.65 : 1,
              }}
            >
              {isLoading ? "Saving..." : "Save Approved Cards"}
            </button>
          </section>
        )}

        {status && (
          <div
            style={{
              ...styles.status,
              ...(statusType === "success"
                ? styles.success
                : statusType === "error"
                ? styles.error
                : styles.neutral),
            }}
          >
            {status}
          </div>
        )}

        <p style={styles.tip}>
          Tip: Put 1–8 cards in one clear photo. Avoid glare and make sure
          emails are readable.
        </p>
      </section>

      {isSettingsOpen && (
        <div style={styles.modalBackdrop}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>Settings</h2>
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                style={styles.closeButton}
              >
                ×
              </button>
            </div>

            <p style={styles.modalText}>
              Choose where scans should be saved. The spreadsheet must be shared
              with the Google service account as an Editor.
            </p>

            <label style={styles.label}>Google Sheet ID</label>
            <input
              value={targetSheetId}
              onChange={(e) => setTargetSheetId(e.target.value)}
              placeholder="Paste the Sheet ID"
              style={styles.input}
            />

            <label style={styles.label}>Sheet/tab name</label>
            <input
              value={targetSheetName}
              onChange={(e) => setTargetSheetName(e.target.value)}
              placeholder="Example: Sheet1"
              style={styles.input}
            />

            <button type="button" onClick={saveSettings} style={styles.button}>
              Save Settings
            </button>

            <button
              type="button"
              onClick={clearSettings}
              style={styles.secondaryButton}
            >
              Use Default Spreadsheet
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

async function resizeAndEncodeImage(file: File, maxWidth: number) {
  const dataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(dataUrl);

  const scale = Math.min(1, maxWidth / img.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare image.");

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const resizedDataUrl = canvas.toDataURL("image/jpeg", 0.82);
  return resizedDataUrl.split(",")[1];
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image."));
    img.src = src;
  });
}

function formatCardName(card: ScanCard) {
  const name = `${card.first_name} ${card.last_name}`.trim();
  return name || card.chinese_name || "Unnamed card";
}

function formatExistingName(existing: DuplicateMatch["existing"]) {
  const name = `${existing.first_name} ${existing.last_name}`.trim();
  return name || existing.chinese_name || "Existing record";
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    background:
      "radial-gradient(circle at top left, rgba(85, 198, 190, 0.35), transparent 32%), radial-gradient(circle at bottom right, rgba(20, 129, 180, 0.35), transparent 34%), linear-gradient(135deg, #eefafb 0%, #f7f8ff 48%, #eef4fb 100%)",
    color: "#162032",
    fontFamily:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    padding: 24,
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    position: "relative",
    width: "100%",
    maxWidth: 520,
    margin: "0 auto",
    background: "rgba(255, 255, 255, 0.88)",
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    padding: 26,
    borderRadius: 28,
    boxShadow: "0 24px 70px rgba(25, 71, 112, 0.18)",
    border: "1px solid rgba(255, 255, 255, 0.75)",
  },
  settingsButton: {
    position: "absolute",
    top: 18,
    right: 18,
    width: 42,
    height: 42,
    borderRadius: 999,
    border: "1px solid rgba(20, 129, 180, 0.18)",
    background: "rgba(255, 255, 255, 0.82)",
    color: "#0d5f8c",
    fontSize: 20,
    cursor: "pointer",
    boxShadow: "0 8px 18px rgba(25, 71, 112, 0.08)",
  },
  headerAccent: {
    width: 58,
    height: 8,
    borderRadius: 999,
    background: "linear-gradient(90deg, #4fc7bf, #0b7fb4, #5960aa)",
    marginBottom: 18,
  },
  h1: {
    fontSize: 34,
    lineHeight: 1,
    margin: "0 0 6px",
    letterSpacing: "-0.04em",
    color: "#0d5f8c",
  },
  creator: {
    margin: "0 0 24px",
    fontSize: 13,
    color: "#667085",
    fontWeight: 600,
  },
  sheetNotice: {
    marginBottom: 12,
    padding: "10px 12px",
    borderRadius: 14,
    background: "rgba(79, 199, 191, 0.12)",
    color: "#08796f",
    border: "1px solid rgba(79, 199, 191, 0.22)",
    fontSize: 13,
    fontWeight: 800,
  },
  label: {
    display: "block",
    fontWeight: 800,
    marginTop: 17,
    marginBottom: 8,
    color: "#223047",
    fontSize: 14,
    letterSpacing: "0.01em",
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    fontSize: 16,
    padding: "14px 15px",
    borderRadius: 16,
    border: "1px solid rgba(20, 129, 180, 0.22)",
    background: "rgba(255, 255, 255, 0.94)",
    color: "#162032",
    outlineColor: "#4fc7bf",
  },
  checkboxRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 18,
    padding: "13px 14px",
    borderRadius: 16,
    border: "1px solid rgba(20, 129, 180, 0.18)",
    background: "rgba(255, 255, 255, 0.66)",
    cursor: "pointer",
  },
  checkbox: {
    width: 20,
    height: 20,
    accentColor: "#0b7fb4",
  },
  checkboxText: {
    fontWeight: 850,
    color: "#223047",
    fontSize: 15,
  },
  helperText: {
    margin: "10px 0 0",
    padding: "12px 13px",
    borderRadius: 14,
    background: "rgba(11, 127, 180, 0.09)",
    color: "#0b5f89",
    border: "1px solid rgba(11, 127, 180, 0.12)",
    fontSize: 13,
    lineHeight: 1.45,
    fontWeight: 650,
  },
  button: {
    width: "100%",
    marginTop: 24,
    padding: 15,
    borderRadius: 18,
    border: "none",
    background:
      "linear-gradient(135deg, #4fc7bf 0%, #0b7fb4 52%, #5960aa 100%)",
    color: "white",
    fontWeight: 900,
    fontSize: 17,
    cursor: "pointer",
    boxShadow: "0 14px 30px rgba(11, 127, 180, 0.28)",
  },
  secondaryButton: {
    width: "100%",
    marginTop: 12,
    padding: 14,
    borderRadius: 18,
    border: "1px solid rgba(20, 129, 180, 0.2)",
    background: "rgba(255, 255, 255, 0.86)",
    color: "#0d5f8c",
    fontWeight: 900,
    fontSize: 16,
    cursor: "pointer",
  },
  preview: {
    marginTop: 16,
    width: "100%",
    borderRadius: 18,
    border: "1px solid rgba(20, 129, 180, 0.18)",
  },
  status: {
    marginTop: 18,
    padding: 14,
    borderRadius: 16,
    lineHeight: 1.4,
    fontWeight: 700,
  },
  success: {
    background: "rgba(79, 199, 191, 0.15)",
    color: "#08796f",
    border: "1px solid rgba(79, 199, 191, 0.25)",
  },
  error: {
    background: "#fdeaea",
    color: "#9d1c1c",
    border: "1px solid rgba(157, 28, 28, 0.12)",
  },
  neutral: {
    background: "rgba(11, 127, 180, 0.12)",
    color: "#0b5f89",
    border: "1px solid rgba(11, 127, 180, 0.18)",
  },
  tip: {
    fontSize: 13,
    color: "#667085",
    marginTop: 18,
    lineHeight: 1.45,
  },
  duplicatePanel: {
    marginTop: 18,
    padding: 14,
    borderRadius: 18,
    background: "rgba(255, 255, 255, 0.72)",
    border: "1px solid rgba(157, 28, 28, 0.14)",
  },
  duplicateTitle: {
    margin: "0 0 6px",
    fontSize: 18,
    color: "#9d1c1c",
    letterSpacing: 0,
  },
  duplicateIntro: {
    margin: "0 0 12px",
    color: "#5b6472",
    fontSize: 13,
    lineHeight: 1.45,
    fontWeight: 650,
  },
  duplicateCard: {
    padding: 12,
    borderRadius: 8,
    background: "rgba(255, 255, 255, 0.9)",
    border: "1px solid rgba(20, 129, 180, 0.15)",
    marginTop: 12,
  },
  scannedCardName: {
    fontSize: 15,
    fontWeight: 900,
    color: "#223047",
    lineHeight: 1.25,
  },
  scannedCardMeta: {
    marginTop: 4,
    fontSize: 12,
    color: "#667085",
    lineHeight: 1.35,
    overflowWrap: "anywhere",
  },
  matchRow: {
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
    background: "rgba(11, 127, 180, 0.07)",
    border: "1px solid rgba(11, 127, 180, 0.12)",
  },
  matchHeader: {
    fontSize: 14,
    fontWeight: 850,
    color: "#0b5f89",
  },
  matchMeta: {
    marginTop: 4,
    fontSize: 12,
    color: "#4f5a6b",
    lineHeight: 1.35,
    overflowWrap: "anywhere",
  },
  matchLocation: {
    marginTop: 6,
    fontSize: 12,
    color: "#9d1c1c",
    fontWeight: 750,
    lineHeight: 1.35,
  },
  decisionRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
    marginTop: 12,
  },
  decisionButton: {
    padding: "11px 8px",
    borderRadius: 8,
    border: "1px solid rgba(20, 129, 180, 0.22)",
    background: "rgba(255, 255, 255, 0.92)",
    color: "#0d5f8c",
    fontSize: 14,
    fontWeight: 900,
    cursor: "pointer",
  },
  decisionButtonActive: {
    background: "#0b7fb4",
    color: "white",
    border: "1px solid #0b7fb4",
  },
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(11, 34, 54, 0.42)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    padding: 20,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
  },
  modal: {
    width: "100%",
    maxWidth: 500,
    background: "rgba(255, 255, 255, 0.96)",
    borderRadius: 26,
    padding: 24,
    boxShadow: "0 24px 80px rgba(0, 0, 0, 0.22)",
    border: "1px solid rgba(255, 255, 255, 0.75)",
  },
  modalHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  modalTitle: {
    margin: 0,
    fontSize: 24,
    color: "#0d5f8c",
    letterSpacing: "-0.03em",
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 999,
    border: "1px solid rgba(20, 129, 180, 0.18)",
    background: "white",
    color: "#0d5f8c",
    fontSize: 28,
    lineHeight: 1,
    cursor: "pointer",
  },
  modalText: {
    color: "#667085",
    lineHeight: 1.45,
    margin: "12px 0 4px",
  },
};
