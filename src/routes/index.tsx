import { createFileRoute } from "@tanstack/react-router";
import { TitleBar } from "@/components/ide/TitleBar";
import { Sidebar } from "@/components/ide/Sidebar";
import { Workspace } from "@/components/ide/Workspace";
import { FilesPanel } from "@/components/ide/FilesPanel";
import { StatusBar } from "@/components/ide/StatusBar";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <div className="relative min-h-screen w-full bg-[oklch(0.10_0.01_250)] p-3">
      {/* Ambient glow under window */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-64 glow-blur" />

      <div className="relative mx-auto flex h-[calc(100vh-1.5rem)] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
        <TitleBar />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <Workspace />
          <FilesPanel />
        </div>
        <StatusBar />
      </div>
    </div>
  );
}
