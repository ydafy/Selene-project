/**
 * Formatea una fecha y hora en el formato - -> dd/mm/yyyy - hh:mm AM/PM.
 */
export const formatTime = (dateStr?: string | null): string => {
  if (!dateStr) return '--/--/---- --:--';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '--/--/---- --:--';

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();

  const time = date.toLocaleTimeString('es-MX', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return `${day}/${month}/${year} - ${time}`;
};
