import { Text, TextInput, TouchableOpacity, View } from 'react-native';

import { styles } from './styles';
import type { ButtonVariant } from './types';

export function ActionButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
}) {
  const inactive = disabled || loading || variant === 'disabled';
  return (
    <TouchableOpacity
      disabled={inactive}
      onPress={onPress}
      style={[
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'ghost' && styles.buttonGhost,
        variant === 'danger' && styles.buttonDanger,
        inactive && styles.buttonDisabled,
      ]}
    >
      <View style={styles.buttonContent}>
        <Text
          style={[
            styles.buttonText,
            variant === 'secondary' && styles.buttonTextSecondary,
            variant === 'ghost' && styles.buttonTextGhost,
            variant === 'danger' && styles.buttonTextDanger,
            inactive && styles.buttonTextDisabled,
          ]}
        >
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export function PasswordField({
  value,
  onChangeText,
  placeholder,
  visible,
  onToggleVisible,
  showLabel,
  hideLabel,
  error,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  visible: boolean;
  onToggleVisible: () => void;
  showLabel: string;
  hideLabel: string;
  error?: string;
}) {
  return (
    <View style={styles.passwordFieldShell}>
      <View style={styles.passwordField}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#6d7892"
          secureTextEntry={!visible}
          style={styles.passwordInput}
        />
        <TouchableOpacity onPress={onToggleVisible} style={styles.passwordToggle}>
          <Text style={styles.passwordToggleText}>{visible ? hideLabel : showLabel}</Text>
        </TouchableOpacity>
      </View>
      {error ? (
        <Text accessibilityLiveRegion="polite" style={styles.fieldError}>{error}</Text>
      ) : null}
    </View>
  );
}
