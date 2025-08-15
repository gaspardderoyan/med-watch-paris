import React, { useEffect, useMemo, useState } from "react";
import { DateTime, Duration } from "luxon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider-custom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Clock, Pill, Shield, ShieldAlert } from "lucide-react";

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

  function addDose() {
    const tsISO = toISOParis(nowParis());
    const newEntry: DoseEntry = { tsISO, amount: Number(doseAmt.toFixed(1)) };
    const next = [newEntry, ...entries];
    setEntries(next);
    saveEntries(next);
  }

  function intervalSincePrev(i: number): string {
    if (i === entries.length - 1) return "—";
    const curr = DateTime.fromISO(entries[i].tsISO);
    const prev = DateTime.fromISO(entries[i + 1].tsISO);
    const d = curr.diff(prev, ["hours", "minutes"]).negate();
    const h = Math.floor(d.as("hours"));
    const m = Math.floor(d.minus({ hours: h }).as("minutes"));
    return `${h}h ${m}m`;
  }

  return (
    <div className="min-h-screen bg-background p-4 max-w-2xl mx-auto">
      {/* Header */}
      <div className="text-center mb-8 pt-4">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Pill className="h-8 w-8 text-medical-blue" />
          <h1 className="text-3xl font-bold text-foreground">Dose Tracker</h1>
        </div>
        <p className="text-muted-foreground">Precise medication timing & safety monitoring</p>
      </div>

      {/* Big Timer Display */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="text-center">
            <div
              className={`inline-flex items-center gap-3 px-6 py-4 rounded-2xl transition-all duration-300 ${
                isWarning
                  ? "bg-timer-bg-warning text-timer-warning"
                  : "bg-timer-bg-safe text-timer-safe"
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
      <Card className="mb-6">
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
              onValueChange={(value) => setDoseAmt(value[0])}
              className="mb-4"
            />
          </div>
          <Button onClick={addDose} className="w-full h-12 text-lg font-semibold">
            Add Dose
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Data saved locally in your browser
          </p>
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Recent Doses
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[50vh]">
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
                      <div className="flex justify-between items-center py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors">
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
          </ScrollArea>
        </CardContent>
      </Card>

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
