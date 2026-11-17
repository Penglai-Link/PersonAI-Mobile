/**
 * Prepares assistant Markdown for the React Native chat bubble.
 *
 * The shared Markdown renderer puts GFM tables and fenced code inside a
 * horizontal `ScrollView`. On Android that nested scroll view can measure as
 * the full viewport height, so one table or code block leaves a screen-sized
 * blank bubble and locks the message list before the messages that follow it.
 * Rendering tables as lists and code as quotes keeps the content without that
 * layout hazard.
 *
 * Only assistant output goes through this transform; user text is shown
 * verbatim.
 */
const TABLE_SEPARATOR = /^:?-{3,}:?$/;

function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|")) text = text.slice(0, -1);

  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\\" && text[index + 1] === "|") {
      current += "|";
      index += 1;
      continue;
    }
    if (character === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  cells.push(current.trim());
  return cells;
}

function isSeparator(line: string): boolean {
  const cells = splitRow(line);
  return (
    cells.length >= 2 && cells.every((cell) => TABLE_SEPARATOR.test(cell))
  );
}


export function formatChatMarkdown(content: string): string {
  const lines = content.split(/\r?\n/);
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    // Fenced code uses the same nested horizontal ScrollView as tables. A
    // blockquote keeps the source verbatim without the broken measurement.
    const fence = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      const marker = fence[1][0];
      const body: string[] = [];
      let next = index + 1;
      const closing = new RegExp(`^\\s*${marker}{3,}\\s*$`);
      while (next < lines.length) {
        if (closing.test(lines[next])) {
          next += 1;
          break;
        }
        body.push(lines[next]);
        next += 1;
      }
      if (body.length > 0) {
        for (const codeLine of body) {
          output.push(codeLine.trim() ? `> ${codeLine}` : ">");
        }
        if (next < lines.length && lines[next].trim() !== "") output.push("");
      }
      index = next - 1;
      continue;
    }

    const separator = lines[index + 1];
    if (
      !line.includes("|") ||
      separator === undefined ||
      !isSeparator(separator)
    ) {
      output.push(line);
      continue;
    }

    const header = splitRow(line);
    const rows: string[][] = [];
    let next = index + 2;
    while (next < lines.length) {
      const row = lines[next];
      if (!row.includes("|") || row.trim() === "") break;
      const cells = splitRow(row);
      if (cells.length < 2) break;
      rows.push(cells);
      next += 1;
    }

    if (rows.length === 0) {
      output.push(line);
      continue;
    }

    if (header.length <= 2 && rows.every((row) => row.length <= 2)) {
      if (header.length === 2 && header[0] && header[1]) {
        output.push(`**${header[0]} / ${header[1]}**`);
      }
      for (const row of rows) {
        const key = row[0] ?? "";
        const value = row[1] ?? "";
        if (key && value) output.push(`- **${key}**: ${value}`);
        else if (key || value) output.push(`- ${key || value}`);
      }
    } else {
      // Wide tables keep their column order inside the same quote form.
      for (const row of [header, ...rows]) {
        output.push(`> ${row.join(" | ")}`);
      }
    }

    // Keep the paragraph after a table separated from the generated list.
    if (next < lines.length && lines[next].trim() !== "") output.push("");
    index = next - 1;
  }

  return output.join("\n");
}