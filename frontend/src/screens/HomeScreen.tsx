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

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmt(s: number): string {
  if (s === 0) return "0m";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  if (m === 0) return "<1m";
  return `${m}m`;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function pctChange(today: number, yesterday: number): number | null {
  if (yesterday === 0) return null;
  return Math.round(((today - yesterday) / yesterday) * 100);
}

function shameEmoji(type: string): string {
  switch (type) {
    case "excessive_opens": return "🚨";
    case "shame_bypass":    return "👻";
    case "streak_broken":   return "💀";
    case "late_night":      return "🌙";
    case "daily_limit":     return "⏰";
    default:                return "🏛️";
  }
}

function shameDesc(entry: WallEntry): string {
  const d = entry.detail || {};
  switch (entry.type) {
    case "excessive_opens": return `Opened ${d.appName || "an app"} ${d.openCount || "?"} times`;
    case "shame_bypass":    return `Skipped a shame from ${d.fromName || "a friend"}`;
    case "streak_broken":   return `Broke a ${d.streakDays || "??"}-day streak`;
    case "late_night":      return `Scrolling ${d.appName || ""} at ${d.time || "late night"}`;
    case "daily_limit":     return `Exceeded daily limit on ${d.appName || "an app"}`;
    default:                return entry.type.replace(/_/g, " ");
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

type FriendData = {
  userId: string;
  displayName: string;
  status: "live" | "recent" | "offline" | "hidden";
  currentApp?: string;
  sessionMinutes?: number;
  lastSeenMinsAgo?: number | null;
  totalTodaySeconds?: number;
  dailyLimitPct?: number;
  totalOpens?: number;
  streakDays?: number;
  canShame?: boolean;
  shameCooldownUntil?: string | null;
  isGhost?: boolean;
};

type MeData = {
  totalTodaySeconds: number;
  dailyLimitPct: number;
  totalOpens: number;
  currentApp?: string;
  sessionMinutes?: number;
  yesterdaySeconds: number;
  yesterdayOpens: number;
};

type WallEntry = {
  id: string;
  userId: string;
  displayName: string;
  type: string;
  detail: Record<string, any>;
  createdAt: string;
};

const REACTIONS = [
  { emoji: "angry",     icon: "😤", label: "Disappointed" },
  { emoji: "facepalm",  icon: "🤦", label: "Facepalm" },
  { emoji: "eyes",      icon: "👀", label: "Watching" },
  { emoji: "emergency", icon: "🚨", label: "Emergency" },
];

// ── Main Screen ──────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const navigation = useNavigation<any>();

  // Push token
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
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: "default", expoPushToken: pushToken, platform: "ios" }),
      }).catch(() => {});
    }
    registerToken();
  }, []);

  const [friends, setFriends] = useState<FriendData[]>([]);
  const [me, setMe] = useState<MeData | null>(null);
  const [wall, setWall] = useState<WallEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [shamingId, setShamingId] = useState<string | null>(null);
  const [reactionsFor, setReactionsFor] = useState<string | null>(null);
  const [cooldownTick, setCooldownTick] = useState(0);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.3, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,   duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setCooldownTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(fetchAll, 30000);
    return () => clearInterval(t);
  }, []);

  async function fetchAll() {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const headers = { Authorization: `Bearer ${token}` };
      const [liveRes, wallRes] = await Promise.all([
        fetch(`${API_URL}/api/friends/live`, { headers }),
        fetch(`${API_URL}/api/wall-of-shame`, { headers }),
      ]);
      if (liveRes.ok) {
        const d = await liveRes.json();
        setFriends(d.friends ?? []);
        setMe(d.me ?? null);
      }
      if (wallRes.ok) {
        setWall(await wallRes.json());
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) fetchAll();
      else setLoading(false);
    });
    return unsub;
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchAll();
  }, []);

  async function handleShame(friendId: string, reaction?: string) {
    setShamingId(friendId);
    setReactionsFor(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`${API_URL}/api/shame?toUserId=${friendId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "quick", reaction: reaction ?? "eyes" }),
      });
      const data = await res.json();
      if (data.status === "cooldown") Alert.alert("Cooldown", data.message);
      else fetchAll();
    } catch {
      Alert.alert("Error", "Failed to send shame");
    } finally {
      setShamingId(null);
    }
  }

  async function handleSOS() {
    Alert.alert("SOS — Rescue Me",
      "Notifies all friends and locks you out for 15 minutes.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Send SOS", style: "destructive", onPress: async () => {
          const token = await auth.currentUser?.getIdToken();
          await fetch(`${API_URL}/api/sos`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          });
          Alert.alert("SOS Sent", "Your friends have been notified. Locked out 15 min.");
          fetchAll();
        }},
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
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accentPrimary} />
      }
    >
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Live</Text>
          {liveCount > 0 && (
            <View style={styles.liveRow}>
              <Animated.View style={[styles.livePulse, { opacity: pulseAnim }] as any} />
              <Text style={styles.liveCount}>{liveCount} scrolling now</Text>
            </View>
          )}
        </View>
        <TouchableOpacity style={styles.sosBtn} onPress={handleSOS}>
          <Text style={styles.sosTxt}>SOS</Text>
        </TouchableOpacity>
      </View>

      {/* ── Friend Scroll ── */}
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.accentPrimary} />
        </View>
      ) : friends.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="people-outline" size={36} color={colors.textTertiary} />
          <Text style={styles.emptyTitle}>No friends yet</Text>
          <Text style={styles.emptyBody}>Join a group in the Friends tab</Text>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.friendScroll}
        >
          {friends.map((f) => (
            <FriendPill
              key={f.userId}
              friend={f}
              pulseAnim={pulseAnim}
              shamingId={shamingId}
              reactionsFor={reactionsFor}
              setReactionsFor={setReactionsFor}
              onShame={handleShame}
              cooldownTick={cooldownTick}
            />
          ))}
        </ScrollView>
      )}

      {/* ── Personal Insight ── */}
      {me && <InsightCard me={me} />}

      {/* ── Accountability Feed ── */}
      <View style={styles.feedHeader}>
        <Text style={styles.feedTitle}>Accountability Feed</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate("Stats", { screen: "WallOfShame" })}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.feedSeeAll}>See all</Text>
        </TouchableOpacity>
      </View>

      {wall.length === 0 ? (
        <View style={styles.feedEmpty}>
          <Text style={styles.feedEmptyText}>The feed is clean — keep it that way.</Text>
        </View>
      ) : (
        wall.slice(0, 12).map((entry, i) => (
          <FeedEntry key={entry.id || i} entry={entry} />
        ))
      )}
    </ScrollView>
  );
}

// ── Friend Pill ──────────────────────────────────────────────────────────────

function FriendPill({
  friend,
  pulseAnim,
  shamingId,
  reactionsFor,
  setReactionsFor,
  onShame,
  cooldownTick,
}: {
  friend: FriendData;
  pulseAnim: Animated.Value;
  shamingId: string | null;
  reactionsFor: string | null;
  setReactionsFor: (id: string | null) => void;
  onShame: (id: string, reaction?: string) => void;
  cooldownTick: number;
}) {
  const isLive    = friend.status === "live";
  const isRecent  = friend.status === "recent";
  const isShaming = shamingId === friend.userId;
  const showReact = reactionsFor === friend.userId;

  // Shame eligibility: live + 5+ continuous minutes + not on cooldown
  const shameReady = isLive && (friend.sessionMinutes ?? 0) >= 5 && !!friend.canShame;
  const onCooldown = isLive && !friend.canShame && !!friend.shameCooldownUntil;
  const warming    = isLive && (friend.sessionMinutes ?? 0) < 5;

  function cooldownLabel(): string {
    if (!friend.shameCooldownUntil) return "";
    const rem = Math.max(0, new Date(friend.shameCooldownUntil).getTime() - Date.now());
    const m = Math.floor(rem / 60000);
    const s = Math.floor((rem % 60000) / 1000);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  return (
    <View style={[styles.pill, isLive && styles.pillLive]}>
      {/* Status line */}
      <View style={styles.pillStatusRow}>
        {isLive ? (
          <Animated.View style={[styles.pillDot, styles.dotGreen, { opacity: pulseAnim }] as any} />
        ) : isRecent ? (
          <View style={[styles.pillDot, styles.dotOrange]} />
        ) : (
          <View style={[styles.pillDot, styles.dotGrey]} />
        )}
        <Text style={styles.pillStatus} numberOfLines={1}>
          {isLive
            ? "LIVE"
            : isRecent
              ? friend.lastSeenMinsAgo != null
                ? `${friend.lastSeenMinsAgo}m ago`
                : "Active today"
              : friend.isGhost
                ? "👻 ghost"
                : "Offline"}
        </Text>
      </View>

      {/* Name */}
      <Text style={styles.pillName} numberOfLines={1}>{friend.displayName}</Text>

      {/* Sub-info */}
      {isLive && friend.currentApp ? (
        <Text style={styles.pillSub} numberOfLines={1}>
          {friend.currentApp} · {friend.sessionMinutes}m
        </Text>
      ) : (friend.totalTodaySeconds ?? 0) > 0 ? (
        <Text style={styles.pillSub}>{fmt(friend.totalTodaySeconds ?? 0)} today</Text>
      ) : (
        <Text style={styles.pillSub}>No activity</Text>
      )}

      {/* Streak */}
      {(friend.streakDays ?? 0) > 0 && (
        <Text style={styles.pillStreak}>🔥 {friend.streakDays}d</Text>
      )}

      {/* Shame controls — only for live friends */}
      {isLive && (
        <View style={styles.pillShameWrap}>
          {onCooldown ? (
            <View style={styles.pillCooldown}>
              <Text style={styles.pillCooldownTxt}>⏳ {cooldownLabel()}</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.pillShameBtn, !shameReady && styles.pillShameBtnDim]}
              disabled={!shameReady || isShaming}
              onPress={() => setReactionsFor(showReact ? null : friend.userId)}
              activeOpacity={0.8}
            >
              {isShaming ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : warming ? (
                <Text style={styles.pillShameTxt}>
                  {friend.sessionMinutes}m / 5m
                </Text>
              ) : (
                <Text style={styles.pillShameTxt}>SHAME 🔥</Text>
              )}
            </TouchableOpacity>
          )}

          {showReact && (
            <View style={styles.reactionPopup}>
              {REACTIONS.map((r) => (
                <TouchableOpacity
                  key={r.emoji}
                  style={[styles.reactionBtn, r.emoji === "emergency" && styles.reactionEmergency]}
                  onPress={() => onShame(friend.userId, r.emoji)}
                >
                  <Text style={styles.reactionIcon}>{r.icon}</Text>
                  <Text style={styles.reactionLabel}>{r.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ── Insight Card ─────────────────────────────────────────────────────────────

function InsightCard({ me }: { me: MeData }) {
  const pct = pctChange(me.totalTodaySeconds, me.yesterdaySeconds);
  const opensPct = pctChange(me.totalOpens, me.yesterdayOpens);

  const barPct = Math.min(me.dailyLimitPct, 100);
  const barColor =
    me.dailyLimitPct >= 100 ? colors.destructive :
    me.dailyLimitPct >= 75  ? colors.warning :
    colors.success;

  return (
    <View style={styles.insight}>
      <Text style={styles.insightLabel}>Today</Text>

      <View style={styles.insightRow}>
        {/* Total time */}
        <View style={styles.insightStat}>
          <Text style={styles.insightNum}>{fmt(me.totalTodaySeconds)}</Text>
          <Text style={styles.insightMeta}>screen time</Text>
          {pct !== null && (
            <Text style={[styles.insightDelta, { color: pct > 0 ? colors.destructive : colors.success }]}>
              {pct > 0 ? "+" : ""}{pct}% vs yesterday
            </Text>
          )}
        </View>

        <View style={styles.insightDivider} />

        {/* Pickups */}
        <View style={styles.insightStat}>
          <Text style={styles.insightNum}>{me.totalOpens}</Text>
          <Text style={styles.insightMeta}>pickups</Text>
          {opensPct !== null && (
            <Text style={[styles.insightDelta, { color: opensPct > 0 ? colors.destructive : colors.success }]}>
              {opensPct > 0 ? "+" : ""}{opensPct}% vs yesterday
            </Text>
          )}
        </View>

        <View style={styles.insightDivider} />

        {/* Limit */}
        <View style={styles.insightStat}>
          <Text style={[styles.insightNum, { color: barColor }]}>{me.dailyLimitPct}%</Text>
          <Text style={styles.insightMeta}>of limit</Text>
        </View>
      </View>

      {/* Limit bar */}
      <View style={styles.insightBarTrack}>
        <View style={[styles.insightBar, { width: `${barPct}%` as any, backgroundColor: barColor }]} />
      </View>

      {me.currentApp && (
        <Text style={styles.insightLive}>
          Currently: {me.currentApp} · {me.sessionMinutes}m
        </Text>
      )}
    </View>
  );
}

// ── Feed Entry ───────────────────────────────────────────────────────────────

function FeedEntry({ entry }: { entry: WallEntry }) {
  const initials = entry.displayName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <View style={styles.feedCard}>
      <View style={styles.feedAvatar}>
        <Text style={styles.feedAvatarTxt}>{initials}</Text>
      </View>
      <View style={styles.feedBody}>
        <View style={styles.feedTopRow}>
          <Text style={styles.feedName}>{entry.displayName}</Text>
          <Text style={styles.feedTime}>{relTime(entry.createdAt)}</Text>
        </View>
        <Text style={styles.feedDesc}>
          {shameEmoji(entry.type)} {shameDesc(entry)}
        </Text>
      </View>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: 100,
  },

  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: spacing.md,
  },
  headerTitle: {
    fontSize: fontSize.page,
    fontWeight: "800",
    color: colors.textPrimary,
    letterSpacing: -1,
  },
  liveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 2,
  },
  livePulse: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  liveCount: {
    fontSize: fontSize.small,
    fontWeight: "600",
    color: colors.success,
  },
  sosBtn: {
    backgroundColor: `${colors.destructive}22`,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: `${colors.destructive}44`,
  },
  sosTxt: {
    fontSize: fontSize.body,
    fontWeight: "700",
    color: colors.destructive,
  },

  // Loading / empty
  loadingWrap: {
    paddingVertical: spacing.xl,
    alignItems: "center",
  },
  emptyCard: {
    backgroundColor: colors.surface1,
    borderRadius: 14,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    fontSize: fontSize.title,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  emptyBody: {
    fontSize: fontSize.body,
    color: colors.textTertiary,
    textAlign: "center",
  },

  // Friend horizontal scroll
  friendScroll: {
    paddingRight: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },

  // Friend pill
  pill: {
    width: 145,
    backgroundColor: colors.surface1,
    borderRadius: 14,
    padding: 12,
    gap: 4,
  },
  pillLive: {
    borderWidth: 1,
    borderColor: `${colors.success}50`,
  },
  pillStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 2,
  },
  pillDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  dotGreen:  { backgroundColor: colors.success },
  dotOrange: { backgroundColor: colors.warning },
  dotGrey:   { backgroundColor: colors.textTertiary },
  pillStatus: {
    fontSize: fontSize.tiny,
    fontWeight: "700",
    color: colors.textTertiary,
    letterSpacing: 0.3,
  },
  pillName: {
    fontSize: fontSize.body,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  pillSub: {
    fontSize: fontSize.tiny,
    color: colors.textSecondary,
  },
  pillStreak: {
    fontSize: fontSize.tiny,
    color: colors.warning,
    fontWeight: "600",
  },
  pillShameWrap: {
    marginTop: 6,
  },
  pillShameBtn: {
    backgroundColor: colors.destructive,
    borderRadius: 7,
    paddingVertical: 6,
    alignItems: "center",
  },
  pillShameBtnDim: {
    backgroundColor: colors.surface2,
  },
  pillShameTxt: {
    fontSize: fontSize.tiny,
    fontWeight: "700",
    color: "#fff",
  },
  pillCooldown: {
    backgroundColor: colors.surface2,
    borderRadius: 7,
    paddingVertical: 6,
    alignItems: "center",
  },
  pillCooldownTxt: {
    fontSize: fontSize.tiny,
    color: colors.textTertiary,
    fontWeight: "600",
  },
  reactionPopup: {
    position: "absolute",
    bottom: "110%",
    left: -8,
    right: -8,
    backgroundColor: colors.surface1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 6,
    gap: 4,
    zIndex: 999,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  reactionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  reactionEmergency: {
    backgroundColor: `${colors.destructive}22`,
  },
  reactionIcon: { fontSize: 14 },
  reactionLabel: {
    fontSize: fontSize.tiny,
    color: colors.textSecondary,
    fontWeight: "500",
  },

  // Insight card
  insight: {
    backgroundColor: colors.surface1,
    borderRadius: 14,
    padding: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  insightLabel: {
    fontSize: fontSize.small,
    fontWeight: "600",
    color: colors.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  insightRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: spacing.sm,
  },
  insightStat: {
    flex: 1,
    alignItems: "center",
  },
  insightNum: {
    fontSize: fontSize.numericSmall,
    fontWeight: "800",
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  insightMeta: {
    fontSize: fontSize.tiny,
    color: colors.textTertiary,
    marginTop: 2,
  },
  insightDelta: {
    fontSize: 10,
    fontWeight: "600",
    marginTop: 2,
  },
  insightDivider: {
    width: 1,
    height: 40,
    backgroundColor: colors.border,
  },
  insightBarTrack: {
    height: 4,
    backgroundColor: colors.surface2,
    borderRadius: 2,
    overflow: "hidden",
    marginTop: spacing.xs,
  },
  insightBar: {
    height: "100%",
    borderRadius: 2,
  },
  insightLive: {
    fontSize: fontSize.tiny,
    color: colors.accentPrimary,
    marginTop: 8,
    fontWeight: "500",
  },

  // Feed
  feedHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  feedTitle: {
    fontSize: fontSize.title,
    fontWeight: "700",
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  feedSeeAll: {
    fontSize: fontSize.small,
    color: colors.accentPrimary,
    fontWeight: "600",
  },
  feedEmpty: {
    backgroundColor: colors.surface1,
    borderRadius: 12,
    padding: spacing.lg,
    alignItems: "center",
  },
  feedEmptyText: {
    fontSize: fontSize.body,
    color: colors.textTertiary,
    fontStyle: "italic",
  },
  feedCard: {
    backgroundColor: colors.surface1,
    borderRadius: 12,
    padding: 12,
    marginBottom: spacing.sm,
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  feedAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: `${colors.accentPrimary}30`,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  feedAvatarTxt: {
    fontSize: fontSize.small,
    fontWeight: "700",
    color: colors.accentPrimary,
  },
  feedBody: {
    flex: 1,
  },
  feedTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 3,
  },
  feedName: {
    fontSize: fontSize.body,
    fontWeight: "700",
    color: colors.textPrimary,
    flexShrink: 1,
  },
  feedTime: {
    fontSize: fontSize.tiny,
    color: colors.textTertiary,
    marginLeft: 8,
  },
  feedDesc: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    lineHeight: 18,
  },
});
