import { Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface VoiceButtonProps {
  onDictation?: (text: string) => void;
}

export function VoiceButton(_props: VoiceButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" disabled>
          <Mic className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Voice dictation — coming soon</TooltipContent>
    </Tooltip>
  );
}
