import React, { useState, useEffect, useCallback, useRef } from "react";
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
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { onAuthStateChanged } from "firebase/auth";
import { useNavigation } from "@react-navigation/native";
import { auth, storage, db } from "../lib/firebase";
import {
  collection,
  query,
  where,
  limit,
  onSnapshot,
} from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import * as ImagePicker from "expo-image-picker";
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

function shameDesc(entry: {
  type: string;
  detail: Record<string, any>;
  displayName: string;
}): string {
  const d = entry.detail || {};
  switch (entry.type) {
    case "excessive_opens":
      return `Opened ${d.appName || "an app"} ${d.openCount || "?"} times`;
    case "shame_bypass":
      return `Skipped a shame from ${d.fromName || "a friend"}`;
    case "streak_broken":
      return `Broke a ${d.streakDays || "??"}-day streak`;
    case "late_night":
      return `Scrolling ${d.appName || ""} at ${d.time || "late night"}`;
    case "daily_limit":
      return `Exceeded daily limit on ${d.appName || "an app"}`;
    default:
      return entry.type.replace(/_/g, " ");
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
  inBreakWindow?: boolean;
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

type FeedItem = {
  id: string;
  kind: "shame" | "wall";
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  // shame fields
  reaction?: string;
  message?: string;
  videoUrl?: string;
  shameType?: string;
  reactions?: Record<string, string[]>;
  // wall fields
  wallType?: string;
  detail?: Record<string, any>;
  createdAt: string;
};

type Award = {
  emoji: string;
  title: string;
  winner: string;
  value: string;
};

const REACTIONS = [
  { emoji: "angry", icon: "😤", label: "Disappointed" },
  { emoji: "facepalm", icon: "🤦", label: "Facepalm" },
  { emoji: "eyes", icon: "👀", label: "Watching" },
  { emoji: "emergency", icon: "🚨", label: "Emergency" },
];

// Maps raw reaction keys stored in Firestore to display emojis
const REACTION_EMOJI_MAP: Record<string, string> = {
  angry: "😤",
  facepalm: "🤦",
  eyes: "👀",
  emergency: "🚨",
};

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

  const [myUid, setMyUid] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendData[]>([]);
  // Stable list of friend IDs — only changes when group membership changes,
  // not when statuses flip. Used as dep for the activeSessions listener.
  const [friendIds, setFriendIds] = useState<string[]>([]);
  const [me, setMe] = useState<MeData | null>(null);
  const [wall, setWall] = useState<FeedItem[]>([]);
  const [awards, setAwards] = useState<Award[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [shamingId, setShamingId] = useState<string | null>(null);
  const [shameTarget, setShameTarget] = useState<FriendData | null>(null);
  const [cooldownTick, setCooldownTick] = useState(0);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setCooldownTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Slow poll: computed stats (60s). Firestore listeners handle real-time updates.
  useEffect(() => {
    const t = setInterval(fetchStats, 60000);
    return () => clearInterval(t);
  }, []);

  // Real-time: activeSessions → update friend live status instantly.
  // Dep on `friendIds` (stable IDs only) not `friends` to avoid re-subscribing
  // every time a status flips inside the callback.
  useEffect(() => {
    if (!myUid || friendIds.length === 0) return;
    const chunks: string[][] = [];
    for (let i = 0; i < friendIds.length; i += 30)
      chunks.push(friendIds.slice(i, i + 30));
    const unsubs = chunks.map((chunk) =>
      onSnapshot(
        query(collection(db, "activeSessions"), where("userId", "in", chunk)),
        (snap) => {
          // Build a map of userId → their latest active session data
          const liveMap = new Map<string, { currentApp: string; sessionMinutes: number }>();
          snap.docs.forEach((d) => {
            const data = d.data();
            const uid = data.userId as string;
            const openTime = data.openTime as string;
            const sessionMinutes = Math.max(0, Math.floor((Date.now() - new Date(openTime).getTime()) / 60000));
            // Keep the latest session per user (highest openTime)
            if (!liveMap.has(uid) || openTime > (snap.docs.find((x) => x.data().userId === uid && liveMap.has(uid))?.data().openTime ?? "")) {
              liveMap.set(uid, { currentApp: data.appName as string, sessionMinutes });
            }
          });
          setFriends((prev) =>
            prev.map((f) => {
              if (liveMap.has(f.userId)) {
                const { currentApp, sessionMinutes } = liveMap.get(f.userId)!;
                return { ...f, status: "live", currentApp, sessionMinutes };
              }
              return {
                ...f,
                status: f.status === "live" ? "recent" : f.status,
              };
            }),
          );
        },
        (err) => console.warn("activeSessions snapshot error:", err.code),
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [myUid, friendIds.join(",")]);

  // Real-time: shameQueue feed — all shames between anyone in the same groups.
  // Queries by fromUserId (uses the composite index) and filters recipients
  // client-side to group members only. Re-subscribes when group membership changes.
  useEffect(() => {
    if (!myUid || friendIds.length === 0) return;
    const allIds = [myUid, ...friendIds];
    const allIdsSet = new Set(allIds);
    const shameMap = new Map<string, FeedItem>();

    const toDoc = (d: any): FeedItem => ({
      id: d.id,
      kind: "shame" as const,
      ...(d.data() as Omit<FeedItem, "id" | "kind">),
    });
    const merge = () => {
      const all = Array.from(shameMap.values()).sort((a, b) =>
        (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
      );
      setWall(all.slice(0, 30));
    };

    const unsubs: (() => void)[] = [];
    for (let i = 0; i < allIds.length; i += 30) {
      const chunk = allIds.slice(i, i + 30);
      unsubs.push(
        onSnapshot(
          query(
            collection(db, "shameQueue"),
            where("fromUserId", "in", chunk),
            limit(100),
          ),
          (snap) => {
            snap.docs.forEach((d) => {
              const data = d.data();
              // Only show shames where the recipient is also a group member
              if (allIdsSet.has(data.toUserId as string)) {
                shameMap.set(d.id, toDoc(d));
              }
            });
            merge();
          },
          (err) => console.warn("shameQueue snapshot error:", err.code),
        ),
      );
    }
    return () => unsubs.forEach((u) => u());
  }, [myUid, friendIds.join(",")]);

  async function fetchAll() {
    await Promise.all([fetchStats(), fetchAwards()]);
    setLoading(false);
    setRefreshing(false);
  }

  async function fetchStats() {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const headers = { Authorization: `Bearer ${token}` };
      const res = await fetch(`${API_URL}/api/friends/live`, { headers });
      if (res.ok) {
        const d = await res.json();
        const raw: FriendData[] = d.friends ?? [];
        const seen = new Set<string>();
        const deduped = raw.filter((f) => {
          if (seen.has(f.userId)) return false;
          seen.add(f.userId);
          return true;
        });
        setFriends(deduped);
        // Update stable IDs only when membership actually changes
        const newIds = deduped.map((f) => f.userId).sort();
        setFriendIds((prev) =>
          prev.join(",") === newIds.join(",") ? prev : newIds,
        );
        if (d.me) setMe(d.me);
      }
    } catch (e) {
      console.warn("fetchStats error:", e);
    }
  }

  async function fetchAwards() {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/awards`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const aData = await res.json();
        setAwards(Array.isArray(aData) ? aData : []);
      }
    } catch (e) {
      console.warn("fetchAwards error:", e);
    }
  }

  async function handleReact(itemId: string, emoji: string) {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return;
    // Optimistic update
    setWall((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item;
        const reactions = { ...(item.reactions ?? {}) };
        const users = [...(reactions[emoji] ?? [])];
        if (myUid && users.includes(myUid)) {
          const next = users.filter((u) => u !== myUid);
          if (next.length === 0) delete reactions[emoji];
          else reactions[emoji] = next;
        } else if (myUid) {
          reactions[emoji] = [...users, myUid];
        }
        return { ...item, reactions };
      }),
    );
    fetch(
      `${API_URL}/api/feed/${itemId}/react?emoji=${encodeURIComponent(emoji)}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      },
    ).catch(() => {});
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        setMyUid(user.uid);
        fetchAll();
      } else {
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchAll();
  }, []);

  async function handleShame(
    friendId: string,
    opts: { reaction?: string; message?: string; videoUrl?: string },
  ) {
    setShamingId(friendId);
    setShameTarget(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const hasVideo = !!opts.videoUrl;
      const res = await fetch(`${API_URL}/api/shame?toUserId=${friendId}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: hasVideo ? "video" : "quick",
          reaction: opts.reaction ?? (opts.message ? undefined : "eyes"),
          message: opts.message || undefined,
          videoUrl: opts.videoUrl || undefined,
        }),
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
    Alert.alert(
      "SOS — Rescue Me",
      "Notifies all friends and locks you out for 15 minutes.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send SOS",
          style: "destructive",
          onPress: async () => {
            const token = await auth.currentUser?.getIdToken();
            await fetch(`${API_URL}/api/sos`, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` },
            });
            Alert.alert(
              "SOS Sent",
              "Your friends have been notified. Locked out 15 min.",
            );
            fetchAll();
          },
        },
      ],
    );
  }

  const liveCount = friends.filter((f) => f.status === "live").length;

  return (
    <>
      <ShameModal
        friend={shameTarget}
        isSending={shamingId === shameTarget?.userId}
        onClose={() => setShameTarget(null)}
        onSend={(opts) => handleShame(shameTarget!.userId, opts)}
      />
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

        {/* ── Header ── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>Live</Text>
            {liveCount > 0 && (
              <View style={styles.liveRow}>
                <Animated.View
                  style={[styles.livePulse, { opacity: pulseAnim }] as any}
                />
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
            <Ionicons
              name="people-outline"
              size={36}
              color={colors.textTertiary}
            />
            <Text style={styles.emptyTitle}>No friends yet</Text>
            <Text style={styles.emptyBody}>
              Join a group in the Friends tab
            </Text>
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
                onOpenShameModal={setShameTarget}
                cooldownTick={cooldownTick}
              />
            ))}
          </ScrollView>
        )}

        {/* ── Personal Insight ── */}
        <InsightCard
          me={
            me ?? {
              totalTodaySeconds: 0,
              dailyLimitPct: 0,
              totalOpens: 0,
              yesterdaySeconds: 0,
              yesterdayOpens: 0,
            }
          }
        />

        {/* ── Feed ── */}
        <View style={styles.feedHeader}>
          <Text style={styles.feedTitle}>Feed</Text>
          <TouchableOpacity
            onPress={() =>
              navigation.navigate("Stats", { screen: "WallOfShame" })
            }
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.feedSeeAll}>See all</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.feedScroll}
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          {wall.length === 0 ? (
            <View style={styles.feedEmpty}>
              <Text style={styles.feedEmptyText}>
                The feed is clean — keep it that way.
              </Text>
            </View>
          ) : (
            wall
              .slice(0, 20)
              .map((entry, i) => (
                <FeedEntry
                  key={entry.id || i}
                  entry={entry}
                  myUid={myUid}
                  onReact={handleReact}
                />
              ))
          )}
        </ScrollView>

        {/* ── Awards ── */}
        {awards.length > 0 && (
          <AwardsSection awards={awards} myUid={myUid} friends={friends} />
        )}
      </ScrollView>
    </>
  );
}

// ── Friend Pill ──────────────────────────────────────────────────────────────

const FriendPill = React.memo(function FriendPill({
  friend,
  pulseAnim,
  shamingId,
  onOpenShameModal,
  cooldownTick: _cooldownTick,
}: {
  friend: FriendData;
  pulseAnim: Animated.Value;
  shamingId: string | null;
  onOpenShameModal: (f: FriendData) => void;
  cooldownTick: number;
}) {
  const isLive = friend.status === "live";
  const isRecent = friend.status === "recent";
  const isShaming = shamingId === friend.userId;

  const inBreakWindow = !!friend.inBreakWindow;
  const shameActive = isLive || inBreakWindow;
  const shameReady = shameActive && !!friend.canShame;
  const onCooldown =
    shameActive && !friend.canShame && !!friend.shameCooldownUntil;

  function cooldownLabel(): string {
    if (!friend.shameCooldownUntil) return "";
    const rem = Math.max(
      0,
      new Date(friend.shameCooldownUntil).getTime() - Date.now(),
    );
    const m = Math.floor(rem / 60000);
    const s = Math.floor((rem % 60000) / 1000);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  return (
    <View style={[styles.pill, isLive && styles.pillLive]}>
      <View style={styles.pillStatusRow}>
        {isLive ? (
          <Animated.View
            style={
              [styles.pillDot, styles.dotGreen, { opacity: pulseAnim }] as any
            }
          />
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

      <Text style={styles.pillName} numberOfLines={1}>
        {friend.displayName}
      </Text>

      {isLive && friend.currentApp ? (
        <Text style={styles.pillSub} numberOfLines={1}>
          {friend.currentApp} · {friend.sessionMinutes}m
        </Text>
      ) : (friend.totalTodaySeconds ?? 0) > 0 ? (
        <Text style={styles.pillSub}>
          {fmt(friend.totalTodaySeconds ?? 0)} today
        </Text>
      ) : (
        <Text style={styles.pillSub}>No activity</Text>
      )}

      {(friend.streakDays ?? 0) > 0 && (
        <Text style={styles.pillStreak}>🔥 {friend.streakDays}d</Text>
      )}

      {isLive && (
        <View style={styles.pillShameWrap}>
          {onCooldown ? (
            <View style={styles.pillCooldown}>
              <Text style={styles.pillCooldownTxt}>⏳ {cooldownLabel()}</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[
                styles.pillShameBtn,
                !shameReady && styles.pillShameBtnDim,
              ]}
              disabled={!shameReady || isShaming}
              onPress={() => onOpenShameModal(friend)}
              activeOpacity={0.8}
            >
              {isShaming ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.pillShameTxt}>SHAME 🔥</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
});

// ── Shame Modal ──────────────────────────────────────────────────────────────

function ShameModal({
  friend,
  isSending,
  onClose,
  onSend,
}: {
  friend: FriendData | null;
  isSending: boolean;
  onClose: () => void;
  onSend: (opts: {
    reaction?: string;
    message?: string;
    videoUrl?: string;
  }) => void;
}) {
  const [selectedReaction, setSelectedReaction] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"reactions" | "message" | "video">(
    "reactions",
  );
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  useEffect(() => {
    if (friend) {
      setSelectedReaction(null);
      setMessage("");
      setMode("reactions");
      setVideoUri(null);
      setUploadProgress(0);
    }
  }, [friend?.userId]);

  const canSend =
    (mode === "reactions" && !!selectedReaction) ||
    (mode === "message" && message.trim().length > 0) ||
    (mode === "video" && !!videoUri);

  async function pickVideo() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission needed",
        "Allow access to your photo library to pick a video.",
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
      videoMaxDuration: 30,
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      setVideoUri(result.assets[0].uri);
    }
  }

  async function recordVideo() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission needed",
        "Allow camera access to record a shame video.",
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["videos"],
      videoMaxDuration: 30,
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      setVideoUri(result.assets[0].uri);
    }
  }

  async function handleSend() {
    if (mode === "reactions") {
      onSend({ reaction: selectedReaction ?? undefined });
      return;
    }
    if (mode === "message") {
      onSend({
        message: message.trim(),
        reaction: selectedReaction ?? undefined,
      });
      return;
    }
    // Video mode: upload first, then send
    if (!videoUri || !auth.currentUser) return;
    setUploading(true);
    try {
      const uid = auth.currentUser.uid;
      const fileId = Date.now().toString();
      const storageRef = ref(storage, `shameVideos/${uid}/${fileId}.mp4`);

      const fetchRes = await fetch(videoUri);
      const blob = await fetchRes.blob();

      await new Promise<void>((resolve, reject) => {
        const task = uploadBytesResumable(storageRef, blob, {
          contentType: "video/mp4",
        });
        task.on(
          "state_changed",
          (snap) => setUploadProgress(snap.bytesTransferred / snap.totalBytes),
          reject,
          () => resolve(),
        );
      });

      const downloadUrl = await getDownloadURL(storageRef);
      onSend({ videoUrl: downloadUrl });
    } catch {
      Alert.alert(
        "Upload failed",
        "Could not upload the video. Please try again.",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal
      visible={!!friend}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Backdrop — tap to dismiss */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <View style={styles.modalSheet}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>
                Shame {friend?.displayName} 🔥
              </Text>
              {friend?.currentApp && (
                <Text style={styles.modalSub}>
                  {friend.currentApp} · {friend.sessionMinutes}m
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Mode tabs */}
          <View style={styles.modeTabs}>
            {(["reactions", "message", "video"] as const).map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.modeTab, mode === m && styles.modeTabActive]}
                onPress={() => setMode(m)}
              >
                <Text
                  style={[
                    styles.modeTabTxt,
                    mode === m && styles.modeTabTxtActive,
                  ]}
                >
                  {m === "reactions"
                    ? "Quick"
                    : m === "message"
                      ? "Message"
                      : "Video"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Reactions */}
          {mode === "reactions" && (
            <View style={styles.reactionsGrid}>
              {REACTIONS.map((r) => (
                <TouchableOpacity
                  key={r.emoji}
                  style={[
                    styles.reactionTile,
                    selectedReaction === r.emoji && styles.reactionTileSelected,
                    r.emoji === "emergency" && styles.reactionTileEmergency,
                  ]}
                  onPress={() =>
                    setSelectedReaction(
                      selectedReaction === r.emoji ? null : r.emoji,
                    )
                  }
                >
                  <Text style={styles.reactionTileIcon}>{r.icon}</Text>
                  <Text style={styles.reactionTileLabel}>{r.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Message */}
          {mode === "message" && (
            <View style={styles.messageWrap}>
              <TextInput
                style={styles.messageInput}
                placeholder="Write something brutal..."
                placeholderTextColor={colors.textTertiary}
                value={message}
                onChangeText={setMessage}
                multiline
                maxLength={200}
                autoFocus
              />
              <Text style={styles.charCount}>{message.length}/200</Text>
              {/* Optional reaction to pair with message */}
              <Text style={styles.messageSectionLabel}>
                Add a reaction (optional)
              </Text>
              <View style={styles.reactionsRow}>
                {REACTIONS.map((r) => (
                  <TouchableOpacity
                    key={r.emoji}
                    style={[
                      styles.reactionChip,
                      selectedReaction === r.emoji &&
                        styles.reactionChipSelected,
                    ]}
                    onPress={() =>
                      setSelectedReaction(
                        selectedReaction === r.emoji ? null : r.emoji,
                      )
                    }
                  >
                    <Text style={styles.reactionChipIcon}>{r.icon}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Video */}
          {mode === "video" && (
            <View style={styles.videoWrap}>
              {videoUri ? (
                <>
                  <Text style={styles.videoReadyIcon}>✅</Text>
                  <Text style={styles.videoPlaceholderTitle}>Video ready</Text>
                  <Text style={styles.videoPlaceholderSub}>
                    Hit send — your victim will receive it as a notification.
                  </Text>
                  <TouchableOpacity
                    style={styles.videoPickBtn}
                    onPress={() => setVideoUri(null)}
                  >
                    <Text style={styles.videoPickTxt}>
                      Pick a different video
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.videoPlaceholderIcon}>🎥</Text>
                  <Text style={styles.videoPlaceholderTitle}>
                    Record or pick a video
                  </Text>
                  <Text style={styles.videoPlaceholderSub}>
                    Film your reaction and send it directly — nothing hits
                    harder than a face. Max 30s.
                  </Text>
                  <TouchableOpacity
                    style={styles.videoPickBtn}
                    onPress={pickVideo}
                  >
                    <Text style={styles.videoPickTxt}>Choose from Library</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.videoPickBtn, { marginTop: 8 }]}
                    onPress={recordVideo}
                  >
                    <Text style={styles.videoPickTxt}>Record Now</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          {/* Upload progress bar */}
          {uploading && (
            <View style={{ marginBottom: spacing.md }}>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  marginBottom: 4,
                }}
              >
                <Text style={styles.uploadBarLabel}>Uploading…</Text>
                <Text style={styles.uploadBarLabel}>
                  {Math.round(uploadProgress * 100)}%
                </Text>
              </View>
              <View style={styles.uploadBarTrack}>
                <View
                  style={[
                    styles.uploadBar,
                    { width: `${Math.round(uploadProgress * 100)}%` as any },
                  ]}
                />
              </View>
            </View>
          )}

          {/* Send button */}
          <TouchableOpacity
            style={[
              styles.sendBtn,
              (!canSend || isSending || uploading) && styles.sendBtnDim,
            ]}
            disabled={!canSend || isSending || uploading}
            onPress={handleSend}
            activeOpacity={0.8}
          >
            {isSending || uploading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.sendBtnTxt}>Send Shame 🔥</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Insight Card ─────────────────────────────────────────────────────────────

function InsightCard({ me }: { me: MeData }) {
  const pct = pctChange(me.totalTodaySeconds, me.yesterdaySeconds);
  const opensPct = pctChange(me.totalOpens, me.yesterdayOpens);

  const barPct = Math.min(me.dailyLimitPct, 100);
  const barColor =
    me.dailyLimitPct >= 100
      ? colors.destructive
      : me.dailyLimitPct >= 75
        ? colors.warning
        : colors.success;

  return (
    <View style={styles.insight}>
      <Text style={styles.insightLabel}>Today</Text>

      <View style={styles.insightRow}>
        {/* Total time */}
        <View style={styles.insightStat}>
          <Text style={styles.insightNum}>{fmt(me.totalTodaySeconds)}</Text>
          <Text style={styles.insightMeta}>screen time</Text>
          {pct !== null && (
            <Text
              style={[
                styles.insightDelta,
                { color: pct > 0 ? colors.destructive : colors.success },
              ]}
              numberOfLines={1}
            >
              {pct > 0 ? "▲" : "▼"}
              {Math.abs(pct)}%
            </Text>
          )}
        </View>

        <View style={styles.insightDivider} />

        {/* Pickups */}
        <View style={styles.insightStat}>
          <Text style={styles.insightNum}>{me.totalOpens}</Text>
          <Text style={styles.insightMeta}>pickups</Text>
          {opensPct !== null && (
            <Text
              style={[
                styles.insightDelta,
                { color: opensPct > 0 ? colors.destructive : colors.success },
              ]}
              numberOfLines={1}
            >
              {opensPct > 0 ? "▲" : "▼"}
              {Math.abs(opensPct)}%
            </Text>
          )}
        </View>

        <View style={styles.insightDivider} />

        {/* Limit */}
        <View style={styles.insightStat}>
          <Text style={[styles.insightNum, { color: barColor }]}>
            {me.dailyLimitPct}%
          </Text>
          <Text style={styles.insightMeta}>of limit</Text>
        </View>
      </View>

      {/* Limit bar */}
      <View style={styles.insightBarTrack}>
        <View
          style={[
            styles.insightBar,
            { width: `${barPct}%` as any, backgroundColor: barColor },
          ]}
        />
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

const REACTION_LABELS: Record<string, string> = {
  "😤": "called out",
  "🤦": "facepalmed at",
  "👀": "is watching",
  "🚨": "emergency shamed",
};

const FEED_REACTION_OPTIONS = ["😂", "💀", "🔥", "👏", "😭", "💯"];

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function FeedEntry({
  entry,
  myUid,
  onReact,
}: {
  entry: FeedItem;
  myUid: string | null;
  onReact: (itemId: string, emoji: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  if (entry.kind === "shame") {
    // Normalise reaction: Firestore stores raw keys ("angry"), backend feed returns emojis ("😤")
    const reactionEmoji = entry.reaction
      ? (REACTION_EMOJI_MAP[entry.reaction] ?? entry.reaction)
      : undefined;
    const isEmergency = entry.shameType === "quick" && reactionEmoji === "🚨";
    const isVideo = entry.shameType === "video";
    const fromMe = entry.fromUserId === myUid;
    const toMe = entry.toUserId === myUid;
    const fromLabel = fromMe ? "You" : entry.fromName;
    const toLabel = toMe ? "you" : (entry.toName ?? "someone");
    const verb = reactionEmoji
      ? (REACTION_LABELS[reactionEmoji] ?? "shamed")
      : isVideo
        ? "sent a video shame to"
        : "shamed";

    return (
      <View style={[styles.feedCard, isEmergency && styles.feedCardEmergency]}>
        <View
          style={[styles.feedAvatar, isEmergency && styles.feedAvatarEmergency]}
        >
          <Text style={styles.feedAvatarTxt}>{initials(entry.fromName)}</Text>
        </View>
        <View style={styles.feedBody}>
          <View style={styles.feedTopRow}>
            <Text style={styles.feedName} numberOfLines={1}>
              <Text style={fromMe ? styles.feedNameMe : styles.feedName}>
                {fromLabel}
              </Text>
              <Text style={styles.feedVerb}> {verb} </Text>
              <Text style={toMe ? styles.feedNameMe : styles.feedName}>
                {toLabel}
              </Text>
              {reactionEmoji ? <Text> {reactionEmoji}</Text> : null}
            </Text>
            <Text style={styles.feedTime}>{relTime(entry.createdAt)}</Text>
          </View>
          {isVideo && (
            <View style={styles.feedVideoBadge}>
              <Text style={styles.feedVideoBadgeTxt}>📹 Video shame</Text>
            </View>
          )}
          {entry.message ? (
            <View style={styles.feedMessageBubble}>
              <Text style={styles.feedMessageTxt}>"{entry.message}"</Text>
            </View>
          ) : null}
          <ReactionRow
            reactions={entry.reactions ?? {}}
            myUid={myUid}
            pickerOpen={pickerOpen}
            onTogglePicker={() => setPickerOpen((v) => !v)}
            onReact={(emoji) => {
              onReact(entry.id, emoji);
              setPickerOpen(false);
            }}
          />
        </View>
      </View>
    );
  }

  // Wall event
  const d = entry.detail || {};
  const wallEmoji = shameEmoji(entry.wallType ?? "");
  const wallDesc = shameDesc({
    type: entry.wallType ?? "",
    detail: d,
    displayName: entry.fromName,
  } as any);
  const isMe = entry.fromUserId === myUid;

  return (
    <View style={styles.feedCard}>
      <View style={[styles.feedAvatar, styles.feedAvatarWall]}>
        <Text style={styles.feedAvatarTxt}>{initials(entry.fromName)}</Text>
      </View>
      <View style={styles.feedBody}>
        <View style={styles.feedTopRow}>
          <Text
            style={[styles.feedName, isMe && styles.feedNameMe]}
            numberOfLines={1}
          >
            {isMe ? "You" : entry.fromName}
          </Text>
          <Text style={styles.feedTime}>{relTime(entry.createdAt)}</Text>
        </View>
        <Text style={styles.feedDesc}>
          {wallEmoji} {wallDesc}
        </Text>
      </View>
    </View>
  );
}

// ── Reaction Row ─────────────────────────────────────────────────────────────

function ReactionRow({
  reactions,
  myUid,
  pickerOpen,
  onTogglePicker,
  onReact,
}: {
  reactions: Record<string, string[]>;
  myUid: string | null;
  pickerOpen: boolean;
  onTogglePicker: () => void;
  onReact: (emoji: string) => void;
}) {
  const entries = Object.entries(reactions).filter(
    ([, users]) => users.length > 0,
  );
  if (entries.length === 0 && !pickerOpen) {
    return (
      <TouchableOpacity
        onPress={onTogglePicker}
        style={styles.reactionAddBtn}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Text style={styles.reactionAddTxt}>+</Text>
      </TouchableOpacity>
    );
  }
  return (
    <View style={styles.reactionRowWrap}>
      {entries.map(([emoji, users]) => {
        const mine = myUid ? users.includes(myUid) : false;
        return (
          <TouchableOpacity
            key={emoji}
            style={[styles.reactionPill, mine && styles.reactionPillMine]}
            onPress={() => onReact(emoji)}
          >
            <Text style={styles.reactionPillTxt}>
              {emoji} {users.length}
            </Text>
          </TouchableOpacity>
        );
      })}
      {pickerOpen ? (
        FEED_REACTION_OPTIONS.map((emoji) => (
          <TouchableOpacity
            key={emoji}
            style={styles.reactionPickerOption}
            onPress={() => onReact(emoji)}
          >
            <Text style={styles.reactionPickerTxt}>{emoji}</Text>
          </TouchableOpacity>
        ))
      ) : (
        <TouchableOpacity
          onPress={onTogglePicker}
          style={styles.reactionAddBtn}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Text style={styles.reactionAddTxt}>+</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Awards Section ───────────────────────────────────────────────────────────

function AwardsSection({
  awards,
  myUid,
  friends,
}: {
  awards: Award[];
  myUid: string | null;
  friends: FriendData[];
}) {
  return (
    <View style={styles.awardsWrap}>
      <Text style={styles.awardsTitle}>Awards 🏆</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.awardsScroll}
      >
        {awards.map((a, i) => {
          const isMe =
            a.winner === "You" ||
            friends.find((f) => f.displayName === a.winner)?.userId === myUid;
          return (
            <View
              key={i}
              style={[styles.awardCard, isMe && styles.awardCardMe]}
            >
              <Text style={styles.awardEmoji}>{a.emoji}</Text>
              <Text style={styles.awardTitle}>{a.title}</Text>
              <Text
                style={[styles.awardWinner, isMe && styles.awardWinnerMe]}
                numberOfLines={1}
              >
                {a.winner}
              </Text>
              <Text style={styles.awardValue}>{a.value}</Text>
            </View>
          );
        })}
      </ScrollView>
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
  dotGreen: { backgroundColor: colors.success },
  dotOrange: { backgroundColor: colors.warning },
  dotGrey: { backgroundColor: colors.textTertiary },
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
  // Shame modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: colors.surface1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    paddingBottom: spacing.xl + 16,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: spacing.md,
  },
  modalTitle: {
    fontSize: fontSize.title,
    fontWeight: "800",
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  modalSub: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    marginTop: 2,
  },
  modalClose: {
    fontSize: 18,
    color: colors.textTertiary,
    fontWeight: "600",
    paddingLeft: 12,
  },
  modeTabs: {
    flexDirection: "row",
    backgroundColor: colors.surface2,
    borderRadius: 10,
    padding: 3,
    marginBottom: spacing.lg,
    gap: 3,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: "center",
  },
  modeTabActive: {
    backgroundColor: colors.surface1,
  },
  modeTabTxt: {
    fontSize: fontSize.small,
    fontWeight: "600",
    color: colors.textTertiary,
  },
  modeTabTxtActive: {
    color: colors.textPrimary,
  },
  // Reactions grid
  reactionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  reactionTile: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: colors.surface2,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: "center",
    gap: 6,
    borderWidth: 2,
    borderColor: "transparent",
  },
  reactionTileSelected: {
    borderColor: colors.accentPrimary,
    backgroundColor: `${colors.accentPrimary}18`,
  },
  reactionTileEmergency: {
    borderColor: `${colors.destructive}40`,
  },
  reactionTileIcon: { fontSize: 28 },
  reactionTileLabel: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    fontWeight: "600",
  },
  // Message mode
  messageWrap: {
    marginBottom: spacing.lg,
  },
  messageInput: {
    backgroundColor: colors.surface2,
    borderRadius: 12,
    padding: spacing.md,
    color: colors.textPrimary,
    fontSize: fontSize.body,
    minHeight: 100,
    textAlignVertical: "top",
  },
  charCount: {
    fontSize: fontSize.tiny,
    color: colors.textTertiary,
    textAlign: "right",
    marginTop: 4,
    marginBottom: spacing.md,
  },
  messageSectionLabel: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    fontWeight: "600",
    marginBottom: spacing.sm,
  },
  reactionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  reactionChip: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  reactionChipSelected: {
    borderColor: colors.accentPrimary,
    backgroundColor: `${colors.accentPrimary}18`,
  },
  reactionChipIcon: { fontSize: 22 },
  // Video mode
  videoWrap: {
    alignItems: "center",
    paddingVertical: spacing.lg,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  videoPlaceholderIcon: { fontSize: 48 },
  videoPlaceholderTitle: {
    fontSize: fontSize.title,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  videoPlaceholderSub: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    textAlign: "center",
    lineHeight: 18,
    paddingHorizontal: spacing.md,
  },
  videoReadyIcon: { fontSize: 48 },
  videoPickBtn: {
    width: "100%",
    backgroundColor: colors.surface2,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  videoPickTxt: {
    fontSize: fontSize.body,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  uploadBarTrack: {
    height: 6,
    backgroundColor: colors.surface2,
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: spacing.md,
  },
  uploadBar: {
    height: "100%",
    backgroundColor: colors.accentPrimary,
    borderRadius: 3,
  },
  uploadBarLabel: {
    fontSize: fontSize.tiny,
    color: colors.textTertiary,
  },
  // Send button
  sendBtn: {
    backgroundColor: colors.destructive,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  sendBtnDim: {
    opacity: 0.4,
  },
  sendBtnTxt: {
    fontSize: fontSize.body,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: 0.3,
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
  feedScroll: {
    maxHeight: 340,
    marginBottom: spacing.lg,
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
  feedCardEmergency: {
    borderWidth: 1,
    borderColor: `${colors.destructive}50`,
    backgroundColor: `${colors.destructive}10`,
  },
  feedAvatarEmergency: {
    backgroundColor: `${colors.destructive}30`,
  },
  feedAvatarWall: {
    backgroundColor: `${colors.textTertiary}30`,
  },
  feedVerb: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    fontWeight: "400",
  },
  feedNameMe: {
    fontSize: fontSize.body,
    fontWeight: "700",
    color: colors.accentPrimary,
    flexShrink: 1,
  },
  feedMessageBubble: {
    marginTop: 6,
    backgroundColor: colors.surface2,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderLeftWidth: 2,
    borderLeftColor: colors.accentPrimary,
  },
  feedMessageTxt: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    fontStyle: "italic",
    lineHeight: 18,
  },
  feedVideoBadge: {
    marginTop: 5,
    alignSelf: "flex-start",
    backgroundColor: `${colors.accentPrimary}20`,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  feedVideoBadgeTxt: {
    fontSize: fontSize.tiny,
    color: colors.accentPrimary,
    fontWeight: "600",
  },

  // Reactions
  reactionRowWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
    alignItems: "center",
  },
  reactionPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface2,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "transparent",
  },
  reactionPillMine: {
    borderColor: colors.accentPrimary,
    backgroundColor: `${colors.accentPrimary}20`,
  },
  reactionPillTxt: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
  },
  reactionAddBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  reactionAddTxt: {
    fontSize: 16,
    color: colors.textTertiary,
    lineHeight: 20,
  },
  reactionPickerOption: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  reactionPickerTxt: {
    fontSize: 18,
  },

  // Awards
  awardsWrap: {
    marginBottom: spacing.lg,
  },
  awardsTitle: {
    fontSize: fontSize.title,
    fontWeight: "700",
    color: colors.textPrimary,
    letterSpacing: -0.3,
    marginBottom: spacing.sm,
  },
  awardsScroll: {
    marginHorizontal: -spacing.md,
    paddingHorizontal: spacing.md,
  },
  awardCard: {
    width: 110,
    backgroundColor: colors.surface1,
    borderRadius: 14,
    padding: 12,
    marginRight: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  awardCardMe: {
    borderColor: colors.accentPrimary,
    backgroundColor: `${colors.accentPrimary}15`,
  },
  awardEmoji: {
    fontSize: 28,
    marginBottom: 4,
  },
  awardTitle: {
    fontSize: fontSize.tiny,
    color: colors.textTertiary,
    textAlign: "center",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  awardWinner: {
    fontSize: fontSize.body,
    fontWeight: "700",
    color: colors.textPrimary,
    textAlign: "center",
    marginBottom: 2,
  },
  awardWinnerMe: {
    color: colors.accentPrimary,
  },
  awardValue: {
    fontSize: fontSize.tiny,
    color: colors.textSecondary,
    textAlign: "center",
  },
});
