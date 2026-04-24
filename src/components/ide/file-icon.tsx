import { getIconForFilePath, getIconForDirectoryPath, getIconUrlByName } from "vscode-material-icons";
import { File, Folder, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS_URL = "/material-icons";

type Props = {
  name: string;
  isDir?: boolean;
  isOpen?: boolean;
  className?: string;
};

export function FileTypeIcon({ name, isDir, isOpen, className }: Props) {
  const sizeClass = cn("h-3.5 w-3.5 shrink-0", className);

  if (isDir) {
    const iconName = getIconForDirectoryPath(name.replace(/\/$/, ""));
    if (iconName) {
      const url = getIconUrlByName(iconName, ICONS_URL);
      return <img src={url} alt="" className={sizeClass} />;
    }
    return isOpen
      ? <FolderOpen className={cn(sizeClass, "text-syntax-fn")} />
      : <Folder className={cn(sizeClass, "text-muted-foreground")} />;
  }

  const iconName = getIconForFilePath(name);
  if (iconName) {
    const url = getIconUrlByName(iconName, ICONS_URL);
    return <img src={url} alt="" className={sizeClass} />;
  }
  return <File className={sizeClass} />;
}
