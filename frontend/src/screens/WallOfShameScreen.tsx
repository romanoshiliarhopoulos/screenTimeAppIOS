import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { auth } from "../lib/firebase";
import { colors, spacing, fontSize } from "../theme";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";

type WallEntry = {
  id: string;
  userId: string;
  displayName: string;
  type: string;
  detail: Record<string, any>;
  createdAt: string;
};

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getShameEmoji(type: string): string {
  switch (type) {
    case "excessive_opens":
      return "🚨";
    case "shame_bypass":
      return "👻";
    case "streak_broken":
      return "💀";
    case "late_night":
      return "🌙";
    case "daily_limit":
      return "⏰";
    default:
      return "🏛️";
  }
}

function getShameDescription(entry: WallEntry): string {
  const detail = entry.detail || {};
  switch (entry.type) {
    case "excessive_opens":
      return `Opened ${detail.appName || "an app"} ${detail.openCount || "way too many"} times`;
    case "shame_bypass":
      return `Skipped a shame from ${detail.fromName || "a friend"}`;
    case "streak_broken":
      return `Broke a ${detail.streakDays || "??"}-day streak`;
    case "late_night":
      return `Scrolling ${detail.appName || ""}at ${detail.time || "late night"}`;
    case "daily_limit":
      return `Exceeded daily limit on ${detail.appName || "an app"}`;
    default:
      return entry.type.replace(/_/g, " ");
  }
}

export default function WallOfShameScreen() {
  const [entries, setEntries] = useState<WallEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchData() {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/wall-of-shame`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setEntries(data);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, []);

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
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accentPrimary} size="large" />
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyEmoji}>🏛️</Text>
          <Text style={styles.emptyTitle}>Wall is empty</Text>
          <Text style={styles.emptySubtext}>
            No one has earned a spot here yet. Keep scrolling and you'll be first.
          </Text>
        </View>
      ) : (
        entries.map((entry, i) => (
          <View key={entry.id || i} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.emoji}>{getShameEmoji(entry.type)}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{entry.displayName}</Text>
                <Text style={styles.time}>{formatRelativeTime(entry.createdAt)}</Text>
              </View>
            </View>
            <Text style={styles.description}>{getShameDescription(entry)}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: 100,
  },
  centered: { marginVertical: spacing.xl, alignItems: "center" },
  emptyCard: {
    backgroundColor: colors.surface1,
    borderRadius: 12,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  emptyEmoji: { fontSize: 40 },
  emptyTitle: {
    fontSize: fontSize.title,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  emptySubtext: {
    fontSize: fontSize.body,
    color: colors.textTertiary,
    textAlign: "center",
    lineHeight: 20,
  },
  card: {
    backgroundColor: colors.surface1,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  emoji: { fontSize: 24 },
  name: {
    fontSize: fontSize.body,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  time: {
    fontSize: fontSize.tiny,
    color: colors.textTertiary,
  },
  description: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    lineHeight: 20,
    paddingLeft: 36,
  },
});
