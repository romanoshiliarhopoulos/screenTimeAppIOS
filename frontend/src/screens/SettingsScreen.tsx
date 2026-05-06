import { useState } from 'react';
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
  const [saving, setSaving] = useState(false);

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

  async function handleSignOut() {
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => signOut(auth),
      },
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
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>Save</Text>
          )}
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
