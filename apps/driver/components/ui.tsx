import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { colors, radius, shadow } from '@/lib/theme';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const bg = variant === 'primary' ? colors.brand : variant === 'danger' ? colors.danger : 'transparent';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'secondary' && { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={variant === 'primary' || variant === 'danger' ? '#fff' : colors.brand} /> : (
        <Text style={[styles.buttonText, (variant === 'secondary' || variant === 'ghost') && { color: variant === 'ghost' ? colors.muted : colors.text }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Input(props: TextInputProps) {
  return <TextInput placeholderTextColor={colors.faint} {...props} style={[styles.input, props.style]} />;
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export function Pill({ text, tone = 'default' }: { text: string; tone?: 'default' | 'good' | 'warn' | 'bad' }) {
  const tones = { default: ['#f1f5f9', colors.muted], good: ['#ecfdf5', colors.success], warn: ['#fffbeb', '#b45309'], bad: ['#fef2f2', colors.danger] } as const;
  const [bg, fg] = tones[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' }}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

export function Centered({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 }}>{children}</View>;
}

export function Muted({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: center ? 'center' : 'left' }}>{children}</Text>;
}

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>{children}</Text>;
}

const styles = StyleSheet.create({
  button: { height: 46, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 14, ...shadow.card },
  input: { height: 46, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, paddingHorizontal: 12, fontSize: 15, backgroundColor: colors.surface, color: colors.text },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, gap: 12 },
  rowLabel: { color: colors.muted, fontSize: 13 },
  rowValue: { color: colors.text, fontSize: 13, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
});
