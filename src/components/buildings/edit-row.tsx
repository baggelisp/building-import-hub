import { useState, type KeyboardEvent } from "react";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import type { Building } from "@/lib/buildings-api";
import {
  BUILDING_FIELDS,
  FIELD_LABELS,
  validateRow,
  type BuildingField,
  type BuildingInput,
  type ColumnMapping,
} from "@shared/buildings";

// Editing reuses the import's validation, so a value is accepted here exactly when it would be
// accepted in a spreadsheet.
const IDENTITY = Object.fromEntries(BUILDING_FIELDS.map((f) => [f, f])) as ColumnMapping;

type Props = {
  building: Building;
  onSave: (value: BuildingInput) => Promise<void>;
  onCancel: () => void;
};

export function EditRow({ building, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<Record<BuildingField, string>>(
    () =>
      Object.fromEntries(BUILDING_FIELDS.map((f) => [f, String(building[f] ?? "")])) as Record<
        BuildingField,
        string
      >,
  );
  const [errors, setErrors] = useState<Partial<Record<BuildingField | "form", string>>>({});
  const [saving, setSaving] = useState(false);

  async function save() {
    const checked = validateRow(draft, IDENTITY, 0);
    if (!checked.ok) {
      setErrors(Object.fromEntries(checked.errors.map((e) => [e.field ?? "form", e.message])));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await onSave(checked.value);
    } catch (e) {
      setErrors({ form: (e as Error).message });
      setSaving(false);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") void save();
    if (e.key === "Escape") onCancel();
  }

  return (
    <>
      <TableRow data-state="selected" className="hover:bg-muted/50">
        <TableCell />
        {BUILDING_FIELDS.map((f, i) => (
          <TableCell key={f} className="align-top">
            <Input
              value={draft[f]}
              onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
              onKeyDown={onKeyDown}
              autoFocus={i === 0}
              disabled={saving}
              inputMode={f === "floors" || f === "year_built" ? "numeric" : undefined}
              aria-label={`Edit ${FIELD_LABELS[f]}`}
              aria-invalid={errors[f] ? true : undefined}
              className={`h-8 ${errors[f] ? "border-destructive" : ""}`}
            />
            {errors[f] && <p className="mt-1 text-xs text-destructive">{errors[f]}</p>}
          </TableCell>
        ))}
        <TableCell className="align-top">
          <div className="flex">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => void save()}
              disabled={saving}
              aria-label="Save changes"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onCancel}
              disabled={saving}
              aria-label="Cancel editing"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {errors.form && (
        <TableRow className="hover:bg-transparent">
          <TableCell />
          <TableCell colSpan={BUILDING_FIELDS.length + 1} className="pt-0 text-sm text-destructive">
            {errors.form}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
