import { useEffect, useMemo, useRef } from "react";
import CodeMirror, { EditorView, type Extension } from "@uiw/react-codemirror";
import { vscodeDark, vscodeLight } from "@uiw/codemirror-theme-vscode";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { sql } from "@codemirror/lang-sql";
import { php } from "@codemirror/lang-php";
import { go } from "@codemirror/lang-go";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { vue } from "@codemirror/lang-vue";
import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { nginx } from "@codemirror/legacy-modes/mode/nginx";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { useIDE } from "@/store/ide";

type FileTabId = `file:${string}`;

type Props = {
  tabId: FileTabId;
  path: string;
  content: string;
};

const FILENAME_MAP: Record<string, () => Extension> = {
  dockerfile: () => StreamLanguage.define(dockerFile),
  makefile: () => StreamLanguage.define(properties),
  ".env": () => StreamLanguage.define(properties),
  ".gitignore": () => StreamLanguage.define(properties),
  ".editorconfig": () => StreamLanguage.define(properties),
};

function languageFor(path: string): Extension | null {
  const filename = (path.split("/").pop() ?? "").toLowerCase();
  const mapped = FILENAME_MAP[filename] ?? FILENAME_MAP[filename.replace(/\..*$/, "")];
  if (mapped) return mapped();

  const ext = filename.includes(".") ? (filename.split(".").pop() ?? "") : "";
  switch (ext) {
    case "ts":
    case "tsx":
      return javascript({ typescript: true, jsx: ext === "tsx" });
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return javascript({ jsx: ext === "jsx" });
    case "json":
    case "jsonc":
      return json();
    case "md":
    case "mdx":
      return markdown();
    case "css":
    case "scss":
    case "sass":
    case "less":
      return css();
    case "html":
    case "htm":
      return html();
    case "py":
      return python();
    case "rs":
      return rust();
    case "xml":
    case "svg":
      return xml();
    case "yml":
    case "yaml":
      return yaml();
    case "sql":
      return sql();
    case "php":
      return php();
    case "go":
      return go();
    case "java":
    case "kt":
    case "kts":
      return java();
    case "c":
    case "h":
    case "cc":
    case "cpp":
    case "cxx":
    case "hpp":
      return cpp();
    case "vue":
      return vue();
    case "sh":
    case "bash":
    case "zsh":
    case "fish":
      return StreamLanguage.define(shell);
    case "toml":
      return StreamLanguage.define(toml);
    case "ini":
    case "conf":
    case "properties":
      return StreamLanguage.define(properties);
    case "rb":
      return StreamLanguage.define(ruby);
    case "lua":
      return StreamLanguage.define(lua);
    case "nginx":
      return StreamLanguage.define(nginx);
    case "diff":
    case "patch":
      return StreamLanguage.define(diff);
    case "swift":
      return StreamLanguage.define(swift);
    default:
      return null;
  }
}

const AUTOSAVE_DELAY_MS = 800;

export function CodeEditor({ tabId, path, content }: Props) {
  const theme = useIDE((s) => s.theme);
  const updateFileContent = useIDE((s) => s.updateFileContent);
  const saveFile = useIDE((s) => s.saveFile);

  const extensions = useMemo(() => {
    const exts: Extension[] = [EditorView.lineWrapping];
    const lang = languageFor(path);
    if (lang) exts.push(lang);
    return exts;
  }, [path]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        void saveFile(tabId);
      }
    };
  }, [tabId, saveFile]);

  const handleChange = (value: string) => {
    updateFileContent(tabId, value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void saveFile(tabId);
    }, AUTOSAVE_DELAY_MS);
  };

  return (
    <CodeMirror
      value={content}
      onChange={handleChange}
      theme={theme === "dark" ? vscodeDark : vscodeLight}
      extensions={extensions}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: true,
        highlightActiveLineGutter: true,
        highlightSelectionMatches: true,
        bracketMatching: true,
        autocompletion: true,
        closeBrackets: true,
        indentOnInput: true,
        syntaxHighlighting: true,
      }}
      className="h-full text-[12.5px]"
      height="100%"
      style={{ height: "100%" }}
    />
  );
}
