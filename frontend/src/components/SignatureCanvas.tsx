"use client";

import { useRef, useState, useCallback } from "react";
import SignaturePad from "react-signature-canvas";

interface SignatureCanvasProps {
  onConfirm: (signatureDataUrl: string) => void;
  onClear?: () => void;
  width?: number;
  height?: number;
}

export default function SignatureCanvas({
  onConfirm,
  onClear,
  width = 500,
  height = 200,
}: SignatureCanvasProps) {
  const sigPadRef = useRef<SignaturePad>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const [confirmed, setConfirmed] = useState(false);

  const handleClear = useCallback(() => {
    sigPadRef.current?.clear();
    setIsEmpty(true);
    setConfirmed(false);
    onClear?.();
  }, [onClear]);

  const handleConfirm = useCallback(() => {
    if (!sigPadRef.current || sigPadRef.current.isEmpty()) return;

    // PNG形式で署名画像を取得
    const dataUrl = sigPadRef.current.getTrimmedCanvas().toDataURL("image/png");
    setConfirmed(true);
    onConfirm(dataUrl);
  }, [onConfirm]);

  const handleEnd = useCallback(() => {
    setIsEmpty(sigPadRef.current?.isEmpty() ?? true);
    setConfirmed(false);
  }, []);

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-gray-700 mb-2">
        署名をここに描いてください
      </div>

      <div
        className={`border-2 rounded-lg overflow-hidden transition-colors ${
          confirmed
            ? "border-green-500 bg-green-50"
            : "border-dashed border-gray-400 bg-white hover:border-blue-400"
        }`}
        style={{ width, height }}
      >
        <SignaturePad
          ref={sigPadRef}
          canvasProps={{
            width,
            height,
            className: "w-full h-full",
            style: { touchAction: "none" },
          }}
          onEnd={handleEnd}
          penColor="#1a56db"
          minWidth={1.5}
          maxWidth={3}
          velocityFilterWeight={0.7}
          backgroundColor="transparent"
        />
      </div>

      {/* 操作ボタン */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleClear}
          className="btn-secondary flex items-center gap-1.5 text-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          クリア
        </button>

        <button
          type="button"
          onClick={handleConfirm}
          disabled={isEmpty || confirmed}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
            confirmed
              ? "bg-green-100 text-green-700 cursor-default"
              : "btn-primary"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {confirmed ? (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              署名確定済み
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              この署名で確定する
            </>
          )}
        </button>
      </div>

      <p className="text-xs text-gray-400">
        ※ 確定した署名は暗号学的ハッシュで保護され、Cloud KMSによる電子署名が付与されます
      </p>
    </div>
  );
}
