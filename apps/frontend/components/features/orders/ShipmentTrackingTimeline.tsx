import { useTranslation } from 'react-i18next';
import type { ShipmentTrackingEvent } from '@selene/types';

import { Box, Text } from '../../../components/base';
import {
  getTrackingEventDescription,
  getTrackingEventLabelKey,
} from '../../../core/utils/tracking-timeline';

interface ShipmentTrackingTimelineProps {
  events: ShipmentTrackingEvent[];
  isLoading: boolean;
  error: unknown;
}

export function ShipmentTrackingTimeline({
  events,
  isLoading,
  error,
}: ShipmentTrackingTimelineProps) {
  const { t, i18n } = useTranslation('orders');

  if (isLoading) {
    return <Text variant="body-sm" color="textSecondary">{t('tracking.loading')}</Text>;
  }

  if (error) {
    return <Text variant="body-sm" color="error">{t('tracking.error')}</Text>;
  }

  if (!events.length) {
    return <Text variant="body-sm" color="textSecondary">{t('tracking.empty')}</Text>;
  }

  return (
    <Box gap="m">
      {events.map((event) => (
        <Box
          key={event.id}
          borderLeftWidth={2}
          borderLeftColor="primary"
          paddingLeft="m"
        >
          <Text variant="body-md" fontWeight="bold" color="textPrimary">
            {t(getTrackingEventLabelKey(event.event_type))}
          </Text>
          <Text variant="body-sm" color="textSecondary">
            {getTrackingEventDescription(event)}
          </Text>
          {event.location ? (
            <Text variant="caption-md" color="textSecondary">
              {event.location}
            </Text>
          ) : null}
          <Text variant="caption-md" color="textSecondary">
            {new Date(event.event_at).toLocaleString(i18n.language)}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
