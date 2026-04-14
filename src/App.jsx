import { useState, useEffect, useRef } from "react";
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem'; // ✅ direct file save

// ── GLOBAL NATIVE BACK BUTTON STACK ──────────────────────────────────────
const backButtonListeners = [];
const addBackListener = (fn) => backButtonListeners.push(fn);
const removeBackListener = (fn) => {
  const idx = backButtonListeners.indexOf(fn);
  if (idx !== -1) backButtonListeners.splice(idx, 1);
};

// ── CONSTANTS & COLORS ───────────────────────────────────────────────────
const COLORS = {
  bg: "#0f1117", card: "#181c27", cardBorder: "#252a3a",
  accent: "#f5a623", accentSoft: "#f5a62322",
  blue: "#4f8ef7", blueSoft: "#4f8ef722",
  green: "#2ecc71", greenSoft: "#2ecc7122",
  red: "#e74c3c", cyan: "#00b4d8",
  text: "#e8eaf0", muted: "#7a8099", highlight: "#ffffff",
  overlay: "rgba(0,0,0,0.6)",
};

const EXAM_MODES = {
  ssc: { label: "SSC CGL", accent: "#f5a623", tag: "SSC CGL" },
  banking: { label: "Banking", accent: "#4f8ef7", tag: "BANK PO/Clerk" }
};

const TABS = [
  { id: "home", label: "Home", icon: "⊞" },
  { id: "syllabus", label: "Syllabus", icon: "☑" },
  { id: "reminders", label: "Reminders", icon: "🔔" },
];

const ICONS = { subject: "📚", topic: "📁", subtopic: "📄", item: "✓" };

const DEFAULT_EXAMS = [
  { id: "1775399865865", name: "CCE Pre", date: "2026-05-01", icon: "📌", color: "#4f8ef7" },
  { id: "1775399603820", name: "SSC JE T1", date: "2026-06-01", icon: "📌", color: "#4f8ef7" },
  { id: "1775399663383", name: "SSC CGL T1", date: "2026-06-01", icon: "📌", color: "#4f8ef7" }
];

// ── UTILITY HELPERS & GENERIC TREE LOGIC ─────────────────────────────────
function uid() { return Date.now() + Math.random(); }

function daysLeft(dateStr) {
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.ceil((new Date(dateStr) - today) / 86400000);
}

function ensureValidUrl(url) {
  if (!url) return '';
  const trimmed = url.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return 'https://' + trimmed;
}

const migrateToTree = (oldData) => {
  if (!oldData || !Array.isArray(oldData)) return [];
  
  const process = (node, defaultType) => {
    const children = [];
    if (node.topics) children.push(...node.topics.map(t => process(t, 'topic')));
    if (node.subtopics) children.push(...node.subtopics.map(st => process(st, 'subtopic')));
    if (node.items) children.push(...node.items.map(i => process(i, 'item')));
    if (node.children) children.push(...node.children.map(c => process(c, c.nodeType || 'item')));

    let links = node.links || [];
    if (node.ytLink && links.length === 0) links = [node.ytLink];

    return {
      id: node.id || uid(), name: node.name || "Untitled", nodeType: node.nodeType || defaultType,
      done: node.done || false, revise: node.revise || false, reviseDate: node.reviseDate || null,
      links: links, children
    };
  };
  return oldData.map(s => process(s, 'subject'));
};

function countLeaves(node) {
  if (!node) return [];
  if (node.nodeType === 'item') return [node];
  if (!node.children || node.children.length === 0) return [];
  return node.children.flatMap(countLeaves);
}

const findNode = (tree, id) => {
  if (!tree) return null;
  for (const node of tree) {
    if (node.id === id) return node;
    if (node.children) { const found = findNode(node.children, id); if (found) return found; }
  }
  return null;
};

const updateNode = (tree, id, modifier) => {
  if (!tree) return [];
  return tree.map(node => {
    if (node.id === id) return modifier(node);
    if (node.children) return { ...node, children: updateNode(node.children, id, modifier) };
    return node;
  });
};

const deleteNode = (tree, id) => {
  if (!tree) return [];
  return tree.filter(node => node.id !== id).map(node => {
    if (node.children) return { ...node, children: deleteNode(node.children, id) };
    return node;
  });
};

const moveNodeArray = (arr, index, dir) => {
  if (index + dir < 0 || index + dir >= arr.length) return arr;
  const newArr = [...arr];
  const temp = newArr[index]; newArr[index] = newArr[index + dir]; newArr[index + dir] = temp;
  return newArr;
};

const moveNodeById = (tree, id, dir) => {
  if (!tree) return [];
  const index = tree.findIndex(n => n.id === id);
  if (index !== -1) return moveNodeArray(tree, index, dir);
  return tree.map(node => {
    if (node.children) return { ...node, children: moveNodeById(node.children, id, dir) };
    return node;
  });
};

const getReviseItems = (tree, path = []) => {
  if (!tree) return [];
  let items = [];
  for (const node of tree) {
    if (node.revise) items.push({ ...node, pathStr: path.length ? path.join(' › ') : "Root Level", type: 'syllabus' });
    if (node.children) items.push(...getReviseItems(node.children, [...path, node.name]));
  }
  return items;
};

// ── UI COMPONENTS ────────────────────────────────────────────────────────
function ProgressRing({ pct, size = 48, stroke = 4, color = COLORS.accent }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={COLORS.cardBorder} strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" style={{ transition: "stroke-dasharray 0.6s ease" }} />
    </svg>
  );
}

function CountdownRing({ days, size = 84, stroke = 7 }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const maxDays = 180;
  const pct = Math.min(100, Math.max(0, (days / maxDays) * 100));
  const dash = (pct / 100) * circ;
  const displayDays = days < 0 ? 0 : days;
  return (
    <div style={{ position: "relative", width: size, height: size, margin: "0 auto" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r - 1} fill="#ffffff" />
        {displayDays > 0 && <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={COLORS.cyan} strokeWidth={stroke} strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />}
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: 28, fontWeight: 900, color: "#000", lineHeight: 1 }}>{displayDays}</div>
        <div style={{ fontSize: 11, fontWeight: 800, color: "#000", marginTop: 2 }}>Days</div>
      </div>
    </div>
  );
}

function AddRow({ placeholder, onAdd, onCancel }) {
  const [val, setVal] = useState("");
  const ref = useRef();
  useEffect(() => { ref.current?.focus(); }, []);
  const submit = () => { if (val.trim()) { onAdd(val.trim()); } else onCancel(); };
  return (
    <div style={{ display: "flex", gap: 8, padding: "8px 0", animation: "fadeIn 0.2s ease" }}>
      <input
        ref={ref}
        value={val}
        placeholder={placeholder}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }}
        style={{ flex: 1, background: `${COLORS.accent}12`, border: `1.5px solid ${COLORS.accent}60`, borderRadius: 8, padding: "7px 10px", color: COLORS.text, fontSize: 13, fontFamily: "inherit", outline: "none", transition: "border 0.2s" }}
      />
      <button onClick={submit} style={{ background: COLORS.accent, color: "#000", border: "none", borderRadius: 8, padding: "6px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer", transition: "transform 0.1s" }}>Add</button>
      <button onClick={onCancel} style={{ background: "transparent", color: COLORS.muted, border: "none", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>
    </div>
  );
}

function BreadCrumb({ crumbs, setNav }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:4, padding:"14px 16px 10px", overflowX:"auto", flexWrap:"nowrap" }}>
      {crumbs.map((c, i) => (
        <div key={i} style={{ display:"flex", alignItems:"center", gap:4, flexShrink:0 }}>
          {i > 0 && <span style={{ color:COLORS.muted, fontSize:12 }}>›</span>}
          <button
            onClick={() => setNav(c.nav)}
            style={{ background: i===crumbs.length-1 ? COLORS.accentSoft : "transparent", border: i===crumbs.length-1 ? `1px solid ${COLORS.accent}40` : "none", color: i===crumbs.length-1 ? COLORS.accent : COLORS.muted, borderRadius:8, padding:"4px 10px", fontSize:12, fontWeight: i===crumbs.length-1?700:500, cursor:"pointer", whiteSpace:"nowrap", transition: "all 0.1s" }}
          >{c.label}</button>
        </div>
      ))}
    </div>
  );
}

function ActionBtn({ icon, onClick, disabled, label }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      disabled={disabled}
      aria-label={label}
      style={{ background: "transparent", border: "none", color: disabled ? COLORS.cardBorder : COLORS.muted, fontSize: 18, cursor: disabled ? "default" : "pointer", padding: "6px 8px", lineHeight: 1, transition: "color 0.1s" }}
    >
      {icon}
    </button>
  );
}

// ── MODALS ───────────────────────────────────────────────────────────────
function SettingsModal({ onClose, dataStr, onImport }) {
  const [manualPaste, setManualPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [toast, setToast] = useState(null);
  const fileInputRef = useRef(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2000); };

  // ✅ NEW: Direct file save using Filesystem
  const handleFileExport = async () => {
    const fileName = "crackit_backup.json";
    try {
      await Filesystem.writeFile({
        path: fileName,
        data: dataStr,
        directory: Directory.Documents,
        recursive: true,
      });
      const result = await Filesystem.getUri({
        directory: Directory.Documents,
        path: fileName,
      });
      showToast(`✅ Backup saved: ${result.uri}`);
    } catch (error) {
      console.error("File write error:", error);
      alert("❌ Failed to save backup. Please use Copy button as fallback.");
    }
  };

  const handleFileImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => { onImport(event.target.result); showToast("📥 Imported"); };
    reader.readAsText(file);
  };

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(dataStr); showToast("✅ Copied to clipboard"); }
    catch (e) { alert("Failed to copy. Please manually select and copy."); }
  };

  const handlePasteImport = async () => {
    try {
      let text = await navigator.clipboard.readText();
      if(!text) throw new Error("Clipboard empty");
      onImport(text);
      showToast("📥 Imported from clipboard");
    } catch (e) { setManualPaste(true); }
  };

  if (manualPaste) {
    return (
      <div style={{ position:"fixed", inset:0, zIndex:999, background:COLORS.overlay, display:"flex", alignItems:"center", justifyContent:"center", padding: 20, animation: "fadeIn 0.2s" }}>
         <div style={{ background: COLORS.card, padding: 20, borderRadius: 20, width: "100%", maxWidth: 380, border: `1px solid ${COLORS.cardBorder}`, boxShadow: "0 10px 40px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems: "center", marginBottom: 16 }}>
               <div style={{ fontSize: 18, fontWeight: 800 }}>Paste Backup Data</div>
               <button onClick={() => setManualPaste(false)} style={{ background:"none", border:"none", color:COLORS.muted, fontSize: 28, lineHeight: 1, cursor:"pointer" }}>×</button>
            </div>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder='{"sscSyllabus": [...'
              style={{ width: "100%", height: 200, boxSizing: "border-box", background: `${COLORS.accent}12`, border: `1px solid ${COLORS.accent}40`, borderRadius: 12, padding: 12, color: COLORS.text, fontFamily: "monospace", fontSize: 12, outline: "none", marginBottom: 16, resize: "none" }}
            />
            <button onClick={() => onImport(pasteText)} style={{ width: "100%", padding: 14, background: COLORS.accent, color: "#000", fontWeight: 800, borderRadius: 12, border:"none", cursor:"pointer" }}>Import Data</button>
         </div>
      </div>
    );
  }

  return (
    <div style={{ position:"fixed", inset:0, zIndex:999, background:COLORS.overlay, display:"flex", alignItems:"center", justifyContent:"center", padding: 20, animation: "fadeIn 0.2s" }}>
       <div style={{ background: COLORS.card, padding: 24, borderRadius: 20, width: "100%", maxWidth: 340, border: `1px solid ${COLORS.cardBorder}`, boxShadow: "0 10px 40px rgba(0,0,0,0.5)" }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom: 24 }}>
             <div style={{ fontSize: 18, fontWeight: 800 }}>Data Management</div>
             <button onClick={onClose} style={{ background:"none", border:"none", color:COLORS.muted, fontSize: 24, lineHeight: 0.8, cursor:"pointer" }}>×</button>
          </div>
          <div style={{ display:"flex", gap:10, marginBottom: 24 }}>
            <button onClick={handleFileExport} style={{ flex:1, padding: 12, background: COLORS.accent, color: "#000", fontWeight: 800, borderRadius: 12, border:"none", cursor:"pointer" }}>💾 Save .json</button>
            <button onClick={() => fileInputRef.current?.click()} style={{ flex:1, padding: 12, background: "transparent", border: `2px solid ${COLORS.accent}`, color: COLORS.accent, fontWeight: 800, borderRadius: 12, cursor:"pointer" }}>📂 Load .json</button>
            <input type="file" accept=".json" ref={fileInputRef} onChange={handleFileImport} style={{ display: "none" }} />
          </div>
          <div style={{ display:"flex", gap:10, marginBottom: 12 }}>
            <button onClick={handleCopy} style={{ flex:1, padding: 12, background: COLORS.blueSoft, color: COLORS.blue, fontWeight: 800, borderRadius: 12, border:`1px solid ${COLORS.blue}40`, cursor:"pointer" }}>📋 Copy</button>
            <button onClick={handlePasteImport} style={{ flex:1, padding: 12, background: COLORS.blueSoft, color: COLORS.blue, fontWeight: 800, borderRadius: 12, border:`1px solid ${COLORS.blue}40`, cursor:"pointer" }}>📥 Paste</button>
          </div>
       </div>
       {toast && <div style={{ position:"fixed", bottom:30, left:"50%", transform:"translateX(-50%)", background:"#000", color:"#fff", padding:"8px 16px", borderRadius:40, fontSize:13, zIndex:1000, whiteSpace:"nowrap" }}>{toast}</div>}
    </div>
  )
}

function LinkModal({ currentLinks = [], onSave, onClose, accent }) {
  const [links, setLinks] = useState([...currentLinks]);
  const [newLink, setNewLink] = useState("");
  const [error, setError] = useState("");

  const isValidUrl = (url) => {
    if (!url.trim()) return false;
    try { new URL(ensureValidUrl(url)); return true; } catch { return false; }
  };
  const valid = newLink.trim() !== "" && isValidUrl(newLink);

  const handleAdd = () => {
    if (valid) {
      const fixedUrl = ensureValidUrl(newLink.trim());
      setLinks([...links, fixedUrl]);
      setNewLink("");
      setError("");
    } else {
      setError("Please enter a valid URL (e.g., https://youtube.com/...)");
    }
  };

  const handleRemove = (index) => {
    setLinks(links.filter((_, i) => i !== index));
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 999, background: COLORS.overlay, display: "flex", alignItems: "flex-end", justifyContent: "center", animation: "slideUp 0.2s" }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: COLORS.card, borderRadius: "20px 20px 0 0", border: `1px solid ${COLORS.cardBorder}`, width: "100%", maxWidth: 430, padding: "20px 20px 36px", maxHeight: "80vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: COLORS.text }}>🔗 Resource Links</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: COLORS.muted, fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        {links.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
            {links.map((link, idx) => (
              <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center", background: `${COLORS.blue}15`, border: `1px solid ${COLORS.blue}40`, borderRadius: 10, padding: "8px 12px" }}>
                <div style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, color: COLORS.blue }}>{link}</div>
                <button onClick={() => window.open(link, "_blank")} style={{ background: COLORS.blue, color: "#000", border: "none", borderRadius: 6, padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>Open</button>
                <button onClick={() => handleRemove(idx)} style={{ background: "transparent", border: "none", color: COLORS.red, fontSize: 16, cursor: "pointer", padding: "0 4px", flexShrink: 0 }}>🗑</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input value={newLink} onChange={e => { setNewLink(e.target.value); setError(""); }} placeholder="Paste URL (https://...)" style={{ flex: 1, boxSizing: "border-box", background: `${accent}12`, border: `1.5px solid ${valid ? accent + "60" : COLORS.red + "80"}`, borderRadius: 10, padding: "10px 12px", color: COLORS.text, fontSize: 13, fontFamily: "inherit", outline: "none" }} />
            <button onClick={handleAdd} disabled={!valid} style={{ background: valid ? accent : COLORS.cardBorder, color: valid ? "#000" : COLORS.muted, border: "none", borderRadius: 10, padding: "10px 16px", fontWeight: 800, fontSize: 14, cursor: valid ? "pointer" : "default" }}>Add</button>
          </div>
          {error && <div style={{ fontSize: 11, color: COLORS.red, paddingLeft: 4 }}>{error}</div>}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
          <button onClick={() => { onSave(links); onClose(); }} style={{ flex: 1, background: accent, color: "#000", border: "none", borderRadius: 10, padding: "12px", fontWeight: 800, fontSize: 14, cursor: "pointer" }}>Save {links.length > 0 ? "Changes" : ""}</button>
        </div>
      </div>
    </div>
  );
}

// ── TABS ─────────────────────────────────────────────────────────────────
function ExamCountdowns({ exams, setExams }) {
  const [editingId, setEditingId] = useState(null);
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDate, setNewDate] = useState("");
  const updateDate = (id, date) => setExams(exams.map(e => e.id === id ? { ...e, date } : e));
  const removeExam = (id) => { setExams(exams.filter(e => e.id !== id)); setEditingId(null); };
  const addExam = () => {
    if (!newName.trim() || !newDate) return;
    setExams([...exams, { id: Date.now().toString(), name: newName.trim(), date: newDate, icon: "📌", color: "#4f8ef7" }]);
    setNewName(""); setNewDate(""); setAddingNew(false);
  };
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div style={{ margin: "0 0 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 20px 12px" }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: COLORS.text }}>⏳ Exam Countdown</div>
        <button onClick={() => setAddingNew(a => !a)} style={{ background: addingNew ? `${COLORS.red}22` : COLORS.accentSoft, border: `1px solid ${addingNew ? COLORS.red + "50" : COLORS.accent + "40"}`, color: addingNew ? COLORS.red : COLORS.accent, borderRadius: 20, padding: "5px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{addingNew ? "✕ Cancel" : "+ Add Exam"}</button>
      </div>
      {addingNew && (
        <div style={{ margin: "0 20px 16px", background: COLORS.card, border: `1px solid ${COLORS.accent}40`, borderRadius: 16, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Exam name (e.g. SSC MTS)" style={{ background: `${COLORS.accent}12`, border: `1px solid ${COLORS.accent}40`, borderRadius: 10, padding: "10px 12px", color: COLORS.text, fontSize: 14, fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box" }} />
          <div style={{ display: "flex", gap: 10 }}>
            <input type="date" value={newDate} min={today} onChange={e => setNewDate(e.target.value)} style={{ flex: 1, background: `${COLORS.accent}12`, border: `1px solid ${COLORS.accent}40`, borderRadius: 10, padding: "10px 12px", color: COLORS.text, fontSize: 14, fontFamily: "inherit", outline: "none", colorScheme: "dark" }} />
            <button onClick={addExam} style={{ background: COLORS.accent, color: "#000", border: "none", borderRadius: 10, padding: "10px 20px", fontWeight: 800, fontSize: 14, cursor: "pointer" }}>Add</button>
          </div>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "0 20px" }}>
        {[...exams].sort((a,b)=>daysLeft(a.date)-daysLeft(b.date)).map(exam => {
          const days = daysLeft(exam.date);
          const isOver = days < 0;
          const dParts = exam.date.split('-'); const displayDate = dParts.length === 3 ? `${dParts[2]}/${dParts[1]}/${dParts[0]}` : exam.date;
          return (
            <div key={exam.id} style={{ background: COLORS.card, border: `1px solid ${COLORS.cardBorder}`, borderRadius: 12, padding: "16px 14px", display: "flex", flexDirection: "column", position: "relative" }}>
              {editingId === exam.id ? (
                <div style={{ display: "flex", flexDirection: "column", height: "100%", justifyContent: "center", gap: 8 }}>
                  <input type="date" defaultValue={exam.date} min={today} onChange={e => updateDate(exam.id, e.target.value)} style={{ width: "100%", boxSizing: "border-box", background: `${COLORS.blue}18`, border: `1px solid ${COLORS.blue}50`, borderRadius: 8, padding: "6px 8px", color: COLORS.text, fontSize: 11, fontFamily: "inherit", outline: "none", colorScheme: "dark" }} />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => setEditingId(null)} style={{ flex: 1, background: `${COLORS.blue}22`, border: "none", color: COLORS.blue, borderRadius: 8, padding: "6px 0", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Save</button>
                    <button onClick={() => removeExam(exam.id)} style={{ background: `${COLORS.red}22`, border: "none", color: COLORS.red, borderRadius: 8, padding: "6px 8px", fontSize: 12, cursor: "pointer" }}>🗑</button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                    <div style={{ flex: 1, paddingRight: 8 }}><div style={{ fontSize: 13, fontWeight: 700, color: COLORS.text, lineHeight: 1.3 }}>{exam.name}</div><div style={{ fontSize: 11, color: COLORS.muted, marginTop: 4 }}>{displayDate}</div></div>
                    <button onClick={() => setEditingId(exam.id)} style={{ background: "transparent", border: "none", color: COLORS.muted, fontSize: 18, cursor: "pointer", padding: "0 0 10px 10px", lineHeight: 0.8 }}>⋮</button>
                  </div>
                  <CountdownRing days={days} />
                  {isOver && <div style={{ textAlign: "center", fontSize: 11, color: COLORS.red, marginTop: 12, fontWeight: 600 }}>Exam passed</div>}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HomeTab({ syllabus, exams, setExams }) {
  return (
    <div style={{ padding: "32px 0 100px" }}>
      <div style={{ padding: "0 20px", marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontSize: 32, fontWeight: 900, color: COLORS.text }}>Dashboard</h1>
        <p style={{ margin: "4px 0 0 0", fontSize: 15, color: COLORS.muted, fontWeight: 500 }}>Ready to crush your goals today?</p>
      </div>
      <div style={{ margin: "0 20px 32px", background: COLORS.card, border: `1px solid ${COLORS.cardBorder}`, borderRadius: 20, padding: 20, boxShadow: "0 6px 20px rgba(0,0,0,0.2)" }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: COLORS.text, marginBottom: 16 }}>Syllabus Progress</div>
        {syllabus.map(s => {
          const leaves = countLeaves(s);
          const prog = leaves.length ? Math.round((leaves.filter(i=>i.done).length / leaves.length) * 100) : 0;
          return (
            <div key={s.id} style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.text }}>{s.name}</span>
                <span style={{ fontSize: 13, color: COLORS.accent, fontWeight: 800 }}>{prog}%</span>
              </div>
              <div style={{ height: 8, background: COLORS.cardBorder, borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${prog}%`, borderRadius: 4, background: `linear-gradient(90deg, ${COLORS.accent}, ${COLORS.blue})`, transition: "width 0.8s ease" }} />
              </div>
            </div>
          );
        })}
        {syllabus.length === 0 && <div style={{ fontSize: 13, color: COLORS.muted, textAlign: "center" }}>No syllabus items added yet. Open settings to import your data!</div>}
      </div>
      <ExamCountdowns exams={exams} setExams={setExams} />
    </div>
  );
}

function SyllabusTab({ syllabus, setSyllabus, accent }) {
  const [nav, setNav] = useState([]); 
  const [adding, setAdding] = useState(false);
  const [addingType, setAddingType] = useState("item");
  const [linkModal, setLinkModal] = useState(null);
  const [editMode, setEditMode] = useState(false);

  const stateRef = useRef({ linkModal, adding, nav });
  useEffect(() => { stateRef.current = { linkModal, adding, nav }; }, [linkModal, adding, nav]);

  useEffect(() => {
    const handleBack = () => {
      const { linkModal, adding, nav } = stateRef.current;
      if (linkModal) { setLinkModal(null); return true; } else if (adding) { setAdding(false); return true; } else if (nav.length > 0) { setNav(n => n.slice(0, -1)); return true; }
      return false; 
    };
    addBackListener(handleBack); return () => removeBackListener(handleBack);
  }, []);

  const currentNode = nav.length === 0 ? null : findNode(syllabus, nav[nav.length - 1]);
  const childrenToRender = nav.length === 0 ? syllabus : (currentNode?.children || []);

  const allLeaves = syllabus.flatMap(countLeaves);
  const overall = allLeaves.length ? Math.round((allLeaves.filter(i => i.done).length / allLeaves.length) * 100) : 0;

  const handleAdd = (name) => {
    const newNode = { id: uid(), name, nodeType: addingType, done: false, revise: false, reviseDate: null, links: [], children: [] };
    if (nav.length === 0) setSyllabus([...syllabus, newNode]);
    else setSyllabus(updateNode(syllabus, nav[nav.length - 1], p => ({ ...p, children: [...(p.children||[]), newNode] })));
    setAdding(false);
  };

  const toggleItem = (id) => setSyllabus(prev => updateNode(prev, id, n => ({...n, done: !n.done})));
  const toggleRevise = (id) => setSyllabus(prev => updateNode(prev, id, n => ({...n, revise: !n.revise, reviseDate: !n.revise ? new Date(Date.now() + 86400000).toISOString().slice(0,10) : null})));
  const setReviseDate = (id, date) => setSyllabus(prev => updateNode(prev, id, n => ({...n, reviseDate: date})));
  const setLinks = (id, newLinks) => setSyllabus(prev => updateNode(prev, id, n => ({...n, links: newLinks})));
  const renameCurrentNode = (id, name) => setSyllabus(prev => updateNode(prev, id, n => ({...n, name})));
  const deleteNodeById = (id) => { setSyllabus(prev => deleteNode(prev, id)); if(nav.includes(id)) setNav(nav.slice(0, nav.indexOf(id))); };
  const moveNodeDir = (id, dir) => setSyllabus(prev => moveNodeById(prev, id, dir));
  
  const promptRename = (currentName, onSave) => {
    const newName = window.prompt("Rename to:", currentName);
    if (newName !== null && newName.trim() !== "") onSave(newName.trim());
  };

  const crumbs = [{ label: "Syllabus", nav: [] }];
  let curNav = [];
  for (let id of nav) {
    curNav.push(id);
    const n = findNode(syllabus, id);
    if (n) crumbs.push({ label: n.name, nav: [...curNav] });
  }

  const progColor = p => p >= 70 ? COLORS.green : p >= 35 ? COLORS.accent : COLORS.blue;
  const btnStyle = { flex: 1, background:"transparent", border:`1.5px dashed ${COLORS.cardBorder}`, color:COLORS.muted, borderRadius:10, padding:"10px 0", fontSize:13, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6, fontWeight:600, transition: "background 0.1s" };

  const renderItemRow = (item, idx, total) => {
    const hasLinks = item.links && item.links.length > 0;
    
    if (editMode) {
      return (
        <div key={item.id} style={{ background: COLORS.card, border:`1px solid ${COLORS.cardBorder}`, borderRadius:11, marginBottom:8, overflow:"hidden", display:"flex", alignItems:"center", padding:"11px 14px" }}>
          <span style={{ flex:1, fontSize:14, color:COLORS.text }}>{item.name}</span>
          <div style={{ display:"flex", gap:4, alignItems:"center" }}>
            <ActionBtn icon="↑" onClick={() => moveNodeDir(item.id, -1)} disabled={idx===0} label="Move up"/>
            <ActionBtn icon="↓" onClick={() => moveNodeDir(item.id, 1)} disabled={idx===total-1} label="Move down"/>
            <ActionBtn icon="✎" onClick={() => promptRename(item.name, nn => renameCurrentNode(item.id,nn))} label="Rename"/>
            <ActionBtn icon="🗑" onClick={() => deleteNodeById(item.id)} label="Delete"/>
          </div>
        </div>
      );
    }
    return (
      <div key={item.id} style={{ background: item.done?`${COLORS.green}08`:item.revise?`${COLORS.accent}08`:COLORS.card, border:`1px solid ${item.revise?COLORS.accent+"50":item.done?COLORS.green+"30":COLORS.cardBorder}`, borderRadius:11, marginBottom:8, overflow:"hidden", transition: "all 0.1s" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 14px" }}>
          <div onClick={() => toggleItem(item.id)} style={{ width:22, height:22, borderRadius:6, flexShrink:0, cursor:"pointer", background:item.done?COLORS.green:"transparent", border:`2px solid ${item.done?COLORS.green:COLORS.cardBorder}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, color:"#fff", transition:"all 0.15s" }}>{item.done?"✓":""}</div>
          <span style={{ flex:1, fontSize:14, color:item.done?COLORS.muted:COLORS.text, textDecoration:item.done?"line-through":"none" }}>{item.name}</span>
          
          <button onClick={() => setLinkModal({ id: item.id, links: item.links || [] })} style={{ background:hasLinks?`${COLORS.blue}22`:"transparent", border:hasLinks?`1px solid ${COLORS.blue}50`:"none", color:hasLinks?COLORS.blue:COLORS.muted, borderRadius:7, padding:"3px 7px", cursor:"pointer", fontSize:13, lineHeight:1, flexShrink:0 }}>
            🔗 {hasLinks && item.links.length > 1 ? item.links.length : ""}
          </button>
          
          <button onClick={() => toggleRevise(item.id)} style={{ background:item.revise?`${COLORS.accent}22`:"transparent", border:item.revise?`1px solid ${COLORS.accent}50`:"none", borderRadius:7, padding:"3px 7px", cursor:"pointer", fontSize:14, lineHeight:1, color: item.revise?COLORS.accent:COLORS.muted }}>🔔</button>
        </div>
        {item.revise && (
          <div style={{ display:"flex", alignItems:"center", gap:10, padding:"0 14px 11px 46px" }}>
            <span style={{ fontSize:11, color:COLORS.accent, fontWeight:600 }}>{item.done ? "🔄 Revise on:" : "🎯 Complete by:"}</span>
            <input type="date" value={item.reviseDate||""} min={new Date().toISOString().slice(0,10)} onChange={e => setReviseDate(item.id, e.target.value)} style={{ background:`${COLORS.accent}12`, border:`1px solid ${COLORS.accent}40`, borderRadius:7, padding:"3px 8px", color:COLORS.text, fontSize:12, fontFamily:"inherit", outline:"none", colorScheme:"dark" }} />
          </div>
        )}
      </div>
    );
  };

  const renderFolderRow = (node, idx, total) => {
    const leaves = countLeaves(node); const doneCount = leaves.filter(i=>i.done).length;
    const pct = leaves.length ? Math.round((doneCount / leaves.length) * 100) : 0;
    const pc = progColor(pct); const hasLinks = node.links && node.links.length > 0;

    if (editMode) {
      return (
        <div key={node.id} style={{ background: COLORS.card, border:`1px solid ${COLORS.cardBorder}`, borderRadius:11, marginBottom:8, overflow:"hidden", display:"flex", alignItems:"center", padding:"11px 14px", gap:12 }}>
          <span style={{ flex:1, fontSize:14, color:COLORS.text }}>{ICONS[node.nodeType]} {node.name}</span>
          <div style={{ display:"flex", gap:4, alignItems:"center" }}>
            <ActionBtn icon="↑" onClick={() => moveNodeDir(node.id, -1)} disabled={idx===0} label="Move up"/>
            <ActionBtn icon="↓" onClick={() => moveNodeDir(node.id, 1)} disabled={idx===total-1} label="Move down"/>
            <ActionBtn icon="✎" onClick={() => promptRename(node.name, nn => renameCurrentNode(node.id,nn))} label="Rename"/>
            <ActionBtn icon="🗑" onClick={() => deleteNodeById(node.id)} label="Delete"/>
          </div>
        </div>
      );
    }
    return (
      <div key={node.id} style={{ background: COLORS.card, border:`1px solid ${pct>0?pc+"40":COLORS.cardBorder}`, borderRadius:11, marginBottom:8, overflow:"hidden", transition: "all 0.1s", cursor: "pointer" }} onClick={() => setNav([...nav, node.id])}>
        <div style={{ display:"flex", alignItems:"center", padding:"14px", gap:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, flex:1 }}>
            <div style={{ position:"relative", flexShrink:0 }}><ProgressRing pct={pct} size={42} stroke={3} color={pc} /><div style={{ position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",fontSize:9,fontWeight:800,color:pc }}>{pct}%</div></div>
            <div style={{ flex:1, minWidth:0 }}>
              <span style={{ fontSize:14,fontWeight:600,color:COLORS.text,display:"block" }}>{ICONS[node.nodeType]} {node.name}</span>
              <div style={{ fontSize:11,color:COLORS.muted,display:"flex",alignItems:"center",gap:4 }}>{(node.children || []).length} sub-items · {doneCount}/{leaves.length} done {hasLinks && <span style={{ color: COLORS.red, fontSize:10, fontWeight:700 }}>▶ 🔗</span>}</div>
            </div>
          </div>
          
          <button onClick={(e) => { e.stopPropagation(); setLinkModal({ id: node.id, links: node.links || [] }); }} style={{ background: hasLinks ? `${COLORS.blue}22` : "transparent", border: hasLinks ? `1px solid ${COLORS.blue}50` : "none", color: hasLinks ? COLORS.blue : COLORS.muted, borderRadius: 7, padding: "3px 7px", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>
            🔗 {hasLinks && node.links.length > 1 ? node.links.length : ""}
          </button>

          <button onClick={(e) => { e.stopPropagation(); toggleRevise(node.id); }} style={{ background:node.revise?`${COLORS.accent}22`:"transparent", border:node.revise?`1px solid ${COLORS.accent}50`:"none", borderRadius:7, padding:"3px 7px", cursor:"pointer", fontSize:14, lineHeight:1, color: node.revise?COLORS.accent:COLORS.muted }}>🔔</button>
          <div style={{ color:COLORS.muted,fontSize:16 }}>›</div>
        </div>
        {node.revise && (
          <div style={{ display:"flex", alignItems:"center", gap:10, padding:"0 14px 11px 46px" }} onClick={(e) => e.stopPropagation()}>
            <span style={{ fontSize:11, color:COLORS.accent, fontWeight:600 }}>🎯 Complete by:</span>
            <input type="date" value={node.reviseDate||""} min={new Date().toISOString().slice(0,10)} onChange={e => setReviseDate(node.id, e.target.value)} style={{ background:`${COLORS.accent}12`, border:`1px solid ${COLORS.accent}40`, borderRadius:7, padding:"3px 8px", color:COLORS.text, fontSize:12, fontFamily:"inherit", outline:"none", colorScheme:"dark" }} />
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div style={{ padding:"0 0 100px" }}>
        {nav.length > 0 ? (
          <BreadCrumb crumbs={crumbs} setNav={setNav} />
        ) : (
          <div style={{ padding:"20px 16px 0", display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
            <div><div style={{ fontSize:20,fontWeight:800,color:COLORS.text }}>Syllabus Tracker</div><div style={{ fontSize:13,color:COLORS.muted,marginTop:2 }}>Tap a folder to drill down</div></div>
          </div>
        )}

        <div style={{ padding:"16px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
            {nav.length > 0 ? (
              <div><div style={{ fontSize:18, fontWeight:800, color:COLORS.text }}>{currentNode.name}</div></div>
            ) : (
               <div style={{ display:"flex", alignItems:"center", gap:16 }}>
                <div style={{ position:"relative", flexShrink:0 }}><ProgressRing pct={overall} size={50} stroke={4} color={COLORS.accent} /><div style={{ position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",fontSize:10,fontWeight:800,color:COLORS.accent }}>{overall}%</div></div>
                <div><div style={{ fontSize:15,fontWeight:700,color:COLORS.text }}>Overall Progress</div><div style={{ fontSize:12,color:COLORS.muted }}>{allLeaves.filter(i=>i.done).length} / {allLeaves.length} items done</div></div>
              </div>
            )}
             <button onClick={() => {setEditMode(!editMode); setAdding(false);}} style={{ background: editMode ? COLORS.green : COLORS.cardBorder, color: editMode ? "#000" : COLORS.text, border:"none", borderRadius:10, padding:"7px 14px", fontWeight:700, fontSize:12, cursor:"pointer", transition: "all 0.1s" }}>{editMode ? "✓ Done" : "✎ Edit List"}</button>
          </div>

          {childrenToRender.length === 0 && !adding && (
            <div style={{ textAlign:"center",padding:"40px 20px",color:COLORS.muted }}>
              <div style={{ fontSize:36,marginBottom:12 }}>📋</div>
              <div style={{ fontSize:15,fontWeight:600,color:COLORS.text,marginBottom:6 }}>It's empty here!</div>
              <div style={{ fontSize:13 }}>Add a subject, topic, subtopic, or item below.</div>
            </div>
          )}

          {childrenToRender.map((n, idx) => n.nodeType === 'item' ? renderItemRow(n, idx, childrenToRender.length) : renderFolderRow(n, idx, childrenToRender.length))}

          {!editMode && (
            adding ? (
              <AddRow placeholder={`New ${addingType}...`} onAdd={handleAdd} onCancel={() => setAdding(false)} />
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                <button onClick={() => {setAddingType('subject'); setAdding(true);}} style={btnStyle}><span style={{fontSize:18,lineHeight:1}}>+</span> Subject</button>
                <button onClick={() => {setAddingType('topic'); setAdding(true);}} style={btnStyle}><span style={{fontSize:18,lineHeight:1}}>+</span> Topic</button>
                <button onClick={() => {setAddingType('subtopic'); setAdding(true);}} style={btnStyle}><span style={{fontSize:18,lineHeight:1}}>+</span> Subtopic</button>
                <button onClick={() => {setAddingType('item'); setAdding(true);}} style={btnStyle}><span style={{fontSize:18,lineHeight:1}}>+</span> Item</button>
              </div>
            )
          )}
        </div>
      </div>
      
      {linkModal && (
        <LinkModal 
          currentLinks={linkModal.links} 
          accent={accent || COLORS.accent} 
          onClose={() => setLinkModal(null)} 
          onSave={newLinks => { 
            setLinks(linkModal.id, newLinks); 
            setLinkModal(null); 
          }} 
        />
      )}
    </>
  );
}

function RemindersTab({ items, setSyllabus, setCustomTasks, today }) {
  const [filter, setFilter] = useState("all"); 
  const [addingCustom, setAddingCustom] = useState(false);
  const [cName, setCName] = useState(""); const [cDate, setCDate] = useState(today); const [cLink, setCLink] = useState("");

  const categorize = (item) => { if (!item.reviseDate) return "unscheduled"; if (item.reviseDate < today) return "overdue"; if (item.reviseDate === today) return "today"; return "upcoming"; };
  const filtered = items.filter(item => { if (filter === "all") return true; return categorize(item) === filter; });

  const counts = { overdue: items.filter(i => categorize(i) === "overdue").length, today: items.filter(i => categorize(i) === "today").length, upcoming: items.filter(i => categorize(i) === "upcoming").length, unscheduled: items.filter(i => categorize(i) === "unscheduled").length };

  const handleAddCustom = () => {
    if(!cName.trim()) return;
    const links = cLink.trim() ? [ensureValidUrl(cLink.trim())] : [];
    setCustomTasks(prev => [...prev, { id: uid(), name: cName.trim(), reviseDate: cDate, links, done: false, type: 'custom' }]);
    setAddingCustom(false); setCName(""); setCLink("");
  };

  const toggleDone = (item) => {
    if (item.type === 'custom') setCustomTasks(prev => prev.map(t => t.id === item.id ? { ...t, done: !t.done } : t));
    else setSyllabus(prev => updateNode(prev, item.id, n => ({ ...n, done: !n.done })));
  };

  const clearItem = (item) => {
    if (item.type === 'custom') setCustomTasks(prev => prev.filter(t => t.id !== item.id));
    else setSyllabus(prev => updateNode(prev, item.id, n => ({ ...n, revise: false, reviseDate: null })));
  };

  const updateDate = (item, date) => {
    if (item.type === 'custom') setCustomTasks(prev => prev.map(t => t.id === item.id ? { ...t, reviseDate: date } : t));
    else setSyllabus(prev => updateNode(prev, item.id, n => ({ ...n, reviseDate: date })));
  };

  const statusColors = { overdue: COLORS.red, today: COLORS.accent, upcoming: COLORS.blue, unscheduled: COLORS.muted };
  const statusLabels = { overdue: "Overdue", today: "Today", upcoming: "Upcoming", unscheduled: "No Date" };

  const formatDate = (d) => { if (!d) return null; const diff = Math.round((new Date(d) - new Date(today)) / 86400000); if (diff === 0) return "Today"; if (diff === 1) return "Tomorrow"; if (diff === -1) return "Yesterday"; if (diff < 0) return `${-diff} days ago`; return `In ${diff} days`; };

  return (
    <div style={{ padding: "0 0 100px" }}>
      <div style={{ padding: "20px 16px 0" }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: COLORS.text }}>Planner & Reminders</div>
        <div style={{ fontSize: 13, color: COLORS.muted, marginTop: 2, marginBottom: 16 }}>Flag tasks with 🔔 in Syllabus, or add direct tasks below.</div>
        
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
          {[ { label: "Due Today", val: counts.today, color: COLORS.accent, bg: COLORS.accentSoft }, { label: "Overdue", val: counts.overdue, color: COLORS.red, bg: `${COLORS.red}18` }, { label: "Upcoming", val: counts.upcoming, color: COLORS.blue, bg: COLORS.blueSoft }, { label: "Total Tasks", val: items.length, color: COLORS.green, bg: COLORS.greenSoft }
          ].map(c => ( <div key={c.label} style={{ background: c.bg, border: `1px solid ${c.color}30`, borderRadius: 12, padding: "12px 14px" }}><div style={{ fontSize: 26, fontWeight: 800, color: c.color }}>{c.val}</div><div style={{ fontSize: 11, color: COLORS.muted, marginTop: 2 }}>{c.label}</div></div> ))}
        </div>

        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 16 }}>
          {[ { key: "all", label: `All (${items.length})` }, { key: "overdue", label: `⚠ Overdue (${counts.overdue})` }, { key: "today", label: `🔥 Today (${counts.today})` }, { key: "upcoming", label: `📅 Upcoming (${counts.upcoming})` }, { key: "unscheduled", label: `No Date (${counts.unscheduled})` }
          ].map(p => ( <button key={p.key} onClick={() => setFilter(p.key)} style={{ background: filter === p.key ? COLORS.accent : COLORS.card, color: filter === p.key ? "#000" : COLORS.muted, border: `1px solid ${filter === p.key ? COLORS.accent : COLORS.cardBorder}`, borderRadius: 20, padding: "5px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>{p.label}</button> ))}
        </div>

        {addingCustom ? (
          <div style={{ background: COLORS.card, border: `1px solid ${COLORS.accent}50`, borderRadius: 14, padding: 14, marginBottom: 16 }}>
            <input value={cName} onChange={e => setCName(e.target.value)} placeholder="Task or Class Name..." style={{ width:"100%", boxSizing:"border-box", background: `${COLORS.accent}12`, border: `1px solid ${COLORS.accent}40`, borderRadius: 8, padding: "8px 12px", color: COLORS.text, fontSize: 14, fontFamily: "inherit", outline: "none", marginBottom: 10 }} />
            <input value={cLink} onChange={e => setCLink(e.target.value)} placeholder="Link URL (optional, e.g. https://...)" style={{ width:"100%", boxSizing:"border-box", background: `${COLORS.accent}12`, border: `1px solid ${COLORS.accent}40`, borderRadius: 8, padding: "8px 12px", color: COLORS.text, fontSize: 13, fontFamily: "inherit", outline: "none", marginBottom: 10 }} />
            <div style={{ display: "flex", gap: 10 }}>
              <input type="date" value={cDate} min={today} onChange={e => setCDate(e.target.value)} style={{ flex: 1, background: `${COLORS.accent}12`, border: `1px solid ${COLORS.accent}40`, borderRadius: 8, padding: "8px 12px", color: COLORS.text, fontSize: 13, fontFamily: "inherit", outline: "none", colorScheme: "dark" }} />
              <button onClick={handleAddCustom} style={{ background: COLORS.accent, color: "#000", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>Save</button>
              <button onClick={() => setAddingCustom(false)} style={{ background: "transparent", color: COLORS.muted, border: "none", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAddingCustom(true)} style={{ width: "100%", background: "transparent", border: `1.5px dashed ${COLORS.cardBorder}`, color: COLORS.text, borderRadius: 14, padding: "12px", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 16 }}><span style={{fontSize:18,lineHeight:1}}>+</span> Add Direct Task</button>
        )}
      </div>

      <div style={{ padding: "0 16px" }}>
        {filtered.length === 0 && !addingCustom && ( <div style={{ textAlign: "center", padding: "40px 20px" }}><div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div><div style={{ fontSize: 15, fontWeight: 700, color: COLORS.text, marginBottom: 6 }}>{filter === "all" ? "No tasks scheduled" : "Nothing here!"}</div><div style={{ fontSize: 13, color: COLORS.muted }}>{filter === "all" ? "Add a direct task above to get started!" : "Switch filter to see other items"}</div></div> )}
        {filtered.sort((a, b) => { const order = { overdue: 0, today: 1, upcoming: 2, unscheduled: 3 }; return (order[categorize(a)] - order[categorize(b)]) || (a.reviseDate || "z").localeCompare(b.reviseDate || "z"); }).map(item => {
            const cat = categorize(item); const sc = statusColors[cat]; const isItem = item.type === 'custom' || item.nodeType === 'item';
            return (
              <div key={item.id} style={{ background: COLORS.card, border: `1px solid ${cat === "overdue" ? COLORS.red + "50" : cat === "today" ? COLORS.accent + "50" : COLORS.cardBorder}`, borderRadius: 14, marginBottom: 10, overflow: "hidden", borderLeft: `4px solid ${sc}` }}>
                <div style={{ padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: sc, background: `${sc}18`, padding: "2px 8px", borderRadius: 10 }}>{statusLabels[cat]}</span>
                    {item.reviseDate && ( <span style={{ fontSize: 11, color: cat === "overdue" ? COLORS.red : COLORS.muted, fontWeight: cat === "overdue" ? 700 : 400 }}>{formatDate(item.reviseDate)}</span> )}
                  </div>
                  
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                    {isItem && <div onClick={() => toggleDone(item)} style={{ width:22, height:22, borderRadius:6, flexShrink:0, cursor:"pointer", background:item.done?COLORS.green:"transparent", border:`2px solid ${item.done?COLORS.green:COLORS.cardBorder}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, color:"#fff", transition:"all 0.15s" }}>{item.done?"✓":""}</div>}
                    <div style={{ fontSize: 15, fontWeight: 700, color: item.done && isItem ? COLORS.muted : COLORS.text, textDecoration: item.done && isItem ? "line-through" : "none" }}>{item.name}</div>
                  </div>

                  <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 10, paddingLeft: isItem ? 32 : 0 }}>
                    {item.type === 'custom' ? "📌 Direct Task" : item.pathStr}
                  </div>

                  {item.links && item.links.length > 0 && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingLeft: isItem ? 32 : 0, marginBottom: 12 }}>
                      {item.links.map((link, idx) => (
                         <button key={idx} onClick={() => window.open(link, '_blank')} style={{ background: `${COLORS.blue}15`, border: `1px solid ${COLORS.blue}40`, color: COLORS.blue, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Open Link {item.links.length > 1 ? idx + 1 : ""}</button>
                      ))}
                    </div>
                  )}

                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input type="date" value={item.reviseDate || ""} onChange={e => updateDate(item, e.target.value)} style={{ flex: 1, background: `${sc}10`, border: `1px solid ${sc}40`, borderRadius: 8, padding: "6px 10px", color: COLORS.text, fontSize: 12, fontFamily: "inherit", outline: "none", colorScheme: "dark" }} />
                    <button onClick={() => clearItem(item)} style={{ background: `${COLORS.red}15`, border: `1px solid ${COLORS.red}40`, color: COLORS.red, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Remove</button>
                  </div>
                </div>
              </div>
            );
        })}
      </div>
    </div>
  );
}

// ── MAIN APP COMPONENT ───────────────────────────────────────────────────
export default function App() {
  const [activeTab, setActiveTab] = useState("home");
  const [showSettings, setShowSettings] = useState(false);

  const [examMode, setExamMode] = useState(() => { try { return localStorage.getItem("crackit_examMode") || "ssc"; } catch { return "ssc"; } });
  const [exams, setExams] = useState(() => { try { const stored = localStorage.getItem("crackit_exams"); return stored ? JSON.parse(stored) : DEFAULT_EXAMS; } catch { return DEFAULT_EXAMS; } });
  const [customTasks, setCustomTasks] = useState(() => { try { const stored = localStorage.getItem("crackit_customTasks"); return stored ? JSON.parse(stored) : []; } catch { return []; } });
  
  const [sscSyllabus, setSscSyllabus] = useState(() => { try { const stored = localStorage.getItem("crackit_sscSyllabus"); return stored ? migrateToTree(JSON.parse(stored)) : []; } catch { return []; } });
  const [bankSyllabus, setBankSyllabus] = useState(() => { try { const stored = localStorage.getItem("crackit_bankSyllabus"); return stored ? migrateToTree(JSON.parse(stored)) : []; } catch { return []; } });
  
  const activeTabRef = useRef(activeTab); useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
  
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let listener; const setup = async () => { listener = await CapApp.addListener('backButton', () => { for (let i = backButtonListeners.length - 1; i >= 0; i--) { if (backButtonListeners[i]()) return; } CapApp.minimizeApp(); }); };
    setup(); return () => { if (listener) listener.remove(); };
  }, []);
  
  useEffect(() => { const handleBack = () => { if (showSettings) { setShowSettings(false); return true; } if (activeTabRef.current !== 'home') { setActiveTab('home'); return true; } return false; }; addBackListener(handleBack); return () => removeBackListener(handleBack); }, [showSettings]);
  useEffect(() => { try { localStorage.setItem("crackit_examMode", examMode); } catch {} }, [examMode]);
  useEffect(() => { try { localStorage.setItem("crackit_exams", JSON.stringify(exams)); } catch {} }, [exams]);
  useEffect(() => { try { localStorage.setItem("crackit_sscSyllabus", JSON.stringify(sscSyllabus)); } catch {} }, [sscSyllabus]);
  useEffect(() => { try { localStorage.setItem("crackit_bankSyllabus", JSON.stringify(bankSyllabus)); } catch {} }, [bankSyllabus]);
  useEffect(() => { try { localStorage.setItem("crackit_customTasks", JSON.stringify(customTasks)); } catch {} }, [customTasks]);

  const mode = EXAM_MODES[examMode]; const accent = mode.accent;
  const syllabus = examMode === "ssc" ? sscSyllabus : bankSyllabus;
  const setSyllabus = examMode === "ssc" ? setSscSyllabus : setBankSyllabus;
  
  const getExportDataString = () => JSON.stringify({ sscSyllabus, bankSyllabus, exams, examMode, customTasks });
  
  const handleImport = (text) => {
    try {
      const data = JSON.parse(text);
      let importedSsc = data.sscSyllabus ? migrateToTree(data.sscSyllabus) : sscSyllabus;
      let importedBank = data.bankSyllabus ? migrateToTree(data.bankSyllabus) : bankSyllabus;
      
      if (data.lucentGK || data.lucentSyllabus) {
        const lucent = migrateToTree(data.lucentGK || data.lucentSyllabus);
        const lucentTopics = lucent.map(s => ({ ...s, nodeType: 'topic' }));
        const gaIndex = importedSsc.findIndex(s => s.name.toLowerCase().includes("ga") || s.name.toLowerCase().includes("general awareness"));
        if (gaIndex !== -1) {
          importedSsc[gaIndex].name = "General Awareness & GK";
          importedSsc[gaIndex].children = [...lucentTopics, ...(importedSsc[gaIndex].children || [])];
        } else {
          importedSsc.push({ id: uid(), name: "General Awareness & GK", nodeType: "subject", done: false, revise: false, reviseDate: null, links: [], children: lucentTopics });
        }
      }

      setSscSyllabus(importedSsc);
      setBankSyllabus(importedBank);
      if (data.exams) setExams(data.exams);
      if (data.examMode && EXAM_MODES[data.examMode]) setExamMode(data.examMode);
      if (data.customTasks) setCustomTasks(data.customTasks);
      
      setShowSettings(false); 
      alert("Progress restored successfully! 🎉");
    } catch (e) { 
      alert("Error: The file/text you provided is not valid backup data.");
    }
  };

  const allReminders = [...getReviseItems(syllabus), ...customTasks];
  const today = new Date().toISOString().slice(0, 10);
  const dueTodayCount = allReminders.filter(i => i.reviseDate && i.reviseDate <= today && !i.done).length;
  
  const renderTab = () => {
    switch (activeTab) {
      case "home":     return <HomeTab syllabus={syllabus} exams={exams} setExams={setExams} />;
      case "syllabus": return <SyllabusTab key={examMode} syllabus={syllabus} setSyllabus={setSyllabus} accent={accent} />;
      case "reminders": return <RemindersTab items={allReminders} setSyllabus={setSyllabus} setCustomTasks={setCustomTasks} today={today} />;
      default: return null;
    }
  };

  return (
    <div style={{ maxWidth: 430, margin: "0 auto", background: COLORS.bg, height: "100dvh", position: "relative", fontFamily: "'Segoe UI', system-ui, sans-serif", color: COLORS.text, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        button { transition: all 0.1s ease; }
        button:active { transform: scale(0.96); }
      `}</style>
      
      <div style={{ flexShrink: 0, background: `linear-gradient(to bottom, ${COLORS.card}, ${COLORS.bg})`, borderBottom: `1px solid ${COLORS.cardBorder}`, padding: "36px 20px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", boxShadow: "0 4px 20px rgba(0,0,0,0.15)", zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 24, fontWeight: 900, color: accent, letterSpacing: 1 }}>CRACK</span>
          <span style={{ fontSize: 24, fontWeight: 900, color: COLORS.text, letterSpacing: 1 }}>IT</span>
          <span style={{ fontSize: 11, fontWeight: 800, background: `${accent}22`, color: accent, padding: "4px 8px", borderRadius: 8, letterSpacing: 1, marginLeft: 6 }}>{mode.tag}</span>
        </div>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <div style={{ display: "flex", background: COLORS.bg, border: `1px solid ${COLORS.cardBorder}`, borderRadius: 20, padding: 4, gap: 2 }}>
            {Object.entries(EXAM_MODES).map(([key, m]) => (
              <button key={key} onClick={() => setExamMode(key)} style={{ background: examMode === key ? m.accent : "transparent", color: examMode === key ? "#000" : COLORS.muted, border: "none", borderRadius: 16, padding: "5px 12px", fontSize: 11, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap", transition: "all 0.2s" }}>{m.label}</button>
            ))}
          </div>
          <button onClick={() => setShowSettings(true)} style={{ background:"transparent", border:"none", fontSize: 22, cursor:"pointer", padding:0 }}>⚙️</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", position: "relative" }}>
        {renderTab()}
      </div>

      <div style={{ flexShrink: 0, background: COLORS.card, borderTop: `1px solid ${COLORS.cardBorder}`, display: "flex", padding: "6px 0 16px", zIndex: 10 }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, background: "none", border: "none", cursor: "pointer", padding: "6px 0", position: "relative" }}>
            <div style={{ fontSize: 18, transition: "transform 0.2s", transform: activeTab === tab.id ? "scale(1.2)" : "scale(1)" }}>{tab.icon}</div>
            {tab.id === "reminders" && dueTodayCount > 0 && ( <div style={{ position: "absolute", top: 2, right: "18%", background: COLORS.red, color: "#fff", borderRadius: "50%", width: 16, height: 16, fontSize: 9, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", border: `2px solid ${COLORS.card}` }}>{dueTodayCount}</div> )}
            <div style={{ fontSize: 10, fontWeight: activeTab === tab.id ? 700 : 500, color: activeTab === tab.id ? accent : COLORS.muted }}>{tab.label}</div>
            {activeTab === tab.id && ( <div style={{ width: 4, height: 4, borderRadius: "50%", background: accent, marginTop: 1 }} /> )}
          </button>
        ))}
      </div>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} dataStr={getExportDataString()} onImport={handleImport} />}
    </div>
  );
}
