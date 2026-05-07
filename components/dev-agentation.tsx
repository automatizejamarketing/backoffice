"use client";

import { Agentation } from "agentation";

function copyWithTextArea(output: string) {
  const textArea = document.createElement("textarea");
  textArea.value = output;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.left = "0";
  textArea.style.top = "0";
  textArea.style.opacity = "0";

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textArea);
  }
}

async function copyAgentationOutput(output: string) {
  try {
    if (copyWithTextArea(output)) {
      console.info("[agentation] Output copied with textarea fallback");
      return;
    }
  } catch (error) {
    console.warn("[agentation] Textarea fallback failed", error);
  }

  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(output);
      console.info("[agentation] Output copied with Clipboard API");
      return;
    }
  } catch (error) {
    console.warn("[agentation] Clipboard API failed", error);
  }

  console.warn("[agentation] Could not copy output");
}

export function DevAgentation() {
  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  return (
    <Agentation
      copyToClipboard={false}
      onCopy={(output) => {
        void copyAgentationOutput(output);
      }}
      onSubmit={(output) => {
        void copyAgentationOutput(output);
      }}
    />
  );
}
