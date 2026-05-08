import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Dimensions,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { onAuthStateChanged } from "firebase/auth";
import { useNavigation } from "@react-navigation/native";
import { auth } from "../lib/firebase";
import { colors, spacing, fontSize } from "../theme";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";
const WINDOW_WIDTH = Dimensions.get("window").width;
const CHART_PAD = spacing.md * 2 + spacing.md * 2; // screen padding + card padding
const CHART_W = WINDOW_WIDTH - CHART_PAD;
const TREND_H = 150;
const DOT_R = 3;

// Activity heatmap — GitHub-style small cells
const GRID_GAP       = 2;   // px gap between cells
const GRID_LABEL_W   = 12;  // day-of-week label column
const GRID_LABEL_GAP = 3;   // gap between labels and grid
const GRID_TARGET    = 11;  // target cell size (≈ GitHub desktop)
// How many week-columns fit at the target size
const GRID_NUM_WEEKS = Math.floor(
  (CHART_W - GRID_LABEL_W - GRID_LABEL_GAP + GRID_GAP) / (GRID_TARGET + GRID_GAP)
);
// Actual cell size — expands slightly so the grid fills the card edge-to-edge
const GRID_CELL = Math.floor(
  (CHART_W - GRID_LABEL_W - GRID_LABEL_GAP - (GRID_NUM_WEEKS - 1) * GRID_GAP) / GRID_NUM_WEEKS
);
// Days to fetch (cover the full grid + a few extra for safety)
const GRID_FETCH_DAYS = GRID_NUM_WEEKS * 7;

const DAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Usage thresholds (seconds)
const T_GREEN = 30 * 60;   // 30 min
const T_YELLOW = 60 * 60;  // 1 hour
const T_ORANGE = 2 * 60 * 60; // 2 hours

// Heatmap: green = low usage (good), red = high usage (bad)
function getHeatmapColor(secs: number): string {
  if (secs <= 0) return colors.surface2;      // no data
  if (secs < 15 * 60) return "#1a5c26";       // < 15m  dark forest green
  if (secs < 30 * 60) return "#22a03c";       // 15–30m medium green
  if (secs < 60 * 60) return colors.success;  // 30–60m bright green
  if (secs < 2 * 60 * 60) return colors.warning; // 1–2h  orange
  return colors.destructive;                  // 2h+   red
}

function getUsageColor(secs: number): string {
  if (secs <= 0) return colors.surface2;
  if (secs < T_GREEN) return colors.success;
  if (secs < T_YELLOW) return colors.warning;
  if (secs < T_ORANGE) return "#FF6B00";
  return colors.destructive;
}

function formatDuration(seconds: number): string {
  if (seconds === 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

type DailySummary = {
  date: string;
  totalSeconds: number;
  byApp: Record<string, number>;
  sessionCount: number;
  maxSessionSeconds?: number;
};

// ─── 28-Day Trend Line Chart ──────────────────────────────────────────────────

function TrendLineChart({
  values,
  labels,
}: {
  values: number[];
  labels: string[];
}) {
  const n = values.length;
  if (n < 2) return null;

  const max = Math.max(...values, 1);
  const avg = values.reduce((a, b) => a + b, 0) / n;

  const W = CHART_W;
  const H = TREND_H;
  const stepX = W / (n - 1);

  const px = (i: number) => i * stepX;
  const py = (v: number) => H - (v / max) * (H - 10) - 5;

  const avgY = py(avg);

  // Build line segments between consecutive points
  const segments = [];
  for (let i = 0; i < n - 1; i++) {
    const x1 = px(i),    y1 = py(values[i]);
    const x2 = px(i + 1), y2 = py(values[i + 1]);
    const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    const angleDeg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    segments.push({
      midX: (x1 + x2) / 2,
      midY: (y1 + y2) / 2,
      len,
      angleDeg,
      color: getUsageColor(Math.max(values[i], values[i + 1])),
    });
  }

  // Show x-axis labels at days 0, 7, 14, 21, 27
  const labelIdx = [0, 7, 14, 21, n - 1].filter((i) => i < n);

  return (
    <View style={{ height: H + 24 }}>
      {/* Average guideline */}
      <View
        style={{
          position: "absolute",
          left: 0,
          top: avgY,
          width: W,
          height: 1,
          backgroundColor: colors.textTertiary,
          opacity: 0.35,
        }}
      />
      <Text
        style={{
          position: "absolute",
          right: 0,
          top: avgY - 11,
          fontSize: fontSize.tiny,
          color: colors.textTertiary,
          opacity: 0.7,
        }}
      >
        avg {formatDuration(Math.round(avg))}
      </Text>

      {/* Line segments */}
      {segments.map((seg, i) => (
        <View
          key={i}
          style={{
            position: "absolute",
            left: seg.midX - seg.len / 2,
            top: seg.midY - 1.5,
            width: seg.len,
            height: 3,
            backgroundColor: seg.color,
            borderRadius: 2,
            transform: [{ rotate: `${seg.angleDeg}deg` }],
          }}
        />
      ))}

      {/* Dots at each data point (only where data exists) */}
      {values.map((v, i) =>
        v > 0 ? (
          <View
            key={i}
            style={{
              position: "absolute",
              left: px(i) - DOT_R,
              top: py(v) - DOT_R,
              width: DOT_R * 2,
              height: DOT_R * 2,
              borderRadius: DOT_R,
              backgroundColor: getUsageColor(v),
            }}
          />
        ) : null
      )}

      {/* X-axis labels */}
      {labelIdx.map((i) => (
        <Text
          key={i}
          style={{
            position: "absolute",
            left: px(i) - 18,
            top: H + 6,
            width: 36,
            textAlign: "center",
            fontSize: fontSize.tiny,
            color: colors.textTertiary,
          }}
        >
          {labels[i]}
        </Text>
      ))}
    </View>
  );
}

// ─── This-Week Bar Chart ──────────────────────────────────────────────────────

function WeekBarChart({
  values,
  todayIdx,
}: {
  values: number[];
  todayIdx: number;
}) {
  const max = Math.max(...values, 1);
  const BAR_MAX_H = 80;

  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", height: BAR_MAX_H + 44 }}>
      {DAYS_SHORT.map((label, i) => {
        const barH =
          values[i] > 0 ? Math.max((values[i] / max) * BAR_MAX_H, 6) : 0;
        const color = getUsageColor(values[i]);
        const isToday = i === todayIdx;
        return (
          <View key={label} style={{ flex: 1, alignItems: "center" }}>
            {/* Duration label above bar */}
            <Text
              style={{
                fontSize: fontSize.tiny,
                color: isToday ? colors.textPrimary : colors.textTertiary,
                marginBottom: 4,
                height: 14,
              }}
            >
              {values[i] > 0 ? formatDuration(values[i]) : ""}
            </Text>

            {/* Bar */}
            <View
              style={{
                width: "58%",
                height: barH || 3,
                backgroundColor: values[i] === 0 ? colors.surface2 : color,
                borderRadius: 5,
                opacity: values[i] === 0 ? 0.25 : 1,
                borderWidth: isToday ? 1.5 : 0,
                borderColor: isToday ? "rgba(255,255,255,0.6)" : "transparent",
              }}
            />

            {/* Day label */}
            <Text
              style={{
                fontSize: fontSize.tiny,
                color: isToday ? colors.textPrimary : colors.textTertiary,
                fontWeight: isToday ? "700" : "400",
                marginTop: 6,
              }}
            >
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ─── Activity Heatmap (GitHub-style) ─────────────────────────────────────────

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOW_LABELS  = ["M", "", "W", "", "F", "", "S"];
const LEGEND_STEPS = [colors.surface2, "#1a5c26", "#22a03c", colors.success, colors.warning, colors.destructive];

function ActivityHeatmap({ summaries }: { summaries: Record<string, DailySummary> }) {
  const today     = new Date();
  const todayStr  = toDateString(today);
  const monday    = getMondayOfWeek(today);

  // Grid starts on the Monday (GRID_NUM_WEEKS − 1) weeks ago
  const gridStart = new Date(monday);
  gridStart.setDate(monday.getDate() - (GRID_NUM_WEEKS - 1) * 7);

  // weeks[col][row] = date string | null (future days shown as empty)
  const weeks: (string | null)[][] = Array.from({ length: GRID_NUM_WEEKS }, (_, col) =>
    Array.from({ length: 7 }, (_, row) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + col * 7 + row);
      const s = toDateString(d);
      return s <= todayStr ? s : null;
    })
  );

  // Month label appears above the first column of every new month
  const monthLabels: (string | null)[] = weeks.map((week, col) => {
    const first = week.find((d) => d !== null);
    if (!first) return null;
    const m = parseInt(first.slice(5, 7), 10) - 1;
    if (col === 0) return MONTH_NAMES[m];
    const prev = weeks[col - 1].find((d) => d !== null);
    if (!prev) return null;
    return parseInt(prev.slice(5, 7), 10) - 1 !== m ? MONTH_NAMES[m] : null;
  });

  return (
    <View>
      {/* Month labels */}
      <View style={{ flexDirection: "row", marginLeft: GRID_LABEL_W + GRID_LABEL_GAP, marginBottom: 3 }}>
        {weeks.map((_, col) => (
          <View key={col} style={{ width: GRID_CELL, marginRight: col < GRID_NUM_WEEKS - 1 ? GRID_GAP : 0 }}>
            <Text style={{ fontSize: 9, color: colors.textTertiary, lineHeight: 11 }}>
              {monthLabels[col] ?? ""}
            </Text>
          </View>
        ))}
      </View>

      {/* Day labels + week columns */}
      <View style={{ flexDirection: "row" }}>
        {/* Day-of-week labels */}
        <View style={{ width: GRID_LABEL_W, marginRight: GRID_LABEL_GAP }}>
          {DOW_LABELS.map((label, i) => (
            <View
              key={i}
              style={{ height: GRID_CELL, marginBottom: i < 6 ? GRID_GAP : 0, justifyContent: "center" }}
            >
              <Text style={{ fontSize: 8, color: colors.textTertiary, lineHeight: GRID_CELL }}>{label}</Text>
            </View>
          ))}
        </View>

        {/* Week columns */}
        {weeks.map((week, col) => (
          <View key={col} style={{ marginRight: col < GRID_NUM_WEEKS - 1 ? GRID_GAP : 0 }}>
            {week.map((dateStr, row) => {
              const secs    = dateStr ? (summaries[dateStr]?.totalSeconds ?? 0) : -1;
              const isToday = dateStr === todayStr;
              return (
                <View
                  key={row}
                  style={{
                    width: GRID_CELL,
                    height: GRID_CELL,
                    borderRadius: 2,
                    marginBottom: row < 6 ? GRID_GAP : 0,
                    backgroundColor: dateStr !== null ? getHeatmapColor(secs) : "transparent",
                    // Today: thin white ring
                    borderWidth: isToday ? 1 : 0,
                    borderColor: "rgba(255,255,255,0.5)",
                  }}
                />
              );
            })}
          </View>
        ))}
      </View>

      {/* Legend */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", marginTop: 10, gap: 3 }}>
        <Text style={{ fontSize: 8, color: colors.textTertiary, marginRight: 2 }}>less</Text>
        {LEGEND_STEPS.map((c, i) => (
          <View key={i} style={{ width: GRID_CELL, height: GRID_CELL, borderRadius: 2, backgroundColor: c }} />
        ))}
        <Text style={{ fontSize: 8, color: colors.textTertiary, marginLeft: 2 }}>more</Text>
      </View>
    </View>
  );
}

// ─── Habit Insight Generator ──────────────────────────────────────────────────

type Insight = {
  icon: string;
  title: string;
  body: string;
  color: string;
};

function generateInsights(
  summaries: Record<string, DailySummary>,
  allDates: string[]
): Insight[] {
  const insights: Insight[] = [];
  const vals = allDates.map((d) => summaries[d]?.totalSeconds ?? 0);

  // 1. Week-over-week trend
  const recent7 = vals.slice(-7);
  const prev7 = vals.slice(-14, -7);
  const recent7Avg = recent7.reduce((a, b) => a + b, 0) / 7;
  const prev7Avg = prev7.reduce((a, b) => a + b, 0) / 7;

  if (prev7Avg > 60) {
    const changePct = Math.round(((recent7Avg - prev7Avg) / prev7Avg) * 100);
    if (changePct <= -10) {
      insights.push({
        icon: "trending-down",
        title: `Down ${Math.abs(changePct)}% vs last week`,
        body: "You're using your phone less than last week. The momentum is real — keep it going.",
        color: colors.success,
      });
    } else if (changePct >= 15) {
      insights.push({
        icon: "trending-up",
        title: `Up ${changePct}% vs last week`,
        body: "Screen time is climbing. Try picking one app to remove from your home screen — friction is the best deterrent.",
        color: colors.destructive,
      });
    } else {
      insights.push({
        icon: "remove-circle-outline",
        title: "Roughly flat week-over-week",
        body: "Usage hasn't changed much. A 10% reduction on your top app per week adds up fast — pick the easiest target first.",
        color: colors.warning,
      });
    }
  }

  // 2. Worst day of week
  const byDOW: number[][] = Array.from({ length: 7 }, () => []);
  allDates.forEach((d) => {
    const date = new Date(d + "T12:00:00");
    const dow = (date.getDay() + 6) % 7; // 0=Mon…6=Sun
    const secs = summaries[d]?.totalSeconds ?? 0;
    if (secs > 0) byDOW[dow].push(secs);
  });
  const dowAvgs = byDOW.map((arr) =>
    arr.length >= 2 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
  );
  const worstDow = dowAvgs.indexOf(Math.max(...dowAvgs));
  const worstAvg = dowAvgs[worstDow];
  const overallAvg =
    vals.filter((x) => x > 0).reduce((a, b) => a + b, 0) /
    (vals.filter((x) => x > 0).length || 1);
  const DOW_NAMES = [
    "Monday", "Tuesday", "Wednesday",
    "Thursday", "Friday", "Saturday", "Sunday",
  ];

  if (worstAvg > 0 && worstAvg > overallAvg * 1.2) {
    const ratio = Math.round((worstAvg / overallAvg - 1) * 100);
    insights.push({
      icon: "calendar-outline",
      title: `${DOW_NAMES[worstDow]}s are your worst day`,
      body: `You average ${formatDuration(Math.round(worstAvg))} on ${DOW_NAMES[worstDow]}s — ${ratio}% above your usual. Try scheduling an offline activity that day.`,
      color: colors.warning,
    });
  }

  // 3. Session behaviour
  const totalSessions = allDates.reduce(
    (sum, d) => sum + (summaries[d]?.sessionCount ?? 0),
    0
  );
  const totalSecs = vals.reduce((a, b) => a + b, 0);
  const avgLen = totalSessions > 0 ? Math.round(totalSecs / totalSessions) : 0;

  if (avgLen > 0) {
    if (avgLen < 5 * 60) {
      insights.push({
        icon: "flash-outline",
        title: "Lots of quick checks",
        body: `Your average session is only ${formatDuration(avgLen)}. Frequent short checks are a classic dopamine loop — try scheduled phone windows instead of constant dips.`,
        color: colors.accentSecondary,
      });
    } else if (avgLen > 20 * 60) {
      insights.push({
        icon: "hourglass-outline",
        title: `Sessions average ${formatDuration(avgLen)}`,
        body: "Long sessions are hard to break once you're in the scroll. Setting a 10-minute app timer can interrupt the flow before it takes hold.",
        color: colors.destructive,
      });
    } else {
      insights.push({
        icon: "time-outline",
        title: `Sessions average ${formatDuration(avgLen)}`,
        body: "Watch for 'quick checks' that silently expand. Most doomscrolling starts as a 30-second intent and turns into much more.",
        color: colors.accentPrimary,
      });
    }
  }

  // 4. Streak (under 1h)
  const reversed = [...vals].reverse();
  let streak = 0;
  for (const v of reversed) {
    if (v < T_YELLOW) streak++;
    else break;
  }
  let overStreak = 0;
  for (const v of reversed) {
    if (v >= T_YELLOW) overStreak++;
    else break;
  }

  if (streak >= 2) {
    insights.push({
      icon: "flame-outline",
      title: `${streak}-day streak under 1h`,
      body: `${streak} days in a row under 1 hour. Streaks build identity — you're becoming someone who uses their phone intentionally.`,
      color: colors.success,
    });
  } else if (overStreak >= 3) {
    insights.push({
      icon: "alert-circle-outline",
      title: `${overStreak} days over 1h in a row`,
      body: "Breaking a streak of high-usage days takes a deliberate reset. Pick one app to delete or move off your home screen today.",
      color: colors.destructive,
    });
  }

  return insights.slice(0, 4);
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

type GroupStats = {
  groupAvgPerDay: number;
  leaderboard: {
    userId: string;
    displayName: string;
    isYou: boolean;
    totalSeconds: number;
    avgPerDay: number;
    byApp: Record<string, number>;
    streakDays: number;
    longestStreak: number;
    shamesSent: number;
    shamesReceived: number;
    rank: number;
  }[];
  appStats: Record<string, {
    groupAvg: number;
    members: { userId: string; displayName: string; isYou: boolean; seconds: number }[];
  }>;
};

export default function StatsScreen() {
  const navigation = useNavigation<any>();
  const [summaries, setSummaries] = useState<Record<string, DailySummary>>({});
  const [groupStats, setGroupStats] = useState<GroupStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchData() {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;

      const today = new Date();
      const start = new Date(today);
      start.setDate(today.getDate() - GRID_FETCH_DAYS);

      const url = `${API_URL}/api/usage/stats?start=${toDateString(start)}&end=${toDateString(today)}`;
      const [statsRes, groupRes] = await Promise.all([
        fetch(url, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_URL}/api/stats/group?days=7`, { headers: { Authorization: `Bearer ${token}` } })
          .catch(() => null),
      ]);

      if (statsRes.ok) {
        const data: DailySummary[] = await statsRes.json();
        const map: Record<string, DailySummary> = {};
        for (const entry of data) map[entry.date] = entry;
        setSummaries(map);
      }

      if (groupRes?.ok) {
        const data = await groupRes.json();
        setGroupStats(data);
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

  // ── Derived data ──────────────────────────────────────────────────────────

  const today = new Date();
  const todayStr = toDateString(today);
  const monday = getMondayOfWeek(today);
  const todayDOW = (today.getDay() + 6) % 7; // 0=Mon…6=Sun

  // 28 dates oldest → newest
  const allDates = Array.from({ length: 28 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - 27 + i);
    return toDateString(d);
  });

  const trendValues = allDates.map((d) => summaries[d]?.totalSeconds ?? 0);
  const trendLabels = allDates.map((d) => {
    const date = new Date(d + "T12:00:00");
    return `${date.getMonth() + 1}/${date.getDate()}`;
  });

  // This week Mon–Sun
  const thisWeekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return toDateString(d);
  });
  const thisWeekValues = thisWeekDates.map((d) => summaries[d]?.totalSeconds ?? 0);

  // Last week
  const lastWeekTotal = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() - 7 + i);
    return summaries[toDateString(d)]?.totalSeconds ?? 0;
  }).reduce((a, b) => a + b, 0);

  // Today
  const todayData = summaries[todayStr];
  const todayTotal = todayData?.totalSeconds ?? 0;
  const todaySessions = todayData?.sessionCount ?? 0;
  const todayMax = todayData?.maxSessionSeconds ?? 0;

  // 7-day avg excluding today
  const last7 = allDates.slice(-8, -1).map((d) => summaries[d]?.totalSeconds ?? 0);
  const last7WithData = last7.filter((x) => x > 0);
  const avg7 = last7WithData.length > 0
    ? Math.round(last7WithData.reduce((a, b) => a + b, 0) / last7WithData.length)
    : 0;
  const vsDailyAvgPct = avg7 > 0 ? Math.round(((todayTotal - avg7) / avg7) * 100) : null;

  // Week totals
  const thisWeekTotal = thisWeekValues.reduce((a, b) => a + b, 0);
  const daysWithData = thisWeekValues.filter((x) => x > 0).length;
  const thisWeekAvg = daysWithData > 0 ? Math.round(thisWeekTotal / daysWithData) : 0;
  const vsLastWeekPct =
    lastWeekTotal > 0
      ? Math.round(((thisWeekTotal - lastWeekTotal) / lastWeekTotal) * 100)
      : null;

  // By app this week
  const byApp: Record<string, number> = {};
  for (const d of thisWeekDates) {
    const s = summaries[d];
    if (s?.byApp) {
      for (const [app, secs] of Object.entries(s.byApp)) {
        byApp[app] = (byApp[app] ?? 0) + secs;
      }
    }
  }
  const sortedApps = Object.entries(byApp).sort((a, b) => b[1] - a[1]);
  const maxAppSecs = sortedApps.length > 0 ? sortedApps[0][1] : 1;

  const insights = generateInsights(summaries, allDates);
  const hasData = Object.keys(summaries).length > 0;

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
      <Text style={styles.pageTitle}>Statistics</Text>

      {/* ── GROUP LEADERBOARD ── */}
      {groupStats && groupStats.leaderboard.length > 1 && (
        <>
          <Text style={styles.sectionHeader}>This Week</Text>
          <View style={styles.card}>
            {groupStats.leaderboard.map((m, i) => (
              <View key={m.userId}>
                {i > 0 && <View style={styles.leaderDivider} />}
                <View style={[styles.leaderRow, m.isYou && styles.leaderRowYou]}>
                  <Text style={styles.leaderRank}>
                    {m.rank === 1 ? "👑" : m.rank === 2 ? "🥈" : m.rank === 3 ? "🥉" : `#${m.rank}`}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.leaderName, m.isYou && { color: colors.accentPrimary }]}>
                      {m.displayName}{m.isYou ? " (you)" : ""}
                    </Text>
                    {m.streakDays > 0 && (
                      <Text style={styles.leaderStreak}>🔥 {m.streakDays}d streak</Text>
                    )}
                  </View>
                  <Text style={[styles.leaderTime, m.isYou && { color: colors.accentPrimary }]}>
                    {formatDuration(m.avgPerDay)}/day
                  </Text>
                </View>
              </View>
            ))}
            <View style={styles.leaderDivider} />
            <View style={styles.leaderFooter}>
              <Text style={styles.leaderFooterText}>
                Group avg: {formatDuration(groupStats.groupAvgPerDay)}/day
              </Text>
              {groupStats.leaderboard.find((m) => m.isYou) && (
                <Text style={[
                  styles.leaderFooterText,
                  {
                    color: (groupStats.leaderboard.find((m) => m.isYou)?.avgPerDay ?? 0) <=
                      groupStats.groupAvgPerDay ? colors.success : colors.destructive,
                  },
                ]}>
                  You: {(groupStats.leaderboard.find((m) => m.isYou)?.avgPerDay ?? 0) <=
                    groupStats.groupAvgPerDay ? "below avg ✓" : "above avg"}
                </Text>
              )}
            </View>
          </View>

          {/* Per-app comparison */}
          {Object.keys(groupStats.appStats).length > 0 && (
            <>
              <Text style={styles.sectionHeader}>By App</Text>
              {Object.entries(groupStats.appStats)
                .sort(([, a], [, b]) => b.groupAvg - a.groupAvg)
                .slice(0, 5)
                .map(([app, stat]) => {
                  const you = stat.members.find((m) => m.isYou);
                  const maxSecs = Math.max(...stat.members.map((m) => m.seconds), 1);
                  return (
                    <View key={app} style={[styles.card, { padding: spacing.md }]}>
                      <Text style={styles.appCompTitle}>{app}</Text>
                      {stat.members.map((m) => (
                        <View key={m.userId} style={styles.appCompRow}>
                          <Text style={[styles.appCompName, m.isYou && { color: colors.accentPrimary }]} numberOfLines={1}>
                            {m.displayName}
                          </Text>
                          <View style={styles.appCompBarTrack}>
                            <View
                              style={[
                                styles.appCompBar,
                                {
                                  width: `${Math.round((m.seconds / maxSecs) * 100)}%` as any,
                                  backgroundColor: m.isYou ? colors.accentPrimary : colors.accentMuted,
                                },
                              ]}
                            />
                          </View>
                          <Text style={styles.appCompTime}>{formatDuration(m.seconds)}</Text>
                        </View>
                      ))}
                      <Text style={styles.appCompAvg}>avg: {formatDuration(stat.groupAvg)}</Text>
                    </View>
                  );
                })}
            </>
          )}

          {/* Streaks board */}
          {groupStats.leaderboard.some((m) => m.streakDays > 0) && (
            <>
              <Text style={styles.sectionHeader}>Streaks</Text>
              <View style={styles.card}>
                {groupStats.leaderboard
                  .filter((m) => m.streakDays > 0 || m.longestStreak > 0)
                  .sort((a, b) => b.streakDays - a.streakDays)
                  .map((m, i) => (
                    <View key={m.userId}>
                      {i > 0 && <View style={styles.leaderDivider} />}
                      <View style={[styles.leaderRow, m.isYou && styles.leaderRowYou]}>
                        <Text style={styles.leaderName}>
                          {m.isYou ? "You" : m.displayName}
                        </Text>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={styles.streakNumber}>🔥 {m.streakDays}d</Text>
                          <Text style={styles.streakBest}>best: {m.longestStreak}d</Text>
                        </View>
                      </View>
                    </View>
                  ))}
              </View>
            </>
          )}

          {/* Shame stats */}
          {groupStats.leaderboard.some((m) => m.shamesSent > 0 || m.shamesReceived > 0) && (
            <>
              <Text style={styles.sectionHeader}>Shame Stats</Text>
              <View style={styles.card}>
                <View style={styles.shameGrid}>
                  <View style={styles.shameCol}>
                    <Text style={styles.shameColHeader}>Sent</Text>
                    {groupStats.leaderboard
                      .sort((a, b) => b.shamesSent - a.shamesSent)
                      .map((m) => (
                        <View key={m.userId} style={styles.shameRow}>
                          <Text style={[styles.shameName, m.isYou && { color: colors.accentPrimary }]} numberOfLines={1}>
                            {m.isYou ? "You" : m.displayName}
                          </Text>
                          <Text style={styles.shameCount}>{m.shamesSent}</Text>
                        </View>
                      ))}
                  </View>
                  <View style={styles.shameColDivider} />
                  <View style={styles.shameCol}>
                    <Text style={styles.shameColHeader}>Received</Text>
                    {groupStats.leaderboard
                      .sort((a, b) => b.shamesReceived - a.shamesReceived)
                      .map((m) => (
                        <View key={m.userId} style={styles.shameRow}>
                          <Text style={[styles.shameName, m.isYou && { color: colors.accentPrimary }]} numberOfLines={1}>
                            {m.isYou ? "You" : m.displayName}
                          </Text>
                          <Text style={styles.shameCount}>{m.shamesReceived}</Text>
                        </View>
                      ))}
                  </View>
                </View>
              </View>
            </>
          )}

          {/* Wall of Shame link */}
          <TouchableOpacity
            style={styles.wallLink}
            onPress={() => navigation.navigate("WallOfShame")}
          >
            <Text style={styles.wallLinkText}>🏛️ Wall of Shame</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>

          <View style={styles.sectionSpacer} />
          <Text style={styles.sectionHeader}>Your Analytics</Text>
        </>
      )}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accentPrimary} size="large" />
        </View>
      ) : !hasData ? (
        <View style={styles.emptyCard}>
          <Ionicons name="bar-chart-outline" size={36} color={colors.textTertiary} />
          <Text style={styles.emptyTitle}>No data yet</Text>
          <Text style={styles.emptySubtext}>
            Set up iOS Shortcuts to start tracking your app usage. Pull down to refresh once data arrives.
          </Text>
        </View>
      ) : (
        <>
          {/* ── TODAY AT A GLANCE ── */}
          <Text style={styles.sectionHeader}>Today at a Glance</Text>
          <View style={styles.todayCard}>
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.todayBig,
                  { color: todayTotal > 0 ? getUsageColor(todayTotal) : colors.textTertiary },
                ]}
              >
                {formatDuration(todayTotal)}
              </Text>
              <View style={styles.todayMeta}>
                <Text style={styles.todayMetaText}>
                  {todaySessions} session{todaySessions !== 1 ? "s" : ""}
                </Text>
                {todayMax > 0 && (
                  <Text style={styles.todayMetaText}>
                    longest {formatDuration(todayMax)}
                  </Text>
                )}
              </View>
            </View>
            {vsDailyAvgPct !== null && (
              <View
                style={[
                  styles.badge,
                  {
                    backgroundColor:
                      vsDailyAvgPct <= 0
                        ? `${colors.success}22`
                        : `${colors.destructive}22`,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    { color: vsDailyAvgPct <= 0 ? colors.success : colors.destructive },
                  ]}
                >
                  {vsDailyAvgPct > 0 ? "+" : ""}
                  {vsDailyAvgPct}%{"\n"}vs avg
                </Text>
              </View>
            )}
          </View>

          {/* ── THIS WEEK ── */}
          <Text style={styles.sectionHeader}>This Week</Text>
          <View style={styles.card}>
            <WeekBarChart values={thisWeekValues} todayIdx={todayDOW} />

            <View style={styles.weekStats}>
              <View style={styles.weekStat}>
                <Text style={styles.weekStatVal}>{formatDuration(thisWeekTotal)}</Text>
                <Text style={styles.weekStatLabel}>total</Text>
              </View>
              <View style={styles.weekStat}>
                <Text style={styles.weekStatVal}>{formatDuration(thisWeekAvg)}</Text>
                <Text style={styles.weekStatLabel}>avg / day</Text>
              </View>
              {vsLastWeekPct !== null && (
                <View style={styles.weekStat}>
                  <Text
                    style={[
                      styles.weekStatVal,
                      {
                        color:
                          vsLastWeekPct <= 0 ? colors.success : colors.destructive,
                      },
                    ]}
                  >
                    {vsLastWeekPct > 0 ? "+" : ""}
                    {vsLastWeekPct}%
                  </Text>
                  <Text style={styles.weekStatLabel}>vs last wk</Text>
                </View>
              )}
            </View>

            <View style={styles.colorLegend}>
              {[
                { color: colors.success, label: "< 30m" },
                { color: colors.warning, label: "< 1h" },
                { color: "#FF6B00", label: "< 2h" },
                { color: colors.destructive, label: "2h+" },
              ].map(({ color, label }) => (
                <View key={label} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: color }]} />
                  <Text style={styles.legendText}>{label}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* ── ACTIVITY HEATMAP ── */}
          <Text style={styles.sectionHeader}>Last Month</Text>
          <View style={styles.card}>
            <ActivityHeatmap summaries={summaries} />
          </View>

          {/* ── 28-DAY TREND ── */}
          <Text style={styles.sectionHeader}>28-Day Trend</Text>
          <View style={styles.card}>
            <TrendLineChart values={trendValues} labels={trendLabels} />
          </View>

          {/* ── HABIT INSIGHTS ── */}
          {insights.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>Habit Insights</Text>
              {insights.map((ins, i) => (
                <View key={i} style={styles.insightCard}>
                  <View
                    style={[
                      styles.insightIcon,
                      { backgroundColor: `${ins.color}20` },
                    ]}
                  >
                    <Ionicons
                      name={ins.icon as any}
                      size={18}
                      color={ins.color}
                    />
                  </View>
                  <View style={styles.insightBody}>
                    <Text style={styles.insightTitle}>{ins.title}</Text>
                    <Text style={styles.insightText}>{ins.body}</Text>
                  </View>
                </View>
              ))}
            </>
          )}

          {/* ── BY APP THIS WEEK ── */}
          {sortedApps.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>By App This Week</Text>
              <View style={styles.card}>
                {sortedApps.map(([app, secs], i) => (
                  <View key={app}>
                    {i > 0 && <View style={styles.divider} />}
                    <View style={styles.appRow}>
                      <View style={styles.appMeta}>
                        <Text style={styles.appName}>{app}</Text>
                        <Text style={styles.appTime}>{formatDuration(secs)}</Text>
                      </View>
                      <View style={styles.barTrack}>
                        <View
                          style={[
                            styles.bar,
                            {
                              width: `${Math.round((secs / maxAppSecs) * 100)}%` as any,
                              backgroundColor: getUsageColor(secs / 7),
                            },
                          ]}
                        />
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}
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
    paddingBottom: spacing.xl * 2,
  },
  centered: { marginVertical: spacing.xl, alignItems: "center" },
  pageTitle: {
    fontSize: fontSize.page,
    fontWeight: "700",
    color: colors.textPrimary,
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
    letterSpacing: -0.5,
  },
  sectionHeader: {
    fontSize: fontSize.section,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: spacing.md,
    marginTop: spacing.sm,
    letterSpacing: -0.3,
  },
  card: {
    backgroundColor: colors.surface1,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },

  // Today card
  todayCard: {
    backgroundColor: colors.surface1,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  todayBig: {
    fontSize: 52,
    fontWeight: "800",
    letterSpacing: -2,
    lineHeight: 56,
  },
  todayMeta: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  todayMetaText: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
  },
  badge: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: "center",
  },
  badgeText: {
    fontSize: fontSize.small,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 16,
  },

  // Week stats row
  weekStats: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingTop: spacing.md,
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  weekStat: { alignItems: "center" },
  weekStatVal: {
    fontSize: fontSize.title,
    fontWeight: "700",
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  weekStatLabel: {
    fontSize: fontSize.tiny,
    color: colors.textTertiary,
    marginTop: 2,
  },

  // Color legend
  colorLegend: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.md,
    marginTop: spacing.md,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: fontSize.tiny, color: colors.textTertiary },

  // Insight cards
  insightCard: {
    backgroundColor: colors.surface1,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  insightIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  insightBody: { flex: 1 },
  insightTitle: {
    fontSize: fontSize.body,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 4,
  },
  insightText: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    lineHeight: 18,
  },

  // App breakdown
  appRow: { paddingVertical: spacing.sm },
  appMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  appName: {
    fontSize: fontSize.body,
    fontWeight: "600",
    color: colors.textPrimary,
    flex: 1,
  },
  appTime: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    minWidth: 50,
    textAlign: "right",
  },
  barTrack: {
    height: 4,
    backgroundColor: colors.surface2,
    borderRadius: 2,
    overflow: "hidden",
  },
  bar: { height: "100%", borderRadius: 2 },

  // Empty state
  emptyCard: {
    backgroundColor: colors.surface1,
    borderRadius: 12,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  emptyTitle: {
    fontSize: fontSize.title,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  emptySubtext: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    textAlign: "center",
    lineHeight: 18,
  },
  divider: { height: 1, backgroundColor: colors.border },

  // ── Social leaderboard styles ──
  leaderRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: spacing.sm,
  },
  leaderRowYou: {
    backgroundColor: `${colors.accentPrimary}14`,
  },
  leaderRank: {
    width: 28,
    fontSize: fontSize.body,
    textAlign: "center",
  },
  leaderName: {
    fontSize: fontSize.body,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  leaderStreak: {
    fontSize: fontSize.tiny,
    color: colors.warning,
    marginTop: 1,
  },
  leaderTime: {
    fontSize: fontSize.body,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  leaderDivider: {
    height: 1,
    backgroundColor: colors.surface2,
    marginHorizontal: spacing.md,
  },
  leaderFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  leaderFooterText: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
  },

  // App comparison
  appCompTitle: {
    fontSize: fontSize.title,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  appCompRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  appCompName: {
    width: 60,
    fontSize: fontSize.small,
    color: colors.textSecondary,
    fontWeight: "500",
  },
  appCompBarTrack: {
    flex: 1,
    height: 6,
    backgroundColor: colors.surface2,
    borderRadius: 3,
    overflow: "hidden",
  },
  appCompBar: {
    height: "100%",
    borderRadius: 3,
  },
  appCompTime: {
    width: 48,
    fontSize: fontSize.small,
    color: colors.textTertiary,
    textAlign: "right",
  },
  appCompAvg: {
    fontSize: fontSize.tiny,
    color: colors.textTertiary,
    marginTop: 4,
  },

  // Streaks
  streakNumber: {
    fontSize: fontSize.body,
    fontWeight: "700",
    color: colors.warning,
  },
  streakBest: {
    fontSize: fontSize.tiny,
    color: colors.textTertiary,
  },

  // Shame stats
  shameGrid: {
    flexDirection: "row",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  shameCol: {
    flex: 1,
    gap: 6,
  },
  shameColDivider: {
    width: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
  },
  shameColHeader: {
    fontSize: fontSize.small,
    fontWeight: "700",
    color: colors.textSecondary,
    marginBottom: 4,
  },
  shameRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  shameName: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    flex: 1,
  },
  shameCount: {
    fontSize: fontSize.body,
    fontWeight: "700",
    color: colors.textPrimary,
    minWidth: 24,
    textAlign: "right",
  },

  // Wall of Shame link
  wallLink: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.surface1,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  wallLinkText: {
    fontSize: fontSize.title,
    fontWeight: "600",
    color: colors.textPrimary,
  },

  sectionSpacer: {
    height: spacing.sm,
  },
});
