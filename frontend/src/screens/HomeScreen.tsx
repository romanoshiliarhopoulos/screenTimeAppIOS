import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  Animated,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { onAuthStateChanged } from "firebase/auth";
import { useNavigation } from "@react-navigation/native";
import { auth } from "../lib/firebase";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { colors, spacing, fontSize } from "../theme";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";

// ── Helpers ──────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (seconds === 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  if (m === 0) return "<1m";
  return `${m}m`;
}

function formatDate(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatCooldown(until: string): string {
  const remaining = Math.max(0, new Date(until).getTime() - Date.now());
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

// ── Types ────────────────────────────────────────────────────────────

type FriendData = {
  userId: string;
  displayName: string;
  status: "live" | "recent" | "offline" | "hidden";
  currentApp?: string;
  sessionStart?: string;
  sessionMinutes?: number;
  totalTodaySeconds?: number;
  dailyLimitPct?: number;
  totalOpens?: number;
  streakDays?: number;
  canShame?: boolean;
  shameCooldownUntil?: string | null;
  isGhost?: boolean;
};

type MeData = {
  userId: string;
  totalTodaySeconds: number;
  dailyLimitPct: number;
  totalOpens: number;
  currentApp?: string;
  sessionMinutes?: number;
};

const QUICK_REACTIONS = [
  { emoji: "angry", label: "Disappointed", icon: "😤" },
  { emoji: "facepalm", label: "Facepalm", icon: "🤦" },
  { emoji: "eyes", label: "Watching you", icon: "👀" },
  { emoji: "emergency", label: "Emergency", icon: "🚨" },
];

// ── Component ────────────────────────────────────────────────────────

export default function HomeScreen() {
  const navigation = useNavigation<any>();

  // Push token registration
  useEffect(() => {
    async function registerToken() {
      if (!Device.isDevice) return;
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== "granted") return;
      const pushToken = (await Notifications.getExpoPushTokenAsync()).data;
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) return;
      fetch(`${API_URL}/api/users/me/push-token`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          deviceId: "default",
          expoPushToken: pushToken,
          platform: "ios",
        }),
      }).catch(() => {});
    }
    registerToken();
  }, []);

  const [friends, setFriends] = useState<FriendData[]>([]);
  const [me, setMe] = useState<MeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [shamingFriend, setShamingFriend] = useState<string | null>(null);
  const [showReactions, setShowReactions] = useState<string | null>(null);
  const [cooldownTick, setCooldownTick] = useState(0);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse animation for live indicator
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  // Cooldown timer — tick every second
  useEffect(() => {
    const interval = setInterval(() => setCooldownTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(() => fetchData(), 30000);
    return () => clearInterval(interval);
  }, []);

  async function fetchData() {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/friends/live`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setFriends(data.friends ?? []);
        setMe(data.me ?? null);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) fetchData();
      else setLoading(false);
    });
    return unsub;
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, []);

  async function handleShame(friendId: string, type: string, reaction?: string) {
    setShamingFriend(friendId);
    setShowReactions(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch(
        `${API_URL}/api/shame?toUserId=${friendId}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ type, reaction }),
        },
      );
      const data = await res.json();
      if (data.status === "cooldown") {
        Alert.alert("Cooldown", data.message);
      }
      fetchData(); // Refresh to update cooldown status
    } catch {
      Alert.alert("Error", "Failed to send shame");
    } finally {
      setShamingFriend(null);
    }
  }

  async function handleSOS() {
    Alert.alert(
      "SOS — Rescue Me",
      "This will notify all friends and lock you out for 15 minutes. Are you sure?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send SOS",
          style: "destructive",
          onPress: async () => {
            const token = await auth.currentUser?.getIdToken();
            if (!token) return;
            await fetch(`${API_URL}/api/sos`, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` },
            });
            Alert.alert("SOS Sent", "Your friends have been notified. You're locked out for 15 minutes.");
            fetchData();
          },
        },
      ],
    );
  }

  const liveCount = friends.filter((f) => f.status === "live").length;

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

      {/* Header */}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.dateLabel}>{formatDate()}</Text>
          {liveCount > 0 && (
            <View style={styles.liveRow}>
              <Animated.View style={[styles.liveDot, { opacity: pulseAnim }] as any} />
              <Text style={styles.liveText}>
                {liveCount} scrolling now
              </Text>
            </View>
          )}
        </View>
        <TouchableOpacity style={styles.sosButton} onPress={handleSOS}>
          <Text style={styles.sosText}>SOS</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingCard}>
          <ActivityIndicator color={colors.accentPrimary} />
        </View>
      ) : friends.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="people-outline" size={40} color={colors.textTertiary} />
          <Text style={styles.emptyTitle}>No friends yet</Text>
          <Text style={styles.emptySubtext}>
            Join a group in the Friends tab to see your friends' live activity
          </Text>
        </View>
      ) : (
        <>
          {/* Friend cards */}
          {friends.map((friend) => (
            <FriendCard
              key={friend.userId}
              friend={friend}
              pulseAnim={pulseAnim}
              shamingFriend={shamingFriend}
              showReactions={showReactions}
              setShowReactions={setShowReactions}
              onShame={handleShame}
              cooldownTick={cooldownTick}
            />
          ))}
        </>
      )}

      {/* Wall of Shame link */}
      <TouchableOpacity
        style={styles.wallLink}
        onPress={() => navigation.navigate("Stats", { screen: "WallOfShame" })}
        activeOpacity={0.75}
      >
        <Text style={styles.wallLinkLabel}>🏛️ Wall of Shame</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
      </TouchableOpacity>

      {/* My status card */}
      {me && (
        <>
          <View style={styles.youDivider}>
            <View style={styles.youDividerLine} />
            <Text style={styles.youDividerText}>YOU</Text>
            <View style={styles.youDividerLine} />
          </View>
          <View style={styles.myCard}>
            {me.currentApp ? (
              <View style={styles.myLiveRow}>
                <View style={[styles.statusDot, styles.dotLive]} />
                <Text style={styles.myAppText}>
                  {me.currentApp} · {me.sessionMinutes}m
                </Text>
              </View>
            ) : null}
            <View style={styles.myStatsRow}>
              <View style={styles.myStat}>
                <Text style={styles.myStatNumber}>
                  {formatDuration(me.totalTodaySeconds)}
                </Text>
                <Text style={styles.myStatLabel}>today</Text>
              </View>
              <View style={styles.myStatDivider} />
              <View style={styles.myStat}>
                <Text style={styles.myStatNumber}>{me.dailyLimitPct}%</Text>
                <Text style={styles.myStatLabel}>of limit</Text>
              </View>
              <View style={styles.myStatDivider} />
              <View style={styles.myStat}>
                <Text style={styles.myStatNumber}>{me.totalOpens}</Text>
                <Text style={styles.myStatLabel}>opens</Text>
              </View>
            </View>
            <View style={styles.limitBar}>
              <View
                style={[
                  styles.limitBarFill,
                  {
                    width: `${Math.min(100, me.dailyLimitPct)}%` as any,
                    backgroundColor:
                      me.dailyLimitPct > 80
                        ? colors.destructive
                        : me.dailyLimitPct > 50
                          ? colors.warning
                          : colors.success,
                  },
                ]}
              />
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}

// ── Friend Card Component ────────────────────────────────────────────

function FriendCard({
  friend,
  pulseAnim,
  shamingFriend,
  showReactions,
  setShowReactions,
  onShame,
  cooldownTick,
}: {
  friend: FriendData;
  pulseAnim: Animated.Value;
  shamingFriend: string | null;
  showReactions: string | null;
  setShowReactions: (id: string | null) => void;
  onShame: (friendId: string, type: string, reaction?: string) => void;
  cooldownTick: number;
}) {
  const isLive = friend.status === "live";
  const isRecent = friend.status === "recent";
  const isGhost = friend.isGhost;
  const isShaming = shamingFriend === friend.userId;
  const reactionsVisible = showReactions === friend.userId;

  return (
    <View style={[styles.friendCard, isLive && styles.friendCardLive]}>
      {/* Status dot + name */}
      <View style={styles.friendHeader}>
        <View style={styles.friendNameRow}>
          {isLive ? (
            <Animated.View
              style={[styles.statusDot, styles.dotLive, { opacity: pulseAnim }] as any}
            />
          ) : isRecent ? (
            <View style={[styles.statusDot, styles.dotRecent]} />
          ) : isGhost ? (
            <View style={[styles.statusDot, styles.dotGhost]} />
          ) : (
            <View style={[styles.statusDot, styles.dotOffline]} />
          )}
          <Text style={styles.friendName}>{friend.displayName}</Text>
          {friend.streakDays ? (
            <Text style={styles.streakBadge}>
              🔥 {friend.streakDays}d
            </Text>
          ) : null}
        </View>

        {/* Shame button or cooldown */}
        {isLive && friend.canShame ? (
          <TouchableOpacity
            style={styles.shameButton}
            onPress={() => onShame(friend.userId, "quick", "eyes")}
            onLongPress={() =>
              setShowReactions(reactionsVisible ? null : friend.userId)
            }
            disabled={isShaming}
          >
            {isShaming ? (
              <ActivityIndicator size="small" color={colors.textPrimary} />
            ) : (
              <Text style={styles.shameButtonText}>SHAME 🔥</Text>
            )}
          </TouchableOpacity>
        ) : isLive && !friend.canShame && friend.shameCooldownUntil ? (
          <View style={styles.cooldownBadge}>
            <Text style={styles.cooldownText}>
              ⏳ {formatCooldown(friend.shameCooldownUntil)}
            </Text>
          </View>
        ) : !isLive && friend.status === "offline" ? (
          <View style={styles.cleanBadge}>
            <Text style={styles.cleanText}>Clean</Text>
          </View>
        ) : null}
      </View>

      {/* Quick reactions popover */}
      {reactionsVisible && (
        <View style={styles.reactionsRow}>
          {QUICK_REACTIONS.map((r) => (
            <TouchableOpacity
              key={r.emoji}
              style={[
                styles.reactionButton,
                r.emoji === "emergency" && styles.reactionEmergency,
              ]}
              onPress={() => onShame(friend.userId, "quick", r.emoji)}
            >
              <Text style={styles.reactionIcon}>{r.icon}</Text>
              <Text style={styles.reactionLabel}>{r.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Session info */}
      {isLive && friend.currentApp ? (
        <View style={styles.sessionRow}>
          <Text style={styles.sessionApp}>{friend.currentApp}</Text>
          <Text style={styles.sessionDot}> · </Text>
          <Text style={styles.sessionTime}>{friend.sessionMinutes}m</Text>
        </View>
      ) : isGhost ? (
        <Text style={styles.ghostText}>👻 Ghost mode</Text>
      ) : friend.status === "offline" ? (
        <Text style={styles.offlineText}>
          {(friend.totalTodaySeconds ?? 0) > 0
            ? `${formatDuration(friend.totalTodaySeconds ?? 0)} today`
            : "No activity today"}
        </Text>
      ) : null}

      {/* Daily limit bar */}
      {friend.dailyLimitPct !== undefined && friend.dailyLimitPct > 0 && (
        <View style={styles.friendLimitRow}>
          <View style={styles.friendLimitBar}>
            <View
              style={[
                styles.friendLimitFill,
                {
                  width: `${Math.min(100, friend.dailyLimitPct)}%` as any,
                  backgroundColor:
                    friend.dailyLimitPct > 80
                      ? colors.destructive
                      : friend.dailyLimitPct > 50
                        ? colors.warning
                        : colors.accentMuted,
                },
              ]}
            />
          </View>
          <Text style={styles.friendLimitText}>{friend.dailyLimitPct}%</Text>
        </View>
      )}

      {/* Opens count */}
      {(friend.totalOpens ?? 0) > 0 && (
        <Text style={styles.opensText}>
          {friend.totalOpens} opens today
        </Text>
      )}
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: 100,
  },

  // Header
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: spacing.lg,
  },
  dateLabel: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  liveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.destructive,
  },
  liveText: {
    fontSize: fontSize.body,
    fontWeight: "600",
    color: colors.destructive,
  },
  sosButton: {
    backgroundColor: colors.destructive + "22",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.destructive + "44",
  },
  sosText: {
    fontSize: fontSize.body,
    fontWeight: "700",
    color: colors.destructive,
  },

  // Loading / Empty
  loadingCard: {
    backgroundColor: colors.surface1,
    borderRadius: 12,
    padding: spacing.xl,
    alignItems: "center",
  },
  emptyCard: {
    backgroundColor: colors.surface1,
    borderRadius: 12,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
  },
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

  // Friend card
  friendCard: {
    backgroundColor: colors.surface1,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  friendCardLive: {
    borderWidth: 1,
    borderColor: colors.destructive + "44",
  },
  friendHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  friendNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotLive: { backgroundColor: "#34C759" },
  dotRecent: { backgroundColor: "#FF9500" },
  dotOffline: { backgroundColor: "#636366" },
  dotGhost: { backgroundColor: "#8E8E93" },
  friendName: {
    fontSize: fontSize.title,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  streakBadge: {
    fontSize: fontSize.small,
    color: colors.warning,
    fontWeight: "500",
  },

  // Shame button
  shameButton: {
    backgroundColor: colors.destructive,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  shameButtonText: {
    fontSize: fontSize.small,
    fontWeight: "700",
    color: "#fff",
  },
  cooldownBadge: {
    backgroundColor: colors.surface2,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  cooldownText: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    fontWeight: "500",
  },
  cleanBadge: {
    backgroundColor: colors.success + "22",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  cleanText: {
    fontSize: fontSize.small,
    color: colors.success,
    fontWeight: "600",
  },

  // Quick reactions
  reactionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  reactionButton: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
    gap: 2,
  },
  reactionEmergency: {
    backgroundColor: colors.destructive + "22",
    borderWidth: 1,
    borderColor: colors.destructive + "44",
  },
  reactionIcon: { fontSize: 18 },
  reactionLabel: {
    fontSize: 9,
    color: colors.textTertiary,
    fontWeight: "500",
  },

  // Session info
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
  },
  sessionApp: {
    fontSize: fontSize.body,
    color: colors.textPrimary,
    fontWeight: "500",
  },
  sessionDot: {
    fontSize: fontSize.body,
    color: colors.textTertiary,
  },
  sessionTime: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
  },
  ghostText: {
    fontSize: fontSize.body,
    color: colors.neutral,
    marginTop: 6,
  },
  offlineText: {
    fontSize: fontSize.body,
    color: colors.textTertiary,
    marginTop: 6,
  },

  // Daily limit bar
  friendLimitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
  },
  friendLimitBar: {
    flex: 1,
    height: 4,
    backgroundColor: colors.surface2,
    borderRadius: 2,
    overflow: "hidden",
  },
  friendLimitFill: {
    height: "100%",
    borderRadius: 2,
  },
  friendLimitText: {
    fontSize: fontSize.tiny,
    color: colors.textTertiary,
    fontWeight: "500",
    width: 30,
    textAlign: "right",
  },

  opensText: {
    fontSize: fontSize.tiny,
    color: colors.textTertiary,
    marginTop: 4,
  },

  // Wall of Shame link
  wallLink: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.surface1,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    marginBottom: spacing.sm,
  },
  wallLinkLabel: {
    fontSize: fontSize.body,
    fontWeight: "600",
    color: colors.textSecondary,
  },

  // You divider
  youDivider: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  youDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  youDividerText: {
    fontSize: fontSize.small,
    fontWeight: "600",
    color: colors.textTertiary,
    letterSpacing: 1,
  },

  // My card
  myCard: {
    backgroundColor: colors.surface1,
    borderRadius: 12,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.accentPrimary + "33",
  },
  myLiveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: spacing.sm,
  },
  myAppText: {
    fontSize: fontSize.body,
    fontWeight: "500",
    color: colors.accentPrimary,
  },
  myStatsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  myStat: {
    flex: 1,
    alignItems: "center",
  },
  myStatDivider: {
    width: 1,
    height: 28,
    backgroundColor: colors.border,
  },
  myStatNumber: {
    fontSize: fontSize.numericSmall,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  myStatLabel: {
    fontSize: fontSize.tiny,
    color: colors.textTertiary,
    marginTop: 2,
  },
  limitBar: {
    height: 4,
    backgroundColor: colors.surface2,
    borderRadius: 2,
    overflow: "hidden",
    marginTop: spacing.sm,
  },
  limitBarFill: {
    height: "100%",
    borderRadius: 2,
  },
});
