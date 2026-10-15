// Parseur minimal de "markdown léger" pour afficher les réponses du Conseiller IA :
// titres (##/###), listes à puces, listes numérotées, paragraphes et **gras**.
export type RichBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "ordered"; items: string[] };

export interface BoldSegment {
  bold: boolean;
  text: string;
}

/** Découpe un texte en segments normaux / gras (**...**). */
export const splitBoldSegments = (text: string): BoldSegment[] => {
  const source = text || "";
  const segments: BoldSegment[] = [];
  const regex = /\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(source)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ bold: false, text: source.slice(lastIndex, match.index) });
    }
    segments.push({ bold: true, text: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < source.length) {
    segments.push({ bold: false, text: source.slice(lastIndex) });
  }
  return segments.length > 0 ? segments : [{ bold: false, text: source }];
};

export const parseRichText = (input: string): RichBlock[] => {
  const lines = (input || "").replace(/\r\n/g, "\n").split("\n");
  const blocks: RichBlock[] = [];
  let paragraph: string[] = [];
  let list: { type: "bullets" | "ordered"; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push(
        list.type === "bullets"
          ? { type: "bullets", items: list.items }
          : { type: "ordered", items: list.items },
      );
      list = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        type: "heading",
        level: Math.min(4, Math.max(2, heading[1].length)),
        text: heading[2].trim(),
      });
      continue;
    }

    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      if (!list || list.type !== "bullets") {
        flushList();
        list = { type: "bullets", items: [] };
      }
      list.items.push(bullet[1].trim());
      continue;
    }

    const ordered = line.match(/^\d+[.)]\s+(.*)$/);
    if (ordered) {
      flushParagraph();
      if (!list || list.type !== "ordered") {
        flushList();
        list = { type: "ordered", items: [] };
      }
      list.items.push(ordered[1].trim());
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
};
