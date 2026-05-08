import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Video, ResizeMode } from "expo-av";
import { auth } from "../lib/firebase";
import { colors, spacing, fontSize } from "../theme";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";

type Props = {
  targetUserId: string;
  targetName: string;
  onDone: () => void;
  onCancel: () => void;
};

export default function ShameRecordScreen({
  targetUserId,
  targetName,
  onDone,
  onCancel,
}: Props) {
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function recordVideo() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Camera access is required to record shame videos");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["videos"],
      videoMaxDuration: 15,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
      allowsEditing: true,
    });

    if (!result.canceled && result.assets[0]) {
      setVideoUri(result.assets[0].uri);
    }
  }

  async function sendShame() {
    if (!videoUri) return;
    setUploading(true);

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");

      // For now, send as quick shame with video URI
      // In production, upload to Firebase Storage first
      const res = await fetch(
        `${API_URL}/api/shame?toUserId=${targetUserId}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "video",
            videoUrl: videoUri, // local URI — in production, upload first
            message: `Video shame from ${auth.currentUser?.email}`,
          }),
        },
      );

      const data = await res.json();
      if (data.status === "sent") {
        Alert.alert("Shame sent!", `${targetName} will see this next time they open an app`);
        onDone();
      } else {
        Alert.alert("Could not send", data.message || "Try again later");
      }
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to send shame");
    } finally {
      setUploading(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onCancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Shame {targetName}</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.content}>
        {!videoUri ? (
          <>
            <Text style={styles.instruction}>
              Record a 15-second video to send to {targetName}
            </Text>
            <TouchableOpacity style={styles.recordButton} onPress={recordVideo}>
              <View style={styles.recordDot} />
              <Text style={styles.recordText}>Record Video</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Video
              source={{ uri: videoUri }}
              style={styles.preview}
              resizeMode={ResizeMode.COVER}
              shouldPlay
              isLooping
            />
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={styles.retakeButton}
                onPress={() => {
                  setVideoUri(null);
                  recordVideo();
                }}
              >
                <Text style={styles.retakeText}>Retake</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.sendButton}
                onPress={sendShame}
                disabled={uploading}
              >
                {uploading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.sendText}>Send Shame 🔥</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingTop: 60,
    paddingBottom: spacing.md,
  },
  cancelText: {
    fontSize: fontSize.body,
    color: colors.accentPrimary,
    fontWeight: "600",
  },
  title: {
    fontSize: fontSize.title,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  instruction: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
  recordButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.destructive,
    borderRadius: 40,
    paddingHorizontal: 32,
    paddingVertical: 18,
  },
  recordDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#fff",
  },
  recordText: {
    fontSize: fontSize.title,
    fontWeight: "700",
    color: "#fff",
  },
  preview: {
    width: "100%",
    aspectRatio: 9 / 16,
    borderRadius: 12,
    maxHeight: 400,
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  retakeButton: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  retakeText: {
    fontSize: fontSize.body,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  sendButton: {
    flex: 1,
    backgroundColor: colors.destructive,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  sendText: {
    fontSize: fontSize.body,
    fontWeight: "700",
    color: "#fff",
  },
});
