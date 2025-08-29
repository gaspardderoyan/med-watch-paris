import React, { useEffect, useMemo, useState } from "react";
import { DateTime, Duration } from "luxon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider-custom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Clock, Pill, Shield, ShieldAlert, Settings, Download, Trash2 } from "lucide-react";

type DoseEntry = { tsISO: string; amount: number };

const CSV_KEY = "doseTracker.csv";
const CSV_HEADER = "timestamp,amount";
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

function parseCSV(csv: string): DoseEntry[] {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const hasHeader = lines[0].toLowerCase().startsWith("timestamp,");
  const rows = hasHeader ? lines.slice(1) : lines;
  const entries: DoseEntry[] = [];
  for (const line of rows) {
    const [ts, amt] = line.split(",");
    if (!ts || !amt) continue;
    const amount = Number(amt);
    if (Number.isFinite(amount)) {
      entries.push({ tsISO: ts.trim(), amount });
    }
  }
  return entries.sort((a, b) => DateTime.fromISO(b.tsISO).toMillis() - DateTime.fromISO(a.tsISO).toMillis());
}

function entriesToCSV(entries: DoseEntry[]): string {
  const lines = [CSV_HEADER, ...entries.map((e) => `${e.tsISO},${e.amount}`)];
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
  const csv = entriesToCSV(entries);
  localStorage.setItem(CSV_KEY, csv);
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
  const [doseAmt, setDoseAmt] = useState<number>(1.0);
  const [tick, setTick] = useState<number>(0);
  const [isAddingDose, setIsAddingDose] = useState<boolean>(false);
  const [deleteEntry, setDeleteEntry] = useState<DoseEntry | null>(null);
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);
  const { toast } = useToast();

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

  // Haptic feedback function
  function triggerHaptic(type: 'light' | 'medium' | 'heavy' = 'light') {
    if (navigator.vibrate) {
      const patterns = {
        light: [10],
        medium: [20],
        heavy: [50]
      };
      navigator.vibrate(patterns[type]);
    }
  }

  async function addDose() {
    if (isAddingDose) return; // Prevent double clicks
    
    setIsAddingDose(true);
    triggerHaptic('medium');
    
    try {
      const tsISO = toISOParis(nowParis());
      const newEntry: DoseEntry = { tsISO, amount: Number(doseAmt.toFixed(1)) };
      const next = [newEntry, ...entries];
      setEntries(next);
      saveEntries(next);
      
      toast({
        title: "Dose added",
        description: `${doseAmt.toFixed(1)} dose recorded at ${DateTime.now().setZone(PARIS).toFormat('HH:mm')}`
      });
    } finally {
      // Add delay to prevent rapid clicks
      setTimeout(() => setIsAddingDose(false), 1000);
    }
  }

  function deleteAllDoses() {
    setEntries([]);
    localStorage.removeItem(CSV_KEY);
    triggerHaptic('heavy');
    toast({
      title: "All doses deleted",
      description: "Your dose history has been cleared"
    });
  }

  function exportToCSV() {
    if (entries.length === 0) {
      toast({
        title: "No data to export",
        description: "Add some doses first"
      });
      return;
    }

    const csv = entriesToCSV(entries);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dose-tracker-${DateTime.now().toFormat('yyyy-MM-dd')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    triggerHaptic('light');
    toast({
      title: "CSV exported",
      description: "Your dose data has been downloaded"
    });
  }

  function deleteSingleDose(entryToDelete: DoseEntry) {
    const updated = entries.filter(e => e.tsISO !== entryToDelete.tsISO);
    setEntries(updated);
    saveEntries(updated);
    setDeleteEntry(null);
    triggerHaptic('medium');
    toast({
      title: "Dose deleted",
      description: `Dose from ${DateTime.fromISO(entryToDelete.tsISO).setZone(PARIS).toFormat('HH:mm')} removed`
    });
  }

  function handleLongPressStart(entry: DoseEntry, event: React.TouchEvent | React.MouseEvent) {
    // Prevent default touch behavior to avoid conflicts
    if ('touches' in event) {
      event.preventDefault();
    }
    
    const timer = setTimeout(() => {
      setDeleteEntry(entry);
      triggerHaptic('heavy');
    }, 500);
    setLongPressTimer(timer);
  }

  function handleLongPressEnd(event?: React.TouchEvent | React.MouseEvent) {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  }

  function intervalSincePrev(i: number): string {
    if (i === entries.length - 1) return "—";
    const curr = DateTime.fromISO(entries[i].tsISO);
    const prev = DateTime.fromISO(entries[i + 1].tsISO);
    const d = curr.diff(prev, ["hours", "minutes"]); // Remove .negate() - curr is newer than prev
    const h = Math.floor(d.as("hours"));
    const m = Math.floor(d.minus({ hours: h }).as("minutes"));
    return `${h}h ${m}m`;
  }

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
              onClick={() => triggerHaptic('light')}
            >
              <Settings className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48" align="end">
            <div className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={exportToCSV}
              >
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="w-full justify-start"
                onClick={deleteAllDoses}
              >
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
              {isWarning ? (
                <ShieldAlert className="h-8 w-8" />
              ) : (
                <Shield className="h-8 w-8" />
              )}
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
            Adjust dose amount and add to your medication log
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex justify-between items-center mb-3">
              <label htmlFor="dose" className="text-sm font-medium">
                Dose Amount
              </label>
              <span className="text-2xl font-bold text-medical-blue">
                {doseAmt.toFixed(1)}
              </span>
            </div>
            <Slider
              id="dose"
              min={0}
              max={2}
              step={0.1}
              value={[doseAmt]}
              onValueChange={(value) => {
                setDoseAmt(value[0]);
                triggerHaptic('light');
              }}
              onPointerMove={() => triggerHaptic('light')}
              className="mb-4"
            />
          </div>
          <Button 
            onClick={addDose} 
            disabled={isAddingDose}
            className="w-full h-12 text-lg font-semibold transition-all duration-200"
          >
            {isAddingDose ? "Adding..." : "Add Dose"}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Data saved locally in your browser
          </p>
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
                        style={{ touchAction: 'manipulation' }}
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xl font-bold text-medical-blue">
                              {entry.amount.toFixed(1)}
                            </span>
                            {dayLabel && (
                              <Badge variant="outline" className="text-xs">
                                {dayLabel}
                              </Badge>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {formatEntryTime(dt)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium text-foreground">
                            {interval}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            interval
                          </div>
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
              Are you sure you want to delete the dose of {deleteEntry?.amount.toFixed(1)} from{' '}
              {deleteEntry && DateTime.fromISO(deleteEntry.tsISO).setZone(PARIS).toFormat('ccc dd LLL HH:mm')}?
              This action cannot be undone.
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

      {/* Footer */}
      <div className="text-center mt-6 pt-4 border-t">
        <p className="text-xs text-muted-foreground">
          Offline-capable • Local-only • Europe/Paris time
        </p>
      </div>
    </div>
  );
};

export default Index;
