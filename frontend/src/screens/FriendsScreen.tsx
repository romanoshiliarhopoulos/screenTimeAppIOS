import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Share,
  Modal,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  type ViewProps,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../lib/firebase";
import { colors, spacing, fontSize } from "../theme";
import LeaderboardCard from "../components/LeaderboardCard";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";

// React 18 + RN: Animated.View strips children from its inferred props type.
type AViewProps = Animated.AnimatedProps<ViewProps> & {
  children?: React.ReactNode;
  pointerEvents?: "box-none" | "none" | "box-only" | "auto";
};
const AView = Animated.View as React.FC<AViewProps>;

async function getToken(): Promise<string | null> {
  return auth.currentUser?.getIdToken() ?? null;
}

type Group = { id: string; name: string; memberCount: number };

export default function FriendsScreen() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  // FAB
  const [fabOpen, setFabOpen] = useState(false);
  const fabAnim = useRef(new Animated.Value(0)).current;

  // Modal: "create" | "join" | null
  const [modal, setModal] = useState<"create" | "join" | null>(null);
  const [groupName, setGroupName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // ── Data fetching ──────────────────────────────────────────────────────────

  async function fetchGroups() {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/groups`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const fetched: Group[] = data.map((g: any) => ({
        id: g.groupId,
        name: g.name,
        memberCount: (g.memberIds ?? []).length,
      }));
      setGroups(fetched);
      // Expand all new groups by default
      setCollapsedIds((prev) => {
        const next = new Set(prev);
        // Remove any ids that are no longer in the group list (cleaned up)
        for (const id of next) {
          if (!fetched.find((g) => g.id === id)) next.delete(id);
        }
        return next;
      });
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) fetchGroups();
      else setInitialLoading(false);
    });
    return unsub;
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshTick((t) => t + 1);
    fetchGroups();
  }, []);

  // ── FAB animation ──────────────────────────────────────────────────────────

  function toggleFab() {
    const toValue = fabOpen ? 0 : 1;
    Animated.spring(fabAnim, {
      toValue,
      useNativeDriver: true,
      tension: 80,
      friction: 10,
    }).start();
    setFabOpen(!fabOpen);
  }

  function closeFab() {
    Animated.spring(fabAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 80,
      friction: 10,
    }).start();
    setFabOpen(false);
  }

  const fabRotate = fabAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "45deg"],
  });

  const action1Y = fabAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -72],
  });
  const action2Y = fabAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -136],
  });
  const actionOpacity = fabAnim.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [0, 0, 1],
  });
  const backdropOpacity = fabAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  // ── Modal actions ──────────────────────────────────────────────────────────

  function openModal(type: "create" | "join") {
    closeFab();
    setTimeout(() => setModal(type), 200);
  }

  function closeModal() {
    setModal(null);
    setGroupName("");
    setInviteCode("");
  }

  async function handleCreate() {
    if (!groupName.trim()) return;
    setSubmitting(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/groups`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: groupName.trim() }),
      });
      if (!res.ok) throw new Error("Failed to create group");
      const data = await res.json();
      closeModal();
      Alert.alert("Group created! 🎉", `Share code: ${data.groupId}`, [
        { text: "Share", onPress: () => Share.share({ message: `Join my group on ScreenTime! Code: ${data.groupId}` }) },
        { text: "Done", style: "cancel" },
      ]);
      fetchGroups();
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleJoin() {
    if (!inviteCode.trim()) return;
    setSubmitting(true);
    try {
      const token = await getToken();
      const res = await fetch(
        `${API_URL}/api/groups/${inviteCode.trim()}/members`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error("Group not found or already a member");
      closeModal();
      Alert.alert("Joined! 🙌", "You're now in the group.");
      fetchGroups();
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setSubmitting(false);
    }
  }

  function toggleCollapse(id: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function shareGroup(g: Group) {
    Share.share({
      message: `Join "${g.name}" on ScreenTime! Invite code: ${g.id}`,
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
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
        <Text style={styles.pageTitle}>Friends</Text>

        {initialLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.accentPrimary} size="large" />
          </View>
        ) : groups.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="people-outline" size={36} color={colors.textTertiary} />
            </View>
            <Text style={styles.emptyTitle}>No groups yet</Text>
            <Text style={styles.emptySubtext}>
              Create a group and challenge friends to spend less time doomscrolling.
            </Text>
            <TouchableOpacity
              style={styles.emptyAction}
              onPress={() => openModal("create")}
            >
              <Ionicons name="add" size={16} color={colors.accentPrimary} />
              <Text style={styles.emptyActionText}>Create your first group</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={styles.subheading}>
              {groups.length} group{groups.length !== 1 ? "s" : ""} · Today
            </Text>

            {groups.map((g) => {
              const isCollapsed = collapsedIds.has(g.id);
              return (
                <View key={g.id} style={styles.groupCard}>
                  {/* Group header */}
                  <TouchableOpacity
                    style={styles.groupHeader}
                    onPress={() => toggleCollapse(g.id)}
                    activeOpacity={0.75}
                  >
                    <View style={styles.groupHeaderLeft}>
                      <View style={styles.groupIconWrap}>
                        <Ionicons
                          name="trophy"
                          size={14}
                          color={colors.accentPrimary}
                        />
                      </View>
                      <View>
                        <Text style={styles.groupName}>{g.name}</Text>
                        <Text style={styles.groupCode}>#{g.id}</Text>
                      </View>
                    </View>
                    <View style={styles.groupHeaderRight}>
                      <TouchableOpacity
                        style={styles.shareBtn}
                        onPress={() => shareGroup(g)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons
                          name="share-outline"
                          size={16}
                          color={colors.textTertiary}
                        />
                      </TouchableOpacity>
                      <Ionicons
                        name={isCollapsed ? "chevron-down" : "chevron-up"}
                        size={16}
                        color={colors.textTertiary}
                        style={{ marginLeft: spacing.sm }}
                      />
                    </View>
                  </TouchableOpacity>

                  {/* Leaderboard — hidden when collapsed */}
                  {!isCollapsed && (
                    <LeaderboardCard
                      groupId={g.id}
                      groupName={g.name}
                      compact={false}
                      hideHeader
                      refreshTick={refreshTick}
                    />
                  )}
                </View>
              );
            })}

            {/* Bottom padding so FAB doesn't cover last group */}
            <View style={{ height: 88 }} />
          </>
        )}
      </ScrollView>

      {/* FAB backdrop */}
      {fabOpen && (
        <AView
          style={[styles.fabBackdrop, { opacity: backdropOpacity }]}
          pointerEvents="auto"
        >
          <Pressable style={{ flex: 1 }} onPress={closeFab} />
        </AView>
      )}

      {/* FAB action buttons */}
      <View style={styles.fabContainer} pointerEvents="box-none">
        {/* Action 2: Create */}
        <AView
          style={[
            styles.fabActionRow,
            {
              transform: [{ translateY: action2Y }],
              opacity: actionOpacity,
            },
          ]}
          pointerEvents={fabOpen ? "auto" : "none"}
        >
          <Text style={styles.fabActionLabel}>Create Group</Text>
          <TouchableOpacity
            style={[styles.fabAction]}
            onPress={() => openModal("create")}
          >
            <Ionicons name="add-circle-outline" size={20} color="#fff" />
          </TouchableOpacity>
        </AView>

        {/* Action 1: Join */}
        <AView
          style={[
            styles.fabActionRow,
            {
              transform: [{ translateY: action1Y }],
              opacity: actionOpacity,
            },
          ]}
          pointerEvents={fabOpen ? "auto" : "none"}
        >
          <Text style={styles.fabActionLabel}>Join Group</Text>
          <TouchableOpacity
            style={[styles.fabAction]}
            onPress={() => openModal("join")}
          >
            <Ionicons name="enter-outline" size={20} color="#fff" />
          </TouchableOpacity>
        </AView>

        {/* Main FAB */}
        <TouchableOpacity style={styles.fab} onPress={toggleFab} activeOpacity={0.85}>
          <AView style={{ transform: [{ rotate: fabRotate }] }}>
            <Ionicons name="add" size={28} color="#fff" />
          </AView>
        </TouchableOpacity>
      </View>

      {/* Create / Join modal */}
      <Modal
        visible={modal !== null}
        transparent
        animationType="fade"
        onRequestClose={closeModal}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable style={styles.modalOverlay} onPress={closeModal}>
            {/* Stop press-through on the sheet */}
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.sheetHandle} />

              <Text style={styles.sheetTitle}>
                {modal === "create" ? "Create a Group" : "Join a Group"}
              </Text>
              <Text style={styles.sheetSubtitle}>
                {modal === "create"
                  ? "Give your group a name and share the invite code with friends."
                  : "Enter the 8-character invite code from a friend."}
              </Text>

              <Text style={styles.fieldLabel}>
                {modal === "create" ? "Group name" : "Invite code"}
              </Text>
              <TextInput
                style={styles.input}
                placeholder={modal === "create" ? "e.g. Study Crew" : "e.g. ab3Xk7Qz"}
                placeholderTextColor={colors.textTertiary}
                value={modal === "create" ? groupName : inviteCode}
                onChangeText={modal === "create" ? setGroupName : setInviteCode}
                autoFocus
                autoCapitalize="none"
                returnKeyType="done"
                onSubmitEditing={modal === "create" ? handleCreate : handleJoin}
              />

              <TouchableOpacity
                style={[
                  styles.sheetBtn,
                  (modal === "create" ? !groupName.trim() : !inviteCode.trim()) &&
                    styles.sheetBtnDisabled,
                ]}
                onPress={modal === "create" ? handleCreate : handleJoin}
                disabled={
                  submitting ||
                  (modal === "create" ? !groupName.trim() : !inviteCode.trim())
                }
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.sheetBtnText}>
                    {modal === "create" ? "Create Group" : "Join Group"}
                  </Text>
                )}
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const FAB_SIZE = 56;
const FAB_MARGIN = 24;

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  centered: { marginTop: spacing.xl * 2, alignItems: "center" },
  pageTitle: {
    fontSize: fontSize.page,
    fontWeight: "700",
    color: colors.textPrimary,
    marginTop: spacing.xl,
    marginBottom: spacing.xs,
    letterSpacing: -0.5,
  },
  subheading: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    marginBottom: spacing.lg,
    fontWeight: "500",
  },

  // ── Group cards ────────────────────────────────────────────────────────────
  groupCard: {
    backgroundColor: colors.surface1,
    borderRadius: 14,
    overflow: "hidden",
    marginBottom: spacing.md,
  },
  groupHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  groupHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flex: 1,
  },
  groupIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: `${colors.accentPrimary}18`,
    alignItems: "center",
    justifyContent: "center",
  },
  groupName: {
    fontSize: fontSize.title,
    fontWeight: "700",
    color: colors.textPrimary,
    letterSpacing: -0.2,
  },
  groupCode: {
    fontSize: fontSize.tiny,
    color: colors.textTertiary,
    fontFamily: "monospace",
    marginTop: 1,
  },
  groupHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  shareBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Empty state ────────────────────────────────────────────────────────────
  emptyState: {
    alignItems: "center",
    paddingTop: spacing.xl * 2,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: colors.surface1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    fontSize: fontSize.title,
    fontWeight: "700",
    color: colors.textSecondary,
  },
  emptySubtext: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    textAlign: "center",
    lineHeight: 18,
    maxWidth: 260,
  },
  emptyAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: `${colors.accentPrimary}40`,
  },
  emptyActionText: {
    fontSize: fontSize.body,
    color: colors.accentPrimary,
    fontWeight: "600",
  },

  // ── FAB ───────────────────────────────────────────────────────────────────
  fabBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  fabContainer: {
    position: "absolute",
    bottom: FAB_MARGIN,
    right: FAB_MARGIN,
    alignItems: "flex-end",
  },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: colors.accentPrimary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.accentPrimary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  fabActionRow: {
    position: "absolute",
    bottom: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  fabActionLabel: {
    fontSize: fontSize.small,
    fontWeight: "600",
    color: colors.textPrimary,
    backgroundColor: colors.surface1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  fabAction: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: colors.surface1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },

  // ── Modal / bottom sheet ──────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl + spacing.lg,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: "center",
    marginBottom: spacing.lg,
  },
  sheetTitle: {
    fontSize: fontSize.title,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    letterSpacing: -0.3,
  },
  sheetSubtitle: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: spacing.lg,
  },
  fieldLabel: {
    fontSize: fontSize.small,
    fontWeight: "600",
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: fontSize.body,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  sheetBtn: {
    backgroundColor: colors.accentPrimary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  sheetBtnDisabled: {
    opacity: 0.4,
  },
  sheetBtnText: {
    color: "#fff",
    fontSize: fontSize.body,
    fontWeight: "700",
  },
});
