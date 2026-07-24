import { useState, type ReactNode } from "react";
import { Moon, Sun, Trash2, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/stores/useAppStore";
import { useAiStore } from "@/stores/useAiStore";
import { isTauri } from "@/lib/platform";
import { aiChat } from "@/lib/ai";
import { toast } from "@/components/ui/toast";

export function Settings() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const ai = useAiStore();
  const [testing, setTesting] = useState(false);

  const testAi = async () => {
    setTesting(true);
    try {
      await aiChat([{ role: "user", content: "Reply with the single word: ok" }]);
      toast.success("AI connection works");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">Settings</h1>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bot className="size-4" /> AI (optional)</CardTitle>
          <CardDescription>DevHelper works fully without AI. Configure a provider to enable AI tools. Keys are stored locally.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Button size="sm" variant={ai.provider === "ollama" ? "default" : "outline"} onClick={() => ai.set({ provider: "ollama" })}>Ollama (local)</Button>
            <Button size="sm" variant={ai.provider === "openai" ? "default" : "outline"} onClick={() => ai.set({ provider: "openai" })}>OpenAI-compatible</Button>
          </div>
          {ai.provider === "ollama" ? (
            <div className="grid grid-cols-2 gap-2">
              <Labeled label="Ollama URL"><Input value={ai.ollamaUrl} onChange={(e) => ai.set({ ollamaUrl: e.target.value })} /></Labeled>
              <Labeled label="Model"><Input value={ai.ollamaModel} onChange={(e) => ai.set({ ollamaModel: e.target.value })} /></Labeled>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Labeled label="Base URL"><Input value={ai.openaiBaseUrl} onChange={(e) => ai.set({ openaiBaseUrl: e.target.value })} /></Labeled>
              <Labeled label="Model"><Input value={ai.openaiModel} onChange={(e) => ai.set({ openaiModel: e.target.value })} /></Labeled>
              <Labeled label="API Key" full><Input type="password" placeholder="sk-…" value={ai.openaiKey} onChange={(e) => ai.set({ openaiKey: e.target.value })} /></Labeled>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={testAi} disabled={testing || !ai.isConfigured()}>{testing ? "Testing…" : "Test connection"}</Button>
            <Badge variant={ai.isConfigured() ? "success" : "secondary"}>{ai.isConfigured() ? "configured" : "not configured"}</Badge>
            {ai.provider === "openai" && <span className="text-xs text-muted-foreground">⚠ OpenAI sends data to an external server.</span>}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Choose how DevHelper looks.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button variant={theme === "dark" ? "default" : "outline"} size="sm" onClick={() => setTheme("dark")}>
            <Moon /> Dark
          </Button>
          <Button variant={theme === "light" ? "default" : "outline"} size="sm" onClick={() => setTheme("light")}>
            <Sun /> Light
          </Button>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Data</CardTitle>
          <CardDescription>Favorites, recents and theme are stored locally in this browser/app profile.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              localStorage.removeItem("devhelper-app");
              toast.success("Local data cleared — reload to apply");
            }}
          >
            <Trash2 /> Clear local data
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>DevHelper 0.1.0</span>
            <Badge variant={isTauri() ? "success" : "secondary"}>{isTauri() ? "Desktop app" : "Browser dev mode"}</Badge>
          </div>
          <p>Local-first developer toolbox. No data leaves your machine unless you enable AI.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function Labeled({ label, children, full }: { label: string; children: ReactNode; full?: boolean }) {
  return (
    <label className={full ? "col-span-2 flex flex-col gap-1" : "flex flex-col gap-1"}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
