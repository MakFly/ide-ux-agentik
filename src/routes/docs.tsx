import { Link, createFileRoute } from "@tanstack/react-router";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, BookOpenText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import docsContent from "../../agent/README.md?raw";

export const Route = createFileRoute("/docs")({
  component: DocsPage,
  head: () => ({
    meta: [
      { title: "Project documentation — Superconductor" },
      {
        name: "description",
        content: "Project documentation for the remote agent and workspace connection flow.",
      },
    ],
  }),
});

type TocItem = {
  id: string;
  depth: 1 | 2 | 3;
  label: string;
};

const toc = extractToc(docsContent);

const markdownComponents: Components = {
  h1: ({ node, className, ...props }) => (
    <h1 id={slugify(getNodeText(node))} className={cn("scroll-mt-24", className)} {...props} />
  ),
  h2: ({ node, className, ...props }) => (
    <h2 id={slugify(getNodeText(node))} className={cn("scroll-mt-24", className)} {...props} />
  ),
  h3: ({ node, className, ...props }) => (
    <h3 id={slugify(getNodeText(node))} className={cn("scroll-mt-24", className)} {...props} />
  ),
  a: ({ className, ...props }) => (
    <a
      className={cn("underline underline-offset-4", className)}
      rel="noreferrer"
      target={props.href?.startsWith("#") ? undefined : "_blank"}
      {...props}
    />
  ),
  table: ({ className, ...props }) => (
    <div className="my-6 overflow-x-auto">
      <table className={cn("w-full min-w-[40rem]", className)} {...props} />
    </div>
  ),
  pre: ({ className, ...props }) => (
    <pre className={cn("scrollbar-visible", className)} {...props} />
  ),
};

function DocsPage() {
  return (
    <main className="min-h-svh bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <BookOpenText className="size-4" />
              Documentation
            </div>
            <div className="flex flex-col gap-1">
              <h1 className="text-3xl font-semibold tracking-tight">Remote agent</h1>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                Setup, security notes, and protocol reference for the workspace connection flow.
              </p>
            </div>
          </div>

          <Button asChild variant="outline" size="sm">
            <Link to="/">
              <ArrowLeft data-icon="inline-start" />
              Back to IDE
            </Link>
          </Button>
        </header>

        <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-6 lg:h-[calc(100svh-3rem)]">
            <Card className="overflow-hidden">
              <CardHeader className="gap-1">
                <CardTitle className="text-sm font-medium">On this page</CardTitle>
                <CardDescription>README sections</CardDescription>
              </CardHeader>
              <Separator />
              <CardContent className="p-0">
                <ScrollArea className="h-[16rem] lg:h-[calc(100svh-12rem)]">
                  <nav className="flex flex-col gap-1 p-3">
                    {toc.map((item) => (
                      <a
                        key={item.id}
                        href={`#${item.id}`}
                        className={cn(
                          "rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                          item.depth === 2 && "pl-5",
                          item.depth === 3 && "pl-7 text-[13px]",
                        )}
                      >
                        {item.label}
                      </a>
                    ))}
                  </nav>
                </ScrollArea>
              </CardContent>
            </Card>
          </aside>

          <Card className="overflow-hidden">
            <CardHeader className="gap-1">
              <CardTitle className="text-base">agent/README.md</CardTitle>
              <CardDescription>Rendered documentation</CardDescription>
            </CardHeader>
            <Separator />
            <CardContent className="p-0">
              <ScrollArea className="h-[calc(100svh-14rem)] min-h-[36rem]">
                <article className="docs-markdown mx-auto w-full max-w-3xl px-6 py-6 sm:px-8 sm:py-8">
                  <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
                    {docsContent}
                  </ReactMarkdown>
                </article>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}

function extractToc(markdown: string): TocItem[] {
  return markdown
    .split("\n")
    .map((line) => line.match(/^(#{1,3})\s+(.*)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      depth: match[1].length as 1 | 2 | 3,
      label: match[2].trim(),
      id: slugify(match[2]),
    }));
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[`]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

type MarkdownNode =
  | {
      value?: string;
      children?: MarkdownNode[];
    }
  | null
  | undefined;

function getNodeText(node: MarkdownNode): string {
  if (!node) return "";
  if (typeof node.value === "string") return node.value;
  if (!Array.isArray(node.children)) return "";
  return node.children.map((child) => getNodeText(child)).join("");
}
