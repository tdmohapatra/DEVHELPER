/** Parse .NET / Java / JavaScript stack traces into a structured, simplified view. */

export interface StackFrame {
  raw: string;
  method: string;
  file?: string;
  line?: number;
  isUserCode: boolean;
}

export interface ParsedStackTrace {
  exceptionType: string;
  message: string;
  frames: StackFrame[];
  inner: { exceptionType: string; message: string }[];
}

const FRAMEWORK_HINTS = ["System.", "Microsoft.", "java.", "javax.", "jdk.", "sun.", "node:internal", "node_modules"];

function isUserCode(text: string): boolean {
  return !FRAMEWORK_HINTS.some((h) => text.includes(h));
}

function parseFrame(line: string): StackFrame | null {
  const raw = line.trim();
  if (!/^at\s/.test(raw) && !raw.startsWith("at ")) return null;

  // .NET: at NS.Class.Method(args) in C:\path\File.cs:line 42
  const net = raw.match(/^at\s+(.+?)\s+in\s+(.+):line\s+(\d+)/);
  if (net) return { raw, method: net[1], file: net[2], line: Number(net[3]), isUserCode: isUserCode(raw) };

  // Java: at com.example.Class.method(File.java:42)
  const java = raw.match(/^at\s+(.+?)\((.+?):(\d+)\)/);
  if (java) return { raw, method: java[1], file: java[2], line: Number(java[3]), isUserCode: isUserCode(raw) };

  // JS: at func (/path/file.js:12:5)  |  at /path/file.js:12:5
  const js = raw.match(/^at\s+(?:(.+?)\s+)?\(?(.+?):(\d+):(\d+)\)?$/);
  if (js) return { raw, method: js[1] ?? "(anonymous)", file: js[2], line: Number(js[3]), isUserCode: isUserCode(raw) };

  return { raw, method: raw.replace(/^at\s+/, ""), isUserCode: isUserCode(raw) };
}

function parseHeader(line: string): { exceptionType: string; message: string } | null {
  // "System.NullReferenceException: Object reference not set..."
  const m = line.match(/^([\w.$]+(?:Exception|Error)[\w.$]*)\s*:\s*(.*)$/);
  if (m) return { exceptionType: m[1], message: m[2].trim() };
  // Bare "TypeError: msg"
  const m2 = line.match(/^([A-Z]\w*(?:Error|Exception))\s*:\s*(.*)$/);
  if (m2) return { exceptionType: m2[1], message: m2[2].trim() };
  return null;
}

export function parseStackTrace(input: string): ParsedStackTrace {
  const lines = input.split(/\r?\n/).map((l) => l.trimEnd());
  let exceptionType = "";
  let message = "";
  const frames: StackFrame[] = [];
  const inner: { exceptionType: string; message: string }[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Inner / caused-by markers.
    const innerMarker = trimmed.match(/^(?:--->|Caused by:)\s*(.*)$/);
    if (innerMarker) {
      const h = parseHeader(innerMarker[1]);
      if (h) inner.push(h);
      continue;
    }

    const frame = parseFrame(trimmed);
    if (frame) {
      frames.push(frame);
      continue;
    }

    const header = parseHeader(trimmed);
    if (header && !exceptionType) {
      exceptionType = header.exceptionType;
      message = header.message;
    }
  }

  return { exceptionType, message, frames, inner };
}

/** The first user-code frame is usually the most useful root location. */
export function rootFrame(parsed: ParsedStackTrace): StackFrame | undefined {
  return parsed.frames.find((f) => f.isUserCode) ?? parsed.frames[0];
}
