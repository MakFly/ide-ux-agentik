import type { ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useIDE, type Theme } from "@/store/ide";

function Row({ label, hint, control }: { label: string; hint?: string; control: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <div className="text-[13px] text-foreground">{label}</div>
        {hint && <div className="text-[11.5px] text-muted-foreground">{hint}</div>}
      </div>
      {control}
    </div>
  );
}

export function SettingsSheet({ children }: { children: ReactNode }) {
  const theme = useIDE((s) => s.theme);
  const setTheme = useIDE((s) => s.setTheme);
  const showSidebar = useIDE((s) => s.showSidebar);
  const toggleSidebar = useIDE((s) => s.toggleSidebar);
  const showFiles = useIDE((s) => s.showFiles);
  const toggleFiles = useIDE((s) => s.toggleFiles);
  const thinking = useIDE((s) => s.thinking);
  const toggleThinking = useIDE((s) => s.toggleThinking);
  const filesTab = useIDE((s) => s.filesTab);
  const setFilesTab = useIDE((s) => s.setFilesTab);

  return (
    <Sheet>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent side="right" className="w-[340px] sm:w-[380px]">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>Tweak appearance, layout, and AI behavior.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4 py-2">
          <section>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Appearance
            </h3>
            <Row
              label="Dark mode"
              hint="Apply the app-wide dark or light theme"
              control={
                <Switch
                  checked={theme === "dark"}
                  onCheckedChange={(v) => setTheme(v ? "dark" : ("light" as Theme))}
                />
              }
            />
          </section>

          <Separator />

          <section>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Layout
            </h3>
            <Row
              label="Show sidebar"
              control={<Switch checked={showSidebar} onCheckedChange={() => toggleSidebar()} />}
            />
            <Row
              label="Show files panel"
              control={<Switch checked={showFiles} onCheckedChange={() => toggleFiles()} />}
            />
            <Row
              label="Default files tab"
              control={
                <Select value={filesTab} onValueChange={(v) => setFilesTab(v as typeof filesTab)}>
                  <SelectTrigger className="h-8 w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="files">Files</SelectItem>
                    <SelectItem value="changes">Changes</SelectItem>
                    <SelectItem value="checks">Checks</SelectItem>
                  </SelectContent>
                </Select>
              }
            />
          </section>

          <Separator />

          <section>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              AI
            </h3>
            <Row
              label="Thinking mode"
              hint="Show internal reasoning in chat"
              control={<Switch checked={thinking} onCheckedChange={() => toggleThinking()} />}
            />
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
