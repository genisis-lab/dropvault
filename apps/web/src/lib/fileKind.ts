import {
  Archive,
  FileText,
  Film,
  Image as ImageIcon,
  Music,
  type LucideIcon,
} from "lucide-react";

export type FileKind = "doc" | "image" | "video" | "audio" | "pdf" | "archive";

// File-type icon colours follow Drive's: blue documents, red PDFs and images,
// green audio, grey archives.
export const KIND_TINT: Record<FileKind, string> = {
  doc: "text-[#4285f4]",
  image: "text-[#ea4335]",
  video: "text-[#ea4335]",
  audio: "text-[#34a853]",
  pdf: "text-[#ea4335]",
  archive: "text-[#5f6368] dark:text-[#c4c7c5]",
};

export function fileKind(type: string | null): {
  Icon: LucideIcon;
  kind: FileKind;
  tint: string;
} {
  const t = (type || "").toLowerCase();
  const pick = (Icon: LucideIcon, kind: FileKind) => ({
    Icon,
    kind,
    tint: KIND_TINT[kind],
  });
  if (t.startsWith("image/")) return pick(ImageIcon, "image");
  if (t.startsWith("video/")) return pick(Film, "video");
  if (t.startsWith("audio/")) return pick(Music, "audio");
  if (t.includes("pdf")) return pick(FileText, "pdf");
  if (t.includes("zip") || t.includes("compressed") || t.includes("tar"))
    return pick(Archive, "archive");
  return pick(FileText, "doc");
}
