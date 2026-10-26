import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { AlertTriangle, FileSpreadsheet, Loader2, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  commitImport,
  previewImport,
  type ImportPreview,
  type ImportResult,
} from "@/lib/buildings-api";
import { downloadTemplate } from "@/lib/excel";
import {
  BUILDING_FIELDS,
  FIELD_LABELS,
  LIMITS,
  type BuildingField,
  type ColumnMapping,
} from "@shared/buildings";

const IGNORE = "__ignore__";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (result: ImportResult) => void;
};

export function ImportDialog({ open, onOpenChange, onImported }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFile(null);
    setPreview(null);
    setBusy(null);
    setError(null);
  }

  async function analyse(next: File, mapping?: ColumnMapping) {
    setBusy("preview");
    setError(null);
    try {
      const result = await previewImport(next, mapping);
      // Re-analyses with an edited mapping skip the model; keep its first answer so its
      // suggestions and reasons stay visible, and credit columns that still follow it.
      if (mapping && preview?.ai.status === "ok") {
        result.ai = preview.ai;
        for (const s of preview.ai.suggestions) {
          if (s.field && result.mapping[s.header] === s.field) result.sources[s.header] = "ai";
        }
      }
      setPreview(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function chooseFile(next: File) {
    if (next.size > LIMITS.maxFileBytes) {
      setError(`The file is larger than ${LIMITS.maxFileBytes / 1024 / 1024} MB.`);
      return;
    }
    setFile(next);
    setPreview(null);
    void analyse(next);
  }

  function changeMapping(header: string, field: BuildingField | null) {
    if (!file || !preview) return;
    const mapping = { ...preview.mapping };
    // A field belongs to one column: picking it here releases it from wherever it was.
    if (field) for (const h of Object.keys(mapping)) if (mapping[h] === field) mapping[h] = null;
    mapping[header] = field;
    void analyse(file, mapping);
  }

  async function confirm() {
    if (!file || !preview) return;
    setBusy("commit");
    setError(null);
    try {
      const result = await commitImport(file, preview.mapping);
      onImported(result);
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const canImport =
    !!preview && preview.mappingProblems.length === 0 && preview.summary.valid > 0 && !busy;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy === "commit") return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import buildings from Excel</DialogTitle>
          <DialogDescription>
            Nothing is saved until you confirm. Columns are matched automatically; check them before
            importing.
          </DialogDescription>
        </DialogHeader>

        {!file ? (
          <DropZone onFile={chooseFile} />
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{file.name}</span>
              {preview && (
                <span className="shrink-0 text-muted-foreground">
                  · sheet “{preview.sheetName}” · {preview.summary.rows} rows
                </span>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={reset} disabled={!!busy}>
              Choose another file
            </Button>
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Import problem</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {busy === "preview" && !preview && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading the file and matching columns…
          </div>
        )}

        {preview && (
          <PreviewBody preview={preview} busy={busy === "preview"} onChange={changeMapping} />
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="link" className="px-0" onClick={() => void downloadTemplate()}>
            Download the Excel template
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy === "commit"}
            >
              Cancel
            </Button>
            <Button onClick={confirm} disabled={!canImport}>
              {busy === "commit" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {preview
                ? `Import ${preview.summary.valid} building${preview.summary.valid === 1 ? "" : "s"}`
                : "Import"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DropZone({ onFile }: { onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) onFile(dropped);
  }

  return (
    <button
      type="button"
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
        over ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
      }`}
    >
      <Upload className="h-6 w-6 text-muted-foreground" />
      <span className="font-medium">Drop an Excel file here, or click to choose one</span>
      <span className="text-sm text-muted-foreground">
        .xlsx, .xls or .csv · up to {LIMITS.maxFileBytes / 1024 / 1024} MB and{" "}
        {LIMITS.maxRows.toLocaleString()} rows · any column names
      </span>
      <input
        ref={input}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        aria-label="Excel file"
        onChange={(e) => {
          const chosen = e.target.files?.[0];
          if (chosen) onFile(chosen);
          e.target.value = "";
        }}
      />
    </button>
  );
}

function SourceBadge({ source }: { source: string | undefined }) {
  if (!source) return null;
  if (source === "ai")
    return (
      <Badge variant="secondary" className="gap-1">
        <Sparkles className="h-3 w-3" /> AI
      </Badge>
    );
  const label = { exact: "Exact", alias: "Synonym", user: "You" }[source] ?? source;
  return <Badge variant="outline">{label}</Badge>;
}

function PreviewBody({
  preview,
  busy,
  onChange,
}: {
  preview: ImportPreview;
  busy: boolean;
  onChange: (header: string, field: BuildingField | null) => void;
}) {
  const suggestions = preview.ai.status === "ok" ? preview.ai.suggestions : [];
  const sampleRow = preview.sample[0]?.row;
  const { summary } = preview;

  return (
    <div className={`space-y-5 ${busy ? "pointer-events-none opacity-60" : ""}`}>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Columns</h3>
        {preview.ai.status === "failed" && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            AI suggestions are unavailable right now ({preview.ai.message}). Map any remaining
            columns yourself.
          </p>
        )}
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Column in your file</TableHead>
                <TableHead>Imports as</TableHead>
                <TableHead className="w-24">Matched by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.headers.map((header) => {
                const field = preview.mapping[header] ?? null;
                const ai = suggestions.find((s) => s.header === header);
                const pendingAi =
                  ai && ai.field && ai.confidence === "low" && field === null ? ai : null;
                return (
                  <TableRow key={header}>
                    <TableCell className="align-top">
                      <div className="font-medium">{header}</div>
                      {ai?.reason && preview.sources[header] === "ai" && (
                        <div className="text-xs text-muted-foreground">{ai.reason}</div>
                      )}
                      {pendingAi && (
                        <button
                          type="button"
                          className="mt-1 flex items-center gap-1 text-xs text-primary hover:underline"
                          onClick={() => onChange(header, pendingAi.field)}
                        >
                          <Sparkles className="h-3 w-3" /> AI guesses{" "}
                          {FIELD_LABELS[pendingAi.field!]} (low confidence) — use it
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <Select
                        value={field ?? IGNORE}
                        onValueChange={(v) =>
                          onChange(header, v === IGNORE ? null : (v as BuildingField))
                        }
                      >
                        <SelectTrigger className="h-8 w-44" aria-label={`Field for ${header}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={IGNORE}>Don’t import</SelectItem>
                          {BUILDING_FIELDS.map((f) => (
                            <SelectItem key={f} value={f}>
                              {FIELD_LABELS[f]}
                              {f === "name" ? " (required)" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="align-top">
                      <SourceBadge source={field ? preview.sources[header] : undefined} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      {preview.mappingProblems.length > 0 ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Fix the column mapping</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {preview.mappingProblems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">What will happen</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            <Stat value={summary.valid} label="will be imported" tone="good" />
            <Stat
              value={summary.invalidRows}
              label="rows have errors and will be skipped"
              tone="bad"
            />
            <Stat value={summary.duplicates} label="duplicates will be skipped" tone="neutral" />
          </div>

          {preview.errors.length > 0 && (
            <Details title={`Rows with errors (${summary.invalidRows})`}>
              {preview.errors.map((e, i) => (
                <li key={i}>
                  <span className="font-mono text-xs text-muted-foreground">Row {e.row}</span> ·{" "}
                  {e.message}
                </li>
              ))}
            </Details>
          )}
          {preview.duplicates.length > 0 && (
            <Details title={`Duplicates (${summary.duplicates})`}>
              {preview.duplicates.map((d) => (
                <li key={d.row}>
                  <span className="font-mono text-xs text-muted-foreground">Row {d.row}</span> ·{" "}
                  {d.name} —{" "}
                  {d.reason === "existing" ? "already in your list" : "repeats an earlier row"}
                </li>
              ))}
            </Details>
          )}
          {sampleRow !== undefined && (
            <p className="text-xs text-muted-foreground">
              First row to import (row {sampleRow}):{" "}
              {BUILDING_FIELDS.map((f) => preview.sample[0]!.value[f])
                .filter((v) => v !== null)
                .join(" · ")}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function Stat({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "good" | "bad" | "neutral";
}) {
  const color =
    tone === "good" && value > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "bad" && value > 0
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="rounded-lg border px-4 py-3">
      <div className={`text-2xl font-semibold tabular-nums ${color}`}>{value.toLocaleString()}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Details({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-lg border px-4 py-2 text-sm">
      <summary className="cursor-pointer font-medium">{title}</summary>
      <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto pb-2">{children}</ul>
    </details>
  );
}

export function importToast(result: ImportResult) {
  const skipped = [
    result.invalidRows && `${result.invalidRows} with errors`,
    result.duplicates && `${result.duplicates} duplicates`,
  ].filter(Boolean);
  toast.success(
    `Imported ${result.inserted} building${result.inserted === 1 ? "" : "s"}${skipped.length ? ` · skipped ${skipped.join(", ")}` : ""}.`,
  );
}
