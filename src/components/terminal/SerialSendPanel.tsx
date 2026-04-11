import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MdSend } from "react-icons/md";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SerialSendPanelProps {
  sessionId: string;
}

function isValidHex(str: string): boolean {
  return /^[0-9a-fA-F\s]*$/.test(str);
}

function hexStringToBytes(hex: string): number[] {
  const cleaned = hex.replace(/\s+/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i += 2) {
    const byte = Number.parseInt(cleaned.substring(i, i + 2), 16);
    if (!Number.isNaN(byte)) bytes.push(byte);
  }
  return bytes;
}

export default function SerialSendPanel({ sessionId }: SerialSendPanelProps) {
  const { t } = useTranslation();
  const [textData, setTextData] = useState("");
  const [hexData, setHexData] = useState("");
  const [lineEnding, setLineEnding] = useState<"none" | "cr" | "lf" | "crlf">("crlf");
  const [hexError, setHexError] = useState(false);
  const textInputRef = useRef<HTMLInputElement>(null);
  const hexInputRef = useRef<HTMLInputElement>(null);

  const sendText = useCallback(() => {
    if (!textData || !sessionId) return;
    let data = textData;
    if (lineEnding === "cr") data += "\r";
    else if (lineEnding === "lf") data += "\n";
    else if (lineEnding === "crlf") data += "\r\n";
    invoke("write_to_session", { sessionId, data }).catch(() => {});
    setTextData("");
    textInputRef.current?.focus();
  }, [textData, sessionId, lineEnding]);

  const sendHex = useCallback(() => {
    if (!hexData || !sessionId) return;
    if (!isValidHex(hexData)) {
      setHexError(true);
      return;
    }
    const bytes = hexStringToBytes(hexData);
    if (bytes.length === 0) return;
    const str = String.fromCharCode(...bytes);
    invoke("write_to_session", { sessionId, data: str }).catch(() => {});
    setHexData("");
    setHexError(false);
    hexInputRef.current?.focus();
  }, [hexData, sessionId]);

  return (
    <div className="h-full flex flex-col overflow-hidden px-2 py-1.5 gap-1">
      <Tabs defaultValue="text" className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center gap-2 shrink-0">
          <TabsList className="h-7">
            <TabsTrigger value="text" className="text-[0.6875rem] px-2.5 h-6">
              {t("serialSend.text", "Text")}
            </TabsTrigger>
            <TabsTrigger value="hex" className="text-[0.6875rem] px-2.5 h-6">
              {t("serialSend.hex", "Hex")}
            </TabsTrigger>
          </TabsList>
          <span className="text-[0.625rem] text-muted-foreground ml-auto select-none">
            {t("serialSend.title", "Serial Send")}
          </span>
        </div>

        <TabsContent value="text" className="flex-1 m-0 mt-1">
          <div className="flex items-center gap-1.5">
            <Input
              ref={textInputRef}
              className="h-7 text-xs flex-1"
              placeholder={t("serialSend.textPlaceholder", "Enter text to send...")}
              value={textData}
              onChange={(e) => setTextData(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") sendText();
              }}
            />
            <Select value={lineEnding} onValueChange={(v) => setLineEnding(v as typeof lineEnding)}>
              <SelectTrigger className="h-7 w-20 text-[0.625rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">
                  {t("serialSend.noLineEnding", "None")}
                </SelectItem>
                <SelectItem value="cr" className="text-xs">
                  CR
                </SelectItem>
                <SelectItem value="lf" className="text-xs">
                  LF
                </SelectItem>
                <SelectItem value="crlf" className="text-xs">
                  CR+LF
                </SelectItem>
              </SelectContent>
            </Select>
            <Button size="icon-xs" variant="default" className="h-7 w-7 shrink-0" onClick={sendText} disabled={!textData}>
              <MdSend className="text-sm" />
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="hex" className="flex-1 m-0 mt-1">
          <div className="flex items-center gap-1.5">
            <Input
              ref={hexInputRef}
              className={`h-7 text-xs flex-1 font-mono ${hexError ? "border-destructive" : ""}`}
              placeholder={t("serialSend.hexPlaceholder", "e.g. 48 65 6C 6C 6F")}
              value={hexData}
              onChange={(e) => {
                setHexData(e.target.value);
                setHexError(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") sendHex();
              }}
            />
            <Button size="icon-xs" variant="default" className="h-7 w-7 shrink-0" onClick={sendHex} disabled={!hexData}>
              <MdSend className="text-sm" />
            </Button>
          </div>
          {hexError && (
            <p className="text-[0.625rem] text-destructive mt-0.5">
              {t("serialSend.hexError", "Invalid hex input. Use hex characters (0-9, A-F) separated by spaces.")}
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
