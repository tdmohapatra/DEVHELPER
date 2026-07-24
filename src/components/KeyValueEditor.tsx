import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { KeyValue } from "@/tools/lib/apiTypes";

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(performance.now()));

interface Props {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

export function KeyValueEditor({ rows, onChange, keyPlaceholder = "Key", valuePlaceholder = "Value" }: Props) {
  const update = (id: string, patch: Partial<KeyValue>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: string) => onChange(rows.filter((r) => r.id !== id));
  const add = () => onChange([...rows, { id: uid(), key: "", value: "", enabled: true }]);

  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={r.enabled}
            onChange={(e) => update(r.id, { enabled: e.target.checked })}
            className="accent-primary"
            title="Enabled"
          />
          <Input className="h-8 flex-1 font-mono text-xs" placeholder={keyPlaceholder} value={r.key} onChange={(e) => update(r.id, { key: e.target.value })} />
          <Input className="h-8 flex-1 font-mono text-xs" placeholder={valuePlaceholder} value={r.value} onChange={(e) => update(r.id, { value: e.target.value })} />
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => remove(r.id)}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="self-start" onClick={add}>
        <Plus /> Add row
      </Button>
    </div>
  );
}
