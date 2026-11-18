import { useEffect, useState } from 'react';
import {
  ScrollView,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';

import { Box, Text } from '@/shared/ui/base';
import type { Theme } from '@/shared/theme';
import { ConfirmDialog } from '@/shared/ui/feedback/confirm-dialog';
import { FormTextInput } from '@/shared/ui/form/form-text-input';
import {
  REPORT_DETAILS_MAX_LENGTH,
  REPORT_REASONS,
  type ReportContext,
  type ReportReason,
} from '@/shared/hooks/use-moderation.logic';

type ReportDialogProps = {
  visible: boolean;
  context: ReportContext;
  loading: boolean;
  onCancel: () => void;
  onSubmit: (report: { reason: ReportReason; details: string }) => void;
};

/** Asks for a report reason (required) and optional details. */
export const ReportDialog = ({
  visible,
  context,
  loading,
  onCancel,
  onSubmit,
}: ReportDialogProps) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('product');
  const { height } = useWindowDimensions();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');

  // Every report starts from a blank form.
  useEffect(() => {
    if (visible) {
      setReason(null);
      setDetails('');
    }
  }, [visible]);

  return (
    <ConfirmDialog
      visible={visible}
      title={t(`product:report.${context}.title`)}
      onCancel={onCancel}
      onConfirm={() => {
        if (reason) onSubmit({ reason, details });
      }}
      confirmLabel={t('product:report.submit')}
      loading={loading}
      disabled={!reason}
      avoidKeyboard
      icon="flag-outline"
    >
      <ScrollView
        style={{ maxHeight: height * 0.5 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text variant="body-md" color="textSecondary" marginBottom="s">
          {t('product:report.reasonLabel')}
        </Text>
        {REPORT_REASONS.map((option) => {
          const selected = option === reason;
          return (
            <TouchableOpacity
              key={option}
              onPress={() => setReason(option)}
              disabled={loading}
              activeOpacity={0.7}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled: loading }}
            >
              <Box flexDirection="row" alignItems="center" paddingVertical="s">
                <MaterialCommunityIcons
                  name={selected ? 'radiobox-marked' : 'radiobox-blank'}
                  size={20}
                  color={
                    selected ? theme.colors.primary : theme.colors.textSecondary
                  }
                />
                <Text
                  variant="body-md"
                  color="textPrimary"
                  marginLeft="s"
                  flex={1}
                >
                  {t(`product:report.reasons.${option}`)}
                </Text>
              </Box>
            </TouchableOpacity>
          );
        })}
        <Box marginTop="m">
          <FormTextInput
            label={t('product:report.detailsLabel')}
            placeholder={t('product:report.detailsPlaceholder')}
            labelMode="static"
            value={details}
            onChangeText={setDetails}
            maxLength={REPORT_DETAILS_MAX_LENGTH}
            multiline
            editable={!loading}
          />
          <Text
            variant="caption-md"
            color="textSecondary"
            textAlign="right"
            marginTop="xs"
          >
            {`${details.length}/${REPORT_DETAILS_MAX_LENGTH}`}
          </Text>
        </Box>
      </ScrollView>
    </ConfirmDialog>
  );
};
