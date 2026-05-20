import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Animated,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { auth } from '../lib/firebase';
import { colors, spacing, fontSize } from '../theme';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';

// ── Duration slider (CreateBetModal) ─────────────────────────────────────────

const DUR_STEPS_MIN = [15, 30, 45, 60, 90, 120, 180];
const DUR_N = DUR_STEPS_MIN.length;
const DUR_THUMB = 24;
const DUR_PRESETS = [
  { label: '15m', idx: 0 },
  { label: '30m', idx: 1 },
  { label: '1h',  idx: 3 },
  { label: '2h',  idx: 5 },
  { label: '3h',  idx: 6 },
];

type CalOption = 'today' | 'tomorrow' | 'week';
const CAL_OPTIONS: Array<{ key: CalOption; label: string }> = [
  { key: 'today',    label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'week',     label: 'This Week' },
];

function durLabel(calOpt: CalOption | null, idx: number): string {
  if (calOpt === 'today')    return 'End of Today';
  if (calOpt === 'tomorrow') return 'End of Tomorrow';
  if (calOpt === 'week')     return 'End of Week';
  const m = DUR_STEPS_MIN[idx];
  if (m < 60) return `${m} min`;
  const h = m / 60;
  return h === Math.floor(h) ? `${h}h` : `${Math.floor(h)}h ${m % 60}m`;
}

// ── Types ────────────────────────────────────────────────────────────────────

type Challenge = {
  id: string;
  type: 'app' | 'custom';
  title: string;
  description: string;
  metric: 'screen_time' | 'opens' | 'streak_days';
  targetApp: string | null;
  startDate: string;
  endDate: string;
  status: 'pending' | 'active' | 'claimable' | 'settled' | 'cancelled';
  createdBy: string;
  rewardCredits?: number;
  weekId?: string;
  participants?: Participant[];
  totalPot?: number;
  winner?: string | null;
  maxParticipants?: number;
  stake?: number;
  // Derived client-side
  claimable?: boolean;
  currentProgress?: number;
  goal?: number;
};

type Participant = {
  userId: string;
  stake: number;
  result: 'pending' | 'won' | 'lost';
  metricValue: number | null;
};

type Transaction = {
  id: string;
  type: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  relatedChallengeId: string | null;
  timestamp: string;
  note: string;
};

type ActiveChallenge = Challenge & {
  currentProgress: number;
  timeRemainingSeconds: number;
};

type DailyChallenge = {
  id: string;
  title: string;
  description: string;
  metric: 'screen_time' | 'opens';
  target_app: string | null;
  goal_type: 'beat_yesterday' | 'weekly_average' | 'fixed';
  stake_credits: number;
  reward_credits: number;
  difficulty: 'easy' | 'medium' | 'hard';
  enrolled: boolean;
  goal: number | null;
  currentProgress: number;
  status: 'available' | 'active' | 'claimable' | 'claimed';
  result: 'pending' | 'won' | 'lost' | null;
  enrollmentId: string | null;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function daysLeft(endDate: string): string {
  const diff = new Date(endDate).getTime() - Date.now();
  if (diff <= 0) return 'Ended';
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  if (days === 1) return '1 day left';
  return `${days} days left`;
}

function metricLabel(metric: string, targetApp: string | null): string {
  const metricName =
    metric === 'screen_time' ? 'Screen Time' : metric === 'opens' ? 'Opens' : 'Streak Days';
  if (targetApp) return `${metricName} · ${targetApp}`;
  return metricName;
}

function txTypeLabel(type: string): string {
  switch (type) {
    case 'challenge_win': return 'Challenge Win';
    case 'challenge_loss': return 'Challenge Loss';
    case 'challenge_stake': return 'Daily Challenge Stake';
    case 'weekly_reward': return 'Weekly Reward';
    case 'spend_block': return 'Spent Block';
    case 'refund': return 'Refund';
    case 'starter_grant': return 'Welcome Bonus';
    default: return type.replace(/_/g, ' ');
  }
}

function fmtSeconds(s: number): string {
  if (s <= 0) return '0m';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

function fmtMetric(value: number, metric: string): string {
  if (metric === 'screen_time') return fmtSeconds(value);
  return String(Math.round(value));
}

function goalHint(goalType: string, metric: string): string {
  if (goalType === 'beat_yesterday') return metric === 'screen_time' ? 'Goal: less than yesterday' : 'Goal: fewer than yesterday';
  if (goalType === 'weekly_average') return 'Goal: under your 7-day average';
  return '';
}

function difficultyColor(d: string): string {
  if (d === 'easy') return colors.success;
  if (d === 'hard') return colors.destructive;
  return colors.warning;
}

function fmtTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Credit Balance Badge ─────────────────────────────────────────────────────

function CreditBadge({
  balance,
  loading,
  onPress,
}: {
  balance: number | null;
  loading: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.creditBadge} onPress={onPress} activeOpacity={0.8}>
      {loading ? (
        <ActivityIndicator size="small" color={colors.accentPrimary} />
      ) : (
        <Text style={styles.creditBadgeText}>
          {'\u{1F48E}'} {balance ?? 0} credits
        </Text>
      )}
    </TouchableOpacity>
  );
}

// ── Progress Bar ─────────────────────────────────────────────────────────────

function ProgressBar({ value, goal }: { value: number; goal: number }) {
  const pct = goal > 0 ? Math.min(value / goal, 1) : 0;
  const barColor = pct >= 1 ? colors.success : colors.accentPrimary;
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${Math.round(pct * 100)}%` as any, backgroundColor: barColor }]} />
    </View>
  );
}

// ── Challenge Card (App) ─────────────────────────────────────────────────────

function AppChallengeCard({
  challenge,
  onClaim,
  claiming,
}: {
  challenge: Challenge;
  onClaim: (id: string) => void;
  claiming: boolean;
}) {
  const isSettled = challenge.status === 'settled';
  const isClaimable = challenge.claimable || challenge.status === 'claimable';
  const progress = challenge.currentProgress ?? 0;
  const goal = challenge.goal ?? 1;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{challenge.title}</Text>
          <Text style={styles.cardMeta}>{metricLabel(challenge.metric, challenge.targetApp)}</Text>
        </View>
        {challenge.rewardCredits != null && (
          <View style={styles.rewardBadge}>
            <Text style={styles.rewardBadgeText}>+{challenge.rewardCredits}</Text>
          </View>
        )}
      </View>

      {challenge.description ? (
        <Text style={styles.cardDesc}>{challenge.description}</Text>
      ) : null}

      {!isSettled && (
        <>
          <ProgressBar value={progress} goal={goal} />
          <Text style={styles.progressLabel}>
            {progress} / {goal}
          </Text>
        </>
      )}

      <View style={styles.cardFooter}>
        <Text style={styles.cardDateText}>{daysLeft(challenge.endDate)}</Text>
        {isClaimable && !isSettled && (
          <TouchableOpacity
            style={[styles.claimBtn, claiming && styles.claimBtnDim]}
            disabled={claiming}
            onPress={() => onClaim(challenge.id)}
            activeOpacity={0.8}
          >
            {claiming ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.claimBtnText}>Claim Reward</Text>
            )}
          </TouchableOpacity>
        )}
        {isSettled && (
          <View style={styles.settledBadge}>
            <Text style={styles.settledBadgeText}>Settled</Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ── Daily Challenge Card ──────────────────────────────────────────────────────

function DailyChallengeCard({
  challenge,
  onEnter,
  onClaim,
  acting,
}: {
  challenge: DailyChallenge;
  onEnter: (id: string) => void;
  onClaim: (id: string) => void;
  acting: boolean;
}) {
  const { status, result, enrolled, goal, currentProgress, metric } = challenge;
  const isClaimed = status === 'claimed';
  const isClaimable = status === 'claimable';
  const isActive = status === 'active';
  const isAvailable = status === 'available';

  const diffColor = difficultyColor(challenge.difficulty);
  const pct = goal != null && goal > 0 ? Math.min(currentProgress / goal, 1.2) : 0;
  const barColor = pct >= 1 ? colors.destructive : pct > 0.8 ? colors.warning : colors.success;

  return (
    <View style={[styles.card, isClaimed && result === 'won' && styles.cardWon, isClaimed && result === 'lost' && styles.cardLost]}>
      {/* Header */}
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{challenge.title}</Text>
          <Text style={styles.cardMeta}>
            {metric === 'screen_time' ? 'Screen Time' : 'Opens'}
            {challenge.target_app ? ` · ${challenge.target_app}` : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <View style={[styles.diffBadge, { backgroundColor: `${diffColor}22`, borderColor: `${diffColor}55` }]}>
            <Text style={[styles.diffBadgeText, { color: diffColor }]}>
              {challenge.difficulty.toUpperCase()}
            </Text>
          </View>
          <View style={styles.rewardBadge}>
            <Text style={styles.rewardBadgeText}>+{challenge.reward_credits}</Text>
          </View>
        </View>
      </View>

      <Text style={styles.cardDesc}>{challenge.description}</Text>

      {/* Goal display */}
      {!isAvailable && goal != null && (
        <View style={styles.dailyGoalRow}>
          <Ionicons name="flag-outline" size={13} color={colors.textTertiary} />
          <Text style={styles.dailyGoalText}>
            Goal: {fmtMetric(goal, metric)}
            {metric === 'screen_time' ? ' or less' : ' opens or less'}
          </Text>
        </View>
      )}
      {isAvailable && challenge.goal_type !== 'fixed' && (
        <Text style={styles.dailyGoalHint}>{goalHint(challenge.goal_type, metric)}</Text>
      )}
      {isAvailable && challenge.goal != null && challenge.goal_type === 'fixed' && (
        <View style={styles.dailyGoalRow}>
          <Ionicons name="flag-outline" size={13} color={colors.textTertiary} />
          <Text style={styles.dailyGoalText}>
            Goal: {fmtMetric(challenge.goal, metric)}
            {metric === 'screen_time' ? ' or less' : ' opens or less'}
          </Text>
        </View>
      )}

      {/* Progress bar (while active) */}
      {isActive && goal != null && (
        <>
          <View style={[styles.progressTrack, { marginTop: spacing.sm }]}>
            <View style={[styles.progressFill, { width: `${Math.min(Math.round(pct * 100), 100)}%` as any, backgroundColor: barColor }]} />
          </View>
          <Text style={styles.progressLabel}>
            {fmtMetric(currentProgress, metric)} used · Goal: {fmtMetric(goal, metric)}
          </Text>
        </>
      )}

      {/* Footer */}
      <View style={styles.cardFooter}>
        <Text style={styles.cardDateText}>
          {isAvailable ? `Stake ${challenge.stake_credits} cr` : isActive ? 'In progress' : isClaimable ? 'Ready to claim' : result === 'won' ? 'Won!' : 'Lost'}
        </Text>

        {isAvailable && (
          <TouchableOpacity
            style={[styles.enterBtn, acting && styles.claimBtnDim]}
            disabled={acting}
            onPress={() => onEnter(challenge.id)}
            activeOpacity={0.8}
          >
            {acting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.enterBtnText}>Enter · {challenge.stake_credits} cr</Text>
            )}
          </TouchableOpacity>
        )}

        {isActive && (
          <View style={[styles.settledBadge, { backgroundColor: `${colors.accentPrimary}18`, borderColor: `${colors.accentPrimary}40` }]}>
            <Text style={[styles.settledBadgeText, { color: colors.accentPrimary }]}>Active</Text>
          </View>
        )}

        {isClaimable && (
          <TouchableOpacity
            style={[styles.claimBtn, acting && styles.claimBtnDim]}
            disabled={acting}
            onPress={() => onClaim(challenge.id)}
            activeOpacity={0.8}
          >
            {acting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.claimBtnText}>Claim</Text>
            )}
          </TouchableOpacity>
        )}

        {isClaimed && (
          <View style={[
            styles.settledBadge,
            result === 'won' && { backgroundColor: `${colors.success}22`, borderColor: `${colors.success}44` },
            result === 'lost' && { backgroundColor: `${colors.destructive}22`, borderColor: `${colors.destructive}44` },
          ]}>
            <Text style={[
              styles.settledBadgeText,
              result === 'won' && { color: colors.success },
              result === 'lost' && { color: colors.destructive },
            ]}>
              {result === 'won' ? `Won +${challenge.reward_credits} cr` : 'Lost'}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ── Challenge Card (Friend Bet) ───────────────────────────────────────────────

function FriendChallengeCard({
  challenge,
  myUid,
  onJoin,
  onDecline,
  onSettle,
  acting,
}: {
  challenge: Challenge;
  myUid: string;
  onJoin: (id: string) => void;
  onDecline: (id: string) => void;
  onSettle: (id: string) => void;
  acting: boolean;
}) {
  const participants = challenge.participants ?? [];
  const myParticipant = participants.find((p) => p.userId === myUid);
  const isParticipant = !!myParticipant;
  const isCreator = challenge.createdBy === myUid;
  const maxP = challenge.maxParticipants ?? 2;
  const isFull = participants.length >= maxP;
  const isPending = challenge.status === 'pending';
  const isActive = challenge.status === 'active' || challenge.status === 'claimable';
  const isSettled = challenge.status === 'settled';

  const canJoin = !isParticipant && isPending && !isFull;
  const pastEnd = new Date(challenge.endDate).getTime() < Date.now();
  const canSettle = isActive && pastEnd;
  const myResult = myParticipant?.result;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{challenge.title}</Text>
          <Text style={styles.cardMeta}>{metricLabel(challenge.metric, challenge.targetApp)}</Text>
        </View>
        {challenge.totalPot != null && (
          <View style={styles.potBadge}>
            <Text style={styles.potBadgeText}>Pot: {challenge.totalPot}</Text>
          </View>
        )}
      </View>

      {/* Spots indicator */}
      <Text style={styles.spotsText}>
        {participants.length}/{maxP} joined
        {challenge.stake ? `  ·  ${challenge.stake} credits each` : ''}
      </Text>

      {/* Participants */}
      {participants.length > 0 && (
        <View style={styles.participantList}>
          {participants.map((p, i) => {
            const isMe = p.userId === myUid;
            const resultColor =
              p.result === 'won' ? colors.success : p.result === 'lost' ? colors.destructive : colors.textSecondary;
            return (
              <View key={i} style={styles.participantRow}>
                <Text style={[styles.participantName, isMe && { color: colors.accentPrimary }]}>
                  {isMe ? 'You' : p.userId.slice(0, 8) + '…'}
                </Text>
                <Text style={styles.participantStake}>Stake: {p.stake}</Text>
                {p.metricValue != null && (
                  <Text style={styles.participantMetric}>{p.metricValue}</Text>
                )}
                {isSettled && (
                  <Text style={[styles.participantResult, { color: resultColor }]}>
                    {p.result === 'won' ? 'Won' : p.result === 'lost' ? 'Lost' : '—'}
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      )}

      <View style={styles.cardFooter}>
        <Text style={styles.cardDateText}>{daysLeft(challenge.endDate)}</Text>

        {/* Not yet joined — can join */}
        {canJoin && (
          <TouchableOpacity
            style={[styles.joinBtn, acting && styles.claimBtnDim]}
            disabled={acting}
            onPress={() => onJoin(challenge.id)}
            activeOpacity={0.8}
          >
            {acting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.joinBtnText}>
                Join{challenge.stake ? ` (${challenge.stake} cr)` : ''}
              </Text>
            )}
          </TouchableOpacity>
        )}

        {/* Already joined and pending */}
        {isParticipant && isPending && (
          <View style={styles.actionRow}>
            <Text style={styles.waitingText}>
              Waiting for {maxP - participants.length} more…
            </Text>
            {isCreator && (
              <TouchableOpacity
                style={[styles.declineBtn, { marginLeft: spacing.sm }, acting && styles.claimBtnDim]}
                disabled={acting}
                onPress={() => onDecline(challenge.id)}
                activeOpacity={0.8}
              >
                <Text style={styles.declineBtnText}>Cancel</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Active: settle button if past end */}
        {canSettle && (
          <TouchableOpacity
            style={[styles.claimBtn, acting && styles.claimBtnDim]}
            disabled={acting}
            onPress={() => onSettle(challenge.id)}
            activeOpacity={0.8}
          >
            {acting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.claimBtnText}>Settle</Text>
            )}
          </TouchableOpacity>
        )}

        {/* Settled: show outcome */}
        {isSettled && myResult && (
          <View
            style={[
              styles.settledBadge,
              myResult === 'won' && { backgroundColor: `${colors.success}22` },
              myResult === 'lost' && { backgroundColor: `${colors.destructive}22` },
            ]}
          >
            <Text
              style={[
                styles.settledBadgeText,
                myResult === 'won' && { color: colors.success },
                myResult === 'lost' && { color: colors.destructive },
              ]}
            >
              {myResult === 'won' ? 'Won' : 'Lost'}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ── Active Challenge Card ────────────────────────────────────────────────────

function ActiveChallengeCard({ challenge }: { challenge: ActiveChallenge }) {
  const participants = challenge.participants ?? [];
  const timeRem = challenge.timeRemainingSeconds ?? 0;
  const hours = Math.floor(timeRem / 3600);
  const days = Math.floor(hours / 24);
  const timeLabel =
    timeRem <= 0 ? 'Ended' : days > 0 ? `${days}d left` : `${hours}h left`;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{challenge.title}</Text>
          <Text style={styles.cardMeta}>{metricLabel(challenge.metric, challenge.targetApp)}</Text>
        </View>
        <Text style={styles.cardDateText}>{timeLabel}</Text>
      </View>

      {challenge.goal != null && (
        <>
          <ProgressBar value={challenge.currentProgress ?? 0} goal={challenge.goal} />
          <Text style={styles.progressLabel}>
            {challenge.currentProgress ?? 0} / {challenge.goal}
          </Text>
        </>
      )}

      {participants.length > 0 && (
        <View style={styles.participantList}>
          {participants.map((p, i) => (
            <View key={i} style={styles.participantRow}>
              <Text style={styles.participantName}>{p.userId.slice(0, 8)}…</Text>
              {p.metricValue != null && (
                <Text style={styles.participantMetric}>{p.metricValue}</Text>
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ── Transaction History Modal ─────────────────────────────────────────────────

function TransactionModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        const res = await fetch(`${API_URL}/api/credits/transactions`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Failed to load');
        const data = await res.json();
        setTransactions(Array.isArray(data) ? data : (data.transactions ?? []));
      } catch {
        setError('Could not load transactions.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose} />
      <View style={styles.modalSheet}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Credit History</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Text style={styles.modalClose}>✕</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.accentPrimary} style={{ marginTop: spacing.lg }} />
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : transactions.length === 0 ? (
          <Text style={styles.emptyText}>No transactions yet.</Text>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            {transactions.map((tx) => (
              <View key={tx.id} style={styles.txRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.txType}>{txTypeLabel(tx.type)}</Text>
                  {tx.note ? <Text style={styles.txNote}>{tx.note}</Text> : null}
                  <Text style={styles.txDate}>{fmtTimestamp(tx.timestamp)}</Text>
                </View>
                <Text
                  style={[
                    styles.txAmount,
                    { color: tx.amount >= 0 ? colors.success : colors.destructive },
                  ]}
                >
                  {tx.amount >= 0 ? '+' : ''}{tx.amount}
                </Text>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

// ── Create Bet Modal ──────────────────────────────────────────────────────────

function CreateBetModal({
  visible,
  onClose,
  onCreated,
  myUid,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
  myUid: string;
}) {
  const [title, setTitle] = useState('');
  const [maxParticipants, setMaxParticipants] = useState('2');
  const [stake, setStake] = useState('');
  const [metric, setMetric] = useState<'screen_time' | 'opens' | 'streak_days'>('screen_time');
  const [appName, setAppName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Duration slider state
  const DEFAULT_IDX = 1; // 30m
  const [durIdx, setDurIdx] = useState(DEFAULT_IDX);
  const [calOption, setCalOption] = useState<CalOption | null>('tomorrow');
  const trackW = useRef(0);
  const idxRef = useRef(DEFAULT_IDX);
  const thumbAnim = useRef(new Animated.Value(0)).current;
  const fillAnim = useRef(new Animated.Value(DEFAULT_IDX / (DUR_N - 1))).current;

  useEffect(() => {
    if (visible) {
      idxRef.current = DEFAULT_IDX;
      setDurIdx(DEFAULT_IDX);
      setCalOption('tomorrow');
      fillAnim.setValue(DEFAULT_IDX / (DUR_N - 1));
      thumbAnim.setValue(0);
    }
  }, [visible]);

  function springTo(newIdx: number) {
    const pct = newIdx / (DUR_N - 1);
    Animated.parallel([
      Animated.spring(thumbAnim, {
        toValue: pct * Math.max(0, trackW.current - DUR_THUMB),
        useNativeDriver: false,
        tension: 220,
        friction: 11,
      }),
      Animated.spring(fillAnim, {
        toValue: pct,
        useNativeDriver: false,
        tension: 220,
        friction: 11,
      }),
    ]).start();
  }

  function snapToIdx(newIdx: number) {
    const clamped = Math.max(0, Math.min(DUR_N - 1, newIdx));
    idxRef.current = clamped;
    setDurIdx(clamped);
    setCalOption(null);
    springTo(clamped);
  }

  function fromTouchX(x: number) {
    if (!trackW.current) return;
    const pct = Math.max(0, Math.min(1, x / trackW.current));
    const newIdx = Math.round(pct * (DUR_N - 1));
    thumbAnim.setValue(pct * Math.max(0, trackW.current - DUR_THUMB));
    fillAnim.setValue(pct);
    if (newIdx !== idxRef.current) {
      idxRef.current = newIdx;
      setDurIdx(newIdx);
      setCalOption(null);
    }
  }

  function selectCal(opt: CalOption) {
    setCalOption(opt);
    const pct = 1;
    Animated.parallel([
      Animated.spring(thumbAnim, {
        toValue: Math.max(0, trackW.current - DUR_THUMB),
        useNativeDriver: false,
        tension: 220,
        friction: 11,
      }),
      Animated.spring(fillAnim, {
        toValue: pct,
        useNativeDriver: false,
        tension: 220,
        friction: 11,
      }),
    ]).start();
  }

  function onTrackLayout(e: any) {
    trackW.current = e.nativeEvent.layout.width;
    const pct = idxRef.current / (DUR_N - 1);
    thumbAnim.setValue(pct * Math.max(0, trackW.current - DUR_THUMB));
    fillAnim.setValue(pct);
  }

  const METRICS: Array<{ value: 'screen_time' | 'opens' | 'streak_days'; label: string }> = [
    { value: 'screen_time', label: 'Screen Time' },
    { value: 'opens', label: 'Opens' },
    { value: 'streak_days', label: 'Streak Days' },
  ];

  function getEndDate(): string {
    const d = new Date();
    if (calOption === 'today') {
      d.setHours(23, 59, 59, 0);
      return d.toISOString();
    }
    if (calOption === 'tomorrow') {
      d.setDate(d.getDate() + 1);
      d.setHours(23, 59, 59, 0);
      return d.toISOString();
    }
    if (calOption === 'week') {
      d.setDate(d.getDate() + 7);
      d.setHours(23, 59, 59, 0);
      return d.toISOString();
    }
    d.setMinutes(d.getMinutes() + DUR_STEPS_MIN[durIdx]);
    return d.toISOString();
  }

  async function handleSubmit() {
    if (!title.trim()) {
      Alert.alert('Missing field', 'Enter a title for the challenge.');
      return;
    }
    const stakeNum = parseInt(stake, 10);
    if (isNaN(stakeNum) || stakeNum <= 0) {
      Alert.alert('Invalid stake', 'Enter a positive number of credits.');
      return;
    }
    const maxNum = parseInt(maxParticipants, 10);
    if (isNaN(maxNum) || maxNum < 2) {
      Alert.alert('Invalid', 'Need at least 2 participants.');
      return;
    }

    setSubmitting(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const body = {
        title: title.trim(),
        description: '',
        metric,
        target_app: appName.trim() || null,
        end_date: getEndDate(),
        max_participants: maxNum,
        stake: stakeNum,
      };
      const res = await fetch(`${API_URL}/api/challenges/custom`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        Alert.alert('Error', err.detail ?? 'Failed to create challenge.');
        return;
      }
      Alert.alert('Challenge created!', 'Your friends can now join. Credits locked until it fills.');
      setTitle('');
      setStake('');
      setAppName('');
      setMaxParticipants('2');
      setCalOption('tomorrow');
      onCreated();
      onClose();
    } catch {
      Alert.alert('Error', 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New Challenge</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.fieldLabel}>Title</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Who scrolls less this week?"
              placeholderTextColor={colors.textTertiary}
            />

            <Text style={styles.fieldLabel}>Metric</Text>
            <View style={styles.metricRow}>
              {METRICS.map((m) => (
                <TouchableOpacity
                  key={m.value}
                  style={[styles.metricChip, metric === m.value && styles.metricChipActive]}
                  onPress={() => setMetric(m.value)}
                >
                  <Text
                    style={[
                      styles.metricChipText,
                      metric === m.value && styles.metricChipTextActive,
                    ]}
                  >
                    {m.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>App (optional)</Text>
            <TextInput
              style={styles.input}
              value={appName}
              onChangeText={setAppName}
              placeholder="e.g. Instagram"
              placeholderTextColor={colors.textTertiary}
            />

            <Text style={styles.fieldLabel}>Max Participants</Text>
            <TextInput
              style={styles.input}
              value={maxParticipants}
              onChangeText={setMaxParticipants}
              placeholder="2"
              placeholderTextColor={colors.textTertiary}
              keyboardType="number-pad"
            />

            <Text style={styles.fieldLabel}>Stake (credits each)</Text>
            <TextInput
              style={styles.input}
              value={stake}
              onChangeText={setStake}
              placeholder="e.g. 20"
              placeholderTextColor={colors.textTertiary}
              keyboardType="number-pad"
            />

            <Text style={styles.fieldLabel}>Ends</Text>

            {/* Big time label */}
            <Text style={styles.durBigLabel}>{durLabel(calOption, durIdx)}</Text>

            {/* Slider */}
            <View
              style={styles.durTrackWrap}
              onLayout={onTrackLayout}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderGrant={(e) => fromTouchX(e.nativeEvent.locationX)}
              onResponderMove={(e) => fromTouchX(e.nativeEvent.locationX)}
            >
              <View style={[styles.durTrack, calOption !== null && { opacity: 0.4 }]}>
                <Animated.View
                  style={[
                    styles.durFill,
                    {
                      width: fillAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0%', '100%'],
                      }),
                    },
                  ]}
                />
              </View>
              <Animated.View
                style={[
                  styles.durThumb,
                  { left: thumbAnim },
                  calOption !== null && { opacity: 0.4 },
                ]}
              />
            </View>
            <View style={styles.durEndLabels}>
              <Text style={styles.durEndTxt}>15 min</Text>
              <Text style={styles.durEndTxt}>3 h</Text>
            </View>

            {/* Duration preset chips */}
            <View style={styles.durPresetRow}>
              {DUR_PRESETS.map((p) => {
                const active = calOption === null && durIdx === p.idx;
                return (
                  <TouchableOpacity
                    key={p.label}
                    style={[styles.durChip, active && styles.durChipActive]}
                    onPress={() => snapToIdx(p.idx)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.durChipTxt, active && styles.durChipTxtActive]}>
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Calendar chips */}
            <View style={styles.durCalRow}>
              {CAL_OPTIONS.map((opt) => {
                const active = calOption === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.durChip, styles.durCalChip, active && styles.durChipActive]}
                    onPress={() => selectCal(opt.key)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.durChipTxt, active && styles.durChipTxtActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.escrowWarning}>
              <Ionicons name="warning-outline" size={16} color={colors.warning} />
              <Text style={styles.escrowWarningText}>
                Your credits are locked when you create this challenge. Friends join and add to the pot.
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.submitBtn, submitting && styles.claimBtnDim]}
              disabled={submitting}
              onPress={handleSubmit}
              activeOpacity={0.8}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitBtnText}>Create Challenge</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Tab 1: Daily Challenges ───────────────────────────────────────────────────

function DailyTab({
  balance,
  balanceLoading,
  onOpenTransactions,
  onBalanceRefresh,
}: {
  balance: number | null;
  balanceLoading: boolean;
  onOpenTransactions: () => void;
  onBalanceRefresh: () => void;
}) {
  const [challenges, setChallenges] = useState<DailyChallenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const fetchChallenges = useCallback(async () => {
    setError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/challenges/daily`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setChallenges(Array.isArray(data) ? data : (data.challenges ?? []));
    } catch {
      setError('Could not load daily challenges.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchChallenges();
  }, [fetchChallenges]);

  async function handleEnter(templateId: string) {
    setActingId(templateId);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/challenges/daily/${templateId}/enter`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        Alert.alert('Could not enter', data.detail ?? 'Something went wrong.');
        return;
      }
      Alert.alert(
        'Challenge entered!',
        `Goal: ${data.goal != null ? (challenges.find(c => c.id === templateId)?.metric === 'screen_time' ? fmtSeconds(data.goal) : String(Math.round(data.goal))) : '—'}\nYour ${data.stakeCredits} cr stake is locked until midnight.`,
      );
      fetchChallenges();
      onBalanceRefresh();
    } catch {
      Alert.alert('Error', 'Failed to enter challenge.');
    } finally {
      setActingId(null);
    }
  }

  async function handleClaim(templateId: string) {
    setActingId(templateId);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/challenges/daily/${templateId}/claim`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        Alert.alert('Cannot claim yet', data.detail ?? 'Something went wrong.');
        return;
      }
      if (data.result === 'won') {
        Alert.alert('You won! 🎉', `+${data.creditsAwarded} credits added to your balance.`);
      } else {
        Alert.alert('Better luck tomorrow', 'You didn\'t meet the goal — your stake is forfeited.');
      }
      fetchChallenges();
      onBalanceRefresh();
    } catch {
      Alert.alert('Error', 'Failed to claim challenge.');
    } finally {
      setActingId(null);
    }
  }

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const entered = challenges.filter(c => c.enrolled);
  const available = challenges.filter(c => !c.enrolled);

  return (
    <ScrollView
      style={styles.tabContent}
      contentContainerStyle={styles.tabContentInner}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchChallenges(); }} tintColor={colors.accentPrimary} />
      }
    >
      {/* Credit balance */}
      <View style={styles.balanceRow}>
        <CreditBadge balance={balance} loading={balanceLoading} onPress={onOpenTransactions} />
        <Text style={styles.todayLabel}>{today}</Text>
      </View>

      {/* Staking info banner */}
      <View style={styles.infoBanner}>
        <Ionicons name="information-circle-outline" size={15} color={colors.accentSecondary} />
        <Text style={styles.infoBannerText}>
          Stake credits to enter · Win and get 2× back · Claim after midnight
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accentPrimary} style={{ marginTop: spacing.xl }} />
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : (
        <>
          {entered.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>Your Challenges</Text>
              {entered.map(c => (
                <DailyChallengeCard
                  key={c.id}
                  challenge={c}
                  onEnter={handleEnter}
                  onClaim={handleClaim}
                  acting={actingId === c.id}
                />
              ))}
            </>
          )}

          <Text style={styles.sectionHeader}>Available Today</Text>
          {available.length === 0 ? (
            <Text style={styles.emptyText}>You've entered all of today's challenges!</Text>
          ) : (
            available.map(c => (
              <DailyChallengeCard
                key={c.id}
                challenge={c}
                onEnter={handleEnter}
                onClaim={handleClaim}
                acting={actingId === c.id}
              />
            ))
          )}
        </>
      )}
    </ScrollView>
  );
}

// ── Tab 2: Friend Challenges ──────────────────────────────────────────────────

function FriendsTab({
  balance,
  balanceLoading,
  onOpenTransactions,
  myUid,
}: {
  balance: number | null;
  balanceLoading: boolean;
  onOpenTransactions: () => void;
  myUid: string;
}) {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [createVisible, setCreateVisible] = useState(false);

  const fetchChallenges = useCallback(async () => {
    setError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/challenges/custom`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      const raw: Challenge[] = (Array.isArray(data) ? data : (data.challenges ?? []))
        .map((c: any) => ({ ...c, id: c.id ?? c.challengeId }));
      const now = Date.now();
      setChallenges(
        raw.map((c) => ({
          ...c,
          claimable: c.status === 'active' && new Date(c.endDate).getTime() < now,
        })),
      );
    } catch {
      setError('Could not load friend challenges.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchChallenges();
  }, [fetchChallenges]);

  function onRefreshFriends() {
    setRefreshing(true);
    fetchChallenges();
  }

  async function handleJoin(id: string) {
    setActingId(id);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/challenges/${id}/join`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        Alert.alert('Error', err.detail ?? 'Failed to join challenge.');
        return;
      }
      fetchChallenges();
    } catch {
      Alert.alert('Error', 'Failed to join challenge.');
    } finally {
      setActingId(null);
    }
  }

  async function handleDecline(id: string) {
    setActingId(id);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      await fetch(`${API_URL}/api/challenges/${id}/decline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchChallenges();
    } catch {
      Alert.alert('Error', 'Failed to decline bet.');
    } finally {
      setActingId(null);
    }
  }

  async function handleSettle(id: string) {
    setActingId(id);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/challenges/${id}/claim`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.result === 'won') {
        Alert.alert('You won!', `+${data.creditsAwarded ?? 0} credits`);
      } else if (data.result === 'lost') {
        Alert.alert('You lost.', 'Better luck next time.');
      } else if (data.result === 'already_settled') {
        Alert.alert('Already settled.');
      }
      fetchChallenges();
    } catch {
      Alert.alert('Error', 'Failed to settle bet.');
    } finally {
      setActingId(null);
    }
  }

  // Separate challenges the user has joined from open ones they can join
  const joined = challenges.filter((c) => c.participants?.some((p) => p.userId === myUid));
  const openToJoin = challenges.filter((c) => !c.participants?.some((p) => p.userId === myUid));

  const pending = joined.filter((c) => c.status === 'pending');
  const active = joined.filter((c) => c.status === 'active' || c.status === 'claimable');
  const settled = joined.filter((c) => c.status === 'settled' || c.status === 'cancelled');

  return (
    <>
      <ScrollView
        style={styles.tabContent}
        contentContainerStyle={styles.tabContentInner}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefreshFriends} tintColor={colors.accentPrimary} />
        }
      >
        {/* Header row: balance + create button */}
        <View style={styles.balanceRow}>
          <CreditBadge balance={balance} loading={balanceLoading} onPress={onOpenTransactions} />
          <TouchableOpacity
            style={styles.createBetBtn}
            onPress={() => setCreateVisible(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={20} color={colors.accentPrimary} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.accentPrimary} style={{ marginTop: spacing.xl }} />
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : (
          <>
            {openToJoin.length > 0 && (
              <>
                <Text style={styles.sectionHeader}>Open to Join</Text>
                {openToJoin.map((c) => (
                  <FriendChallengeCard
                    key={c.id}
                    challenge={c}
                    myUid={myUid}
                    onJoin={handleJoin}
                    onDecline={handleDecline}
                    onSettle={handleSettle}
                    acting={actingId === c.id}
                  />
                ))}
              </>
            )}

            {pending.length > 0 && (
              <>
                <Text style={styles.sectionHeader}>Waiting for Players</Text>
                {pending.map((c) => (
                  <FriendChallengeCard
                    key={c.id}
                    challenge={c}
                    myUid={myUid}
                    onJoin={handleJoin}
                    onDecline={handleDecline}
                    onSettle={handleSettle}
                    acting={actingId === c.id}
                  />
                ))}
              </>
            )}

            <Text style={styles.sectionHeader}>Active</Text>
            {active.length === 0 ? (
              <Text style={styles.emptyText}>No active bets.</Text>
            ) : (
              active.map((c) => (
                <FriendChallengeCard
                  key={c.id}
                  challenge={c}
                  myUid={myUid}
                  onJoin={handleJoin}
                  onDecline={handleDecline}
                  onSettle={handleSettle}
                  acting={actingId === c.id}
                />
              ))
            )}

            {settled.length > 0 && (
              <>
                <Text style={styles.sectionHeader}>Settled</Text>
                {settled.map((c) => (
                  <FriendChallengeCard
                    key={c.id}
                    challenge={c}
                    myUid={myUid}
                    onJoin={handleJoin}
                    onDecline={handleDecline}
                    onSettle={handleSettle}
                    acting={actingId === c.id}
                  />
                ))}
              </>
            )}

            {openToJoin.length === 0 && pending.length === 0 && active.length === 0 && settled.length === 0 && (
              <Text style={styles.emptyText}>No friend bets yet. Tap + to create one.</Text>
            )}
          </>
        )}
      </ScrollView>

      <CreateBetModal
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        onCreated={fetchChallenges}
        myUid={myUid}
      />
    </>
  );
}

// ── Tab 3: Active ─────────────────────────────────────────────────────────────

function ActiveTab() {
  const [challenges, setChallenges] = useState<ActiveChallenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchChallenges = useCallback(async () => {
    setError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/challenges/active`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      const raw = Array.isArray(data) ? data : (data.challenges ?? []);
      setChallenges(raw);
    } catch {
      setError('Could not load active challenges.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchChallenges();
  }, [fetchChallenges]);

  function onRefresh() {
    setRefreshing(true);
    fetchChallenges();
  }

  return (
    <ScrollView
      style={styles.tabContent}
      contentContainerStyle={styles.tabContentInner}
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
        <ActivityIndicator color={colors.accentPrimary} style={{ marginTop: spacing.xl }} />
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : challenges.length === 0 ? (
        <View style={styles.emptyStateContainer}>
          <Ionicons name="game-controller-outline" size={40} color={colors.textTertiary} />
          <Text style={styles.emptyStateTitle}>No active challenges</Text>
          <Text style={styles.emptyStateBody}>
            Enter a daily challenge or bet a friend.
          </Text>
        </View>
      ) : (
        challenges.map((c) => <ActiveChallengeCard key={c.id} challenge={c} />)
      )}
    </ScrollView>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

type InnerTab = 'app' | 'friends' | 'active';

export default function ChallengesScreen() {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<InnerTab>('app');
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [txModalVisible, setTxModalVisible] = useState(false);
  const [myUid, setMyUid] = useState<string>('');

  useEffect(() => {
    const uid = auth.currentUser?.uid ?? '';
    setMyUid(uid);
  }, []);

  const fetchBalance = useCallback(async () => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/credits/balance`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setBalance(data.balance ?? data.blockCredits ?? 0);
      }
    } catch {
      // silently fail — balance badge will show 0
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  const TABS: Array<{ key: InnerTab; label: string }> = [
    { key: 'app', label: 'Daily' },
    { key: 'friends', label: 'Friends' },
    { key: 'active', label: 'Active' },
  ];

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Page header */}
      <View style={[styles.pageHeader, { paddingTop: insets.top + spacing.lg }]}>
        <Text style={styles.pageTitle}>Challenges</Text>
      </View>

      {/* In-screen tab bar */}
      <View style={styles.innerTabBar}>
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.innerTab, activeTab === tab.key && styles.innerTabActive]}
            onPress={() => setActiveTab(tab.key)}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.innerTabText,
                activeTab === tab.key && styles.innerTabTextActive,
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Tab content */}
      {activeTab === 'app' && (
        <DailyTab
          balance={balance}
          balanceLoading={balanceLoading}
          onOpenTransactions={() => setTxModalVisible(true)}
          onBalanceRefresh={fetchBalance}
        />
      )}
      {activeTab === 'friends' && (
        <FriendsTab
          balance={balance}
          balanceLoading={balanceLoading}
          onOpenTransactions={() => setTxModalVisible(true)}
          myUid={myUid}
        />
      )}
      {activeTab === 'active' && <ActiveTab />}

      {/* Transaction history modal */}
      <TransactionModal
        visible={txModalVisible}
        onClose={() => setTxModalVisible(false)}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  // Page header
  pageHeader: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  pageTitle: {
    fontSize: fontSize.page,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: -1,
  },

  // Inner tab bar
  innerTabBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  innerTab: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: colors.surface2,
  },
  innerTabActive: {
    backgroundColor: `${colors.accentPrimary}22`,
    borderWidth: 1,
    borderColor: `${colors.accentPrimary}60`,
  },
  innerTabText: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  innerTabTextActive: {
    color: colors.accentPrimary,
  },

  // Tab content area
  tabContent: {
    flex: 1,
  },
  tabContentInner: {
    paddingHorizontal: spacing.md,
    paddingBottom: 100,
  },

  // Balance row
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  creditBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${colors.accentPrimary}18`,
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: `${colors.accentPrimary}40`,
  },
  creditBadgeText: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.accentPrimary,
  },
  createBetBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: `${colors.accentPrimary}18`,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: `${colors.accentPrimary}40`,
  },

  // Section header
  sectionHeader: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },

  // Challenge card
  card: {
    backgroundColor: colors.surface1,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.xs,
  },
  cardTitle: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: -0.2,
  },
  cardMeta: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    marginTop: 2,
  },
  cardDesc: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    lineHeight: 20,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  cardDateText: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    fontWeight: '500',
  },

  // Progress bar
  progressTrack: {
    height: 5,
    backgroundColor: colors.surface2,
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressLabel: {
    fontSize: fontSize.tiny,
    color: colors.textTertiary,
    marginTop: 4,
  },

  // Reward badge
  rewardBadge: {
    backgroundColor: `${colors.success}22`,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    marginLeft: spacing.sm,
    borderWidth: 1,
    borderColor: `${colors.success}44`,
  },
  rewardBadgeText: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.success,
  },

  // Pot badge
  potBadge: {
    backgroundColor: `${colors.accentSecondary}22`,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    marginLeft: spacing.sm,
    borderWidth: 1,
    borderColor: `${colors.accentSecondary}44`,
  },
  potBadgeText: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.accentSecondary,
  },

  // Claim button
  claimBtn: {
    backgroundColor: colors.accentPrimary,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    minWidth: 100,
    alignItems: 'center',
  },
  claimBtnDim: {
    opacity: 0.4,
  },
  claimBtnText: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: '#fff',
  },

  // Settled badge
  settledBadge: {
    backgroundColor: `${colors.neutral}22`,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  settledBadgeText: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.neutral,
  },

  // Participant list
  participantList: {
    marginTop: spacing.sm,
    gap: 6,
  },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  participantName: {
    flex: 1,
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  participantStake: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
  },
  participantMetric: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  participantResult: {
    fontSize: fontSize.small,
    fontWeight: '700',
  },

  // Spots indicator
  spotsText: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    marginTop: 4,
    marginBottom: spacing.xs,
  },

  // Join button
  joinBtn: {
    backgroundColor: colors.accentSecondary,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    minWidth: 100,
    alignItems: 'center',
  },
  joinBtnText: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: '#fff',
  },

  // Accept / Decline buttons
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  declineBtn: {
    backgroundColor: `${colors.destructive}22`,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: `${colors.destructive}44`,
  },
  declineBtnText: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.destructive,
  },
  waitingText: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    fontStyle: 'italic',
  },

  // Empty states
  emptyText: {
    fontSize: fontSize.body,
    color: colors.textTertiary,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  emptyStateContainer: {
    alignItems: 'center',
    paddingTop: spacing.xl * 2,
    gap: spacing.sm,
  },
  emptyStateTitle: {
    fontSize: fontSize.title,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  emptyStateBody: {
    fontSize: fontSize.body,
    color: colors.textTertiary,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    lineHeight: 20,
  },

  // Error
  errorText: {
    fontSize: fontSize.body,
    color: colors.destructive,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    paddingBottom: spacing.xl + 16,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  modalTitle: {
    fontSize: fontSize.title,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  modalClose: {
    fontSize: 18,
    color: colors.textTertiary,
    fontWeight: '600',
    paddingLeft: spacing.md,
  },

  // Transaction row
  txRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  txType: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  txNote: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    marginTop: 2,
  },
  txDate: {
    fontSize: fontSize.tiny,
    color: colors.textTertiary,
    marginTop: 2,
  },
  txAmount: {
    fontSize: fontSize.title,
    fontWeight: '700',
    marginLeft: spacing.sm,
  },

  // Create bet form
  fieldLabel: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: 12,
    padding: spacing.md,
    color: colors.textPrimary,
    fontSize: fontSize.body,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metricRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metricChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  metricChipActive: {
    borderColor: colors.accentPrimary,
    backgroundColor: `${colors.accentPrimary}18`,
  },
  metricChipText: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  metricChipTextActive: {
    color: colors.accentPrimary,
  },
  // Duration slider (CreateBetModal)
  durBigLabel: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.textPrimary,
    textAlign: 'center',
    letterSpacing: -0.5,
    marginVertical: spacing.md,
  },
  durTrackWrap: {
    height: 40,
    justifyContent: 'center',
    marginHorizontal: 4,
    marginBottom: 4,
  },
  durTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
  },
  durFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: colors.accentPrimary,
  },
  durThumb: {
    position: 'absolute',
    width: DUR_THUMB,
    height: DUR_THUMB,
    borderRadius: DUR_THUMB / 2,
    backgroundColor: '#fff',
    top: (40 - DUR_THUMB) / 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
    borderWidth: 2,
    borderColor: colors.accentPrimary,
  },
  durEndLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  durEndTxt: {
    fontSize: fontSize.tiny,
    color: colors.textTertiary,
  },
  durPresetRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: spacing.sm,
  },
  durCalRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: spacing.sm,
  },
  durChip: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderRadius: 20,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  durCalChip: {
    borderRadius: 10,
  },
  durChipActive: {
    borderColor: colors.accentPrimary,
    backgroundColor: `${colors.accentPrimary}18`,
  },
  durChipTxt: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  durChipTxtActive: {
    color: colors.accentPrimary,
    fontWeight: '700',
  },

  escrowWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    backgroundColor: `${colors.warning}18`,
    borderRadius: 10,
    padding: spacing.md,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: `${colors.warning}40`,
  },
  escrowWarningText: {
    flex: 1,
    fontSize: fontSize.small,
    color: colors.warning,
    lineHeight: 18,
  },
  submitBtn: {
    backgroundColor: colors.accentPrimary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  submitBtnText: {
    fontSize: fontSize.body,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.3,
  },

  // Daily challenges
  todayLabel: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    fontWeight: '500',
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: `${colors.accentSecondary}12`,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: `${colors.accentSecondary}30`,
  },
  infoBannerText: {
    flex: 1,
    fontSize: fontSize.small,
    color: colors.accentSecondary,
    lineHeight: 18,
  },
  diffBadge: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
  },
  diffBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  dailyGoalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
    marginBottom: 2,
  },
  dailyGoalText: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    fontStyle: 'italic',
  },
  dailyGoalHint: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    fontStyle: 'italic',
    marginTop: 4,
    marginBottom: 2,
  },
  enterBtn: {
    backgroundColor: colors.accentSecondary,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    alignItems: 'center',
  },
  enterBtnText: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: '#fff',
  },
  cardWon: {
    borderWidth: 1,
    borderColor: `${colors.success}44`,
  },
  cardLost: {
    borderWidth: 1,
    borderColor: `${colors.destructive}22`,
    opacity: 0.8,
  },
});
