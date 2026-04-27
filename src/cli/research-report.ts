import { loadConfig } from "../config.js";
import { AnalysisSnapshotStore, ResearchSnapshot } from "../research/snapshot-store.js";
import { labelOutcomes, LabeledResearchSnapshot } from "../research/outcome-labeler.js";

function bucketConfidence(confidence: number): string {
  if (confidence < 40) return "0-39";
  if (confidence < 60) return "40-59";
  if (confidence < 80) return "60-79";
  return "80-100";
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pct(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(3)}%`;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    groups[key] ??= [];
    groups[key].push(item);
  }
  return groups;
}

function averageForwardReturn(items: LabeledResearchSnapshot[]): string {
  return pct(avg(items.map((item) => item.outcomes.forwardReturn1h).filter((v): v is number => v !== undefined)));
}

function directionalHitRate(items: LabeledResearchSnapshot[], sufficient: boolean): string {
  if (!sufficient) return "insufficient sample";
  const directional = items.filter((item) => item.state.setup === "LONG-PULLBACK" || item.state.setup === "SHORT-REJECTION");
  const scored = directional.filter((item) => item.outcomes.forwardReturn1h !== undefined);
  if (scored.length === 0) return "n/a";
  const hits = scored.filter((item) => {
    const ret = item.outcomes.forwardReturn1h ?? 0;
    return item.state.setup === "LONG-PULLBACK" ? ret > 0 : ret < 0;
  }).length;
  return `${((hits / scored.length) * 100).toFixed(1)}% (${hits}/${scored.length})`;
}

function falseAlertRate(items: LabeledResearchSnapshot[], sufficient: boolean): string {
  if (!sufficient) return "insufficient sample";
  const alerts = items.filter((item) => item.state.setup === "LONG-PULLBACK" || item.state.setup === "SHORT-REJECTION");
  const scored = alerts.filter((item) => item.outcomes.maxAdverseExcursion1h !== undefined);
  if (scored.length === 0) return "n/a";
  const falseAlerts = scored.filter((item) => (item.outcomes.maxAdverseExcursion1h ?? 0) < -0.0015).length;
  return `${((falseAlerts / scored.length) * 100).toFixed(1)}% (${falseAlerts}/${scored.length})`;
}

function summarizeGroups(
  title: string,
  groups: Record<string, LabeledResearchSnapshot[]>
): Record<string, { count: number; averageForwardReturn1h: string }> {
  return Object.fromEntries(
    Object.entries(groups).map(([key, values]) => [
      key,
      { count: values.length, averageForwardReturn1h: averageForwardReturn(values) }
    ])
  );
}

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new AnalysisSnapshotStore(config.analysisSnapshotPath);
  const snapshots: ResearchSnapshot[] = await store.readAll();
  const labeled = labelOutcomes(snapshots);
  const sufficient = labeled.length >= 100;

  const report = {
    path: config.analysisSnapshotPath,
    count: labeled.length,
    sampleStatus: sufficient ? "sufficient" : "insufficient sample (<100)",
    bySession: summarizeGroups("session", groupBy(labeled, (item) => item.session ?? "unknown")),
    byRegime: summarizeGroups("regime", groupBy(labeled, (item) => item.state.regime)),
    byConfidenceBucket: summarizeGroups("confidence", groupBy(labeled, (item) => bucketConfidence(item.confidence))),
    averageForwardReturn: {
      m15: pct(avg(labeled.map((item) => item.outcomes.forwardReturn15m).filter((v): v is number => v !== undefined))),
      h1: pct(avg(labeled.map((item) => item.outcomes.forwardReturn1h).filter((v): v is number => v !== undefined))),
      h4: pct(avg(labeled.map((item) => item.outcomes.forwardReturn4h).filter((v): v is number => v !== undefined)))
    },
    directionalBiasHitRate: directionalHitRate(labeled, sufficient),
    falseAlertRate: falseAlertRate(labeled, sufficient),
    eventVsNonEvent: summarizeGroups(
      "event",
      groupBy(labeled, (item) => item.eventRisk.mode === "normal" ? "non-event" : "event")
    )
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
