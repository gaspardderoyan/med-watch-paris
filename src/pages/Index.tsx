import React, { useEffect, useMemo, useRef, useState } from "react";
import { DateTime, Duration } from "luxon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider-custom";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Clock, Pill, Shield, ShieldAlert, Settings, Download, Trash2, Plus, X } from "lucide-react";

type DoseEntry = {
  tsISO: string;
  amount: number;
  medName?: string;
  unit?: string;
};

type Medication = {
  id: string;
  name: string;
  unit: string;
  min: number;
  max: number;
  step: number;
};

type AppSettings = {
  multiMode: boolean;
  selectedMedId: string | null;
};

const CSV_KEY = "doseTracker.csv";
const MEDS_KEY = "doseTracker.medications";
const SETTINGS_KEY = "doseTracker.settings";
const CSV_HEADER = "timestamp,amount,medication,unit";
const PARIS = "Europe/Paris";
const RED_THRESHOLD_MIN = 90;

function nowParis(): DateTime {
  return DateTime.now().setZone(PARIS);
}

function formatEntryTime(dt: DateTime): string {
  return dt.toFormat("ccc dd LLL HH:mm");
}

function dayOffsetLabel(dt: DateTime): string {
  const n = Math.floor(nowParis().startOf("day").diff(dt.startOf("day"), "days").days);
  return n >= 1 ? `(D-${n})` : "";
}

function toISOParis(dt: DateTime): string {
  return dt.toISO({ suppressMilliseconds: true })!;
}

function sanitizeField(s: string): string {
  return s.replace(/[,\r\n]/g, " ").trim();
}

function parseCSV(csv: string): DoseEntry[] {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const hasHeader = lines[0].toLowerCase().startsWith("timestamp,");
  const rows = hasHeader ? lines.slice(1) : lines;
  const entries: DoseEntry[] = [];
  for (const line of rows) {
    const parts = line.split(",");
    if (parts.length < 2) continue;
    const ts = parts[0].trim();
    const amount = Number(parts[1]);
    if (!ts || !Number.isFinite(amount)) continue;
    const medName = parts[2]?.trim() || undefined;
    const unit = parts[3]?.trim() || undefined;
    entries.push({ tsISO: ts, amount, medName, unit });
  }
  return entries.sort((a, b) => DateTime.fromISO(b.tsISO).toMillis() - DateTime.fromISO(a.tsISO).toMillis());
}

function entriesToCSV(entries: DoseEntry[]): string {
  const lines = [
    CSV_HEADER,
    ...entries.map((e) => `${e.tsISO},${e.amount},${sanitizeField(e.medName || "")},${sanitizeField(e.unit || "")}`),
  ];
  return lines.join("\n");
}

function loadEntries(): DoseEntry[] {
  const csv = localStorage.getItem(CSV_KEY);
  if (!csv) return [];
  try {
    return parseCSV(csv);
  } catch {
    return [];
  }
}

function saveEntries(entries: DoseEntry[]) {
  localStorage.setItem(CSV_KEY, entriesToCSV(entries));
}

function loadMedications(): Medication[] {
  try {
    const raw = localStorage.getItem(MEDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((m) => m && typeof m.id === "string");
  } catch {
    return [];
  }
}

function saveMedications(meds: Medication[]) {
  localStorage.setItem(MEDS_KEY, JSON.stringify(meds));
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { multiMode: false, selectedMedId: null };
    const parsed = JSON.parse(raw);
    return {
      multiMode: !!parsed.multiMode,
      selectedMedId: parsed.selectedMedId ?? null,
    };
  } catch {
    return { multiMode: false, selectedMedId: null };
  }
}

function saveSettings(s: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function newMedId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `med-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatElapsed(d: Duration): string {
  const hh = Math.floor(d.as("hours"));
  const mm = Math.floor(d.minus({ hours: hh }).as("minutes"));
  const ss = Math.floor(d.minus({ hours: hh, minutes: mm }).as("seconds"));
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

const Index = () => {
  const [entries, setEntries] = useState<DoseEntry[]>(() => loadEntries());
  const [medications, setMedications] = useState<Medication[]>(() => loadMedications());
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [doseAmt, setDoseAmt] = useState<number>(1.0);
  const [tick, setTick] = useState<number>(0);
  const [isAddingDose, setIsAddingDose] = useState<boolean>(false);
  const [deleteEntry, setDeleteEntry] = useState<DoseEntry | null>(null);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHapticRef = useRef<number>(0);
  const { toast } = useToast();

  // Persist medications and settings
  useEffect(() => {
    saveMedications(medications);
  }, [medications]);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // Heartbeat for timer updates
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Register service worker
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
      });
    }
  }, []);

  const lastDoseDT = useMemo(() => {
    return entries.length > 0 ? DateTime.fromISO(entries[0].tsISO) : null;
  }, [entries, tick]);

  const elapsed = useMemo(() => {
    if (!lastDoseDT) return null;
    const diff = nowParis().diff(lastDoseDT, ["hours", "minutes", "seconds"]);
    return diff.shiftTo("hours", "minutes", "seconds");
  }, [lastDoseDT, tick]);

  const isWarning = useMemo(() => {
    if (!elapsed) return false;
    return elapsed.as("minutes") < RED_THRESHOLD_MIN;
  }, [elapsed]);

  const selectedMed = useMemo<Medication | null>(() => {
    if (!settings.multiMode) return null;
    return medications.find((m) => m.id === settings.selectedMedId) || null;
  }, [settings, medications]);

  const sliderMin = selectedMed?.min ?? 0;
  const sliderMax = selectedMed?.max ?? 2;
  const sliderStep = selectedMed?.step ?? 0.1;
  const unitLabel = selectedMed?.unit ?? "";

  // Clamp dose amount when the active range changes
  useEffect(() => {
    setDoseAmt((d) => {
      const clamped = Math.max(sliderMin, Math.min(sliderMax, d));
      return clamped;
    });
  }, [sliderMin, sliderMax]);

  // Throttled haptic. Continuous pointer movement and rapid step changes used to
  // queue up vibrations, making the whole device buzz; the ref keeps light
  // feedback to at most once per 60ms.
  function triggerHaptic(type: "light" | "medium" | "heavy" = "light") {
    if (!navigator.vibrate) return;
    const now = Date.now();
    if (type === "light" && now - lastHapticRef.current < 60) return;
    lastHapticRef.current = now;
    const patterns = { light: [10], medium: [20], heavy: [50] } as const;
    navigator.vibrate(patterns[type]);
  }

  async function addDose() {
    if (isAddingDose) return;
    if (settings.multiMode && !selectedMed) {
      toast({ title: "Select a medication", description: "Pick a medication before adding a dose." });
      return;
    }

    setIsAddingDose(true);
    triggerHaptic("medium");

    try {
      const tsISO = toISOParis(nowParis());
      const amount = Number(doseAmt.toFixed(Math.max(0, (sliderStep.toString().split(".")[1] || "").length)));
      const newEntry: DoseEntry = {
        tsISO,
        amount,
        ...(selectedMed ? { medName: selectedMed.name, unit: selectedMed.unit } : {}),
      };
      const next = [newEntry, ...entries];
      setEntries(next);
      saveEntries(next);

      toast({
        title: "Dose added",
        description: `${amount}${unitLabel ? ` ${unitLabel}` : ""}${selectedMed ? ` of ${selectedMed.name}` : ""} recorded at ${DateTime.now().setZone(PARIS).toFormat("HH:mm")}`,
      });
    } finally {
      setTimeout(() => setIsAddingDose(false), 1000);
    }
  }

  function deleteAllDoses() {
    setEntries([]);
    localStorage.removeItem(CSV_KEY);
    triggerHaptic("heavy");
    toast({ title: "All doses deleted", description: "Your dose history has been cleared" });
  }

  function exportToCSV() {
    if (entries.length === 0) {
      toast({ title: "No data to export", description: "Add some doses first" });
      return;
    }
    const csv = entriesToCSV(entries);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dose-tracker-${DateTime.now().toFormat("yyyy-MM-dd")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    triggerHaptic("light");
    toast({ title: "CSV exported", description: "Your dose data has been downloaded" });
  }

  function deleteSingleDose(entryToDelete: DoseEntry) {
    const updated = entries.filter((e) => e.tsISO !== entryToDelete.tsISO);
    setEntries(updated);
    saveEntries(updated);
    setDeleteEntry(null);
    triggerHaptic("medium");
    toast({
      title: "Dose deleted",
      description: `Dose from ${DateTime.fromISO(entryToDelete.tsISO).setZone(PARIS).toFormat("HH:mm")} removed`,
    });
  }

  function handleLongPressStart(entry: DoseEntry, event: React.TouchEvent | React.MouseEvent) {
    if ("touches" in event) {
      event.preventDefault();
    }
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      setDeleteEntry(entry);
      triggerHaptic("heavy");
    }, 500);
  }

  function handleLongPressEnd() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function intervalSincePrev(i: number): string {
    if (i === entries.length - 1) return "—";
    const curr = DateTime.fromISO(entries[i].tsISO);
    const prev = DateTime.fromISO(entries[i + 1].tsISO);
    const d = curr.diff(prev, ["hours", "minutes"]);
    const h = Math.floor(d.as("hours"));
    const m = Math.floor(d.minus({ hours: h }).as("minutes"));
    return `${h}h ${m}m`;
  }

  function addMedication() {
    const med: Medication = {
      id: newMedId(),
      name: "New medication",
      unit: "mg",
      min: 0,
      max: 10,
      step: 0.5,
    };
    setMedications((prev) => [...prev, med]);
    setSettings((s) => (s.selectedMedId ? s : { ...s, selectedMedId: med.id }));
  }

  function updateMedication(id: string, patch: Partial<Medication>) {
    setMedications((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  function deleteMedication(id: string) {
    setMedications((prev) => prev.filter((m) => m.id !== id));
    setSettings((s) => (s.selectedMedId === id ? { ...s, selectedMedId: null } : s));
  }

  function toggleMultiMode(on: boolean) {
    setSettings((s) => {
      const next: AppSettings = { ...s, multiMode: on };
      if (on && !next.selectedMedId && medications.length > 0) {
        next.selectedMedId = medications[0].id;
      }
      return next;
    });
  }

  const canAddDose = !isAddingDose && (!settings.multiMode || !!selectedMed);
  const decimals = Math.max(0, (sliderStep.toString().split(".")[1] || "").length);

  return (
    <div className="min-h-screen bg-background p-4 max-w-2xl mx-auto">
      {/* Header with Settings */}
      <div className="relative text-center mb-8 pt-4">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Pill className="h-8 w-8 text-medical-blue" />
          <h1 className="text-3xl font-bold text-foreground">Dose Tracker</h1>
        </div>
        <p className="text-muted-foreground">Precise medication timing & safety monitoring</p>

        {/* Settings Button */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="absolute top-0 right-0"
              onClick={() => triggerHaptic("light")}
            >
              <Settings className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56" align="end">
            <div className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </Button>
              <Button variant="outline" size="sm" className="w-full justify-start" onClick={exportToCSV}>
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
              <Button variant="destructive" size="sm" className="w-full justify-start" onClick={deleteAllDoses}>
                <Trash2 className="h-4 w-4 mr-2" />
                Delete All
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Big Timer Display */}
      <Card className="mb-6 grainy glass border-border/50">
        <CardContent className="pt-6">
          <div className="text-center">
            <div
              className={`inline-flex items-center gap-3 px-8 py-6 rounded-3xl transition-all duration-500 grainy relative overflow-hidden ${
                isWarning
                  ? "bg-timer-bg-warning text-timer-warning shadow-xl shadow-timer-warning/30"
                  : "bg-timer-bg-safe text-timer-safe shadow-xl shadow-timer-safe/30"
              }`}
            >
              {isWarning ? <ShieldAlert className="h-8 w-8" /> : <Shield className="h-8 w-8" />}
              <span className="text-5xl font-mono font-bold timer-display">
                {elapsed ? formatElapsed(elapsed) : "— — : — — : — —"}
              </span>
            </div>
            <div className="mt-3">
              <Badge variant={isWarning ? "destructive" : "default"} className="text-sm">
                {isWarning ? "Wait until 1h30 has passed" : "Safe interval reached"}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dose Input */}
      <Card className="mb-6 grainy glass border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Pill className="h-5 w-5" />
            Add New Dose
          </CardTitle>
          <CardDescription>
            {settings.multiMode
              ? selectedMed
                ? `Logging ${selectedMed.name} (${selectedMed.unit})`
                : "Select a medication below to start logging"
              : "Adjust dose amount and add to your medication log"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex justify-between items-center mb-3">
              <label htmlFor="dose" className="text-sm font-medium">
                Dose Amount
              </label>
              <span className="text-2xl font-bold text-medical-blue">
                {doseAmt.toFixed(decimals)}
                {unitLabel ? ` ${unitLabel}` : ""}
              </span>
            </div>
            <Slider
              id="dose"
              min={sliderMin}
              max={sliderMax}
              step={sliderStep}
              value={[doseAmt]}
              onValueChange={(value) => {
                setDoseAmt(value[0]);
                triggerHaptic("light");
              }}
              disabled={settings.multiMode && !selectedMed}
              className="mb-4"
            />
          </div>

          <div className="flex gap-2">
            {settings.multiMode && (
              <Select
                value={settings.selectedMedId ?? undefined}
                onValueChange={(v) => setSettings((s) => ({ ...s, selectedMedId: v }))}
              >
                <SelectTrigger className="flex-1 h-12">
                  <SelectValue placeholder={medications.length === 0 ? "No medications" : "Select medication"} />
                </SelectTrigger>
                <SelectContent>
                  {medications.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} ({m.unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              onClick={addDose}
              disabled={!canAddDose}
              className={`${settings.multiMode ? "flex-1" : "w-full"} h-12 text-lg font-semibold transition-all duration-200`}
            >
              {isAddingDose ? "Adding..." : "Add Dose"}
            </Button>
          </div>

          {settings.multiMode && medications.length === 0 && (
            <p className="text-xs text-muted-foreground text-center">
              Add a medication in Settings to start logging.
            </p>
          )}
          <p className="text-xs text-muted-foreground text-center">Data saved locally in your browser</p>
        </CardContent>
      </Card>

      {/* History */}
      <Card className="grainy glass border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Recent Doses
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[50vh] overflow-y-auto">
            {entries.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Pill className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No doses recorded yet</p>
                <p className="text-sm">Add your first dose above</p>
              </div>
            ) : (
              <div className="space-y-1">
                {entries.map((entry, i) => {
                  const dt = DateTime.fromISO(entry.tsISO).setZone(PARIS);
                  const dayLabel = dayOffsetLabel(dt);
                  const interval = intervalSincePrev(i);

                  return (
                    <div key={entry.tsISO + i}>
                      <div
                        className="flex justify-between items-center py-3 px-3 rounded-lg hover:bg-muted/30 transition-all duration-300 grainy border border-transparent hover:border-border/30 cursor-pointer select-none"
                        onMouseDown={(e) => handleLongPressStart(entry, e)}
                        onMouseUp={handleLongPressEnd}
                        onMouseLeave={handleLongPressEnd}
                        onTouchStart={(e) => handleLongPressStart(entry, e)}
                        onTouchEnd={handleLongPressEnd}
                        onTouchCancel={handleLongPressEnd}
                        style={{ touchAction: "manipulation" }}
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xl font-bold text-medical-blue">
                              {entry.amount}
                              {entry.unit ? ` ${entry.unit}` : ""}
                            </span>
                            {entry.medName && (
                              <Badge variant="secondary" className="text-xs">
                                {entry.medName}
                              </Badge>
                            )}
                            {dayLabel && (
                              <Badge variant="outline" className="text-xs">
                                {dayLabel}
                              </Badge>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground">{formatEntryTime(dt)}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium text-foreground">{interval}</div>
                          <div className="text-xs text-muted-foreground">interval</div>
                        </div>
                      </div>
                      {i < entries.length - 1 && <Separator />}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteEntry} onOpenChange={() => setDeleteEntry(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Dose</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the dose of {deleteEntry?.amount}
              {deleteEntry?.unit ? ` ${deleteEntry.unit}` : ""} from{" "}
              {deleteEntry && DateTime.fromISO(deleteEntry.tsISO).setZone(PARIS).toFormat("ccc dd LLL HH:mm")}? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteEntry && deleteSingleDose(deleteEntry)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Settings Dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>Configure medications and logging behavior.</DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-2">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="multi-mode" className="text-base">
                  Multi-medication mode
                </Label>
                <p className="text-xs text-muted-foreground">
                  Track doses for multiple medications, each with its own range and unit.
                </p>
              </div>
              <Switch id="multi-mode" checked={settings.multiMode} onCheckedChange={toggleMultiMode} />
            </div>

            {settings.multiMode && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-base">Medications</Label>
                  <Button size="sm" variant="outline" onClick={addMedication}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add
                  </Button>
                </div>

                {medications.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No medications yet. Add one to get started.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {medications.map((m) => (
                      <div key={m.id} className="rounded-lg border border-border/60 p-3 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <Input
                            value={m.name}
                            onChange={(e) => updateMedication(m.id, { name: e.target.value })}
                            placeholder="Medication name"
                            className="font-medium"
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteMedication(m.id)}
                            aria-label={`Delete ${m.name}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          <div>
                            <Label className="text-xs">Unit</Label>
                            <Input
                              value={m.unit}
                              onChange={(e) => updateMedication(m.id, { unit: e.target.value })}
                              placeholder="mg"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Min</Label>
                            <Input
                              type="number"
                              value={m.min}
                              onChange={(e) => updateMedication(m.id, { min: Number(e.target.value) })}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Max</Label>
                            <Input
                              type="number"
                              value={m.max}
                              onChange={(e) => updateMedication(m.id, { max: Number(e.target.value) })}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Step</Label>
                            <Input
                              type="number"
                              value={m.step}
                              step="0.1"
                              onChange={(e) =>
                                updateMedication(m.id, { step: Math.max(0.01, Number(e.target.value) || 0.1) })
                              }
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button onClick={() => setSettingsOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Footer */}
      <div className="text-center mt-6 pt-4 border-t">
        <p className="text-xs text-muted-foreground">Offline-capable • Local-only • Europe/Paris time</p>
      </div>
    </div>
  );
};

export default Index;
