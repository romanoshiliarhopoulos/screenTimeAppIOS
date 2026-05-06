import { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { auth } from "../lib/firebase";
import { colors, spacing, fontSize } from "../theme";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";

type LeaderboardEntry = {
  userId: string;
  displayName: string;
  totalSeconds: number;
  sessionCount: number;
  byApp: Record<string, number>;
  rank: number;
};

function formatDuration(s: number): string {
  if (s === 0) return "0m";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function localDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const MEDALS = ["🥇", "🥈", "🥉"];

type Props = {
  groupId: string;
  groupName: string;
  /** true = top-3 preview for HomeScreen, false = full list with app breakdown */
  compact?: boolean;
  /** true = hide the card's own header (when parent already shows group name) */
  hideHeader?: boolean;
  /** increment to trigger a re-fetch on pull-to-refresh */
  refreshTick?: number;
};

export default function LeaderboardCard({
  groupId,
  groupName,
  compact = false,
  hideHeader = false,
  refreshTick = 0,
}: Props) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
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
        // Pass local date so server doesn't use UTC today
        const date = localDateString();
        const res = await fetch(
          `${API_URL}/api/groups/${groupId}/leaderboard?date=${date}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setEntries(data.leaderboard ?? []);
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
      <View style={[styles.card, hideHeader && styles.cardNoTop]}>
        <ActivityIndicator
          color={colors.accentPrimary}
          style={{ marginVertical: spacing.md }}
        />
      </View>
    );
  }

  if (entries.length === 0) {
    return (
      <View style={[styles.card, hideHeader && styles.cardNoTop]}>
        <Text style={styles.emptyText}>No usage data yet for today.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.card, hideHeader && styles.cardNoTop]}>
      {/* Card header — shown on HomeScreen compact view */}
      {!hideHeader && (
        <>
          <View style={styles.header}>
            <View>
              <Text style={styles.groupName}>{groupName}</Text>
              <Text style={styles.subtitle}>
                Today · {entries.length} member{entries.length !== 1 ? "s" : ""}
              </Text>
            </View>
            {myEntry && (
              <View style={styles.myRankBadge}>
                <Text style={styles.myRankText}>
                  {myEntry.rank <= 3 ? MEDALS[myEntry.rank - 1] : `#${myEntry.rank}`}{" "}
                  you
                </Text>
              </View>
            )}
          </View>
          <View style={styles.divider} />
        </>
      )}

      {/* Sub-header when header is hidden (inside Friends expanded view) */}
      {hideHeader && (
        <>
          <View style={styles.subHeader}>
            <Text style={styles.subtitle}>
              Today · {entries.length} member{entries.length !== 1 ? "s" : ""}
            </Text>
            {myEntry && (
              <View style={styles.myRankBadge}>
                <Text style={styles.myRankText}>
                  {myEntry.rank <= 3 ? MEDALS[myEntry.rank - 1] : `#${myEntry.rank}`}{" "}
                  you
                </Text>
              </View>
            )}
          </View>
          <View style={styles.divider} />
        </>
      )}

      {/* Rows */}
      {visible.map((entry, i) => {
        const isMe = entry.userId === currentUid;
        const medal = entry.rank <= 3 ? MEDALS[entry.rank - 1] : null;
        const isExpanded = !compact && expandedUid === entry.userId;
        const appEntries = Object.entries(entry.byApp).sort((a, b) => b[1] - a[1]);

        return (
          <View key={entry.userId}>
            {i > 0 && <View style={styles.rowDivider} />}

            <TouchableOpacity
              style={[styles.row, isMe && styles.rowMe]}
              onPress={() =>
                !compact && setExpandedUid(isExpanded ? null : entry.userId)
              }
              activeOpacity={compact ? 1 : 0.7}
            >
              <Text style={[styles.rank, isMe && styles.rankMe]}>
                {medal ?? `#${entry.rank}`}
              </Text>

              <View style={styles.nameBlock}>
                <Text style={[styles.name, isMe && styles.nameMe]} numberOfLines={1}>
                  {entry.displayName}
                  {isMe ? <Text style={styles.youTag}> · you</Text> : null}
                </Text>
                {!compact && (
                  <Text style={styles.sessions}>
                    {entry.sessionCount} session{entry.sessionCount !== 1 ? "s" : ""}
                  </Text>
                )}
              </View>

              <View style={styles.rightBlock}>
                <Text style={[styles.time, isMe && styles.timeMe]}>
                  {formatDuration(entry.totalSeconds)}
                </Text>
                {!compact && (
                  <Ionicons
                    name={isExpanded ? "chevron-up" : "chevron-down"}
                    size={13}
                    color={colors.textTertiary}
                    style={{ marginLeft: 4 }}
                  />
                )}
              </View>
            </TouchableOpacity>

            {/* App breakdown */}
            {isExpanded && (
              <View style={styles.appBreakdown}>
                {appEntries.length === 0 ? (
                  <Text style={styles.noApps}>No app breakdown available.</Text>
                ) : (
                  appEntries.map(([app, secs]) => {
                    const pct = entry.totalSeconds > 0 ? secs / entry.totalSeconds : 0;
                    return (
                      <View key={app} style={styles.appRow}>
                        <View style={styles.appMeta}>
                          <Text style={styles.appName}>{app}</Text>
                          <Text style={styles.appTime}>{formatDuration(secs)}</Text>
                        </View>
                        <View style={styles.barTrack}>
                          <View
                            style={[
                              styles.bar,
                              { width: `${Math.round(pct * 100)}%` as any },
                            ]}
                          />
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
          <Text style={styles.moreHint}>
            +{entries.length - 3} more · see Friends tab
          </Text>
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
  // When attached below a group row, remove top radius so they visually connect
  cardNoTop: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    marginTop: 1,
    marginBottom: 0,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  subHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  groupName: {
    fontSize: fontSize.title,
    fontWeight: "700",
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
  },
  myRankBadge: {
    backgroundColor: colors.surface2,
    borderRadius: 12,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  myRankText: {
    fontSize: fontSize.small,
    color: colors.accentSecondary,
    fontWeight: "600",
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  rowDivider: {
    height: 1,
    backgroundColor: colors.surface2,
    marginHorizontal: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    gap: spacing.sm,
  },
  rowMe: {
    backgroundColor: `${colors.accentPrimary}14`,
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
  },
  name: {
    fontSize: fontSize.body,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  nameMe: {
    color: colors.accentPrimary,
  },
  youTag: {
    fontSize: fontSize.small,
    color: colors.accentSecondary,
    fontWeight: "400",
  },
  sessions: {
    fontSize: fontSize.tiny,
    color: colors.textTertiary,
    marginTop: 2,
  },
  rightBlock: {
    flexDirection: "row",
    alignItems: "center",
  },
  time: {
    fontSize: fontSize.body,
    fontWeight: "600",
    color: colors.textPrimary,
    letterSpacing: -0.3,
    minWidth: 44,
    textAlign: "right",
  },
  timeMe: {
    color: colors.accentPrimary,
  },
  appBreakdown: {
    backgroundColor: colors.surface2,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: 8,
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
  barTrack: {
    height: 3,
    backgroundColor: colors.border,
    borderRadius: 2,
    overflow: "hidden",
  },
  bar: {
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
