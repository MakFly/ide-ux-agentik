export function GeminiApiKeyBlock() {
  return (
    <div className="mt-3 border-t border-border pt-3 text-[11.5px] text-muted-foreground">
      Set <code className="font-mono">GEMINI_API_KEY</code> (or <code>GOOGLE_API_KEY</code>) in the
      agent host environment, or run{" "}
      <code className="font-mono">gcloud auth application-default login</code>.
    </div>
  );
}
