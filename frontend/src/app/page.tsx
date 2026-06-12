"use client";

import { useState, useRef, useCallback, useEffect } from "react";

const LEVELS = [
  { value: 1, label: "Heel eenvoudig", desc: "Jonge kinderen" },
  { value: 2, label: "Eenvoudig", desc: "Kinderen" },
  { value: 3, label: "Gemiddeld", desc: "Oudere kinderen" },
  { value: 4, label: "Redelijk moeilijk", desc: "Tieners" },
  { value: 5, label: "Moeilijk", desc: "Volwassenen" },
  { value: 6, label: "Zeer moeilijk", desc: "Experts" },
];

const STORAGE_KEY = "kleurboek_data";
const MAX_HISTORY = 10;

interface HistoryEntry {
  id: number;
  difficulty: number;
  label: string;
  timestamp: number;
  imageData: string;
}

interface StorageData {
  difficulty: number;
  originalImage: string | null;
  coloringPage: string | null;
  history: HistoryEntry[];
}

function loadStorage(): StorageData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { difficulty: 3, originalImage: null, coloringPage: null, history: [] };
}

function saveStorage(data: StorageData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("localStorage full, clearing old history", e);
    data.history = data.history.slice(-3);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}
  }
}

export default function Home() {
  const [original, setOriginal] = useState<string | null>(null);
  const [coloringPage, setColoringPage] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragover, setDragover] = useState(false);
  const [difficulty, setDifficulty] = useState(3);
  const inputRef = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const saved = loadStorage();
    setDifficulty(saved.difficulty);
    setOriginal(saved.originalImage);
    setColoringPage(saved.coloringPage);
    setHistory(saved.history);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    saveStorage({ difficulty, originalImage: original, coloringPage, history });
  }, [difficulty, original, coloringPage, history, loaded]);

  const currentLevel = LEVELS.find((l) => l.value === difficulty) || LEVELS[2];

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Selecteer een afbeelding (jpg, png, etc.)");
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      setOriginal(e.target?.result as string);
      setColoringPage(null);
    };
    reader.readAsDataURL(file);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragover(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragover(true);
  };
  const onDragLeave = () => setDragover(false);

  const onSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const generate = async () => {
    if (!original) return;
    setLoading(true);
    setError(null);
    setProgress("Bezig met starten...");

    try {
      const apiBase = process.env.NODE_ENV === "development" ? "http://localhost:8000" : "";
      const res = await fetch(`${apiBase}/api/generate-coloring-page`, {
        method: "POST",
        body: JSON.stringify({ image: original, difficulty }),
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const text = await res.text();
        try {
          const err = JSON.parse(text);
          throw new Error(err.detail || `Fout (${res.status})`);
        } catch {
          throw new Error(text || `Fout (${res.status})`);
        }
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("Geen response body");

      const decoder = new TextDecoder();
      let buffer = "";

      let streamError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.step === "uploading") {
                setProgress("Foto voorbereiden...");
              } else if (data.step === "generating") {
                setProgress("Kleurplaat genereren (kan 30-60 sec duren)...");
              } else if (data.step === "done") {
                setColoringPage(data.image_data);
                setHistory((prev) => {
                  const entry: HistoryEntry = {
                    id: Date.now(),
                    difficulty,
                    label: currentLevel.label,
                    timestamp: Date.now(),
                    imageData: data.image_data,
                  };
                  return [entry, ...prev].slice(0, MAX_HISTORY);
                });
                setProgress(null);
                setLoading(false);
              } else if (data.step === "error") {
                streamError = data.message;
                break;
              }
            } catch {
              // skip invalid JSON
            }
          }
        }

        if (streamError) {
          setError(streamError);
          setLoading(false);
          setProgress(null);
          break;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Onbekende fout");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  const restoreHistory = (entry: HistoryEntry) => {
    if (original) setColoringPage(entry.imageData);
  };

  const clearStorage = () => {
    localStorage.removeItem(STORAGE_KEY);
    setOriginal(null);
    setColoringPage(null);
    setHistory([]);
    setDifficulty(3);
    setError(null);
  };

  const download = () => {
    if (!coloringPage) return;
    const link = document.createElement("a");
    link.download = `kleurplaat-niveau${difficulty}.png`;
    link.href = coloringPage;
    link.click();
  };

  return (
    <div className="container">
      <header>
        <h1>Kleurboek</h1>
        <p>Zet je foto om in een A4-kleurplaat met AI</p>
      </header>

      <div className="card slider-card">
        <div className="slider-header">
          <span className="slider-label">Moeilijkheidsgraad:</span>
          <span className="slider-value">{currentLevel.label}</span>
        </div>
        <input
          type="range"
          className="slider"
          min={1}
          max={6}
          step={1}
          value={difficulty}
          onChange={(e) => setDifficulty(Number(e.target.value))}
        />
        <div className="slider-labels">
          {LEVELS.map((l) => (
            <span
              key={l.value}
              className={`slider-tick ${difficulty >= l.value ? "active" : ""}`}
            >
              {l.value}
            </span>
          ))}
        </div>
        <div className="slider-desc">{currentLevel.desc}</div>
      </div>

      <div
        className={`upload-zone ${original ? "has-image" : ""} ${dragover ? "dragover" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
      >
        {original ? (
          <img
            src={original}
            alt="Preview"
            style={{ maxHeight: 220, margin: "0 auto" }}
          />
        ) : (
          <>
            <p>Klik of sleep een foto hierheen</p>
            <p className="sub">JPG of PNG</p>
          </>
        )}
        <input ref={inputRef} type="file" accept="image/*" onChange={onSelect} />
      </div>

      {!coloringPage && (
        <div className="btn-group">
          <button
            className="btn btn-primary"
            onClick={original ? generate : undefined}
            disabled={!original || loading}
          >
            {loading && <span className="spinner" />}
            {loading ? "Bezig..." : "Genereer kleurplaat"}
          </button>
        </div>
      )}

      {progress && (
        <div className="progress-bar-wrapper">
          <div className="progress-bar-inner" />
          <span className="progress-text">{progress}</span>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {coloringPage && (
        <>
          <div className="card result-card">
            <img src={coloringPage} alt="Kleurplaat" className="result-img" />
          </div>
          <div className="btn-group">
            <button className="btn btn-primary" onClick={download}>
              Download kleurplaat
            </button>
            <button
              className="btn btn-secondary"
              onClick={generate}
              disabled={loading}
            >
              {loading ? "Bezig..." : "Opnieuw met niveau " + difficulty}
            </button>
          </div>
        </>
      )}

      {history.length > 0 && (
        <div className="card history-card">
          <div className="history-header">
            <h3>Geschiedenis</h3>
            <button className="btn-small" onClick={clearStorage}>
              Wissen
            </button>
          </div>
          <div className="history-grid">
            {history.map((entry) => (
              <div
                key={entry.id}
                className="history-item"
                onClick={() => setColoringPage(entry.imageData)}
              >
                <img src={entry.imageData} alt={`Niveau ${entry.difficulty}`} />
                <div className="history-item-info">
                  <span className="history-item-level">
                    Niveau {entry.difficulty}
                  </span>
                  <span className="history-item-date">
                    {new Date(entry.timestamp).toLocaleDateString("nl-NL")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
