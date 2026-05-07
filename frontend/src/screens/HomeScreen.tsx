import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../lib/firebase";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { colors, spacing, fontSize } from "../theme";
import LeaderboardCard from "../components/LeaderboardCard";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";

function formatDate(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDuration(seconds: number): string {
  if (seconds === 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

type DayStat = {
  date: string;
  totalSeconds: number;
  sessionCount: number;
  maxSessionSeconds: number;
  byApp: Record<string, number>;
};

type Group = { id: string; name: string };

export default function HomeScreen() {
  // --- DEBUG: log push token + Firebase ID token for notification testing ---
  // Remove this block once testing is done.
  useEffect(() => {
    async function logDebugTokens() {
      if (!Device.isDevice) return;
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== "granted") {
        console.log("[DEBUG] Notification permission denied");
        return;
      }
      const pushToken = (await Notifications.getExpoPushTokenAsync()).data;
      const idToken = await auth.currentUser?.getIdToken();
      console.log("[DEBUG] Expo push token:", pushToken);
      console.log("[DEBUG] Firebase ID token:", idToken);
    }
    logDebugTokens();
  }, []);
  // --- END DEBUG ---

  const [today, setToday] = useState<DayStat | null>(null);
  const [yesterday, setYesterday] = useState<DayStat | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  async function fetchData() {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;

      const todayDate = new Date();
      const yesterdayDate = new Date(todayDate);
      yesterdayDate.setDate(todayDate.getDate() - 1);
      const start = toDateString(yesterdayDate);
      const end = toDateString(todayDate);
      const todayStr = toDateString(todayDate);
      const yestStr = toDateString(yesterdayDate);

      const headers = { Authorization: `Bearer ${token}` };

      const [statsRes, groupsRes] = await Promise.all([
        fetch(`${API_URL}/api/usage/stats?start=${start}&end=${end}`, { headers }),
        fetch(`${API_URL}/api/groups`, { headers }),
      ]);

      if (statsRes.ok) {
        const data: DayStat[] = await statsRes.json();
        setToday(data.find((d) => d.date === todayStr) ?? null);
        setYesterday(data.find((d) => d.date === yestStr) ?? null);
      }

      if (groupsRes.ok) {
        const data = await groupsRes.json();
        setGroups(data.map((g: any) => ({ id: g.groupId, name: g.name })));
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) fetchData();
      else setLoading(false);
    });
    return unsubscribe;
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshTick((t) => t + 1);
    fetchData();
  }, []);

  const vsYesterday =
    yesterday && yesterday.totalSeconds > 0 && today
      ? Math.round(
          ((today.totalSeconds - yesterday.totalSeconds) /
            yesterday.totalSeconds) *
            100,
        )
      : null;

  const sortedApps = today
    ? Object.entries(today.byApp).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.accentPrimary}
        />
      }
    >
      <StatusBar style="light" />

      {refreshing && (
        <View style={styles.refreshBanner}>
          <Ionicons name="refresh" size={14} color={colors.accentPrimary} />
          <Text style={styles.refreshBannerText}>Updating…</Text>
        </View>
      )}

      <Text style={styles.dateLabel}>{formatDate()}</Text>

      {/* Primary metric */}
      <View style={styles.metricCard}>
        {loading ? (
          <ActivityIndicator color={colors.accentPrimary} />
        ) : (
          <>
            <Text style={styles.metricNumber}>
              {today ? formatDuration(today.totalSeconds) : "—"}
            </Text>
            <Text style={styles.metricLabel}>screen time today</Text>
          </>
        )}
      </View>

      {/* Quick stats row */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statNumber}>
            {loading ? "—" : today ? String(today.sessionCount) : "—"}
          </Text>
          <Text style={styles.statLabel}>sessions</Text>
        </View>
        <View style={[styles.statBox, styles.statBoxMiddle]}>
          <Text style={styles.statNumber}>
            {loading
              ? "—"
              : today && today.maxSessionSeconds > 0
                ? formatDuration(today.maxSessionSeconds)
                : "—"}
          </Text>
          <Text style={styles.statLabel}>longest</Text>
        </View>
        <View style={styles.statBox}>
          <Text
            style={[
              styles.statNumber,
              !loading && vsYesterday !== null && vsYesterday < 0 && { color: colors.success },
              !loading && vsYesterday !== null && vsYesterday > 0 && { color: colors.destructive },
            ]}
          >
            {loading
              ? "—"
              : vsYesterday !== null
                ? `${vsYesterday > 0 ? "+" : ""}${vsYesterday}%`
                : "—"}
          </Text>
          <Text style={styles.statLabel}>vs. yesterday</Text>
        </View>
      </View>

      {/* Apps Today */}
      <Text style={styles.sectionHeader}>Apps Today</Text>
      {loading ? (
        <View style={styles.emptyCard}>
          <ActivityIndicator color={colors.accentPrimary} />
        </View>
      ) : sortedApps.length === 0 ? (
        <View style={[styles.emptyCard, { marginBottom: spacing.lg }]}>
          <Text style={styles.emptyText}>No data yet.</Text>
          <Text style={styles.emptySubtext}>
            Set up iOS Shortcuts in Profile to start tracking.
          </Text>
        </View>
      ) : (
        <View style={[styles.appsCard, { marginBottom: spacing.lg }]}>
          {sortedApps.map(([app, secs], i) => {
            const pct =
              today && today.totalSeconds > 0 ? secs / today.totalSeconds : 0;
            return (
              <View key={app}>
                {i > 0 && <View style={styles.divider} />}
                <View style={styles.appRow}>
                  <View style={styles.appMeta}>
                    <Text style={styles.appName}>{app}</Text>
                    <Text style={styles.appTime}>{formatDuration(secs)}</Text>
                  </View>
                  <View style={styles.appBarTrack}>
                    <View
                      style={[
                        styles.appBar,
                        { width: `${Math.round(pct * 100)}%` as any },
                      ]}
                    />
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Friends leaderboard — one compact card per group */}
      {!loading && groups.length > 0 && (
        <>
          <Text style={styles.sectionHeader}>Friends Challenge</Text>
          {groups.map((g) => (
            <LeaderboardCard
              key={g.id}
              groupId={g.id}
              groupName={g.name}
              compact
              refreshTick={refreshTick}
            />
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  refreshBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface1,
    borderRadius: 8,
    marginBottom: spacing.sm,
  },
  refreshBannerText: {
    fontSize: fontSize.small,
    color: colors.accentPrimary,
    fontWeight: "500",
  },
  dateLabel: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    letterSpacing: 0.2,
  },
  metricCard: {
    backgroundColor: colors.surface1,
    borderRadius: 8,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    alignItems: "center",
    minHeight: 80,
    justifyContent: "center",
  },
  metricNumber: {
    fontSize: fontSize.numericLarge,
    fontWeight: "700",
    color: colors.accentPrimary,
    letterSpacing: -1,
  },
  metricLabel: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  statsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  statBox: {
    flex: 1,
    backgroundColor: colors.surface1,
    borderRadius: 8,
    padding: spacing.md,
    alignItems: "center",
  },
  statBoxMiddle: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
  statNumber: {
    fontSize: fontSize.numericSmall,
    fontWeight: "600",
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  statLabel: {
    fontSize: fontSize.tiny,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  sectionHeader: {
    fontSize: fontSize.section,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: spacing.md,
    letterSpacing: -0.3,
  },
  emptyCard: {
    backgroundColor: colors.surface1,
    borderRadius: 8,
    padding: spacing.lg,
    alignItems: "center",
  },
  emptyText: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  emptySubtext: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    textAlign: "center",
    lineHeight: 18,
  },
  appsCard: {
    backgroundColor: colors.surface1,
    borderRadius: 8,
    padding: spacing.md,
  },
  appRow: { paddingVertical: spacing.sm, gap: spacing.sm },
  appMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  appName: {
    fontSize: fontSize.body,
    fontWeight: "500",
    color: colors.textPrimary,
  },
  appTime: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    fontWeight: "500",
  },
  appBarTrack: {
    height: 4,
    backgroundColor: colors.surface2,
    borderRadius: 2,
    overflow: "hidden",
  },
  appBar: {
    height: "100%",
    backgroundColor: colors.accentMuted,
    borderRadius: 2,
  },
  divider: { height: 1, backgroundColor: colors.border },
});
