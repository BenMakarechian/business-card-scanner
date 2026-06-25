"use client";

import { useState } from "react";

export default function Page() {
  const [language, setLanguage] = useState("English");
  const [sourceName, setSourceName] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState<"neutral" | "success" | "error">(
    "neutral"
  );
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit() {
    try {
      if (!sourceName.trim()) {
        showError("Please enter your name.");
        return;
      }

      if (!accessCode.trim()) {
        showError("Please enter the access code.");
        return;
      }

      if (!photo) {
        showError("Please take or upload a photo.");
        return;
      }

      setIsLoading(true);
      showNeutral("Uploading and scanning image. This may take 10–30 seconds.");

      const imageBase64 = await resizeAndEncodeImage(photo, 1600);

      const response = await fetch("/api/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          preferredLanguage: language,
          sourceName: sourceName.trim(),
          accessCode: accessCode.trim(),
          mimeType: "image/jpeg",
          imageBase64,
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
    } catch (err: any) {
      showError(err.message || String(err));
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
        <h1 style={styles.h1}>Business Card Scanner</h1>
        <p style={styles.p}>
          Take or upload one photo with multiple business cards. The app will
          extract the contact information and add it to the Google Sheet.
        </p>

        <label style={styles.label}>Preferred language</label>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          style={styles.input}
        >
          <option value="English">English</option>
          <option value="Chinese">Chinese</option>
        </select>

        <label style={styles.label}>Your name</label>
        <input
          value={sourceName}
          onChange={(e) => setSourceName(e.target.value)}
          placeholder="Enter your name"
          style={styles.input}
        />

        <label style={styles.label}>Access code</label>
        <input
          type="password"
          value={accessCode}
          onChange={(e) => setAccessCode(e.target.value)}
          placeholder="Enter access code"
          style={styles.input}
        />

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
          Tip: Put 4–8 cards in one clear photo. Avoid glare and make sure
          emails are readable.
        </p>
      </section>
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

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f5f5f7",
    color: "#1d1d1f",
    fontFamily:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    padding: 24,
    boxSizing: "border-box",
  },
  card: {
    maxWidth: 520,
    margin: "0 auto",
    background: "white",
    padding: 24,
    borderRadius: 18,
    boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
  },
  h1: {
    fontSize: 28,
    margin: "0 0 8px",
  },
  p: {
    color: "#555",
    lineHeight: 1.45,
  },
  label: {
    display: "block",
    fontWeight: 700,
    marginTop: 18,
    marginBottom: 8,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    fontSize: 17,
    padding: 13,
    borderRadius: 12,
    border: "1px solid #ccc",
    background: "white",
  },
  button: {
    width: "100%",
    marginTop: 22,
    padding: 14,
    borderRadius: 12,
    border: "none",
    background: "#1d1d1f",
    color: "white",
    fontWeight: 800,
    fontSize: 17,
    cursor: "pointer",
  },
  preview: {
    marginTop: 14,
    width: "100%",
    borderRadius: 12,
  },
  status: {
    marginTop: 18,
    padding: 14,
    borderRadius: 12,
    lineHeight: 1.4,
  },
  success: {
    background: "#e8f7ee",
    color: "#126b35",
  },
  error: {
    background: "#fdeaea",
    color: "#9d1c1c",
  },
  neutral: {
    background: "#eef3ff",
    color: "#26427a",
  },
  tip: {
    fontSize: 14,
    color: "#666",
    marginTop: 18,
  },
};