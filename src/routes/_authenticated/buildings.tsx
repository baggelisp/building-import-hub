import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Download, FileSpreadsheet, LogOut, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BuildingsTable } from "@/components/buildings/buildings-table";
import { ImportDialog, importToast } from "@/components/buildings/import-dialog";
import { Button } from "@/components/ui/button";
import { deleteBuildings, fetchBuildings } from "@/lib/buildings-api";
import { downloadTemplate, exportBuildings } from "@/lib/excel";

const buildingsQuery = queryOptions({ queryKey: ["buildings"], queryFn: fetchBuildings });

export const Route = createFileRoute("/_authenticated/buildings")({
  loader: ({ context }) => context.queryClient.ensureQueryData(buildingsQuery),
  component: BuildingsPage,
});

function BuildingsPage() {
  const { user } = Route.useRouteContext();
  const { data: buildings } = useSuspenseQuery(buildingsQuery);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [importing, setImporting] = useState(false);
  // A fresh dialog per opening: state resets without flashing the empty step while it fades out.
  const [importKey, setImportKey] = useState(0);

  const remove = useMutation({
    mutationFn: deleteBuildings,
    onSuccess: (_, ids) => {
      toast.success(`Deleted ${ids.length} building${ids.length === 1 ? "" : "s"}.`);
      return qc.invalidateQueries({ queryKey: ["buildings"] });
    },
    onError: (e) => toast.error(e.message),
  });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-2 font-semibold">
            <FileSpreadsheet className="h-5 w-5 text-primary" /> Buildings Registry
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="hidden sm:inline">{user.email}</span>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Buildings</h1>
            <p className="text-sm text-muted-foreground">
              {buildings.length.toLocaleString()} building{buildings.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void downloadTemplate()}>
              <Download className="mr-2 h-4 w-4" /> Template
            </Button>
            <Button
              variant="outline"
              onClick={() => void exportBuildings(buildings)}
              disabled={buildings.length === 0}
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" /> Export
            </Button>
            <Button
              onClick={() => {
                setImportKey((k) => k + 1);
                setImporting(true);
              }}
            >
              <Upload className="mr-2 h-4 w-4" /> Import Excel
            </Button>
          </div>
        </div>

        <BuildingsTable
          buildings={buildings}
          onDelete={(ids) => remove.mutateAsync(ids).then(() => undefined)}
          deleting={remove.isPending}
        />
      </main>

      <ImportDialog
        key={importKey}
        open={importing}
        onOpenChange={setImporting}
        onImported={(result) => {
          importToast(result);
          void qc.invalidateQueries({ queryKey: ["buildings"] });
        }}
      />
    </div>
  );
}
