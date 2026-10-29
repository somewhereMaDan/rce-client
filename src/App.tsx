import Editor from "@monaco-editor/react";
import { useState, useRef, useCallback, useEffect } from "react";
import { Client } from "@stomp/stompjs";
import SockJS from "sockjs-client";

const SOCKJS_URL = "http://localhost:8080/ws";

type Language = "python" | "java" | "cpp";

interface LangConfig {
    label: string;
    ext: string;
    monacoLang: string;
    color: string;
    glow: string;
    defaultCode: string;
}

const LANGS: Record<Language, LangConfig> = {
    python: {
        label: "Python",
        ext: ".py",
        monacoLang: "python",
        color: "#4A9EFF",
        glow: "rgba(74,158,255,0.25)",
        defaultCode: `def solution(nums: list[int]) -> int:\n    # Write your solution here\n    pass\n\n# Example usage\nprint(solution([1, 2, 3]))`,
    },
    java: {
        label: "Java",
        ext: ".java",
        monacoLang: "java",
        color: "#FF9F43",
        glow: "rgba(255,159,67,0.25)",
        defaultCode: `public class Main {\n    public int solve(int[] nums) {\n        // Write your solution here\n        return 0;\n    }\n\n    public static void main(String[] args) {\n        Main s = new Main();\n        System.out.println(s.solve(new int[]{1, 2, 3}));\n    }\n}`,
    },
    cpp: {
        label: "C++",
        ext: ".cpp",
        monacoLang: "cpp",
        color: "#A78BFA",
        glow: "rgba(167,139,250,0.25)",
        defaultCode: `#include <bits/stdc++.h>\nusing namespace std;\n\nint solution(vector<int>& nums) {\n    // Write your solution here\n    return 0;\n}\n\nint main() {\n    vector<int> nums = {1, 2, 3};\n    cout << solution(nums) << endl;\n    return 0;\n}`,
    },
};

type OutputStatus = "idle" | "queued" | "running" | "success" | "error";
interface OutputLine { text: string; type: "stdout" | "stderr" | "system" | "stdin"; }

interface IncomingMessage {
    type: "stdout" | "stderr" | "queued" | "error" | "exit";
    data?: string;
    code?: number;
    cpuTime?: number;
}

const QUEUED_COLOR = "#F5A623";

export default function App() {
    const [lang, setLang] = useState<Language>("python");
    const [code, setCode] = useState(LANGS["python"].defaultCode);
    const [stdin, setStdin] = useState("");
    const [status, setStatus] = useState<OutputStatus>("idle");
    const [queueMessage, setQueueMessage] = useState("");
    const [outputLines, setOutputLines] = useState<OutputLine[]>([
        { text: "// Output will appear here after running your code", type: "system" },
    ]);
    const [panelWidth, setPanelWidth] = useState(55);
    const [runTime, setRunTime] = useState<number | null>(null);
    const [connected, setConnected] = useState(false);
    const isDragging = useRef(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const stompClientRef = useRef<Client | null>(null);

    // Generated once per user session (not per run, not per page reload within this mount).
    const sessionIdRef = useRef<string>(crypto.randomUUID());

    const cfg = LANGS[lang];
    const isBusy = status === "queued" || status === "running";

    const handleLangChange = (l: Language) => {
        if (isBusy) return; // avoid switching languages mid-run and confusing the active session
        setLang(l);
        setCode(LANGS[l].defaultCode);
        setStatus("idle");
        setOutputLines([{ text: "// Output will appear here after running your code", type: "system" }]);
        setRunTime(null);
    };

    useEffect(() => {
        const client = new Client({
            webSocketFactory: () => new SockJS(SOCKJS_URL) as unknown as WebSocket,
            reconnectDelay: 5000,
            debug: () => { },
            onConnect: () => {
                setConnected(true);
                client.subscribe(`/topic/output/${sessionIdRef.current}`, (message) => {
                    let msg: IncomingMessage;
                    try {
                        msg = JSON.parse(message.body);
                    } catch {
                        return;
                    }

                    console.log("receiving msg from websocket: ", msg);


                    switch (msg.type) {
                        case "queued": {
                            const text = msg.data ?? "Queued";
                            setStatus("queued");
                            setQueueMessage(text);
                            setOutputLines((prev) => [...prev, { text: `// ${text}`, type: "system" }]);
                            break;
                        }
                        case "error": {
                            setOutputLines((prev) => [...prev, { text: msg.data ?? "Unknown error", type: "stderr" }]);
                            setStatus("error");
                            break;
                        }
                        case "stdout": {
                            setOutputLines((prev) => [...prev, { text: msg.data ?? "", type: "stdout" }]);
                            setStatus("running");
                            break;
                        }
                        case "stderr": {
                            setOutputLines((prev) => [...prev, { text: msg.data ?? "", type: "stderr" }]);
                            setStatus("error");
                            break;
                        }
                        case "exit": {
                            setStatus(msg.code === 0 ? "success" : "error");
                            setRunTime(typeof msg.cpuTime === "number" ? msg.cpuTime : null);
                            break;
                        }
                    }
                });
            },
            onDisconnect: () => setConnected(false),
            onStompError: () => setConnected(false),
            onWebSocketClose: () => setConnected(false),
        });

        client.activate();
        stompClientRef.current = client;

        return () => {
            client.deactivate();
        };
    }, []);

    const handleRun = () => {
        if (!code.trim() || isBusy) return;
        const client = stompClientRef.current;
        if (!client || !client.connected) return;

        setStatus("queued");
        setQueueMessage("Queued");
        setRunTime(null);
        setOutputLines(stdin.trim() ? [{ text: stdin, type: "stdin" }] : []);

        client.publish({
            destination: "/app/run",
            body: JSON.stringify({
                sessionId: sessionIdRef.current,
                lang,
                code,
                inputString: stdin,
            }),
        });
    };

    const handleClear = () => {
        setOutputLines([{ text: "// Output cleared", type: "system" }]);
        setStatus("idle");
        setRunTime(null);
    };

    const handleCopy = () => navigator.clipboard.writeText(code);

    const startDrag = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isDragging.current = true;
        const onMove = (me: MouseEvent) => {
            if (!containerRef.current || !isDragging.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            const pct = ((me.clientX - rect.left) / rect.width) * 100;
            setPanelWidth(Math.min(Math.max(pct, 25), 75));
        };
        const onUp = () => {
            isDragging.current = false;
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    }, []);

    const statusColor =
        status === "success" ? "#34D399"
            : status === "error" ? "#F87171"
                : status === "queued" ? QUEUED_COLOR
                    : status === "running" ? cfg.color
                        : "#374151";

    const statusLabel =
        status === "success" ? "Success"
            : status === "error" ? "Error"
                : status === "queued" ? (queueMessage || "Queued")
                    : status === "running" ? "Running…"
                        : connected ? "Ready" : "Connecting…";

    return (
        <div style={s.root}>
            <div style={{ ...s.ambient, background: `radial-gradient(700px circle at 15% 60%, ${cfg.glow}, transparent 65%)` }} />

            {/* Topbar */}
            <header style={s.topbar}>
                <div style={s.topLeft}>
                    <div style={s.brand}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                            <path d="M8 6L3 12L8 18" stroke={cfg.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M16 6L21 12L16 18" stroke={cfg.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M14 4L10 20" stroke={cfg.color} strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                        <span style={s.brandText}>CodeSubmit</span>
                    </div>
                    <div style={s.divBar} />
                    <div style={s.langTabs}>
                        {(Object.entries(LANGS) as [Language, LangConfig][]).map(([l, c]) => (
                            <button key={l} onClick={() => handleLangChange(l)} disabled={isBusy} style={{
                                ...s.langTab,
                                color: lang === l ? c.color : "#4B5563",
                                borderBottomColor: lang === l ? c.color : "transparent",
                                cursor: isBusy ? "not-allowed" : "pointer",
                                opacity: isBusy && lang !== l ? 0.5 : 1,
                            }}>
                                <span style={{ ...s.langDot, background: lang === l ? c.color : "#2D3748" }} />
                                {c.label}
                                <span style={s.tabExt}>{c.ext}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div style={s.topRight}>
                    <div style={{ ...s.statusPill, borderColor: `${statusColor}33`, color: statusColor }}>
                        <span style={{ ...s.statusDot, background: statusColor }} />
                        {statusLabel}
                        {runTime !== null && (status === "success" || status === "error") && <span style={s.runTime}>{runTime}ms</span>}
                    </div>
                    <button onClick={handleCopy} style={s.iconBtn} title="Copy code">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" />
                            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                        </svg>
                    </button>
                    <button onClick={handleRun} disabled={isBusy || !connected} style={{
                        ...s.runBtn,
                        background: isBusy ? "rgba(255,255,255,0.04)" : `linear-gradient(135deg, ${cfg.color}, ${cfg.color}88)`,
                        boxShadow: isBusy ? "none" : `0 0 24px ${cfg.glow}, 0 2px 8px rgba(0,0,0,0.5)`,
                        cursor: isBusy || !connected ? "not-allowed" : "pointer",
                        opacity: !connected && !isBusy ? 0.5 : 1,
                    }}>
                        {isBusy ? (
                            <><span style={{ width: 13, height: 13, border: `2px solid ${statusColor}44`, borderTop: `2px solid ${statusColor}`, borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite" }} /> {status === "queued" ? "Queued" : "Running"}</>
                        ) : (
                            <><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg> Run Code</>
                        )}
                    </button>
                </div>
            </header>

            {/* Workspace */}
            <div style={s.workspace} ref={containerRef}>
                {/* Editor Pane */}
                <div style={{ ...s.pane, width: `${panelWidth}%` }}>
                    <div style={s.paneBar}>
                        <div style={s.paneTitle}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={cfg.color} strokeWidth="2" strokeLinecap="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
                            <span>Editor</span>
                        </div>
                        <div style={s.trafficLights}>
                            {["#FF5F57", "#FFBD2E", "#28C840"].map(c => <div key={c} style={{ width: 9, height: 9, borderRadius: "50%", background: c }} />)}
                        </div>
                        <span style={s.fileName}>{`main${cfg.ext}`}</span>
                    </div>
                    <div style={s.editorWrap}>
                        <Editor
                            language={cfg.monacoLang}
                            value={code}
                            onChange={(v) => setCode(v ?? "")}
                            theme="codesubmit"
                            options={{
                                fontSize: 13,
                                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                                fontLigatures: true,
                                lineHeight: 22,
                                minimap: { enabled: false },
                                scrollbar: { vertical: "auto", horizontal: "auto", verticalScrollbarSize: 5, horizontalScrollbarSize: 5 },
                                padding: { top: 16, bottom: 16 },
                                renderLineHighlight: "line",
                                lineNumbersMinChars: 3,
                                glyphMargin: false,
                                folding: true,
                                wordWrap: "off",
                                smoothScrolling: true,
                                cursorBlinking: "smooth",
                                cursorSmoothCaretAnimation: "on",
                                bracketPairColorization: { enabled: true },
                            }}
                            beforeMount={(monaco) => {
                                monaco.editor.defineTheme("codesubmit", {
                                    base: "vs-dark",
                                    inherit: true,
                                    rules: [
                                        { token: "comment", foreground: "3D4F6A", fontStyle: "italic" },
                                        { token: "keyword", foreground: cfg.color.replace("#", "") },
                                        { token: "string", foreground: "7EC8A0" },
                                        { token: "number", foreground: "E9A96E" },
                                    ],
                                    colors: {
                                        "editor.background": "#070B12",
                                        "editor.lineHighlightBackground": "#0C1220",
                                        "editorLineNumber.foreground": "#1E2D3D",
                                        "editorLineNumber.activeForeground": cfg.color,
                                        "editor.selectionBackground": `${cfg.color}28`,
                                        "editorCursor.foreground": cfg.color,
                                        "scrollbarSlider.background": "#1A2332",
                                        "scrollbarSlider.hoverBackground": "#253347",
                                    },
                                });
                            }}
                        />
                    </div>

                    {/* Stdin panel — fed to the program once, upfront, on Run. No mid-run interaction. */}
                    <div style={s.stdinSection}>
                        <div style={s.stdinBar}>
                            <span style={{ color: cfg.color }}>{'>'}</span>
                            <span style={s.paneTitle}>Input (stdin)</span>
                        </div>
                        <textarea
                            value={stdin}
                            onChange={(e) => setStdin(e.target.value)}
                            disabled={isBusy}
                            placeholder="Optional — enter stdin for your program"
                            style={s.stdinTextarea}
                        />
                    </div>
                </div>

                {/* Drag Divider */}
                <div style={s.dragDiv} onMouseDown={startDrag}>
                    <div style={{ ...s.dragLine, background: cfg.color }} />
                    <div style={s.dragHandle}>
                        <svg width="5" height="20" viewBox="0 0 5 20" fill="none">
                            {[2, 9, 16].map(y => <circle key={y} cx="2.5" cy={y} r="1.5" fill={cfg.color} opacity="0.5" />)}
                        </svg>
                    </div>
                </div>

                {/* Output Pane */}
                <div style={{ ...s.pane, flex: 1 }}>
                    <div style={s.paneBar}>
                        <div style={s.paneTitle}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={statusColor} strokeWidth="2" strokeLinecap="round"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
                            <span style={{ color: statusColor }}>Output</span>
                        </div>
                        <div style={s.paneRight}>
                            {outputLines.length > 1 && (
                                <button onClick={handleClear} style={s.clearBtn}>clear</button>
                            )}
                        </div>
                    </div>

                    <div style={s.outputWrap}>
                        <div style={s.outputScroll}>
                            <div style={s.promptRow}>
                                <span style={{ color: cfg.color }}>➜</span>
                                <span style={{ color: "#2D3748" }}>~</span>
                                <span style={{ color: "#374151" }}> ./{`main${cfg.ext}`}</span>
                            </div>

                            {outputLines.map((line, i) => (
                                <div key={i} style={{
                                    ...s.outLine,
                                    color: line.type === "stderr" ? "#F87171"
                                        : line.type === "stdin" ? cfg.color      // echoes the input that was submitted
                                            : line.type === "system" ? "#2D3748"
                                                : "#A7F3C8",
                                    fontStyle: line.type === "system" ? "italic" : "normal",
                                }}>
                                    {line.type === "stderr" && <span style={{ marginRight: 4 }}>✗</span>}
                                    {line.type === "stdin" && <span style={{ marginRight: 4, opacity: 0.5 }}>{'>'}</span>}
                                    {line.text}
                                </div>
                            ))}

                            {isBusy && (
                                <span style={{
                                    display: 'inline-block',
                                    width: 7, height: 14,
                                    background: statusColor,
                                    borderRadius: 1,
                                    animation: "blink 1.2s step-end infinite",
                                    marginTop: 4,
                                    opacity: 0.7
                                }} />
                            )}

                            {!isBusy && (
                                <span style={{
                                    display: "inline-block",
                                    width: 7, height: 14,
                                    background: status === "idle" ? cfg.color : statusColor,
                                    borderRadius: 1,
                                    animation: "blink 1.2s step-end infinite",
                                    marginTop: 4,
                                    opacity: 0.7
                                }} />
                            )}
                        </div>
                    </div>

                    <div style={s.outFooter}>
                        <span>{outputLines.filter(l => l.type === "stdout").length} lines output</span>
                        {runTime !== null && <span>{runTime < 1000 ? `${runTime}ms` : `${(runTime / 1000).toFixed(2)}s`} elapsed</span>}
                    </div>
                </div>
            </div>
        </div>
    );
}

const s: Record<string, any> = {
    root: { height: "100vh", display: "flex", flexDirection: "column", background: "#060A10", fontFamily: "'JetBrains Mono','Fira Code',monospace", overflow: "hidden", position: "relative" },
    ambient: { position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, transition: "background 0.8s ease" },
    topbar: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", height: 50, borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(6,10,16,0.95)", backdropFilter: "blur(20px)", position: "relative", zIndex: 10, flexShrink: 0 },
    topLeft: { display: "flex", alignItems: "center", gap: 16 },
    brand: { display: "flex", alignItems: "center", gap: 8 },
    brandText: { fontSize: 14, fontWeight: 700, color: "#D1D5DB", letterSpacing: "-0.3px" },
    divBar: { width: 1, height: 20, background: "rgba(255,255,255,0.08)" },
    langTabs: { display: "flex" },
    langTab: { display: "flex", alignItems: "center", gap: 6, padding: "0 14px", background: "transparent", border: "none", borderBottom: "2px solid", fontSize: 11, fontWeight: 600, fontFamily: "inherit", letterSpacing: "0.03em", transition: "all 0.2s", height: 50, marginBottom: -1 },
    langDot: { width: 6, height: 6, borderRadius: "50%", transition: "background 0.2s" },
    tabExt: { fontSize: 9, opacity: 0.35 },
    topRight: { display: "flex", alignItems: "center", gap: 8 },
    statusPill: { display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 20, border: "1px solid", fontSize: 10, fontWeight: 600, letterSpacing: "0.05em", background: "rgba(255,255,255,0.02)" },
    statusDot: { width: 5, height: 5, borderRadius: "50%" },
    runTime: { opacity: 0.4, marginLeft: 4, fontSize: 9 },
    iconBtn: { display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 7, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.03)", color: "#4B5563", cursor: "pointer", transition: "all 0.2s" },
    runBtn: { display: "flex", alignItems: "center", gap: 7, padding: "7px 15px", borderRadius: 8, border: "none", color: "#fff", fontSize: 11, fontWeight: 700, fontFamily: "inherit", letterSpacing: "0.05em", transition: "all 0.25s" },
    workspace: { display: "flex", flex: 1, overflow: "hidden", position: "relative", zIndex: 1 },
    pane: { display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 180 },
    paneBar: { display: "flex", alignItems: "center", gap: 8, padding: "0 14px", height: 36, borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.015)", flexShrink: 0 },
    paneTitle: { display: "flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 600, color: "#374151", letterSpacing: "0.07em", textTransform: "uppercase" },
    trafficLights: { display: "flex", gap: 5, marginLeft: "auto" },
    fileName: { fontSize: 9, color: "#1F2937", marginLeft: 2 },
    paneRight: { marginLeft: "auto" },
    clearBtn: { fontSize: 9, color: "#2D3748", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.05em", padding: "2px 6px", borderRadius: 3 },
    editorWrap: { flex: 1, overflow: "hidden", background: "#070B12" },
    stdinSection: { display: "flex", flexDirection: "column", height: 120, borderTop: "1px solid rgba(255,255,255,0.05)", flexShrink: 0, background: "#070B12" },
    stdinBar: { display: "flex", alignItems: "center", gap: 6, padding: "0 14px", height: 26, background: "rgba(255,255,255,0.015)", flexShrink: 0 },
    stdinTextarea: { flex: 1, background: "#070B12", border: "none", outline: "none", resize: "none", color: "#D1D5DB", fontFamily: "inherit", fontSize: 12, lineHeight: "18px", padding: "8px 14px" },
    dragDiv: { width: 10, cursor: "col-resize", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexShrink: 0, position: "relative", zIndex: 5 },
    dragLine: { position: "absolute", top: 0, bottom: 0, width: 1, opacity: 0.12, left: "50%", transform: "translateX(-50%)" },
    dragHandle: { width: 16, height: 28, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", zIndex: 1 },
    outputWrap: { flex: 1, overflow: "hidden", background: "#050810", position: "relative" },
    outputScroll: { height: "100%", overflowY: "auto", padding: "14px 18px", boxSizing: "border-box" as const },
    promptRow: { display: "flex", gap: 6, fontSize: 11, marginBottom: 10, opacity: 0.6 },
    outLine: { fontSize: 12, lineHeight: "19px", fontFamily: "inherit", whiteSpace: "pre-wrap" as const, wordBreak: "break-word" as const },
    outFooter: { display: "flex", justifyContent: "space-between", padding: "4px 14px", borderTop: "1px solid rgba(255,255,255,0.04)", fontSize: 9, color: "#1F2937", letterSpacing: "0.05em", background: "rgba(255,255,255,0.01)", flexShrink: 0 },
};

if (typeof document !== "undefined") {
    const style = document.createElement("style");
    style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    html,body,#root{height:100%;overflow:hidden}
    body{background:#060A10}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
    ::-webkit-scrollbar{width:5px;height:5px}
    ::-webkit-scrollbar-track{background:transparent}
    ::-webkit-scrollbar-thumb{background:#1A2332;border-radius:3px}
    ::-webkit-scrollbar-thumb:hover{background:#253347}
    button:hover:not(:disabled){filter:brightness(1.2)}
    button:disabled{filter:none}
  `;
    document.head.appendChild(style);
}