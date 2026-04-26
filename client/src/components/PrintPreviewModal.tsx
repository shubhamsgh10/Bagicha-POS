import { X, Printer } from "lucide-react";

export interface PrintPreview {
  title: string;
  lines: string[];
  width?: number;
}

export function PrintPreviewModal({ preview, onClose }: {
  preview: PrintPreview;
  onClose: () => void;
}) {
  const charWidth = preview.width ?? 32;
  // Each monospace char ≈ 7.5px at text-[11px], add padding
  const pxWidth = Math.min(charWidth * 7.8 + 24, 420);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex flex-col rounded-xl shadow-2xl overflow-hidden"
        style={{ width: pxWidth, maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-gray-800 shrink-0">
          <div className="flex items-center gap-2">
            <Printer className="w-3.5 h-3.5 text-gray-400" />
            <div>
              <p className="text-xs font-semibold text-white leading-tight">{preview.title}</p>
              <p className="text-[10px] text-amber-400 leading-tight">Preview — configure printer in Settings</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-1 rounded">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Receipt paper */}
        <div className="flex-1 overflow-y-auto bg-white">
          <div
            className="px-3 pt-4 pb-2 font-mono text-gray-900 overflow-x-hidden"
            style={{ fontSize: 11, lineHeight: '1.55', whiteSpace: 'pre' }}
          >
            {preview.lines.map((line, i) => (
              <div key={i}>{line || ' '}</div>
            ))}
          </div>

          {/* Perforated tear line */}
          <div className="mx-3 my-3 flex gap-[3px] items-center">
            {Array.from({ length: Math.floor(charWidth * 0.9) }).map((_, i) => (
              <div key={i} className="flex-1 h-[2px] rounded-full bg-gray-200" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
