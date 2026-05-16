import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { colors, spacing, fontSize } from '../theme';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';

export default function SettingsScreen() {
  const [displayName, setDisplayName] = useState('');
  const [barkApiKey, setBarkApiKey] = useState('');
  const [quietStart, setQuietStart] = useState('');
  const [quietEnd, setQuietEnd] = useState('');
  const [dailyCap, setDailyCap] = useState('60');
  const [saving, setSaving] = useState(false);
  const [savingBark, setSavingBark] = useState(false);
  const [savingLimits, setSavingLimits] = useState(false);
  const [testingNotif, setTestingNotif] = useState(false);

  useEffect(() => {
    async function loadSettings() {
      try {
        const token = await auth.currentUser?.getIdToken();
        const [profileRes, notifRes] = await Promise.all([
          fetch(`${API_URL}/api/users/me`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API_URL}/api/users/me/notification-settings`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        if (profileRes.ok) {
          const data = await profileRes.json();
          if (data.displayName) setDisplayName(data.displayName);
        }
        if (notifRes.ok) {
          const data = await notifRes.json();
          if (data.barkApiKey) setBarkApiKey(data.barkApiKey);
          if (data.quietHoursStart) setQuietStart(data.quietHoursStart);
          if (data.quietHoursEnd) setQuietEnd(data.quietHoursEnd);
          if (data.dailyCapSeconds) setDailyCap(String(Math.round(data.dailyCapSeconds / 60)));
        }
      } catch (_) {}
    }
    loadSettings();
  }, []);

  async function handleSaveName() {
    if (!displayName.trim()) return;
    setSaving(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`${API_URL}/api/users/me`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ display_name: displayName.trim() }),
      });
      if (!res.ok) throw new Error('Failed to save');
      Alert.alert('Saved', 'Display name updated.');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveBarkKey() {
    if (!barkApiKey.trim()) return;
    setSavingBark(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`${API_URL}/api/users/me/notification-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ barkApiKey: barkApiKey.trim() }),
      });
      if (!res.ok) throw new Error('Failed to save');
      Alert.alert('Saved', 'Bark API key saved. Tap Test to verify.');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSavingBark(false);
    }
  }

  async function handleTestNotification() {
    setTestingNotif(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`${API_URL}/api/users/me/test-notification`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.status === 'ok') {
        Alert.alert('Sent', 'Check your Bark app.');
      } else {
        Alert.alert('Failed', data.reason ?? 'No token saved yet.');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setTestingNotif(false);
    }
  }

  async function handleSignOut() {
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut(auth) },
    ]);
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.pageTitle}>Settings</Text>

      <Text style={styles.sectionHeader}>Account</Text>
      <View style={styles.card}>
        <Text style={styles.fieldLabel}>Email</Text>
        <Text style={styles.fieldValue}>{auth.currentUser?.email ?? '—'}</Text>
      </View>

      <Text style={styles.sectionHeader}>Display Name</Text>
      <View style={styles.card}>
        <TextInput
          style={styles.input}
          placeholder="Your name (shown to friends)"
          placeholderTextColor={colors.textTertiary}
          value={displayName}
          onChangeText={setDisplayName}
        />
        <TouchableOpacity
          style={[styles.primaryButton, !displayName.trim() && styles.primaryButtonDisabled]}
          onPress={handleSaveName}
          disabled={saving || !displayName.trim()}
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Save</Text>}
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionHeader}>Notifications</Text>
      <View style={styles.card}>
        <Text style={styles.fieldLabel}>Bark API Key</Text>
        <Text style={styles.fieldHint}>
          Install the Bark app → copy your key from the home screen → paste it here.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. RjS5zcFdESzKpSfePygGLG"
          placeholderTextColor={colors.textTertiary}
          value={barkApiKey}
          onChangeText={setBarkApiKey}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity
          style={[styles.primaryButton, !barkApiKey.trim() && styles.primaryButtonDisabled]}
          onPress={handleSaveBarkKey}
          disabled={savingBark || !barkApiKey.trim()}
        >
          {savingBark ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Save</Text>}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.secondaryButton, !barkApiKey.trim() && styles.primaryButtonDisabled]}
          onPress={handleTestNotification}
          disabled={testingNotif || !barkApiKey.trim()}
        >
          {testingNotif ? <ActivityIndicator color={colors.accentPrimary} /> : <Text style={styles.secondaryButtonText}>Send Test Notification</Text>}
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionHeader}>Limits & Gateway</Text>
      <View style={styles.card}>
        <Text style={styles.fieldLabel}>Daily screen time limit (minutes)</Text>
        <TextInput
          style={styles.input}
          placeholder="60"
          placeholderTextColor={colors.textTertiary}
          value={dailyCap}
          onChangeText={setDailyCap}
          keyboardType="number-pad"
        />
        <Text style={styles.fieldLabel}>Quiet hours (24h format, e.g. 23:00)</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Start (23:00)"
            placeholderTextColor={colors.textTertiary}
            value={quietStart}
            onChangeText={setQuietStart}
          />
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="End (07:00)"
            placeholderTextColor={colors.textTertiary}
            value={quietEnd}
            onChangeText={setQuietEnd}
          />
        </View>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={async () => {
            setSavingLimits(true);
            try {
              const token = await auth.currentUser?.getIdToken();
              const body: any = {};
              const capMins = parseInt(dailyCap, 10);
              if (!isNaN(capMins) && capMins > 0) body.dailyCapSeconds = capMins * 60;
              if (quietStart.trim()) body.quietHoursStart = quietStart.trim();
              if (quietEnd.trim()) body.quietHoursEnd = quietEnd.trim();
              await fetch(`${API_URL}/api/users/me/notification-settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify(body),
              });
              Alert.alert('Saved', 'Limits updated.');
            } catch (e: any) {
              Alert.alert('Error', e.message);
            } finally {
              setSavingLimits(false);
            }
          }}
          disabled={savingLimits}
        >
          {savingLimits ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Save Limits</Text>}
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  pageTitle: {
    fontSize: fontSize.page,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.lg,
    letterSpacing: -0.5,
  },
  sectionHeader: {
    fontSize: fontSize.small,
    fontWeight: '500',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: colors.surface1,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  fieldLabel: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
  },
  fieldHint: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  fieldValue: {
    fontSize: fontSize.body,
    color: colors.textPrimary,
  },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: fontSize.body,
    color: colors.textPrimary,
  },
  primaryButton: {
    backgroundColor: colors.accentPrimary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    backgroundColor: colors.accentMuted,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  secondaryButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.accentPrimary,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: colors.accentPrimary,
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  signOutButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.destructive,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  signOutText: {
    color: colors.destructive,
    fontSize: fontSize.body,
    fontWeight: '600',
  },
});
