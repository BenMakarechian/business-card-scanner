"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

export default function Page() {
  const [language, setLanguage] = useState("English");
  const [sourceName, setSourceName] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState<"neutral" | "success" | "error">(
    "neutral"
  );
  const [isLoading, setIsLoading] = useState(false);

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

      if (!photo) {
        showError("Please take or upload a photo.");
        return;
      }

      setIsLoading(true);
      showNeutral("Scanning image. This may take 10–30 seconds.");

      const imageBase64 = await resizeAndEncodeImage(photo, 1600);

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
          targetSheetId: targetSheetId.trim(),
          targetSheetName: targetSheetName.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Unknown error.");
      }

      showSuccess(`Successfully added ${data.added} cards`);
      setPhoto(null);
      setPreviewUrl("");

      const fileInput = document.getElementById("photo") as HTMLInputElement;
      if (fileInput) fileInput.value = "";
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

  function handlePhotoChange(file: File | null) {
    setPhoto(file);

    if (!file) {
      setPreviewUrl("");
      return;
    }

    setPreviewUrl(URL.createObjectURL(file));
    setStatus("");
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

        <h1 style={styles.h1}>Super Scanner</h1>
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

        <label style={styles.label}>Business card photo</label>
        <input
          id="photo"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => handlePhotoChange(e.target.files?.[0] || null)}
          style={styles.input}
        />

        {previewUrl && (
          <img src={previewUrl} alt="Preview" style={styles.preview} />
        )}

        <button
          onClick={handleSubmit}
          disabled={isLoading}
          style={{
            ...styles.button,
            opacity: isLoading ? 0.65 : 1,
          }}
        >
          {isLoading ? "Scanning..." : "Scan and Add Cards"}
        </button>

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
