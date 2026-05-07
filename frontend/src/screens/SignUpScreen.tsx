import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  Animated,
  Keyboard,
} from 'react-native';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { colors, spacing, fontSize } from '../theme';

type Props = {
  onNavigateToSignIn: () => void;
};

export default function SignUpScreen({ onNavigateToSignIn }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const scaleAnim = new Animated.Value(1);

  async function handleSignUp() {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter your email and password.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters.');
      return;
    }
    Keyboard.dismiss();
    setLoading(true);
    try {
      await createUserWithEmailAndPassword(auth, email, password);
    } catch (e: any) {
      Alert.alert('Sign up failed', e.message);
    } finally {
      setLoading(false);
    }
  }

  const handleButtonPressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.96,
      useNativeDriver: true,
    }).start();
  };

  const handleButtonPressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
    }).start();
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.keyboardView}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <View style={styles.topSection}>
          <View style={styles.iconContainer}>
            <Text style={styles.icon}>🚀</Text>
          </View>
          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>Start tracking your screen time</Text>
        </View>

        <View style={styles.formSection}>
          <View style={[styles.inputWrapper, emailFocused ? styles.inputWrapperFocused : null]}>
            <Text style={styles.inputLabel}>Email</Text>
            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              onFocus={() => setEmailFocused(true)}
              onBlur={() => setEmailFocused(false)}
              editable={!loading}
            />
          </View>

          <View style={[styles.inputWrapper, passwordFocused ? styles.inputWrapperFocused : null]}>
            <Text style={styles.inputLabel}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              onFocus={() => setPasswordFocused(true)}
              onBlur={() => setPasswordFocused(false)}
              editable={!loading}
            />
            {password.length > 0 && password.length < 6 && (
              <Text style={styles.helperText}>Min 6 characters</Text>
            )}
          </View>
        </View>

        <Animated.View style={[styles.buttonContainer, { transform: [{ scale: scaleAnim }] }]}>
          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSignUp}
            onPressIn={handleButtonPressIn}
            onPressOut={handleButtonPressOut}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.buttonText}>Sign Up</Text>
            )}
          </TouchableOpacity>
        </Animated.View>

        <View style={styles.footerSection}>
          <Text style={styles.footerText}>Already have an account?</Text>
          <TouchableOpacity onPress={onNavigateToSignIn}>
            <Text style={styles.linkText}>Sign in</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    justifyContent: 'space-between',
  },
  topSection: {
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.surface1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  icon: {
    fontSize: 40,
  },
  title: {
    fontSize: fontSize.page,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  formSection: {
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  inputWrapper: {
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    paddingBottom: spacing.sm,
  },
  inputWrapperFocused: {
    borderBottomColor: colors.accentPrimary,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  input: {
    fontSize: fontSize.body,
    color: colors.textPrimary,
    paddingVertical: spacing.sm,
  },
  helperText: {
    fontSize: 12,
    color: colors.accentSecondary,
    marginTop: spacing.xs,
  },
  buttonContainer: {
    marginBottom: spacing.lg,
  },
  button: {
    width: '100%',
    height: 56,
    backgroundColor: colors.accentPrimary,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.accentPrimary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#fff',
    fontSize: fontSize.body,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  footerSection: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
    paddingBottom: spacing.lg,
  },
  footerText: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
  linkText: {
    color: colors.accentSecondary,
    fontSize: fontSize.body,
    fontWeight: '600',
  },
});
