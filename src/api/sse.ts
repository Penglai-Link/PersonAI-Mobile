export interface SseFrame {
  event: string;
  data: string;
}

function findFrameBoundary(value: string): { index: number; length: number } | null {
  const lf = value.indexOf("\n\n");
  const crlf = value.indexOf("\r\n\r\n");
  if (lf < 0 && crlf < 0) return null;
  if (lf < 0) return { index: crlf, length: 4 };
  if (crlf < 0) return { index: lf, length: 2 };
  return lf < crlf
    ? { index: lf, length: 2 }
    : { index: crlf, length: 4 };
}

/** Extracts complete SSE frames from a text buffer, returning the unparsed tail. */
export function extractSseFrames(buffer: string): {
  frames: SseFrame[];
  rest: string;
} {
  const frames: SseFrame[] = [];
  let rest = buffer;

  for (;;) {
    const boundary = findFrameBoundary(rest);
    if (!boundary) break;
    const rawFrame = rest.slice(0, boundary.index);
    rest = rest.slice(boundary.index + boundary.length);
    const frame = parseSseFrame(rawFrame);
    if (frame) frames.push(frame);
  }

  return { frames, rest };
}

export function parseSseFrame(rawFrame: string): SseFrame | null {
  let event = "";
  const dataLines: string[] = [];

  for (const line of rawFrame.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (!dataLines.length) return null;
  return { event, data: dataLines.join("\n") };
}