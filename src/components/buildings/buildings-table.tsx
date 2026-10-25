import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Search, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Building } from "@/lib/buildings-api";
import { BUILDING_FIELDS, FIELD_LABELS, type BuildingField } from "@shared/buildings";

type Sort = { field: BuildingField; dir: "asc" | "desc" } | null;
const NUMERIC: BuildingField[] = ["floors", "year_built"];
const VISIBLE_LIMIT = 500;

function compare(a: Building, b: Building, field: BuildingField): number {
  const x = a[field];
  const y = b[field];
  if (x === y) return 0;
  if (x === null) return 1; // blanks last in both directions
  if (y === null) return -1;
  return typeof x === "number" && typeof y === "number"
    ? x - y
    : String(x).localeCompare(String(y));
}

type Props = {
  buildings: Building[];
  onDelete: (ids: string[]) => Promise<void>;
  deleting: boolean;
};

export function BuildingsTable({ buildings, onDelete, deleting }: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<string[] | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? buildings.filter((b) =>
          BUILDING_FIELDS.some((f) =>
            String(b[f] ?? "")
              .toLowerCase()
              .includes(q),
          ),
        )
      : buildings;
    if (!sort) return filtered;
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const c = compare(a, b, sort.field);
      return a[sort.field] === null || b[sort.field] === null ? c : c * sign;
    });
  }, [buildings, query, sort]);

  const visible = rows.slice(0, VISIBLE_LIMIT);
  // Selection only counts rows that still exist and match the filter.
  const selectedVisible = visible.filter((b) => selected.has(b.id));
  const allChecked = visible.length > 0 && selectedVisible.length === visible.length;

  function toggleSort(field: BuildingField) {
    setSort((s) =>
      s?.field !== field ? { field, dir: "asc" } : s.dir === "asc" ? { field, dir: "desc" } : null,
    );
  }

  function toggle(id: string, on: boolean) {
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function confirmDelete() {
    if (!confirming) return;
    try {
      await onDelete(confirming);
    } catch {
      return; // the page reports the error; keep the dialog open to retry
    }
    setSelected((s) => new Set([...s].filter((id) => !confirming.includes(id))));
    setConfirming(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search buildings"
            className="pl-9"
            aria-label="Search buildings"
          />
        </div>
        {selectedVisible.length > 0 && (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setConfirming(selectedVisible.map((b) => b.id))}
          >
            <Trash2 className="mr-2 h-4 w-4" /> Delete {selectedVisible.length} selected
          </Button>
        )}
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allChecked}
                  onCheckedChange={(on) =>
                    setSelected(on ? new Set(visible.map((b) => b.id)) : new Set())
                  }
                  aria-label="Select all"
                  disabled={visible.length === 0}
                />
              </TableHead>
              {BUILDING_FIELDS.map((f) => (
                <TableHead key={f} className={NUMERIC.includes(f) ? "text-right" : undefined}>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    onClick={() => toggleSort(f)}
                  >
                    {FIELD_LABELS[f]}
                    {sort?.field !== f ? (
                      <ArrowUpDown className="h-3 w-3 opacity-40" />
                    ) : sort.dir === "asc" ? (
                      <ArrowUp className="h-3 w-3" />
                    ) : (
                      <ArrowDown className="h-3 w-3" />
                    )}
                  </button>
                </TableHead>
              ))}
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={BUILDING_FIELDS.length + 2}
                  className="py-12 text-center text-muted-foreground"
                >
                  {buildings.length === 0
                    ? "No buildings yet. Import an Excel file to get started."
                    : "No buildings match your search."}
                </TableCell>
              </TableRow>
            ) : (
              visible.map((b) => (
                <TableRow key={b.id} data-state={selected.has(b.id) ? "selected" : undefined}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(b.id)}
                      onCheckedChange={(on) => toggle(b.id, on === true)}
                      aria-label={`Select ${b.name}`}
                    />
                  </TableCell>
                  {BUILDING_FIELDS.map((f) => (
                    <TableCell
                      key={f}
                      className={
                        f === "name"
                          ? "font-medium"
                          : NUMERIC.includes(f)
                            ? "text-right tabular-nums"
                            : undefined
                      }
                    >
                      {b[f] ?? <span className="text-muted-foreground/50">—</span>}
                    </TableCell>
                  ))}
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => setConfirming([b.id])}
                      aria-label={`Delete ${b.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {rows.length > VISIBLE_LIMIT && (
        <p className="text-center text-sm text-muted-foreground">
          Showing the first {VISIBLE_LIMIT} of {rows.length.toLocaleString()} buildings. Search to
          narrow the list, or export to see all of them.
        </p>
      )}

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && !deleting && setConfirming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete{" "}
              {confirming?.length === 1 ? "this building" : `${confirming?.length} buildings`}?
            </AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
