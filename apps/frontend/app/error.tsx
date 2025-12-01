import { useTranslation } from 'react-i18next';
import { ErrorBoundaryProps } from 'expo-router';
import { ScreenLayout } from '../components/layout/ScreenLayout';
import { ErrorState } from '../components/ui/ErrorState';

/**
 * Global Error Boundary.
 * Captura errores no controlados en cualquier parte de la navegación
 * y muestra una pantalla amigable en lugar de cerrar la app.
 */
export default function GlobalErrorBoundary({
  //error,
  retry,
}: ErrorBoundaryProps) {
  const { t } = useTranslation('common');

  // Opcional: Aquí podrías loguear el error a un servicio como Sentry
  // console.error("Global Error Boundary caught:", error);

  return (
    <ScreenLayout>
      <ErrorState
        title={t('globalError.title')}
        message={t('globalError.message')}
        onRetry={retry}
      />
    </ScreenLayout>
  );
}
