import { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { auth } from "../lib/firebase";
import { colors, spacing, fontSize } from "../theme";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";

type LeaderboardEntry = {
  userId: string;
  displayName: string;
  totalSeconds: number;
  sessionCount: number;
  byApp: Record<string, number>;
  streakDays: number;
  isLive: boolean;
  dailyCapSeconds: number;
  rank: number;
  blockCredits?: number;
};

function fmt(s: number): string {
  if (s === 0) return "0m";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function localDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function usagePct(total: number, cap: number): number {
  if (cap <= 0) return 0;
  return Math.min(total / cap, 1.2); // allow slight overflow for visual
}

function barColor(pct: number): string {
  if (pct >= 1.0) return colors.destructive;
  if (pct >= 0.75) return colors.warning;
  return colors.success;
}

function timeColor(pct: number): string {
  if (pct >= 1.0) return colors.destructive;
  if (pct >= 0.75) return colors.warning;
  return colors.textPrimary;
}

const MEDALS = ["🥇", "🥈", "🥉"];

export type { LeaderboardEntry };

type Props = {
  groupId: string;
  groupName: string;
  compact?: boolean;
  hideHeader?: boolean;
  refreshTick?: number;
  onLoad?: (entries: LeaderboardEntry[], groupAvg: number) => void;
};

export default function LeaderboardCard({
  groupId,
  compact = false,
  hideHeader = false,
  refreshTick = 0,
  onLoad,
}: Props) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [groupAvg, setGroupAvg] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedUid, setExpandedUid] = useState<string | null>(null);

  const currentUid = auth.currentUser?.uid;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        const date = localDateString();
        const res = await fetch(
          `${API_URL}/api/groups/${groupId}/leaderboard?date=${date}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) {
          const loaded = data.leaderboard ?? [];
          const avg = data.groupAvgSeconds ?? 0;
          setEntries(loaded);
          setGroupAvg(avg);
          onLoad?.(loaded, avg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [groupId, refreshTick]);

  const myEntry = entries.find((e) => e.userId === currentUid);
  const visible = compact ? entries.slice(0, 3) : entries;

  if (loading) {
    return (
      <View style={hideHeader ? styles.innerWrap : styles.card}>
        <ActivityIndicator color={colors.accentPrimary} style={{ marginVertical: spacing.md }} />
      </View>
    );
  }

  if (entries.length === 0) {
    return (
      <View style={hideHeader ? styles.innerWrap : styles.card}>
        <Text style={styles.emptyText}>No data yet — use Shortcuts to record sessions.</Text>
      </View>
    );
  }

  return (
    <View style={hideHeader ? styles.innerWrap : styles.card}>
      {/* Summary bar */}
      <View style={styles.summaryRow}>
        <Text style={styles.summaryText}>
          {entries.length} member{entries.length !== 1 ? "s" : ""} · avg {fmt(groupAvg)} today
        </Text>
        {myEntry && (
          <View style={styles.myBadge}>
            <Text style={styles.myBadgeText}>
              {myEntry.rank <= 3 ? MEDALS[myEntry.rank - 1] : `#${myEntry.rank}`} you
            </Text>
          </View>
        )}
      </View>
      <View style={styles.divider} />

      {visible.map((entry, i) => {
        const isMe = entry.userId === currentUid;
        const medal = entry.rank <= 3 ? MEDALS[entry.rank - 1] : null;
        const isExpanded = !compact && expandedUid === entry.userId;
        const pct = usagePct(entry.totalSeconds, entry.dailyCapSeconds);
        const appEntries = Object.entries(entry.byApp).sort((a, b) => b[1] - a[1]);

        return (
          <View key={entry.userId}>
            {i > 0 && <View style={styles.rowDivider} />}

            <TouchableOpacity
              style={[styles.row, isMe && styles.rowMe]}
              onPress={() => !compact && setExpandedUid(isExpanded ? null : entry.userId)}
              activeOpacity={compact ? 1 : 0.7}
            >
              {/* Rank */}
              <Text style={[styles.rank, isMe && styles.rankMe]}>
                {medal ?? `#${entry.rank}`}
              </Text>

              {/* Name + live dot + progress bar */}
              <View style={styles.nameBlock}>
                <View style={styles.nameRow}>
                  <Text style={[styles.name, isMe && styles.nameMe]} numberOfLines={1}>
                    {entry.displayName}
                    {isMe ? <Text style={styles.youTag}> · you</Text> : null}
                  </Text>
                  {entry.isLive && (
                    <View style={styles.liveDot} />
                  )}
                </View>
                {/* Progress bar */}
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.bar,
                      {
                        width: `${Math.min(Math.round(pct * 100), 100)}%` as any,
                        backgroundColor: barColor(pct),
                      },
                    ]}
                  />
                </View>
              </View>

              {/* Right: streak + credits + time */}
              <View style={styles.rightBlock}>
                {entry.streakDays > 0 && (
                  <View style={styles.streakBadge}>
                    <Text style={styles.streakText}>🔥{entry.streakDays}</Text>
                  </View>
                )}
                {(entry.blockCredits ?? 0) > 0 && (
                  <View style={styles.creditsBadge}>
                    <Text style={styles.creditsText}>💎{entry.blockCredits}</Text>
                  </View>
                )}
                <Text style={[styles.time, { color: timeColor(pct) }, isMe && pct < 0.75 && styles.timeMe]}>
                  {fmt(entry.totalSeconds)}
                </Text>
              </View>
            </TouchableOpacity>

            {/* App breakdown (expanded) */}
            {isExpanded && (
              <View style={styles.breakdown}>
                {appEntries.length === 0 ? (
                  <Text style={styles.noApps}>No app breakdown available.</Text>
                ) : (
                  appEntries.map(([app, secs]) => {
                    const appPct = entry.totalSeconds > 0 ? secs / entry.totalSeconds : 0;
                    return (
                      <View key={app} style={styles.appRow}>
                        <View style={styles.appMeta}>
                          <Text style={styles.appName}>{app}</Text>
                          <Text style={styles.appTime}>{fmt(secs)}</Text>
                        </View>
                        <View style={styles.appBarTrack}>
                          <View style={[styles.appBar, { width: `${Math.round(appPct * 100)}%` as any }]} />
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            )}
          </View>
        );
      })}

      {compact && entries.length > 3 && (
        <View style={styles.moreRow}>
          <Text style={styles.moreHint}>+{entries.length - 3} more · see Friends tab</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface1,
    borderRadius: 8,
    overflow: "hidden",
    marginBottom: spacing.lg,
  },
  innerWrap: {
    overflow: "hidden",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  summaryText: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    fontWeight: "500",
  },
  myBadge: {
    backgroundColor: `${colors.accentPrimary}20`,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  myBadgeText: {
    fontSize: fontSize.small,
    color: colors.accentPrimary,
    fontWeight: "600",
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  rowDivider: {
    height: 1,
    backgroundColor: `${colors.border}60`,
    marginHorizontal: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    gap: spacing.sm,
  },
  rowMe: {
    backgroundColor: `${colors.accentPrimary}10`,
  },
  rank: {
    width: 30,
    fontSize: fontSize.body,
    color: colors.textSecondary,
    fontWeight: "600",
    textAlign: "center",
  },
  rankMe: {
    color: colors.accentPrimary,
  },
  nameBlock: {
    flex: 1,
    gap: 5,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  name: {
    fontSize: fontSize.body,
    fontWeight: "600",
    color: colors.textPrimary,
    flexShrink: 1,
  },
  nameMe: {
    color: colors.accentPrimary,
  },
  youTag: {
    fontSize: fontSize.tiny,
    color: colors.accentSecondary,
    fontWeight: "400",
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  barTrack: {
    height: 3,
    backgroundColor: colors.surface2,
    borderRadius: 2,
    overflow: "hidden",
  },
  bar: {
    height: "100%",
    borderRadius: 2,
  },
  rightBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  streakBadge: {
    backgroundColor: colors.surface2,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  streakText: {
    fontSize: fontSize.tiny,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  creditsBadge: {
    backgroundColor: `${colors.accentPrimary}18`,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  creditsText: {
    fontSize: fontSize.tiny,
    fontWeight: "600",
    color: colors.accentPrimary,
  },
  time: {
    fontSize: fontSize.body,
    fontWeight: "700",
    letterSpacing: -0.3,
    minWidth: 44,
    textAlign: "right",
  },
  timeMe: {
    color: colors.accentPrimary,
  },
  breakdown: {
    backgroundColor: colors.surface2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 10,
  },
  appRow: { gap: 4 },
  appMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  appName: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    fontWeight: "500",
  },
  appTime: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
  },
  appBarTrack: {
    height: 3,
    backgroundColor: colors.border,
    borderRadius: 2,
    overflow: "hidden",
  },
  appBar: {
    height: "100%",
    backgroundColor: colors.accentMuted,
    borderRadius: 2,
  },
  noApps: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
  },
  emptyText: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    textAlign: "center",
    padding: spacing.md,
    lineHeight: 18,
  },
  moreRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  moreHint: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
  },
});
