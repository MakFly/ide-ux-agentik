export function AnthropicApiKeyBlock() {
  return (
    <div className="mt-3 border-t border-border pt-3 text-[11.5px] text-muted-foreground">
      Auth handled entirely on the agent host via <code className="font-mono">claude login</code>.
      Credentials live at <code className="font-mono">~/.claude/.credentials.json</code>.
    </div>
  );
}
